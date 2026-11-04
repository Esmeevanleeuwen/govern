<?php
declare(strict_types=1);
namespace Govern;

use PDO;
use PDOException;

/** Text/NULL-only mappings shared by new and existing destinations. */
final class DatasetMapping
{
    public function __construct(private readonly Database $database) {}

    /** Validate a plan without touching a database that does not exist yet. */
    public static function normalize(array $parsed, array $tables): array
    {
        if (!isset($parsed['datasets']) || !is_array($parsed['datasets']) || !array_is_list($tables)
            || count($tables) < 1 || count($tables) > 32) self::invalid();
        $result = $seenTables = $seenDatasets = [];
        foreach ($tables as $input) {
            if (!is_array($input) || array_diff(array_keys($input), ['dataset', 'table', 'mode', 'version', 'mapping']) !== []) self::invalid();
            $index = $input['dataset'] ?? null;
            $name = $input['table'] ?? null;
            $mode = $input['mode'] ?? 'create';
            if (!is_int($index) || !isset($parsed['datasets'][$index]) || isset($seenDatasets[$index])
                || !is_string($name) || $name === '' || strlen($name) > 63 || preg_match('//u', $name) !== 1
                || preg_match('/[\x00-\x1f\x7f]/', $name)
                || ($mode === 'create' && !preg_match('/\A[A-Za-z][A-Za-z0-9_]{0,62}\z/D', $name))
                || str_starts_with(strtolower($name), '_govern_') || isset($seenTables[strtolower($name)])
                || !in_array($mode, ['create', 'append'], true)) self::invalid();
            $seenTables[strtolower($name)] = $seenDatasets[$index] = true;
            $dataset = $parsed['datasets'][$index];
            self::validateDataset($dataset);
            $sourceNames = array_column($dataset['columns'], 'name');
            $mapping = $input['mapping'] ?? array_map(static fn (string $source): array =>
                ['source' => $source, 'target' => $source, 'empty_as_null' => false], $sourceNames);
            if (!is_array($mapping) || !array_is_list($mapping) || count($mapping) !== count($sourceNames)) self::invalid();
            $sources = $targets = $normalized = [];
            foreach ($mapping as $map) {
                if (!is_array($map) || array_diff(array_keys($map), ['source', 'target', 'empty_as_null']) !== []) self::invalid();
                $source = $map['source'] ?? null;
                $target = $map['target'] ?? null;
                $empty = $map['empty_as_null'] ?? false;
                if (!is_string($source) || !in_array($source, $sourceNames, true) || isset($sources[$source]) || !is_bool($empty)) self::invalid();
                $sources[$source] = true;
                if ($target !== null) {
                    if (!is_string($target) || $target === '' || strlen($target) > 63 || preg_match('//u', $target) !== 1
                        || preg_match('/[\x00-\x1f\x7f]/', $target) || isset($targets[strtolower($target)])
                        || str_starts_with(strtolower($target), '_govern_')
                        || ($mode === 'create' && !preg_match('/\A[A-Za-z][A-Za-z0-9_]{0,62}\z/D', $target))) self::invalid();
                    $targets[strtolower($target)] = true;
                }
                $normalized[] = ['source' => $source, 'target' => $target, 'empty_as_null' => $empty];
            }
            if ($targets === []) self::invalid();
            $version = $input['version'] ?? '';
            if (!is_string($version) || ($mode === 'append' && !preg_match('/\A[a-f0-9]{64}\z/D', $version))) self::invalid();
            $result[] = ['dataset' => $index, 'table' => $name, 'mode' => $mode, 'version' => $version, 'mapping' => $normalized];
        }
        return $result;
    }

