<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** PostgreSQL publishes imported text/NULL rows atomically, with no overwrite. */
final class PostgresDatasetImport
{
    public function __construct(private readonly Database $database) {}

    private function targets(array $dataset): array
    {
        $catalog = new Catalog($this->database);
        $names = array_column($dataset['columns'], 'name');
        $targets = [];
        foreach ($catalog->tables() as $table) {
            $name = (string) $table['name'];
            if ($table['type'] !== 'table' || !($table['row_editable'] ?? false) || str_starts_with($name, '_govern_')) continue;
            $definition = $this->definition($name, $catalog);
            $importable = [];
            foreach ($definition['columns'] as $column) {
                if ($column['generated'] || $column['auto_increment']) continue;
                if (($column['type_schema'] ?? '') !== 'pg_catalog' || !in_array($column['data_type'], ['text', 'varchar'], true)) continue 2;
                $importable[] = $column['name'];
            }
            if ($names === $importable) $targets[] = ['name' => $name, 'version' => $this->version($definition)];
        }
        return $targets;
    }

    public function preview(array $parsed): array
    {
        $datasets = [];
        foreach ($parsed['datasets'] as $index => $dataset) {
            $this->validateDataset($dataset);
            $datasets[] = [...$dataset, 'index' => $index,
                'columns' => array_map(static fn (array $column): array => [...$column, 'type' => 'TEXT'], $dataset['columns']),
                'rows' => array_slice($dataset['rows'], 0, 20), 'targets' => $this->targets($dataset)];
        }
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(),
            'scope_key' => $this->scope(), 'confirmation' => $this->confirmation(),
            'sha256' => $parsed['sha256'], 'datasets' => $datasets];
    }

    public function commit(array $parsed, array $input): array
    {
        if (($input['confirmation'] ?? '') !== $this->confirmation()
            || !hash_equals($parsed['sha256'], Http::text($input, 'sha256'))) throw ApiException::fromCode('dataset_changed', 409);
        $index = filter_var($input['dataset'] ?? null, FILTER_VALIDATE_INT);
        if ($index === false || !isset($parsed['datasets'][$index])) throw ApiException::fromCode('dataset_invalid', 422);
        $dataset = $parsed['datasets'][$index];
        $this->validateDataset($dataset);
        $name = Http::text($input, 'table');
        $mode = Http::text($input, 'mode');
        if (!in_array($mode, ['create', 'append'], true)) throw ApiException::fromCode('dataset_invalid', 422);
        $target = null;
        if ($mode === 'append') {
            foreach ($this->targets($dataset) as $candidate) if ($candidate['name'] === $name) $target = $candidate;
            if ($target === null || !hash_equals($target['version'], Http::text($input, 'version'))) throw ApiException::fromCode('dataset_changed', 409);
        } elseif (!preg_match('/\A[A-Za-z][A-Za-z0-9_]{0,62}\z/D', $name)) {
            throw ApiException::fromCode('postgres_dataset_name', 422);
        }
        $pdo = $this->database->scriptConnection();
        $quoted = $this->qualified($name);
        $columns = array_map(fn (array $column): string => $this->database->quoteIdentifier($column['name']), $dataset['columns']);
        try {
            $pdo->beginTransaction();
            if ($mode === 'create') {
                $exists = $pdo->prepare('SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname=:schema AND pg_catalog.lower(c.relname)=pg_catalog.lower(:name)');
                $exists->execute(['schema' => $this->database->schemaName(), 'name' => $name]);
                if ($exists->fetchColumn() !== false) throw ApiException::fromCode('dataset_exists', 409);
                $definitions = implode(', ', array_map(static fn (string $column): string => $column . ' pg_catalog.text NULL', $columns));
                // DDL and rows become visible together. A concurrent name
                // collision fails rather than overwriting the other relation.
                $pdo->exec('CREATE TABLE ' . $quoted . ' ("_govern_id" pg_catalog.int8 GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ' . $definitions . ')');
            } else {
                $pdo->exec('LOCK TABLE ' . $quoted . ' IN ROW EXCLUSIVE MODE');
                $fresh = $this->definition($name, new Catalog($this->database));
                if (!hash_equals($target['version'], $this->version($fresh))) throw ApiException::fromCode('dataset_changed', 409);
            }
            $statement = $pdo->prepare('INSERT INTO ' . $quoted . ' (' . implode(', ', $columns) . ') VALUES ('
                . implode(', ', array_fill(0, count($columns), '?')) . ')');
            foreach ($dataset['rows'] as $row) {
                foreach ($row as $position => $value) $statement->bindValue($position + 1, $value, $value === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
                $statement->execute();
            }
            $pdo->commit();
            return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(),
                'scope_key' => $this->scope(), 'table' => $name, 'imported' => count($dataset['rows']), 'mode' => $mode];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($exception instanceof PDOException) {
                if (in_array($exception->getCode(), ['42P07', '42710'], true)) throw ApiException::fromCode('dataset_exists', 409);
                if ($exception->getCode() === '42501') throw ApiException::fromCode('row_permission_denied', 403);
                throw ApiException::fromCode('postgres_dataset_write_failed', 422, ['state' => $exception->getCode()]);
            }
            throw $exception;
        }
    }

    private function validateDataset(array $dataset): void
    {
        $columns = $dataset['columns'] ?? [];
        $rows = $dataset['rows'] ?? [];
        if (!is_array($columns) || count($columns) < 1 || count($columns) > 256 || !is_array($rows) || count($rows) > 100000)
            throw ApiException::fromCode('dataset_invalid', 422);
        $seen = [];
        foreach ($columns as $column) {
            $name = $column['name'] ?? null;
            if (!is_string($name) || $name === '' || strlen($name) > 63 || str_contains($name, "\0") || preg_match('//u', $name) !== 1
                || isset($seen[$name]) || $name === '_govern_id') throw ApiException::fromCode('dataset_invalid', 422);
            $seen[$name] = true;
        }
        foreach ($rows as $row) {
            if (!is_array($row) || !array_is_list($row) || count($row) !== count($columns)) throw ApiException::fromCode('dataset_invalid', 422);
            foreach ($row as $value) if ($value !== null && (!is_string($value) || strlen($value) > 1048576
                || str_contains($value, "\0") || preg_match('//u', $value) !== 1)) throw ApiException::fromCode('dataset_invalid', 422);
        }
    }

    private function definition(string $table, Catalog $catalog): array
    {
        $definition = $catalog->structure($table);
        $statement = $this->database->reader()->prepare('SELECT c.oid::text FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema AND c.relname=:table');
        $statement->execute(['schema' => $this->database->schemaName(), 'table' => $table]);
        $definition['object_id'] = $statement->fetchColumn();
        if ($definition['object_id'] === false) throw ApiException::fromCode('dataset_changed', 409);
        $statement = $this->database->reader()->prepare('SELECT con.oid::text, con.conname,
            pg_catalog.pg_get_constraintdef(con.oid,true) AS definition FROM pg_catalog.pg_constraint con
            WHERE con.conrelid=:object ORDER BY con.oid');
        $statement->execute(['object' => $definition['object_id']]);
        $definition['constraints'] = $statement->fetchAll(PDO::FETCH_ASSOC);
        return $definition;
    }

    private function version(array $definition): string { return hash('sha256', serialize([$this->scope(), $definition])); }
    private function scope(): string { return ConnectionScope::scopeKey('postgres', $this->database->name(), $this->database->schemaName()); }
    private function confirmation(): string { return $this->database->name() . '.' . $this->database->schemaName(); }
    private function qualified(string $name): string { return $this->database->quoteIdentifier($this->database->schemaName()) . '.' . $this->database->quoteIdentifier($name); }
}
