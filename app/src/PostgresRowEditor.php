<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** Native PostgreSQL row mutations; the read-only connection remains separate. */
final class PostgresRowEditor
{
    private const FIELD_BYTES = 131072;
    private const FORM_BYTES = 524288;
    private readonly Catalog $catalog;

    public function __construct(private readonly Database $database)
    {
        $this->catalog = new Catalog($database);
    }

    public function describe(string $table, ?array $key = null): array
    {
        $definition = $this->definition($table);
        if ($key === null) return $this->descriptor($definition);
        $this->requireEditable($definition);
        try { return $this->descriptor($definition, $this->read($this->database->reader(), $definition, $key)); }
        catch (PDOException $exception) { $this->rethrow($exception); }
    }

    public function insert(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $descriptor = $this->descriptor($definition);
        if (!$descriptor['can_insert']) throw ApiException::fromCode('row_insert_unsupported_postgres', 422);
        $values = $this->values($input, $descriptor);
        $parameters = $columns = $expressions = [];
        foreach ($values as $name => $field) {
            if ($field['mode'] === 'default') continue;
            $columns[] = $this->quote((string) $name);
            $expressions[] = $this->valueExpression($definition['map'][$name], $field, 'value_' . count($parameters), $parameters);
        }
        return $this->transaction(function (PDO $pdo) use ($definition, $columns, $expressions, $parameters): array {
            $sql = 'INSERT INTO ' . $this->qualified($definition['table'])
                . ($columns === [] ? ' DEFAULT VALUES' : ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $expressions) . ')')
                . ' RETURNING ' . $this->projection($definition);
            $statement = $pdo->prepare($sql);
            $this->execute($statement, $parameters);
            $record = $this->record($definition, $statement->fetch(PDO::FETCH_NUM));
            if ($record === null) throw ApiException::fromCode('row_stale', 409);
            return $this->mutationResult($definition, 1, $this->afterMutation($pdo, $definition, $record));
        });
    }

    public function update(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $this->requireEditable($definition);
        $key = $this->inputKey($input);
        $version = $this->inputVersion($input);
        return $this->transaction(function (PDO $pdo) use ($definition, $key, $version, $input): array {
            $record = $this->read($pdo, $definition, $key, true);
            $this->checkVersion($definition, $record, $version);
            $values = $this->values($input, $this->descriptor($definition, $record));
            if ($values === []) return $this->mutationResult($definition, 0, $record);
            $parameters = $assignments = [];
            foreach ($values as $name => $field) {
                $expression = $field['mode'] === 'default' ? 'DEFAULT'
                    : $this->valueExpression($definition['map'][$name], $field, 'value_' . count($parameters), $parameters);
                $assignments[] = $this->quote((string) $name) . ' = ' . $expression;
            }
            $where = $this->keyWhere($definition, $key, $parameters) . $this->guardWhere($definition, $record, $parameters);
            $statement = $pdo->prepare('UPDATE ' . $this->qualified($definition['table']) . ' SET ' . implode(', ', $assignments)
                . ' WHERE ' . $where . ' RETURNING ' . $this->projection($definition));
            $this->execute($statement, $parameters);
            $after = $this->record($definition, $statement->fetch(PDO::FETCH_NUM));
            if ($after === null || $statement->fetch(PDO::FETCH_NUM) !== false) throw ApiException::fromCode('row_stale', 409);
            return $this->mutationResult($definition, 1, $this->afterMutation($pdo, $definition, $after));
        });
    }

    public function delete(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $this->requireEditable($definition);
        $key = $this->inputKey($input);
        $version = $this->inputVersion($input);
        return $this->transaction(function (PDO $pdo) use ($definition, $key, $version): array {
            $record = $this->read($pdo, $definition, $key, true);
            $this->checkVersion($definition, $record, $version);
            $parameters = [];
            $where = $this->keyWhere($definition, $key, $parameters) . $this->guardWhere($definition, $record, $parameters);
            $statement = $pdo->prepare('DELETE FROM ' . $this->qualified($definition['table']) . ' WHERE ' . $where);
            $this->execute($statement, $parameters);
            if ($statement->rowCount() !== 1) throw ApiException::fromCode('row_stale', 409);
            return ['affected_rows' => 1, 'key' => $key, 'row' => null];
        });
    }

    private function definition(string $table): array
    {
        $definition = $this->catalog->structure($table);
        $definition['map'] = RecordIdentity::columnMap($definition['columns']);
        $definition['key_columns'] = ($definition['row_editable'] ?? false)
            ? PostgresRowIdentity::columns($definition['columns'], $definition['indexes']) : [];
        return $definition;
    }

    private function descriptor(array $definition, ?array $record = null): array
    {
        $columns = [];
        $row = $record === null ? null : [];
        $remaining = self::FORM_BYTES;
        $canInsert = $definition['row_editable'] ?? false;
        foreach ($definition['columns'] as $column) {
            $value = $record['row'][$column['name']] ?? null;
            $binary = PostgresRowIdentity::binary($column);
            $size = $binary ? intdiv(strlen($value ?? ''), 2) : strlen($value ?? '');
            $invalid = $value !== null && preg_match('//u', $value) !== 1;
            $large = $record !== null && ($size > self::FIELD_BYTES || strlen($value ?? '') > $remaining || $invalid);
            $supported = PostgresRowIdentity::supported($column);
            $editable = $supported && !$column['generated'] && ($column['identity'] ?? '') !== 'a' && !$large;
            if (!$supported && !$column['generated'] && !$column['nullable'] && $column['default'] === null && !$column['auto_increment']) $canInsert = false;
            if ($large && $value !== null) {
                $value = substr($value, 0, max(0, min(Preview::CELL_BYTES, $remaining)));
                if ($binary) $value = substr($value, 0, intdiv(strlen($value), 2) * 2);
                else while ($value !== '' && preg_match('//u', $value) !== 1) $value = substr($value, 0, -1);
            }
            $columns[] = [...$column, 'editable' => $editable, 'encoding' => $binary ? 'hex' : 'text', 'large' => $large];
            if ($row !== null) { $row[$column['name']] = $value; $remaining -= strlen($value ?? ''); }
        }
        $key = $record === null ? null : PostgresRowIdentity::key($record['row'], $definition['key_columns']);
        $editable = ($definition['row_editable'] ?? false) && $definition['key_columns'] !== [] && ($record === null || $key !== null);
        $reason = !($definition['row_editable'] ?? false) ? 'row_view_unsupported_postgres' : (!$editable ? 'row_key_required_postgres' : null);
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(), 'engine' => 'postgres',
            'table' => $definition['table'], 'type' => $definition['type'], 'phpmyadmin' => false,
            'editable' => $editable, 'can_insert' => $canInsert, 'key_columns' => $definition['key_columns'],
            'columns' => $columns, 'row' => $row, 'key' => $key, 'version' => $record === null ? null : $this->version($definition, $record),
            'reason' => $reason === null ? null : Messages::text($reason), 'reason_code' => $reason,
            'reason_i18n' => $reason === null ? null : Messages::translations($reason)];
    }

    private function requireEditable(array $definition): void
    {
        if (!($definition['row_editable'] ?? false)) throw ApiException::fromCode('row_view_unsupported_postgres', 422);
        if ($definition['key_columns'] === []) throw ApiException::fromCode('row_key_required_postgres', 422);
    }

    private function read(PDO $pdo, array $definition, array $key, bool $lock = false): array
    {
        $parameters = [];
        $where = $this->keyWhere($definition, $key, $parameters);
        $statement = $pdo->prepare('SELECT ' . $this->projection($definition) . ' FROM ' . $this->qualified($definition['table'])
            . ' WHERE ' . $where . ' LIMIT 2' . ($lock ? ' FOR UPDATE' : ''));
        $this->execute($statement, $parameters);
        $rows = $statement->fetchAll(PDO::FETCH_NUM);
        if (count($rows) > 1) throw ApiException::fromCode('row_key_required_postgres', 409);
        if ($rows === []) throw ApiException::fromCode('row_missing', 404);
        return $this->record($definition, $rows[0]);
    }

    private function projection(array $definition): string
    {
        $projection = [];
        foreach ($definition['columns'] as $column) $projection[] = PostgresRowIdentity::expression($this->database, $column);
        foreach ($definition['columns'] as $column) $projection[] = $this->fingerprint($column);
        return implode(', ', [...$projection, 'xmin::text', 'ctid::text', 'tableoid::text']);
    }

    private function record(array $definition, array|false $values): ?array
    {
        if ($values === false) return null;
        $count = count($definition['columns']);
        return ['row' => array_combine(array_column($definition['columns'], 'name'), array_slice($values, 0, $count)),
            'guards' => array_slice($values, $count, $count), 'tuple' => array_slice($values, $count * 2, 3)];
    }

    private function keyWhere(array $definition, array $key, array &$parameters): string
    {
        $names = array_map('strval', array_keys($key));
        $expected = $definition['key_columns'];
        sort($names); sort($expected);
        if ($names !== $expected || $expected === [] || PostgresRowIdentity::key($key, $definition['key_columns']) === null)
            throw ApiException::fromCode('row_key_invalid', 422);
        $where = [];
        foreach ($definition['key_columns'] as $position => $name) {
            $value = $key[$name];
            if (!is_string($value) || strlen($value) > self::FIELD_BYTES || str_contains($value, "\0") || preg_match('//u', $value) !== 1)
                throw ApiException::fromCode('row_key_invalid', 422);
            $binary = PostgresRowIdentity::binary($definition['map'][$name]);
            if ($binary) $this->validateHex($value);
            $parameter = 'key_' . $position;
            $parameters[$parameter] = $value;
            // Native prepared parameters are inferred as the exact column type.
            $where[] = $this->quote($name) . ' = ' . ($binary ? "pg_catalog.decode(:$parameter, 'hex')" : ':' . $parameter);
        }
        return implode(' AND ', $where);
    }

    private function fingerprint(array $column): string
    {
        $value = PostgresRowIdentity::binary($column) ? $this->quote($column['name'])
            : "pg_catalog.convert_to(" . PostgresRowIdentity::expression($this->database, $column) . ", 'UTF8')";
        return "pg_catalog.encode(pg_catalog.sha256($value), 'hex')";
    }

    private function guardWhere(array $definition, array $record, array &$parameters): string
    {
        $where = '';
        foreach ($definition['columns'] as $position => $column) {
            $parameter = 'guard_' . $position;
            $parameters[$parameter] = $record['guards'][$position];
            $where .= ' AND ' . $this->fingerprint($column) . ' IS NOT DISTINCT FROM :' . $parameter;
        }
        foreach (['xmin', 'ctid', 'tableoid'] as $position => $name) {
            $parameters['tuple_' . $position] = $record['tuple'][$position];
            $where .= ' AND ' . $name . '::text = :tuple_' . $position;
        }
        return $where;
    }

    private function version(array $definition, array $record): string
    {
        return hash('sha256', serialize(['postgres', $this->database->name(), $this->database->schemaName(), $definition['table'],
            $definition['columns'], $definition['key_columns'], $record]));
    }

    private function checkVersion(array $definition, array $record, string $version): void
    {
        if (!hash_equals($this->version($definition, $record), $version)) throw ApiException::fromCode('row_stale', 409);
    }

    private function inputKey(array $input): array
    {
        if (!isset($input['key']) || !is_array($input['key'])) throw ApiException::fromCode('row_key_invalid', 422);
        return $input['key'];
    }

    private function inputVersion(array $input): string
    {
        if (!isset($input['version']) || !is_string($input['version']) || preg_match('/\A[a-f0-9]{64}\z/D', $input['version']) !== 1)
            throw ApiException::fromCode('row_version_invalid', 422);
        return $input['version'];
    }

    private function values(array $input, array $descriptor): array
    {
        if (!isset($input['values']) || !is_array($input['values'])) throw ApiException::fromCode('row_values_invalid', 422);
        $columns = RecordIdentity::columnMap($descriptor['columns']);
        $values = [];
        $bytes = 0;
        foreach ($input['values'] as $name => $field) {
            $name = (string) $name;
            $column = $columns[$name] ?? null;
            if ($column === null || !$column['editable']) throw ApiException::fromCode('row_field_readonly_postgres', 422, ['column' => $name]);
            if (!is_array($field) || !isset($field['mode']) || !in_array($field['mode'], ['value', 'null', 'default'], true))
                throw ApiException::fromCode('row_values_invalid', 422);
            if ($field['mode'] === 'null' && !$column['nullable']) throw ApiException::fromCode('row_null_invalid', 422, ['column' => $name]);
            $normalized = ['mode' => $field['mode']];
            if ($field['mode'] === 'value') {
                if (!isset($field['value']) || !is_string($field['value'])) throw ApiException::fromCode('row_values_invalid', 422);
                $value = $field['value'];
                if ($column['encoding'] === 'hex') $this->validateHex($value);
                elseif (str_contains($value, "\0") || preg_match('//u', $value) !== 1) throw ApiException::fromCode('row_values_invalid', 422);
                $size = $column['encoding'] === 'hex' ? intdiv(strlen($value), 2) : strlen($value);
                $bytes += $size;
                if ($size > self::FIELD_BYTES || $bytes > self::FORM_BYTES) throw ApiException::fromCode('row_value_too_large_postgres', 413);
                $normalized['value'] = $value;
            }
            $values[$name] = $normalized;
        }
        return $values;
    }

    private function valueExpression(array $column, array $field, string $parameter, array &$parameters): string
    {
        $parameters[$parameter] = $field['mode'] === 'null' ? null : $field['value'];
        return PostgresRowIdentity::binary($column) && $field['mode'] !== 'null' ? "pg_catalog.decode(:$parameter, 'hex')" : ':' . $parameter;
    }

    private function validateHex(string $value): void
    {
        if (preg_match('/\A(?:[a-f0-9]{2})*\z/iD', $value) !== 1) throw ApiException::fromCode('row_hex_invalid', 422);
    }

    private function execute(\PDOStatement $statement, array $parameters): void
    {
        foreach ($parameters as $name => $value) $statement->bindValue(':' . $name, $value, $value === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->execute();
    }

    /** AFTER triggers may update or remove the returned row; never invent its new key. */
    private function afterMutation(PDO $pdo, array $definition, array $record): ?array
    {
        $key = PostgresRowIdentity::key($record['row'], $definition['key_columns']);
        if ($key === null) return null;
        try { return $this->read($pdo, $definition, $key); }
        catch (ApiException $exception) {
            if ($exception->errorCode === 'row_missing') return null;
            throw $exception;
        }
    }

    private function mutationResult(array $definition, int $affected, ?array $record): array
    {
        $data = $record === null ? null : $this->descriptor($definition, $record);
        return ['affected_rows' => $affected, 'key' => $data['key'] ?? null, 'row' => $data['row'] ?? null, 'version' => $data['version'] ?? null];
    }

    private function transaction(callable $operation): array
    {
        $pdo = $this->database->writer();
        try {
            $pdo->beginTransaction();
            $result = $operation($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $this->rethrow($exception);
        }
    }

    private function rethrow(\Throwable $exception): never
    {
        if ($exception instanceof PDOException) {
            if ($exception->getCode() === '42501') throw ApiException::fromCode('row_permission_denied', 403);
            if (in_array($exception->getCode(), ['40001', '40P01', '55P03'], true)) throw ApiException::fromCode('row_stale', 409);
            // Driver diagnostics can contain the complete row or a sensitive value.
            throw ApiException::fromCode('row_write_failed', 422, ['detail' => 'PostgreSQL SQLSTATE ' . $exception->getCode()]);
        }
        throw $exception;
    }

    private function qualified(string $table): string { return $this->quote($this->database->schemaName()) . '.' . $this->quote($table); }
    private function quote(string $name): string { return $this->database->quoteIdentifier($name); }
}