    /** Catalog tables remain visible, with an explanation when unavailable. */
    public function preview(array $parsed): array
    {
        $targets = [];
        foreach ((new Catalog($this->database))->tables() as $table) {
            $name = (string) $table['name'];
            if (str_starts_with($name, '_govern_')) continue;
            $definition = $this->definition($name);
            $targets[] = ['name' => $name, 'version' => $definition['version'], 'eligible' => $definition['eligible'],
                'reason' => $definition['reason'], 'columns' => $definition['columns']];
        }
        $datasets = [];
        $remaining = Preview::RESULT_BYTES;
        foreach ($parsed['datasets'] as $index => $dataset) {
            self::validateDataset($dataset);
            $rows = [];
            $shortened = count($dataset['rows']) > 20;
            foreach (array_slice($dataset['rows'], 0, 20) as $row) {
                $row = Preview::row($row, $shortened);
                $bytes = Preview::bytes($row);
                if ($bytes > $remaining) { $shortened = true; break; }
                $remaining -= $bytes;
                $rows[] = $row;
            }
            $datasets[] = [...$dataset, 'index' => $index, 'rows' => $rows,
                'preview_truncated' => $shortened, 'targets' => $targets];
        }
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(),
            'datasets' => $datasets, 'targets' => $targets, 'sha256' => $parsed['sha256']];
    }

    public function prepare(array $parsed, array $tables): array
    {
        $plans = self::normalize($parsed, $tables);
        foreach ($plans as $plan) {
            if ($plan['mode'] === 'create') {
                if ($this->exists($plan['table'])) throw ApiException::fromCode('dataset_exists', 409);
            } else {
                $target = $this->definition($plan['table']);
                if (!$target['eligible']) throw ApiException::fromCode('dataset_append_unsupported', 422, ['table' => $plan['table']]);
                if (!hash_equals($target['version'], $plan['version'])) throw ApiException::fromCode('dataset_changed', 409);
                $this->validateValues($parsed['datasets'][$plan['dataset']], $plan, $target['columns']);
            }
        }
        return $plans;
    }

    /** Callbacks run after publication, so stop requests run between real units. */
    public function execute(array $parsed, array $tables, ?callable $progress = null, ?callable $heartbeat = null): array
    {
        $plans = $this->prepare($parsed, $tables);
        $completed = [];
        foreach ($plans as $plan) {
            $uncertain = false;
            try { $item = $this->publish($parsed['datasets'][$plan['dataset']], $plan, $uncertain, $heartbeat); }
            catch (\Throwable $error) { throw new DatasetMappingException($completed, $uncertain, $error); }
            $completed[] = $item;
            if ($progress !== null) $progress($item, $completed);
        }
        return ['tables' => $completed, 'imported' => array_sum(array_column($completed, 'imported'))];
    }

    private function publish(array $dataset, array $plan, bool &$uncertain, ?callable $heartbeat): array
    {
        $pdo = $this->database->scriptConnection();
        $postgres = $this->database->engine() === 'postgres';
        $stage = null;
        $phase = 'prepare';
        $mapping = array_values(array_filter($plan['mapping'], static fn (array $m): bool => $m['target'] !== null));
        $columns = array_map(fn (array $m): string => $this->database->quoteIdentifier($m['target']), $mapping);
        try {
            if ($postgres) $pdo->beginTransaction();
            if ($plan['mode'] === 'create') {
                if ($this->exists($plan['table'])) throw ApiException::fromCode('dataset_exists', 409);
                $stage = $postgres ? null : '_govern_import_' . bin2hex(random_bytes(12));
                $definitions = implode(', ', array_map(static fn (string $column): string => $column . ($postgres ? ' pg_catalog.text NULL' : ' LONGTEXT NULL'), $columns));
                $id = $postgres ? '"_govern_id" pg_catalog.int8 GENERATED ALWAYS AS IDENTITY PRIMARY KEY' : '`_govern_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
                $pdo->exec('CREATE TABLE ' . $this->qualified($stage ?? $plan['table']) . ' (' . $id . ', ' . $definitions . ')'
                    . ($postgres ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'));
            }
            if (!$postgres) $pdo->beginTransaction();
            if ($plan['mode'] === 'append') {
                $qualified = $this->qualified($plan['table']);
                if ($postgres) $pdo->exec('LOCK TABLE ' . $qualified . ' IN ROW EXCLUSIVE MODE');
                else $pdo->query('SELECT 1 FROM ' . $qualified . ' LIMIT 0')->closeCursor();
                $fresh = $this->definition($plan['table']);
                if (!$fresh['eligible'] || !hash_equals($plan['version'], $fresh['version'])) throw ApiException::fromCode('dataset_changed', 409);
                $this->validateValues($dataset, $plan, $fresh['columns']);
            }
            $positions = array_flip(array_column($dataset['columns'], 'name'));
            $statement = $pdo->prepare('INSERT INTO ' . $this->qualified($stage ?? $plan['table']) . ' (' . implode(', ', $columns) . ') VALUES ('
                . implode(', ', array_fill(0, count($columns), '?')) . ')');
            $lastHeartbeat = microtime(true);
            foreach ($dataset['rows'] as $rowIndex => $row) {
                foreach ($mapping as $index => $map) {
                    $value = $row[$positions[$map['source']]];
                    if ($value === '' && $map['empty_as_null']) $value = null;
                    $statement->bindValue($index + 1, $value, $value === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                }
                $statement->execute();
                if ($heartbeat !== null && (($rowIndex + 1) % 500 === 0 || microtime(true) - $lastHeartbeat >= 5)) {
                    // Activity only: these rows are still inside the transaction.
                    $heartbeat();
                    $lastHeartbeat = microtime(true);
                }
            }
            $statement->closeCursor();
            $phase = 'commit';
            if (!$pdo->commit()) throw new \RuntimeException('Dataset commit was not acknowledged.');
            $phase = 'publish';
            if ($stage !== null) {
                $pdo->exec('RENAME TABLE ' . $this->qualified($stage) . ' TO ' . $this->qualified($plan['table']));
                $stage = null;
            }
            return ['table' => $plan['table'], 'imported' => count($dataset['rows']), 'mode' => $plan['mode']];
        } catch (\Throwable $error) {
            $rolledBack = false;
            try { if ($pdo->inTransaction()) { $pdo->rollBack(); $rolledBack = true; } }
            catch (\Throwable) { $uncertain = true; }
            if ($phase === 'commit' && !$rolledBack) $uncertain = true;
            if ($phase === 'publish' && $stage !== null) {
                $collision = $error instanceof PDOException && (int) ($error->errorInfo[1] ?? 0) === 1050;
                if (!$collision) $uncertain = true;
            }
            if ($stage !== null) {
                try { $pdo->exec('DROP TABLE IF EXISTS ' . $this->qualified($stage)); }
                catch (\Throwable) { $uncertain = true; }
            }
            if ($error instanceof PDOException && in_array($error->getCode(), ['42P07', '42710'], true)) throw ApiException::fromCode('dataset_exists', 409);
            throw $error;
        }
    }

    private function definition(string $table): array
    {
        $catalog = new Catalog($this->database);
        $definition = $catalog->structure($table);
        $postgres = $this->database->engine() === 'postgres';
        // The configured MariaDB writer has TRIGGER on its exact work scope;
        // a SELECT-only account cannot enumerate trigger metadata reliably.
        $pdo = $postgres ? $this->database->reader() : $this->database->writer();
        if ($postgres) {
            $q = $pdo->prepare("SELECT c.oid::text AS object_id, c.relkind,
                (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
                (SELECT count(*) FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid AND r.rulename <> '_RETURN') AS rules
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=? AND c.relname=?");
        } else {
            $q = $pdo->prepare('SELECT ENGINE, CREATE_TIME, (SELECT COUNT(*) FROM information_schema.TRIGGERS r WHERE r.TRIGGER_SCHEMA=t.TABLE_SCHEMA AND r.EVENT_OBJECT_TABLE=t.TABLE_NAME) AS triggers
                FROM information_schema.TABLES t WHERE TABLE_SCHEMA=? AND TABLE_NAME=?');
        }
        $q->execute([$this->database->schemaName(), $table]);
        $identity = $q->fetch(PDO::FETCH_ASSOC);
        if (!$identity) throw ApiException::fromCode('dataset_changed', 409);
        if ($postgres) {
            $q = $pdo->prepare('SELECT oid::text, conname, pg_catalog.pg_get_constraintdef(oid,true) AS definition
                FROM pg_catalog.pg_constraint WHERE conrelid=? ORDER BY oid');
            $q->execute([$identity['object_id']]);
            $identity['constraints'] = $q->fetchAll(PDO::FETCH_ASSOC);
        }
        $reason = $definition['type'] !== 'table' ? 'view' : null;
        if (($postgres && $identity['relkind'] !== 'r') || (!$postgres && $identity['ENGINE'] !== 'InnoDB')) $reason ??= 'unsupported_table';
        if ((int) $identity['triggers'] !== 0) $reason ??= 'triggers';
        if ($postgres && (int) $identity['rules'] !== 0) $reason ??= 'triggers';
        foreach ($definition['columns'] as &$column) {
            $column['importable'] = !$column['generated'] && !$column['auto_increment']
                && in_array($column['data_type'], $postgres ? ['text', 'varchar'] : ['longtext', 'mediumtext', 'text', 'varchar'], true)
                && (!$postgres || (($column['type_schema'] ?? '') === 'pg_catalog' && ($column['type_kind'] ?? '') === 'b'));
            if (!$column['generated'] && !$column['auto_increment'] && !$column['importable']) $reason ??= 'unsupported_columns';
        }
        unset($column);
        $definition['create_sql'] = preg_replace('/\bAUTO_INCREMENT=\d+\s*/i', '', $definition['create_sql'] ?? '');
        return [...$definition, 'eligible' => $reason === null, 'reason' => $reason,
            'version' => hash('sha256', serialize([$this->database->engine(), $this->database->name(), $this->database->schemaName(), $definition, $identity]))];
    }

    private function validateValues(array $dataset, array $plan, array $columns): void
    {
        $byName = array_column($columns, null, 'name');
        $positions = array_flip(array_column($dataset['columns'], 'name'));
        $mapped = [];
        foreach ($plan['mapping'] as $map) {
            if ($map['target'] === null) continue;
            $column = $byName[$map['target']] ?? null;
            if ($column === null || !$column['importable']) self::invalid();
            $mapped[$map['target']] = true;
            foreach ($dataset['rows'] as $rowIndex => $row) {
                $value = $row[$positions[$map['source']]];
                if ($value === '' && $map['empty_as_null']) $value = null;
                $reason = $value === null && !$column['nullable'] ? 'null' : null;
                if ($value !== null) {
                    if (preg_match('/^(?:character varying|varchar)\((\d+)\)/i', $column['type'], $match)) {
                        preg_match_all('/./us', $value, $characters);
                        if (count($characters[0]) > (int) $match[1]) $reason = 'length';
                    }
                    if ($this->database->engine() === 'mariadb' && $column['data_type'] === 'text' && strlen($value) > 65535) $reason = 'length';
                }
                if ($reason !== null) throw ApiException::fromCode('dataset_mapping_value', 422,
                    ['column' => $map['target'], 'row' => $rowIndex + 1, 'reason' => $reason]);
            }
        }
        foreach ($columns as $column) {
            if (!isset($mapped[$column['name']]) && !$column['generated'] && !$column['auto_increment']
                && !$column['nullable'] && $column['default'] === null) throw ApiException::fromCode('dataset_mapping_value', 422,
                    ['column' => $column['name'], 'row' => 0, 'reason' => 'required']);
        }
    }

    private function exists(string $table): bool
    {
        $pdo = $this->database->reader();
        $q = $pdo->prepare($this->database->engine() === 'postgres'
            ? 'SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=? AND lower(c.relname)=lower(?)'
            : 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)');
        $q->execute([$this->database->schemaName(), $table]);
        return $q->fetchColumn() !== false;
    }

    private function qualified(string $table): string
    {
        return $this->database->quoteIdentifier($this->database->schemaName()) . '.' . $this->database->quoteIdentifier($table);
    }

    private static function validateDataset(array $dataset): void
    {
        $columns = $dataset['columns'] ?? null;
        $rows = $dataset['rows'] ?? null;
        if (!is_array($columns) || !array_is_list($columns) || count($columns) < 1 || count($columns) > 256
            || !is_array($rows) || !array_is_list($rows) || count($rows) > 100000) self::invalid();
        $names = [];
        foreach ($columns as $column) {
            $name = $column['name'] ?? null;
            if (!is_string($name) || $name === '' || strlen($name) > 63 || str_contains($name, "\0")
                || preg_match('//u', $name) !== 1 || isset($names[$name])) self::invalid();
            $names[$name] = true;
        }
        foreach ($rows as $row) {
            if (!is_array($row) || !array_is_list($row) || count($row) !== count($columns)) self::invalid();
            foreach ($row as $value) if ($value !== null && (!is_string($value) || strlen($value) > 1048576
                || str_contains($value, "\0") || preg_match('//u', $value) !== 1)) self::invalid();
        }
    }

    private static function invalid(): never { throw ApiException::fromCode('dataset_mapping_invalid', 422); }
}
