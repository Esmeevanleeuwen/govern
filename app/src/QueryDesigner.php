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
        $design = self::object($design, ['table', 'join', 'columns', 'filters', 'match', 'order', 'limit'], 'de query');
        $table = self::text($design['table'], 'de tabelnaam');
        $catalog = new Catalog($this->database);
        $structure = $catalog->structure($table);
        $sources = ['base' => array_column($structure['columns'], null, 'name')];
        $joinSql = '';
        $joined = $design['join'] !== null;
        $explanation = ['Je leest de tabel of het overzicht ' . $table . '.'];
        if ($joined) {
            $join = self::object($design['join'], ['foreign_key', 'type'], 'de koppeling');
            $key = self::text($join['foreign_key'], 'de naam van de verwijzing');
            $joinType = self::choice($join['type'], ['left', 'inner'], 'het soort koppeling');
            $keys = array_column($structure['foreign_keys'], null, 'name');
            if (!isset($keys[$key])) {
                throw new ApiException('Deze verwijzing bestaat niet meer. Vernieuw de structuur en kies opnieuw.', 422);
            }
            $reference = $keys[$key];
            if ($reference['referenced_schema'] !== $this->database->name()) {
                throw new ApiException('Deze verwijzing loopt naar een andere database. Gebruik daarvoor de SQL-editor.', 422);
            }
            $sources['related'] = array_column($catalog->columns($reference['referenced_table']), null, 'name');
            $conditions = [];
            foreach ($reference['columns'] as $index => $column) {
                $left = self::field(['source' => 'base', 'column' => $column], $sources);
                $right = self::field(['source' => 'related', 'column' => $reference['referenced_columns'][$index]], $sources);
                $conditions[] = $left['sql'] . ' = ' . $right['sql'];
            }
            $joinSql = "\n" . strtoupper($joinType) . ' JOIN ' . Database::identifier($reference['referenced_table'])
                . ' AS `gekoppeld` ON ' . implode(' AND ', $conditions);
            $explanation[] = 'De koppeling met ' . $reference['referenced_table'] . ' volgt de bestaande verwijzing ' . $key . '.';
            $explanation[] = $joinType === 'left'
                ? 'LEFT JOIN houdt rijen zonder gekoppelde match aanvankelijk zichtbaar. Filters op gekoppelde velden kunnen die rijen alsnog uitsluiten.'
                : 'INNER JOIN laat alleen rijen zien waarvoor een gekoppelde match bestaat.';
        }

        $columns = self::items($design['columns'], 1024, 'de gekozen kolommen');
        if ($columns === []) {
            throw new ApiException('Kies minstens één kolom om te tonen.', 422);
        }
        $selection = [];
        $seen = [];
        foreach ($columns as $column) {
            $column = self::object($column, ['source', 'column'], 'een gekozen kolom');
            $field = self::field($column, $sources);
            self::unique($seen, $field['sql'], 'Deze kolom is meer dan één keer gekozen.');
            $selection[] = $field['sql'] . ($joined ? ' AS ' . Database::identifier(self::ALIASES[$column['source']] . '.' . $column['column']) : '');
        }
        $prefix = 'SELECT ' . implode(', ', $selection) . "\nFROM " . Database::identifier($table) . ' AS `basis`' . $joinSql;
        $preparedConditions = [];
        $displayConditions = [];
        $parameters = [];
        $match = self::choice($design['match'], ['all', 'any'], 'de filtercombinatie');
        $filters = self::items($design['filters'], 64, 'de filters');
        $pdo = $this->database->reader();
        foreach ($filters as $index => $filter) {
            $filter = self::object($filter, ['source', 'column', 'operator'], 'een filter', ['value']);
            $field = self::field($filter, $sources);
            $operator = self::choice($filter['operator'], [...array_keys(self::COMPARISONS), 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'], 'de filterbewerking');
            if (in_array($operator, ['is_null', 'is_not_null'], true)) {
                if (array_key_exists('value', $filter)) {
                    throw new ApiException('Een NULL-filter heeft geen invoerwaarde. Verwijder die waarde uit het filter.', 422);
                }
                $condition = $field['sql'] . ($operator === 'is_null' ? ' IS NULL' : ' IS NOT NULL');
                $preparedConditions[] = $condition;
                $displayConditions[] = $condition;
                continue;
            }
            if (!array_key_exists('value', $filter)) {
                throw new ApiException('Dit filter mist een waarde. Gebruik een NULL-filter wanneer je ontbrekende waarden zoekt.', 422);
            }
            $value = self::text($filter['value'], 'de filterwaarde', true);
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
                        throw new ApiException('Vul een geldig getal in met een punt als decimaalteken.', 422);
                    }
                    // Exponent zero makes the database use its floating-point
                    // type; PHP never converts an entered number to float.
                    $preparedValue = '(' . $preparedValue . ' + 0e0)';
                    $displayValue = '(' . $displayValue . ' + 0e0)';
                } elseif (!in_array($type, [...self::TEXT_TYPES, ...self::TIME_TYPES], true)) {
                    throw new ApiException('Dit veldtype kan in de querybouwer alleen op NULL worden gefilterd. Gebruik voor andere vergelijkingen de SQL-editor.', 422);
                }
                $comparison = ' ' . self::COMPARISONS[$operator] . ' ';
                $preparedConditions[] = $field['sql'] . $comparison . $preparedValue;
                $displayConditions[] = $field['sql'] . $comparison . $displayValue;
                $parameters[$key] = $value;
            } else {
                if (!in_array($type, self::TEXT_TYPES, true)) {
                    throw new ApiException('Bevat, begint met en eindigt op zijn bedoeld voor tekstkolommen.', 422);
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
            $explanation[] = $match === 'all' ? 'Alle filters moeten tegelijk kloppen (AND).' : 'Minstens één filter moet kloppen (OR).';
            $explanation[] = 'NULL betekent dat een waarde ontbreekt; dat is iets anders dan lege tekst. Tekstvergelijkingen volgen de ingestelde databasecollatie.';
        }

        $ordering = [];
        $seen = [];
        foreach (self::items($design['order'], 64, 'de sorteringen') as $order) {
            $order = self::object($order, ['source', 'column', 'direction'], 'een sortering');
            $field = self::field($order, $sources);
            self::unique($seen, $field['sql'], 'Sorteer een kolom maar één keer.');
            $direction = self::choice($order['direction'], ['asc', 'desc'], 'de sorteerrichting');
            $ordering[] = $field['sql'] . ' ' . strtoupper($direction);
        }
        $orderSql = $ordering === [] ? '' : "\nORDER BY " . implode(', ', $ordering);
        if ($ordering === []) {
            $explanation[] = 'Zonder sortering is de volgorde van de rijen niet gegarandeerd.';
        }
        $limit = $design['limit'];
        if (!is_int($limit) || $limit < 1 || $limit > QueryRunner::ROW_LIMIT) {
            throw new ApiException('Kies een geheel aantal rijen van 1 tot ' . QueryRunner::ROW_LIMIT . '.', 422);
        }
        $parameters['row_limit'] = $limit;
        $explanation[] = 'Je toont maximaal ' . $limit . ' rijen. De SQL-editor blijft beschikbaar voor een verder uitgewerkte vraag.';
        $sql = $prefix . $displayWhere . $orderSql . "\nLIMIT " . $limit . ';';
        if (strlen($sql) > 262144) {
            throw new ApiException('Deze samengestelde vraag is te groot. Kies minder velden of kortere filters.', 413);
        }
        return ['sql' => $sql, 'prepared_sql' => $prefix . $preparedWhere . $orderSql . "\nLIMIT :row_limit",
            'params' => $parameters, 'explanation' => $explanation];
    }

    private static function field(array $field, array $sources): array
    {
        $source = self::choice($field['source'], ['base', 'related'], 'de herkomst van de kolom');
        $name = self::text($field['column'], 'de kolomnaam');
        if (!isset($sources[$source][$name])) {
            throw new ApiException('Deze kolom hoort niet bij de gekozen tabel of koppeling. Vernieuw de structuur en kies opnieuw.', 422);
        }
        return ['sql' => Database::identifier(self::ALIASES[$source]) . '.' . Database::identifier($name), 'column' => $sources[$source][$name]];
    }

    private static function decimalCast(string $value, PDO $pdo): string
    {
        if (!preg_match('/\A[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\z/', $value)) {
            throw new ApiException('Vul een exact getal in met cijfers en eventueel een punt als decimaalteken.', 422);
        }
        [$integer, $fraction] = array_pad(explode('.', ltrim($value, '+-'), 2), 2, '');
        $scale = strlen(rtrim($fraction, '0'));
        $precision = max(1, strlen(ltrim($integer, '0')) + $scale);
        $maxScale = stripos((string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'MariaDB') !== false ? 38 : 30;
        if ($precision > 65 || $scale > $maxScale) {
            throw new ApiException('Dit getal heeft meer cijfers of decimalen dan de database exact kan vergelijken.', 422);
        }
        return 'DECIMAL(' . $precision . ',' . $scale . ')';
    }

    private static function object(mixed $value, array $required, string $label, array $optional = []): array
    {
        if (!is_array($value) || array_is_list($value) || array_diff($required, array_keys($value)) !== []
            || array_diff(array_keys($value), [...$required, ...$optional]) !== []) {
            throw new ApiException('Ongeldige velden voor ' . $label . '. Vernieuw de querybouwer en controleer je keuzes.', 422);
        }
        return $value;
    }

    private static function items(mixed $value, int $max, string $label): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > $max) {
            throw new ApiException('Gebruik een lijst van maximaal ' . $max . ' onderdelen voor ' . $label . '.', 422);
        }
        return $value;
    }

    private static function text(mixed $value, string $label, bool $empty = false): string
    {
        if (!is_string($value) || (!$empty && $value === '') || strlen($value) > 8192
            || str_contains($value, "\0") || preg_match('//u', $value) !== 1) {
            throw new ApiException('Vul geldige tekst in voor ' . $label . ' (maximaal 8192 bytes).', 422);
        }
        return $value;
    }

    private static function choice(mixed $value, array $choices, string $label): string
    {
        if (!is_string($value) || !in_array($value, $choices, true)) {
            throw new ApiException('Kies een geldige optie voor ' . $label . '.', 422);
        }
        return $value;
    }

    private static function unique(array &$seen, string $key, string $message): void
    {
        if (isset($seen[$key])) {
            throw new ApiException($message, 422);
        }
        $seen[$key] = true;
    }
}
