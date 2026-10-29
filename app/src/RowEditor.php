<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** Generic, exact-key record editing; browse previews are never write payloads. */
final class RowEditor
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
        $record = $this->read($this->database->reader(), $definition, $key);
        return $this->descriptor($definition, $record);
    }

    public function insert(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $descriptor = $this->descriptor($definition);
        if (!$descriptor['can_insert']) throw ApiException::fromCode('row_insert_unsupported', 422);
        $values = $this->values($input, $descriptor);
        $parameters = [];
        $columns = $expressions = [];
        foreach ($values as $name => $field) {
            $name = (string) $name;
            if ($field['mode'] === 'default') continue;
            $columns[] = Database::identifier($name);
            $expressions[] = $this->valueExpression($definition['map'][$name], $field, 'value_' . count($parameters), $parameters);
        }
        $pdo = $this->database->writer();
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare('INSERT INTO ' . Database::identifier($definition['table'])
                . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $expressions) . ')');
            $this->execute($statement, $parameters);
            $affected = $statement->rowCount();
            $insertId = $pdo->lastInsertId();
            $key = $this->insertedKey($definition, $values, $insertId);
            $record = $key === null ? null : $this->read($pdo, $definition, $key, false, false);
            $pdo->commit();
            return $this->mutationResult($definition, $affected, $record);
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $this->rethrow($exception);
        }
    }

    public function update(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $this->requireEditable($definition);
        $key = $this->inputKey($input);
        $version = $this->inputVersion($input);
        $pdo = $this->database->writer();
        try {
            $pdo->beginTransaction();
            $record = $this->read($pdo, $definition, $key, true);
            $this->checkVersion($definition, $record, $version);
            $values = $this->values($input, $this->descriptor($definition, $record));
            if ($values === []) {
                $pdo->commit();
                return $this->mutationResult($definition, 0, $record);
            }
            $parameters = [];
            $assignments = [];
            $nextKey = RecordIdentity::key($record['row'], $definition['columns'], $definition['key_columns']);
            foreach ($values as $name => $field) {
                $name = (string) $name;
                $column = $definition['map'][$name];
                $expression = $field['mode'] === 'default' ? 'DEFAULT(' . Database::identifier($name) . ')'
                    : $this->valueExpression($column, $field, 'value_' . count($parameters), $parameters);
                $assignments[] = Database::identifier($name) . ' = ' . $expression;
                if (in_array($name, $definition['key_columns'], true)) {
                    if ($field['mode'] === 'default') $nextKey = null;
                    elseif ($nextKey !== null) $nextKey[$name] = $field['value'];
                }
            }
            $where = $this->keyWhere($definition, $key, $parameters, 'old_') . $this->guardWhere($definition, $record, $parameters);
            $statement = $pdo->prepare('UPDATE ' . Database::identifier($definition['table'])
                . ' SET ' . implode(', ', $assignments) . ' WHERE ' . $where . ' LIMIT 1');
            $this->execute($statement, $parameters);
            $affected = $statement->rowCount();
            $after = $nextKey === null ? null : $this->read($pdo, $definition, $nextKey, false, false);
            if ($affected === 0) {
                $current = $this->read($pdo, $definition, $key, false, false);
                if ($current === null || $current['guards'] !== $record['guards']) throw ApiException::fromCode('row_stale', 409);
            }
            $pdo->commit();
            return $this->mutationResult($definition, $affected, $after);
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $this->rethrow($exception);
        }
    }

    public function delete(array $input): array
    {
        $definition = $this->definition(Http::text($input, 'table'));
        $this->requireEditable($definition);
        $key = $this->inputKey($input);
        $version = $this->inputVersion($input);
        $pdo = $this->database->writer();
        try {
            $pdo->beginTransaction();
            $record = $this->read($pdo, $definition, $key, true);
            $this->checkVersion($definition, $record, $version);
            $parameters = [];
            $where = $this->keyWhere($definition, $key, $parameters, 'old_') . $this->guardWhere($definition, $record, $parameters);
            $statement = $pdo->prepare('DELETE FROM ' . Database::identifier($definition['table']) . ' WHERE ' . $where . ' LIMIT 1');
            $this->execute($statement, $parameters);
            if ($statement->rowCount() !== 1) throw ApiException::fromCode('row_stale', 409);
            $pdo->commit();
            return ['affected_rows' => 1, 'key' => $key, 'row' => null];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            $this->rethrow($exception);
        }
    }

    private function definition(string $table): array
    {
        $data = $this->catalog->structure($table);
        $data['map'] = RecordIdentity::columnMap($data['columns']);
        $data['key_columns'] = $data['type'] === 'table' ? RecordIdentity::columns($data['columns'], $data['indexes']) : [];
        return $data;
    }

    private function descriptor(array $definition, ?array $record = null): array
    {
        $columns = [];
        $row = $record === null ? null : [];
        $remaining = self::FORM_BYTES;
        foreach ($definition['columns'] as $column) {
            $binary = RecordIdentity::binary($column);
            $value = $record['row'][$column['name']] ?? null;
            $bytes = $value === null ? 0 : strlen((string) $value);
            $invalid = !$binary && $value !== null && preg_match('//u', (string) $value) !== 1;
            $encoded = $value === null ? null : RecordIdentity::encode($value, $column);
            $large = $record !== null && ($bytes > self::FIELD_BYTES || strlen($encoded ?? '') > $remaining || $invalid);
            $editable = !$column['generated'] && !RecordIdentity::unsupported($column) && !$large;
            if ($large && $value !== null) {
                $previewBytes = max(0, min(Preview::CELL_BYTES, $remaining));
                if ($binary || $invalid) $encoded = bin2hex(substr((string) $value, 0, intdiv($previewBytes, 2)));
                else {
                    $encoded = substr((string) $value, 0, $previewBytes);
                    while ($encoded !== '' && preg_match('//u', $encoded) !== 1) $encoded = substr($encoded, 0, -1);
                }
            }
            $column += ['editable' => $editable, 'encoding' => $binary || $invalid ? 'hex' : 'text', 'large' => $large];
            $columns[] = $column;
            if ($row !== null) { $row[$column['name']] = $encoded; $remaining -= strlen($encoded ?? ''); }
        }
        $key = $record === null ? null : RecordIdentity::key($record['row'], $definition['columns'], $definition['key_columns']);
        $editable = $definition['type'] === 'table' && $definition['key_columns'] !== [] && ($record === null || $key !== null);
        $canInsert = $definition['type'] === 'table';
        foreach ($columns as $column) {
            if (RecordIdentity::unsupported($column) && !$column['generated'] && !$column['nullable'] && $column['default'] === null && !$column['auto_increment']) $canInsert = false;
        }
        $reasonCode = $definition['type'] !== 'table' ? 'row_view_unsupported' : (!$editable ? 'row_key_required' : null);
        return ['database' => $this->database->name(), 'table' => $definition['table'], 'type' => $definition['type'],
            'editable' => $editable, 'can_insert' => $canInsert, 'key_columns' => $definition['key_columns'],
            'columns' => $columns, 'row' => $row, 'key' => $key, 'version' => $record === null ? null : $this->version($definition, $record),
            'reason' => $reasonCode === null ? null : Messages::text($reasonCode), 'reason_code' => $reasonCode,
            'reason_i18n' => $reasonCode === null ? null : Messages::translations($reasonCode)];
    }

    private function requireEditable(array $definition): void
    {
        if ($definition['type'] !== 'table') throw ApiException::fromCode('row_view_unsupported', 422);
        if ($definition['key_columns'] === []) throw ApiException::fromCode('row_key_required', 422);
    }

    /** Read raw values and server-side byte fingerprints in the same statement. */
    private function read(PDO $pdo, array $definition, array $key, bool $lock = false, bool $required = true): ?array
    {
        $parameters = [];
        $where = $this->keyWhere($definition, $key, $parameters, 'key_');
        $projection = array_map(Database::identifier(...), array_column($definition['columns'], 'name'));
        foreach ($definition['columns'] as $column) $projection[] = 'SHA2(CAST(' . Database::identifier($column['name']) . ' AS BINARY), 256)';
        $statement = $pdo->prepare('SELECT ' . implode(', ', $projection) . ' FROM ' . Database::identifier($definition['table'])
            . ' WHERE ' . $where . ' LIMIT 2' . ($lock ? ' FOR UPDATE' : ''));
        $this->execute($statement, $parameters);
        $rows = $statement->fetchAll(PDO::FETCH_NUM);
        if (count($rows) > 1) throw ApiException::fromCode('row_key_required', 409);
        if ($rows === []) {
            if ($required) throw ApiException::fromCode('row_missing', 404);
            return null;
        }
        $count = count($definition['columns']);
        $values = array_slice($rows[0], 0, $count);
        return ['row' => array_combine(array_column($definition['columns'], 'name'), $values), 'guards' => array_slice($rows[0], $count)];
    }

    private function keyWhere(array $definition, array $key, array &$parameters, string $prefix): string
    {
        $names = array_map('strval', array_keys($key));
        $expected = $definition['key_columns'];
        sort($names); sort($expected);
        if ($names !== $expected || $expected === []) throw ApiException::fromCode('row_key_invalid', 422);
        $where = [];
        foreach ($definition['key_columns'] as $index => $name) {
            $column = $definition['map'][$name];
            $value = $key[$name];
            if (!is_string($value) || strlen($value) > self::FIELD_BYTES) throw ApiException::fromCode('row_key_invalid', 422);
            $parameter = $prefix . $index;
            if (RecordIdentity::binary($column)) {
                $this->validateHex($value);
                $expression = 'UNHEX(:' . $parameter . ')';
            } else {
                $cast = $this->numericKeyCast($column, $value);
                $expression = $cast === null ? ':' . $parameter : 'CAST(:' . $parameter . ' AS ' . $cast . ')';
            }
            $parameters[$parameter] = $value;
            $where[] = Database::identifier($name) . ' = ' . $expression;
        }
        return implode(' AND ', $where);
    }

    /** Numeric/string comparison otherwise promotes exact keys to DOUBLE. */
    private function numericKeyCast(array $column, string $value): ?string
    {
        $type = strtolower($column['data_type']);
        $zeroFill = str_contains(strtolower($column['type']), 'zerofill');
        if (in_array($type, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'year'], true)) {
            if (preg_match($zeroFill ? '/\A[0-9]+\z/D' : '/\A-?(?:0|[1-9][0-9]*)\z/D', $value) !== 1
                || strlen(ltrim($value, '-0')) > 20)
                throw ApiException::fromCode('row_key_invalid', 422);
            return 'DECIMAL(20,0)';
        }
        if (in_array($type, ['decimal', 'numeric'], true)) {
            if (preg_match('/\A(?:decimal|numeric)\(([1-9][0-9]*),([0-9]+)\)/i', $column['type'], $match) !== 1
                || preg_match($zeroFill ? '/\A[0-9]+(?:\.[0-9]+)?\z/D' : '/\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\z/D', $value) !== 1)
                throw ApiException::fromCode('row_key_invalid', 422);
            $precision = (int) $match[1];
            $scale = (int) $match[2];
            [$integer, $fraction] = array_pad(explode('.', ltrim($value, '-'), 2), 2, '');
            if (strlen(ltrim($integer, '0')) > $precision - $scale || strlen($fraction) > $scale)
                throw ApiException::fromCode('row_key_invalid', 422);
            return 'DECIMAL(' . $precision . ',' . $scale . ')';
        }
        if (in_array($type, ['float', 'double', 'real'], true)
            && preg_match('/\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\z/D', $value) !== 1)
            throw ApiException::fromCode('row_key_invalid', 422);
        return null;
    }

    private function guardWhere(array $definition, array $record, array &$parameters): string
    {
        $where = '';
        foreach ($definition['columns'] as $index => $column) {
            $key = 'guard_' . $index;
            $parameters[$key] = $record['guards'][$index];
            $where .= ' AND SHA2(CAST(' . Database::identifier($column['name']) . ' AS BINARY), 256) <=> :' . $key;
        }
        return $where;
    }

    private function version(array $definition, array $record): string
    {
        return hash('sha256', serialize([$this->database->name(), $definition['table'], $record['row'], $record['guards']]));
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
            if ($column === null || !$column['editable']) throw ApiException::fromCode('row_field_readonly', 422, ['column' => $name]);
            if (!is_array($field) || !isset($field['mode']) || !in_array($field['mode'], ['value', 'null', 'default'], true))
                throw ApiException::fromCode('row_values_invalid', 422);
            if ($field['mode'] === 'null' && !$column['nullable']) throw ApiException::fromCode('row_null_invalid', 422, ['column' => $name]);
            $normalized = ['mode' => $field['mode']];
            if ($field['mode'] === 'value') {
                if (!array_key_exists('value', $field) || !is_string($field['value'])) throw ApiException::fromCode('row_values_invalid', 422);
                $value = $field['value'];
                if ($column['encoding'] === 'hex') $this->validateHex($value);
                $size = $column['encoding'] === 'hex' ? intdiv(strlen($value), 2) : strlen($value);
                $bytes += $size;
                if ($size > self::FIELD_BYTES || $bytes > self::FORM_BYTES) throw ApiException::fromCode('row_value_too_large', 413);
                $normalized['value'] = $value;
            }
            $values[$name] = $normalized;
        }
        return $values;
    }

    private function valueExpression(array $column, array $field, string $parameter, array &$parameters): string
    {
        $parameters[$parameter] = $field['mode'] === 'null' ? null : $field['value'];
        return RecordIdentity::binary($column) && $field['mode'] !== 'null' ? 'UNHEX(:' . $parameter . ')' : ':' . $parameter;
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

    private function insertedKey(array $definition, array $values, string|false $insertId): ?array
    {
        if ($definition['key_columns'] === []) return null;
        $key = [];
        foreach ($definition['key_columns'] as $name) {
            $field = $values[$name] ?? ['mode' => 'default'];
            if ($field['mode'] === 'value') $key[$name] = $field['value'];
            elseif ($definition['map'][$name]['auto_increment'] && $insertId !== false && $insertId !== '' && $insertId !== '0') $key[$name] = $insertId;
            else return null;
        }
        return $key;
    }

    private function mutationResult(array $definition, int $affected, ?array $record): array
    {
        $data = $record === null ? null : $this->descriptor($definition, $record);
        return ['affected_rows' => $affected, 'key' => $data['key'] ?? null, 'row' => $data['row'] ?? null, 'version' => $data['version'] ?? null];
    }

    private function rethrow(\Throwable $exception): never
    {
        if ($exception instanceof PDOException) {
            $code = (int) ($exception->errorInfo[1] ?? 0);
            if (in_array($code, [1044, 1142, 1143, 1227], true)) throw ApiException::fromCode('row_permission_denied', 403);
            $detail = (string) ($exception->errorInfo[2] ?? $exception->getMessage());
            throw ApiException::fromCode('row_write_failed', 422, ['detail' => substr($detail, 0, 2000)]);
        }
        throw $exception;
    }
}
