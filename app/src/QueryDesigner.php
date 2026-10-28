<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Compiles a small visual question against the current, ordinary SQL schema. */
final class QueryDesigner
{
    private const TEXT_TYPES = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'];
    private const NUMBER_TYPES = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'year'];
    private const REAL_TYPES = ['float', 'double', 'real'];
    private const TIME_TYPES = ['date', 'datetime', 'timestamp', 'time'];
    private const COMPARISONS = ['eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='];
    private const ALIASES = ['base' => 'basis', 'related' => 'gekoppeld'];

    public function __construct(private readonly Database $database) {}

    /** prepared_sql and params are internal; sql can be edited and saved normally. */
    public function compile(mixed $design): array
    {
        $design = self::object($design, ['table', 'join', 'columns', 'filters', 'match', 'order', 'limit'], 'field.query');
        $table = self::text($design['table'], 'field.table_name');
        $catalog = new Catalog($this->database);
        // Only inspect the metadata needed to compose the question. SHOW CREATE
        // VIEW can prepare/evaluate a view; compiling must not execute it.
        $sources = ['base' => self::sourceColumns($catalog, $table)];
        $joinSql = '';
        $joined = $design['join'] !== null;
        $explanation = [['code' => 'explain_source', 'params' => ['table' => $table]]];
        if ($joined) {
            $join = self::object($design['join'], ['foreign_key', 'type'], 'field.join');
            $key = self::text($join['foreign_key'], 'field.relationship_name');
            $joinType = self::choice($join['type'], ['left', 'inner'], 'field.join_type');
            $keys = array_column($catalog->foreignKeys($table), null, 'name');
            if (!isset($keys[$key])) {
                throw ApiException::fromCode('relationship_missing', 422);
            }
            $reference = $keys[$key];
            if ($reference['referenced_schema'] !== $this->database->name()) {
                throw ApiException::fromCode('relationship_other_database', 422);
            }
            $sources['related'] = self::sourceColumns($catalog, $reference['referenced_table']);
            $conditions = [];
            foreach ($reference['columns'] as $index => $column) {
                $left = self::field(['source' => 'base', 'column' => $column], $sources);
                $right = self::field(['source' => 'related', 'column' => $reference['referenced_columns'][$index]], $sources);
                $conditions[] = $left['sql'] . ' = ' . $right['sql'];
            }
            $joinSql = "\n" . strtoupper($joinType) . ' JOIN ' . Database::identifier($reference['referenced_table'])
                . ' AS `gekoppeld` ON ' . implode(' AND ', $conditions);
            $explanation[] = ['code' => 'explain_join', 'params' => ['table' => $reference['referenced_table'], 'key' => $key]];
            $explanation[] = ['code' => $joinType === 'left' ? 'explain_left_join' : 'explain_inner_join'];
        }

        $columns = self::items($design['columns'], 1024, 'field.columns');
        if ($columns === []) {
            throw ApiException::fromCode('column_required', 422);
        }
        $selection = [];
        $seen = [];
        foreach ($columns as $column) {
            $column = self::object($column, ['source', 'column'], 'field.column');
            $field = self::field($column, $sources);
            self::unique($seen, $field['sql'], 'column_duplicate');
            $selection[] = $field['sql'] . ($joined ? ' AS ' . Database::identifier(self::ALIASES[$column['source']] . '.' . $column['column']) : '');
        }
        $prefix = 'SELECT ' . implode(', ', $selection) . "\nFROM " . Database::identifier($table) . ' AS `basis`' . $joinSql;
        $preparedConditions = [];
        $displayConditions = [];
        $parameters = [];
        $match = self::choice($design['match'], ['all', 'any'], 'field.match');
        $filters = self::items($design['filters'], 64, 'field.filters');
        $pdo = $this->database->reader();
        foreach ($filters as $index => $filter) {
            $filter = self::object($filter, ['source', 'column', 'operator'], 'field.filter', ['value']);
            $field = self::field($filter, $sources);
            $operator = self::choice($filter['operator'], [...array_keys(self::COMPARISONS), 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'], 'field.operator');
            if (in_array($operator, ['is_null', 'is_not_null'], true)) {
                if (array_key_exists('value', $filter)) {
                    throw ApiException::fromCode('null_filter_has_value', 422);
                }
                $condition = $field['sql'] . ($operator === 'is_null' ? ' IS NULL' : ' IS NOT NULL');
                $preparedConditions[] = $condition;
                $displayConditions[] = $condition;
                continue;
            }
            if (!array_key_exists('value', $filter)) {
                throw ApiException::fromCode('filter_value_missing', 422);
            }
            $value = self::text($filter['value'], 'field.value', true);
            $key = 'filter_' . $index;
            $type = $field['column']['data_type'];
            $preparedValue = ':' . $key;
            $displayValue = $pdo->quote($value);
            if (isset(self::COMPARISONS[$operator])) {
                if (in_array($type, self::NUMBER_TYPES, true)) {
                    $cast = self::decimalCast($value, $pdo);
                    $preparedValue = 'CAST(' . $preparedValue . ' AS ' . $cast . ')';
                    $displayValue = 'CAST(' . $displayValue . ' AS ' . $cast . ')';
                } elseif (in_array($type, self::REAL_TYPES, true)) {
                    if (!preg_match('/\A[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z/', $value)) {
                        throw ApiException::fromCode('number_invalid', 422);
                    }
                    // Exponent zero makes the database use its floating-point
                    // type; PHP never converts an entered number to float.
                    $preparedValue = '(' . $preparedValue . ' + 0e0)';
                    $displayValue = '(' . $displayValue . ' + 0e0)';
                } elseif (!in_array($type, [...self::TEXT_TYPES, ...self::TIME_TYPES], true)) {
                    throw ApiException::fromCode('filter_type_unsupported', 422);
                }
                $comparison = ' ' . self::COMPARISONS[$operator] . ' ';
                $preparedConditions[] = $field['sql'] . $comparison . $preparedValue;
                $displayConditions[] = $field['sql'] . $comparison . $displayValue;
                $parameters[$key] = $value;
            } else {
                if (!in_array($type, self::TEXT_TYPES, true)) {
                    throw ApiException::fromCode('text_filter_required', 422);
                }
                // The explicit '=' escape also keeps a user's %, _ and = literal.
                $pattern = str_replace(['=', '%', '_'], ['==', '=%', '=_'], $value);
                $pattern = ($operator === 'starts_with' ? '' : '%') . $pattern . ($operator === 'ends_with' ? '' : '%');
                $preparedConditions[] = $field['sql'] . " LIKE :$key ESCAPE '='";
                $displayConditions[] = $field['sql'] . ' LIKE ' . $pdo->quote($pattern) . " ESCAPE '='";
                $parameters[$key] = $pattern;
            }
        }
        $separator = $match === 'all' ? ' AND ' : ' OR ';
        $preparedWhere = $preparedConditions === [] ? '' : "\nWHERE (" . implode($separator, $preparedConditions) . ')';
        $displayWhere = $displayConditions === [] ? '' : "\nWHERE (" . implode($separator, $displayConditions) . ')';
        if ($filters !== []) {
            $explanation[] = ['code' => $match === 'all' ? 'explain_all_filters' : 'explain_any_filter'];
            $explanation[] = ['code' => 'explain_null'];
        }

        $ordering = [];
        $seen = [];
        foreach (self::items($design['order'], 64, 'field.sorts') as $order) {
            $order = self::object($order, ['source', 'column', 'direction'], 'field.sort');
            $field = self::field($order, $sources);
            self::unique($seen, $field['sql'], 'sort_duplicate');
            $direction = self::choice($order['direction'], ['asc', 'desc'], 'field.direction');
            $ordering[] = $field['sql'] . ' ' . strtoupper($direction);
        }
        $orderSql = $ordering === [] ? '' : "\nORDER BY " . implode(', ', $ordering);
        if ($ordering === []) {
            $explanation[] = ['code' => 'explain_no_sort'];
        }
        $limit = $design['limit'];
        if (!is_int($limit) || $limit < 1 || $limit > QueryRunner::ROW_LIMIT) {
            throw ApiException::fromCode('row_limit_invalid', 422, ['max' => QueryRunner::ROW_LIMIT]);
        }
        $parameters['row_limit'] = $limit;
        $explanation[] = ['code' => 'explain_limit', 'params' => ['limit' => $limit]];
        $sql = $prefix . $displayWhere . $orderSql . "\nLIMIT " . $limit . ';';
        if (strlen($sql) > 262144) {
            throw ApiException::fromCode('design_too_large', 413);
        }
        return ['sql' => $sql, 'prepared_sql' => $prefix . $preparedWhere . $orderSql . "\nLIMIT :row_limit",
            'params' => $parameters, 'explanation' => Messages::explanations($explanation),
            'explanation_i18n' => ['nl' => Messages::explanations($explanation, 'nl'), 'en' => Messages::explanations($explanation, 'en')]];
    }

    private static function sourceColumns(Catalog $catalog, string $table): array
    {
        $columns = $catalog->columns($table);
        if ($columns === []) {
            throw ApiException::fromCode('source_columns_missing', 422, ['table' => $table]);
        }
        return array_column($columns, null, 'name');
    }

    private static function field(array $field, array $sources): array
    {
        $source = self::choice($field['source'], ['base', 'related'], 'field.source');
        $name = self::text($field['column'], 'field.column_name');
        if (!isset($sources[$source][$name])) {
            throw ApiException::fromCode('column_missing', 422);
        }
        return ['sql' => Database::identifier(self::ALIASES[$source]) . '.' . Database::identifier($name), 'column' => $sources[$source][$name]];
    }

    private static function decimalCast(string $value, PDO $pdo): string
    {
        if (!preg_match('/\A[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\z/', $value)) {
            throw ApiException::fromCode('exact_number_invalid', 422);
        }
        [$integer, $fraction] = array_pad(explode('.', ltrim($value, '+-'), 2), 2, '');
        $scale = strlen(rtrim($fraction, '0'));
        $precision = max(1, strlen(ltrim($integer, '0')) + $scale);
        $maxScale = stripos((string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'MariaDB') !== false ? 38 : 30;
        if ($precision > 65 || $scale > $maxScale) {
            throw ApiException::fromCode('exact_number_too_large', 422);
        }
        return 'DECIMAL(' . $precision . ',' . $scale . ')';
    }

    private static function object(mixed $value, array $required, string $label, array $optional = []): array
    {
        if (!is_array($value) || array_is_list($value) || array_diff($required, array_keys($value)) !== []
            || array_diff(array_keys($value), [...$required, ...$optional]) !== []) {
            throw ApiException::fromCode('design_fields_invalid', 422, ['field' => $label]);
        }
        return $value;
    }

    private static function items(mixed $value, int $max, string $label): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > $max) {
            throw ApiException::fromCode('design_list_invalid', 422, ['field' => $label, 'max' => $max]);
        }
        return $value;
    }

    private static function text(mixed $value, string $label, bool $empty = false): string
    {
        if (!is_string($value) || (!$empty && $value === '') || strlen($value) > 8192
            || str_contains($value, "\0") || preg_match('//u', $value) !== 1) {
            throw ApiException::fromCode('design_text_invalid', 422, ['field' => $label]);
        }
        return $value;
    }

    private static function choice(mixed $value, array $choices, string $label): string
    {
        if (!is_string($value) || !in_array($value, $choices, true)) {
            throw ApiException::fromCode('design_choice_invalid', 422, ['field' => $label]);
        }
        return $value;
    }

    private static function unique(array &$seen, string $key, string $messageCode): void
    {
        if (isset($seen[$key])) {
            throw ApiException::fromCode($messageCode, 422);
        }
        $seen[$key] = true;
    }
}
