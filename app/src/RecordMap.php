<?php
declare(strict_types=1);
namespace Govern;

use PDO;

/** Read-only graph queries; all relationships come from the selected live catalog. */
final class RecordMap
{
    private ?array $schema = null;
    private array $identities = [];
    private array $projections = [];
    private const MAX_KEY_BYTES = 8192;

    public function __construct(private readonly Database $database, private readonly Catalog $catalog, private readonly ?array $config = null) {}

    public function records(string $table, int $page = 1, int $pageSize = 25, string $search = ''): array
    {
        $metadata = $this->table($table);
        $identity = $this->identity($table);
        $page = max(1, $page); $pageSize = max(1, min(50, $pageSize));
        if ($page > 10000000) throw ApiException::fromCode('page_too_large');
        if (strlen($search) > 2048) throw ApiException::fromCode('search_too_long');
        $result = ['table' => $table, 'nodes' => [], 'key_columns' => $identity, 'supported' => $identity !== [],
            'page' => $page, 'page_size' => $pageSize, 'has_more' => false, 'next_page' => null];
        if ($metadata['type'] !== 'table' || $identity === []) return [...$result, 'supported' => false, 'reason_code' => 'record_map_identity_unsupported'];
        $conditions = []; $params = [];
        if ($search !== '') {
            $pattern = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $search) . '%';
            foreach ($metadata['columns'] as $index => $column) {
                if ($this->unsupportedValue($column)) continue;
                $key = 'search_' . $index;
                $cast = $this->database->engine() === 'postgres' ? 'text' : 'CHAR';
                $like = $this->database->engine() === 'postgres' ? 'ILIKE' : 'LIKE';
                $conditions[] = 'CAST(' . $this->quote($column['name']) . ' AS ' . $cast . ') ' . $like . ' :' . $key . " ESCAPE '='";
                $params[$key] = $pattern;
            }
            if ($conditions === []) throw ApiException::fromCode('search_not_supported');
        }
        $where = $conditions === [] ? '' : ' WHERE (' . implode(' OR ', $conditions) . ')';
        $sql = 'SELECT ' . $this->projection($table) . ' FROM ' . $this->qualified($table) . $where . $this->orderBy($identity) . ' LIMIT :map_limit OFFSET :map_offset';
        $params += ['map_limit' => $pageSize + 1, 'map_offset' => ($page - 1) * $pageSize];
        $statement = $this->execute($sql, $params);
        try {
            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                if (count($result['nodes']) === $pageSize) { $result['has_more'] = true; break; }
                $result['nodes'][] = $this->node($table, $row);
            }
        } finally { $statement->closeCursor(); }
        $result['next_page'] = $result['has_more'] ? $page + 1 : null;
        return $result;
    }

    public function explore(array $input): array
    {
        if (array_diff(array_keys($input), ['table', 'key', 'relation', 'offset', 'page_size']) !== [] || !array_key_exists('key', $input)) {
            throw ApiException::fromCode('record_map_input_invalid', 422);
        }
        $table = $this->inputText($input['table'] ?? null);
        $metadata = $this->table($table); $identity = $this->identity($table);
        if ($metadata['type'] !== 'table' || $identity === []) throw ApiException::fromCode('record_map_identity_unsupported', 422);
        $key = $this->validateKey($input['key'], $identity);
        $row = $this->find($table, $key);
        $focus = $this->node($table, $row);
        $relations = $this->relations($table);
        $result = ['focus' => $focus, 'nodes' => [$focus], 'edges' => [], 'relations' => $relations, 'has_more' => false, 'next_offset' => null];
        if (!array_key_exists('relation', $input)) return $result;
        $relationId = $this->inputText($input['relation']); $relation = null;
        foreach ($relations as $candidate) if ($candidate['id'] === $relationId) { $relation = $candidate; break; }
        if ($relation === null) throw ApiException::fromCode('record_map_relation_missing', 404);
        if (!$relation['supported']) throw ApiException::fromCode('record_map_relation_unsupported', 422);
        $offset = $input['offset'] ?? 0; $pageSize = $input['page_size'] ?? 25;
        if (!is_int($offset) || $offset < 0 || $offset > 10000000 || !is_int($pageSize) || $pageSize < 1 || $pageSize > 50) {
            throw ApiException::fromCode('record_map_input_invalid', 422);
        }
        $outgoing = $relation['direction'] === 'outgoing';
        $neighborTable = $outgoing ? $relation['target_table'] : $relation['source_table'];
        $ownColumns = $outgoing ? $relation['source_columns'] : $relation['target_columns'];
        $matchColumns = $outgoing ? $relation['target_columns'] : $relation['source_columns'];
        $conditions = []; $params = [];
        foreach ($ownColumns as $position => $column) {
            if (!array_key_exists($column, $row) || $row[$column] === null) return [...$result, 'relation' => $relationId, 'offset' => $offset, 'page_size' => $pageSize];
            $parameter = 'map_link_' . $position;
            $params[$parameter] = $this->scalar($row[$column]);
            $conditions[] = $this->quote($matchColumns[$position]) . ' = :' . $parameter;
        }
        $sql = 'SELECT ' . $this->projection($neighborTable) . ' FROM ' . $this->qualified($neighborTable) . ' WHERE ' . implode(' AND ', $conditions)
            . $this->orderBy($this->identity($neighborTable)) . ' LIMIT :map_limit OFFSET :map_offset';
        $params += ['map_limit' => $pageSize + 1, 'map_offset' => $offset];
        $statement = $this->execute($sql, $params);
        $nodes = [$focus['id'] => $focus]; $edges = []; $returned = 0; $hasMore = false;
        try {
            while (($neighborRow = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                if ($returned === $pageSize) { $hasMore = true; break; }
                $neighbor = $this->node($neighborTable, $neighborRow); $nodes[$neighbor['id']] = $neighbor;
                $source = $outgoing ? $focus : $neighbor; $target = $outgoing ? $neighbor : $focus;
                $sourceValues = $this->columnValues($outgoing ? $row : $neighborRow, $relation['source_columns']);
                $targetValues = $this->columnValues($outgoing ? $neighborRow : $row, $relation['target_columns']);
                $pairs = [];
                foreach ($relation['source_columns'] as $position => $column) $pairs[] = ['source' => $column, 'target' => $relation['target_columns'][$position]];
                $evidence = ['sql' => $sql, 'params' => (object) $params, 'column_pairs' => $pairs,
                    'source_schema' => $relation['source_schema'], 'target_schema' => $relation['target_schema']];
                $edgeId = hash('sha256', $relation['constraint_id'] . ':' . $source['id'] . ':' . $target['id']);
                $edges[$edgeId] = ['id' => $edgeId, 'source' => $source['id'], 'target' => $target['id'], 'kind' => 'foreign_key',
                    'constraint' => $relation['constraint'], 'source_table' => $relation['source_table'], 'target_table' => $relation['target_table'],
                    'source_columns' => $relation['source_columns'], 'target_columns' => $relation['target_columns'],
                    'source_values' => $sourceValues, 'target_values' => $targetValues,
                    'source_key' => $source['key'], 'target_key' => $target['key'], 'evidence' => $evidence];
                $returned++;
            }
        } finally { $statement->closeCursor(); }
        return [...$result, 'relation' => $relationId, 'nodes' => array_values($nodes), 'edges' => array_values($edges),
            'has_more' => $hasMore, 'next_offset' => $hasMore ? $offset + $returned : null,
            'offset' => $offset, 'page_size' => $pageSize, 'evidence' => ['sql' => $sql, 'params' => (object) $params]];
    }

    private function table(string $table): array
    {
        if ($this->schema === null) {
            $this->schema = [];
            foreach ($this->catalog->schema()['tables'] as $entry) $this->schema[$entry['name']] = $entry;
        }
        if (str_starts_with($table, '_govern_') || !isset($this->schema[$table])) throw ApiException::fromCode('table_missing', 404);
        return $this->schema[$table];
    }

    private function identity(string $table): array
    {
        if (array_key_exists($table, $this->identities)) return $this->identities[$table];
        $metadata = $this->table($table);
        if ($metadata['type'] !== 'table') return $this->identities[$table] = [];
        $columns = RecordIdentity::columnMap($metadata['columns']); $indexes = $this->catalog->indexes($table);
        $expressions = $this->expressionIndexes($table);
        usort($indexes, static fn (array $a, array $b): int =>
            ((($a['primary'] ?? false) || $a['name'] === 'PRIMARY' ? 0 : 1) <=> (($b['primary'] ?? false) || $b['name'] === 'PRIMARY' ? 0 : 1))
            ?: (count($a['columns']) <=> count($b['columns'])) ?: strcmp($a['name'], $b['name']));
        foreach ($indexes as $index) {
            if (!($index['unique'] ?? false) || ($index['partial'] ?? false) || ($index['columns'] ?? []) === []
                || in_array($index['name'], $expressions, true)) continue;
            foreach ($index['columns'] as $position => $name) {
                $column = $columns[$name] ?? null;
                if ($column === null || $column['nullable'] || $column['generated'] || $this->unsupportedValue($column)
                    || ($index['sub_parts'][$position] ?? null) !== null) continue 2;
            }
            return $this->identities[$table] = $index['columns'];
        }
        return $this->identities[$table] = [];
    }

    private function relations(string $table): array
    {
        $this->table($table); $relations = [];
        foreach ($this->schema as $sourceName => $metadata) foreach ($metadata['foreign_keys'] as $foreignKey) {
            $sourceTable = (string) $sourceName;
            $targetSchema = $foreignKey['referenced_schema'] ?? $this->database->schemaName();
            $targetTable = $foreignKey['referenced_table']; $external = $targetSchema !== $this->database->schemaName();
            $directions = [];
            if ($sourceTable === $table) $directions[] = 'outgoing';
            if (!$external && $targetTable === $table) $directions[] = 'incoming';
            foreach ($directions as $direction) {
                $sourceColumns = $foreignKey['columns']; $targetColumns = $foreignKey['referenced_columns'];
                $constraintId = hash('sha256', $this->scope() . ':' . json_encode([$sourceTable, $foreignKey['name'], $targetSchema,
                    $targetTable, $sourceColumns, $targetColumns], JSON_THROW_ON_ERROR));
                $supported = !$external && isset($this->schema[$targetTable]) && $this->identity($sourceTable) !== [] && $this->identity($targetTable) !== [];
                if ($supported) foreach ([[$sourceTable, $sourceColumns], [$targetTable, $targetColumns]] as [$checkTable, $checkColumns]) {
                    $map = RecordIdentity::columnMap($this->table($checkTable)['columns']);
                    foreach ($checkColumns as $column) if (!isset($map[$column]) || $this->unsupportedValue($map[$column])) { $supported = false; break 2; }
                }
                $relations[] = ['id' => hash('sha256', $constraintId . ':' . $direction), 'constraint_id' => $constraintId,
                    'direction' => $direction, 'kind' => 'foreign_key', 'constraint' => $foreignKey['name'],
                    'source_table' => $sourceTable, 'target_table' => $targetTable, 'source_columns' => $sourceColumns, 'target_columns' => $targetColumns,
                    'source_schema' => $this->database->schemaName(), 'target_schema' => $targetSchema, 'external' => $external, 'supported' => $supported,
                    'reason_code' => $supported ? null : ($external ? 'record_map_external_relation' : 'record_map_identity_unsupported')];
            }
        }
        usort($relations, static fn (array $a, array $b): int => strcmp($a['direction'] . ':' . $a['source_table'] . ':' . $a['constraint'], $b['direction'] . ':' . $b['source_table'] . ':' . $b['constraint']));
        return $relations;
    }

    /** Expression text can equal a real column name; use catalog flags, not labels. */
    private function expressionIndexes(string $table): array
    {
        $sql = $this->database->engine() === 'postgres'
            ? 'SELECT idx.relname FROM pg_catalog.pg_index i
               JOIN pg_catalog.pg_class rel ON rel.oid = i.indrelid
               JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
               JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
               WHERE ns.nspname = :map_schema AND rel.relname = :map_table AND i.indexprs IS NOT NULL'
            : 'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = :map_schema AND TABLE_NAME = :map_table AND COLUMN_NAME IS NULL';
        $statement = $this->execute($sql, ['map_schema' => $this->database->schemaName(), 'map_table' => $table]);
        try { return $statement->fetchAll(PDO::FETCH_COLUMN); }
        finally { $statement->closeCursor(); }
    }

    private function find(string $table, array $key): array
    {
        $conditions = []; $params = [];
        foreach ($key as $column => $value) {
            $parameter = 'map_key_' . count($params); $conditions[] = $this->quote((string) $column) . ' = :' . $parameter; $params[$parameter] = $value;
        }
        try {
            $statement = $this->execute('SELECT ' . $this->projection($table) . ' FROM ' . $this->qualified($table) . ' WHERE ' . implode(' AND ', $conditions) . ' LIMIT 2', $params);
        } catch (\PDOException $exception) {
            // A key that cannot be represented by its real column type cannot
            // identify a record. Do not turn invalid input into a server outage.
            if (str_starts_with((string) $exception->getCode(), '22')) throw ApiException::fromCode('record_map_record_missing', 404);
            throw $exception;
        }
        try { $row = $statement->fetch(PDO::FETCH_ASSOC); $duplicate = $statement->fetch(PDO::FETCH_ASSOC); }
        finally { $statement->closeCursor(); }
        if ($row === false || $duplicate !== false || $this->rowKey($row, $this->identity($table)) !== $key) throw ApiException::fromCode('record_map_record_missing', 404);
        return $row;
    }

    /** Preserve engine text for keys and joins before PDO can round float values. */
    private function projection(string $table): string
    {
        if (isset($this->projections[$table])) return $this->projections[$table];
        $metadata = $this->table($table);
        $exact = array_fill_keys($this->identity($table), true);
        foreach ($this->schema as $source => $entry) foreach ($entry['foreign_keys'] as $foreignKey) {
            if ((string) $source === $table) foreach ($foreignKey['columns'] as $column) $exact[$column] = true;
            if ($foreignKey['referenced_table'] === $table
                && ($foreignKey['referenced_schema'] ?? $this->database->schemaName()) === $this->database->schemaName()) {
                foreach ($foreignKey['referenced_columns'] as $column) $exact[$column] = true;
            }
        }
        $projection = [];
        $cast = $this->database->engine() === 'postgres' ? 'text' : 'CHAR';
        foreach ($metadata['columns'] as $column) {
            $name = $column['name']; $quoted = $this->quote($name);
            $projection[] = isset($exact[$name]) && !$this->unsupportedValue($column)
                ? 'CAST(' . $quoted . ' AS ' . $cast . ') AS ' . $quoted : $quoted;
        }
        return $this->projections[$table] = implode(', ', $projection);
    }

    private function validateKey(mixed $value, array $columns): array
    {
        if ($value instanceof \stdClass) $value = get_object_vars($value);
        if (!is_array($value)) throw ApiException::fromCode('record_map_input_invalid', 422);
        $names = array_map(strval(...), array_keys($value)); $expected = array_map(strval(...), $columns);
        sort($names, SORT_STRING); sort($expected, SORT_STRING);
        if ($names !== $expected) throw ApiException::fromCode('record_map_input_invalid', 422);
        $key = [];
        foreach ($columns as $column) {
            $part = $value[$column];
            if (!is_string($part) || strlen($part) > self::MAX_KEY_BYTES || preg_match('//u', $part) !== 1 || str_contains($part, "\0")) throw ApiException::fromCode('record_map_input_invalid', 422);
            $key[$column] = $part;
        }
        return $key;
    }

    private function node(string $table, array $row): array
    {
        $columns = $this->table($table)['columns']; $key = $this->rowKey($row, $this->identity($table)); $truncated = false;
        $cellLimit = min(Preview::CELL_BYTES, max(128, intdiv(32768, max(1, count($row)))));
        foreach ($columns as $column) {
            $name = $column['name'];
            if (!array_key_exists($name, $row) || $row[$name] === null) continue;
            if (is_resource($row[$name])) {
                $value = stream_get_contents($row[$name], intdiv($cellLimit, 2) + 1); if ($value === false) $value = '';
                $row[$name] = '0x' . bin2hex(substr($value, 0, intdiv($cellLimit, 2)));
                if (strlen($value) > intdiv($cellLimit, 2)) { $row[$name] .= Messages::text('preview_binary_shortened'); $truncated = true; }
            } elseif ($this->binary($column)) {
                $value = (string) $row[$name]; $row[$name] = '0x' . bin2hex(substr($value, 0, intdiv($cellLimit, 2)));
                if (strlen($value) > intdiv($cellLimit, 2)) { $row[$name] .= Messages::text('preview_binary_shortened'); $truncated = true; }
            } elseif ($this->database->engine() === 'postgres' && $column['data_type'] === 'bool') {
                $row[$name] = in_array($row[$name], [true, 1, '1', 't', 'true'], true) ? 'true' : 'false';
            } else {
                $row[$name] = $this->scalar($row[$name]);
                if (strlen($row[$name]) > $cellLimit) { $row[$name] = self::short($row[$name], $cellLimit) . Messages::text('preview_shortened'); $truncated = true; }
            }
        }
        $preview = Preview::row($row, $truncated); $label = '';
        foreach (['name', 'title', 'label', 'display_name', 'code'] as $column) if (isset($preview[$column]) && is_string($preview[$column]) && trim($preview[$column]) !== '') { $label = self::short($preview[$column], 120); break; }
        if ($label === '') $label = self::short($table . ' · ' . implode(' · ', array_values($key)), 120);
        return ['id' => hash('sha256', json_encode([$this->database->engine(), $this->database->name(),
                $this->database->schemaName(), $table, (object) $key], JSON_THROW_ON_ERROR)),
            'table' => $table, 'key' => (object) $key, 'label' => $label, 'row' => (object) $preview, 'columns' => $columns, 'truncated' => $truncated];
    }

    private function rowKey(array $row, array $columns): array
    {
        $key = [];
        foreach ($columns as $column) {
            if (!array_key_exists($column, $row) || $row[$column] === null || is_resource($row[$column])) throw ApiException::fromCode('record_map_identity_unsupported', 422);
            $value = $this->scalar($row[$column]);
            if (strlen($value) > self::MAX_KEY_BYTES || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) throw ApiException::fromCode('record_map_identity_unsupported', 422);
            $key[$column] = $value;
        }
        return $key;
    }

    private function columnValues(array $row, array $columns): object
    {
        $values = [];
        foreach ($columns as $column) $values[$column] = $row[$column] === null ? null : $this->scalar($row[$column]);
        return (object) $values;
    }

    private function unsupportedValue(array $column): bool { return $this->binary($column) || RecordIdentity::unsupported($column) || in_array(strtolower($column['data_type']), ['varbit'], true); }
    private function binary(array $column): bool
    {
        return RecordIdentity::binary($column) || strtolower($column['data_type']) === 'bytea'
            || ($this->database->engine() === 'mariadb' && strtolower($column['data_type']) === 'bit');
    }
    private function scalar(mixed $value): string { return is_bool($value) ? ($value ? '1' : '0') : (string) $value; }
    private function quote(string $value): string { return $this->database->quoteIdentifier($value); }
    private function qualified(string $table): string { return $this->quote($this->database->schemaName()) . '.' . $this->quote($table); }
    private function scope(): string { return json_encode([$this->database->engine(), $this->database->name(), $this->database->schemaName()], JSON_THROW_ON_ERROR); }
    private function orderBy(array $columns): string { return ' ORDER BY ' . implode(', ', array_map($this->quote(...), $columns)); }
    private function inputText(mixed $value): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 1024 || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) throw ApiException::fromCode('record_map_input_invalid', 422);
        return $value;
    }
    private function execute(string $sql, array $params): \PDOStatement
    {
        $statement = $this->database->reader()->prepare($sql);
        foreach ($params as $key => $value) $statement->bindValue(':' . $key, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        $statement->execute(); return $statement;
    }
    private static function short(string $value, int $bytes): string
    {
        if (strlen($value) <= $bytes) return $value;
        $value = substr($value, 0, $bytes); while ($value !== '' && preg_match('//u', $value) !== 1) $value = substr($value, 0, -1);
        return $value . '…';
    }
}
