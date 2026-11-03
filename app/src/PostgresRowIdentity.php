<?php
declare(strict_types=1);

namespace Govern;

/** PostgreSQL row values stay engine-produced strings, independent of previews. */
final class PostgresRowIdentity
{
    // Row-editor keys travel in a GET URL; leave space for scope and route.
    public const KEY_URL_BYTES = 4096;

    public static function supported(array $column): bool
    {
        return ($column['type_kind'] ?? '') === 'e' || (($column['type_schema'] ?? 'pg_catalog') === 'pg_catalog' && in_array($column['data_type'], [
            'int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'bool', 'text', 'varchar', 'bpchar', 'name',
            'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval', 'uuid', 'json', 'jsonb', 'bytea',
            'inet', 'cidr', 'macaddr', 'macaddr8', 'money',
        ], true));
    }

    public static function binary(array $column): bool
    {
        return $column['data_type'] === 'bytea' && ($column['type_schema'] ?? 'pg_catalog') === 'pg_catalog';
    }

    /** Only a complete, immediate, non-partial unique index identifies a row. */
    public static function columns(array $columns, array $indexes): array
    {
        $map = RecordIdentity::columnMap($columns);
        usort($indexes, static fn (array $a, array $b): int =>
            (($a['primary'] ?? false) ? 0 : 1) <=> (($b['primary'] ?? false) ? 0 : 1)
            ?: count($a['columns']) <=> count($b['columns']) ?: strcmp($a['name'], $b['name']));
        foreach ($indexes as $index) {
            if (!$index['unique'] || ($index['partial'] ?? false) || ($index['expression'] ?? false)
                || !($index['immediate'] ?? true) || $index['columns'] === []) continue;
            foreach ($index['columns'] as $name) {
                $column = $map[$name] ?? null;
                if ($column === null || $column['nullable'] || !self::supported($column)
                    || (($column['type_schema'] ?? 'pg_catalog') === 'pg_catalog' && in_array($column['data_type'], ['json', 'jsonb'], true))) continue 2;
            }
            return $index['columns'];
        }
        return [];
    }

    public static function expression(Database $database, array $column): string
    {
        $quoted = $database->quoteIdentifier($column['name']);
        return self::binary($column) ? "pg_catalog.encode($quoted, 'hex')" : "CAST($quoted AS text)";
    }

    public static function key(array $row, array $columns): ?array
    {
        if ($columns === []) return null;
        $key = [];
        foreach ($columns as $name) {
            $value = $row[$name] ?? null;
            if (!is_string($value) || strlen($value) > 131072 || preg_match('//u', $value) !== 1) return null;
            $key[$name] = $value;
        }
        $json = json_encode((object) $key, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen(rawurlencode($json)) > self::KEY_URL_BYTES) return null;
        return $key;
    }
}
