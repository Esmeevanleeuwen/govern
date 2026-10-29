<?php
declare(strict_types=1);

namespace Govern;

/** Exact record keys are independent of shortened, formatted browse values. */
final class RecordIdentity
{
    public static function binary(array $column): bool
    {
        return in_array(strtolower($column['data_type']), ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'], true);
    }

    public static function unsupported(array $column): bool
    {
        return in_array(strtolower($column['data_type']), ['bit', 'geometry', 'point', 'linestring', 'polygon',
            'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'], true);
    }

    public static function columnMap(array $columns): array
    {
        $map = [];
        foreach ($columns as $column) $map[$column['name']] = $column;
        return $map;
    }

    /** Prefer the primary key, otherwise a complete, non-nullable unique key. */
    public static function columns(array $columns, array $indexes): array
    {
        $map = self::columnMap($columns);
        usort($indexes, static function (array $left, array $right): int {
            return (($left['name'] === 'PRIMARY' ? 0 : 1) <=> ($right['name'] === 'PRIMARY' ? 0 : 1))
                ?: (count($left['columns']) <=> count($right['columns'])) ?: strcmp($left['name'], $right['name']);
        });
        foreach ($indexes as $index) {
            if (!$index['unique'] || $index['columns'] === []) continue;
            foreach ($index['columns'] as $position => $name) {
                $column = $map[$name] ?? null;
                if ($column === null || $column['nullable'] || $column['generated'] || self::unsupported($column)
                    || ($index['sub_parts'][$position] ?? null) !== null) continue 2;
            }
            return $index['columns'];
        }
        return [];
    }

    public static function encode(mixed $value, array $column): ?string
    {
        if ($value === null) return null;
        return self::binary($column) ? bin2hex((string) $value) : (string) $value;
    }

    public static function key(array $row, array $columns, array $keyColumns): ?array
    {
        if ($keyColumns === []) return null;
        $map = self::columnMap($columns);
        $key = [];
        foreach ($keyColumns as $name) {
            if (!array_key_exists($name, $row) || $row[$name] === null) return null;
            $value = self::encode($row[$name], $map[$name]);
            if (preg_match('//u', $value) !== 1) return null;
            $key[$name] = $value;
        }
        return $key;
    }
}
