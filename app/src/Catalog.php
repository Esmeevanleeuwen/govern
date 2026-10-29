<?php
declare(strict_types=1);

namespace Govern;

use PDO;

final class Catalog
{
    public function __construct(private readonly Database $database) {}

    /** Complete diagram metadata in three reads, independent of the table count. */
    public function schema(): array
    {
        $pdo = $this->database->reader();
        $statement = $pdo->prepare(
            'SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
             FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema ORDER BY TABLE_NAME'
        );
        $statement->execute(['schema' => $this->database->name()]);
        $tables = [];
        foreach ($statement as $row) {
            if (str_starts_with($row['TABLE_NAME'], '_govern_')) {
                continue;
            }
            $tables[$row['TABLE_NAME']] = [
                'name' => $row['TABLE_NAME'],
                'type' => $row['TABLE_TYPE'] === 'VIEW' ? 'view' : 'table',
                'comment' => $row['TABLE_COMMENT'] === 'VIEW' ? '' : $row['TABLE_COMMENT'],
                'columns' => [],
                'foreign_keys' => [],
            ];
        }
        $statement = $pdo->prepare(
            'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                    EXTRA, COLUMN_KEY, COLUMN_COMMENT, GENERATION_EXPRESSION
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema
             ORDER BY TABLE_NAME, ORDINAL_POSITION'
        );
        $statement->execute(['schema' => $this->database->name()]);
        foreach ($statement as $row) {
            if (isset($tables[$row['TABLE_NAME']])) {
                $tables[$row['TABLE_NAME']]['columns'][] = self::columnMetadata($row);
            }
        }
        $statement = $pdo->prepare(
            'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
                    REFERENCED_COLUMN_NAME, REFERENCED_TABLE_SCHEMA
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=:schema AND REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION'
        );
        $statement->execute(['schema' => $this->database->name()]);
        foreach ($statement as $row) {
            $table = $row['TABLE_NAME'];
            if (!isset($tables[$table])) {
                continue;
            }
            $name = $row['CONSTRAINT_NAME'];
            $tables[$table]['foreign_keys'][$name] ??= [
                'name' => $name, 'columns' => [], 'referenced_table' => $row['REFERENCED_TABLE_NAME'],
                'referenced_schema' => $row['REFERENCED_TABLE_SCHEMA'], 'referenced_columns' => [],
            ];
            $tables[$table]['foreign_keys'][$name]['columns'][] = $row['COLUMN_NAME'];
            $tables[$table]['foreign_keys'][$name]['referenced_columns'][] = $row['REFERENCED_COLUMN_NAME'];
        }
        foreach ($tables as &$table) {
            $table['foreign_keys'] = array_values($table['foreign_keys']);
        }
        unset($table);
        return ['database' => $this->database->name(), 'tables' => array_values($tables)];
    }

    public function tables(): array
    {
        $statement = $this->database->reader()->prepare(
            'SELECT t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_COMMENT, t.TABLE_ROWS,
                    (SELECT COUNT(*) FROM information_schema.COLUMNS c
                     WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME) AS column_count
             FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA=:schema ORDER BY t.TABLE_NAME'
        );
        $statement->execute(['schema' => $this->database->name()]);
        $tables = [];
        foreach ($statement as $row) {
            if (str_starts_with($row['TABLE_NAME'], '_govern_')) {
                continue;
            }
            $tables[] = [
                'name' => $row['TABLE_NAME'],
                'type' => $row['TABLE_TYPE'] === 'VIEW' ? 'view' : 'table',
                'comment' => $row['TABLE_COMMENT'] === 'VIEW' ? '' : $row['TABLE_COMMENT'],
                'rows_estimate' => (int) ($row['TABLE_ROWS'] ?? 0),
                'columns' => (int) $row['column_count'],
            ];
        }
        return $tables;
    }

    public function columns(string $table): array
    {
        $this->requireTable($table);
        $statement = $this->database->reader()->prepare(
            'SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                    EXTRA, COLUMN_KEY, COLUMN_COMMENT, GENERATION_EXPRESSION
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table ORDER BY ORDINAL_POSITION'
        );
        $statement->execute(['schema' => $this->database->name(), 'table' => $table]);
        $columns = [];
        foreach ($statement as $row) {
            $columns[] = self::columnMetadata($row);
        }
        return $columns;
    }

    public function foreignKeys(string $table): array
    {
        $this->requireTable($table);
        $statement = $this->database->reader()->prepare(
            'SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
                    REFERENCED_TABLE_SCHEMA
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table AND REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION'
        );
        $statement->execute(['schema' => $this->database->name(), 'table' => $table]);
        $references = [];
        foreach ($statement as $row) {
            $name = $row['CONSTRAINT_NAME'];
            $references[$name] ??= [
                'name' => $name, 'columns' => [], 'referenced_table' => $row['REFERENCED_TABLE_NAME'],
                'referenced_schema' => $row['REFERENCED_TABLE_SCHEMA'], 'referenced_columns' => [],
            ];
            $references[$name]['columns'][] = $row['COLUMN_NAME'];
            $references[$name]['referenced_columns'][] = $row['REFERENCED_COLUMN_NAME'];
        }
        return array_values($references);
    }

    public function structure(string $table): array
    {
        $type = $this->requireTable($table);
        $columns = $this->columns($table);
        $pdo = $this->database->reader();
        $statement = $pdo->prepare(
            'SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, INDEX_TYPE
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table
             ORDER BY INDEX_NAME, SEQ_IN_INDEX'
        );
        $statement->execute(['schema' => $this->database->name(), 'table' => $table]);
        $indexes = [];
        foreach ($statement as $row) {
            $name = $row['INDEX_NAME'];
            $indexes[$name] ??= ['name' => $name, 'unique' => $row['NON_UNIQUE'] === '0', 'columns' => [], 'type' => $row['INDEX_TYPE']];
            $indexes[$name]['columns'][] = $row['COLUMN_NAME'] ?? '(expressie)';
        }
        $references = $this->foreignKeys($table);
        $create = $pdo->query('SHOW CREATE ' . ($type === 'VIEW' ? 'VIEW ' : 'TABLE ') . Database::identifier($table))->fetch(PDO::FETCH_NUM);
        return ['table' => $table, 'columns' => $columns, 'indexes' => array_values($indexes),
            'foreign_keys' => $references, 'create_sql' => $create[1] ?? ''];
    }

    public function browse(string $table, int $page, int $pageSize, string $search): array
    {
        $columns = $this->columns($table);
        $page = max(1, $page);
        $pageSize = max(1, min(100, $pageSize));
        if ($page > 10000000) {
            throw ApiException::fromCode('page_too_large');
        }
        if (strlen($search) > 2048) {
            throw ApiException::fromCode('search_too_long');
        }
        $conditions = [];
        $params = [];
        if ($search !== '') {
            $pattern = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $search) . '%';
            foreach ($columns as $index => $column) {
                if (in_array($column['data_type'], ['blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'], true)) {
                    continue;
                }
                $key = 'search_' . $index;
                $conditions[] = 'CAST(' . Database::identifier($column['name']) . " AS CHAR) LIKE :$key ESCAPE '='";
                $params[$key] = $pattern;
            }
            if ($conditions === []) {
                throw ApiException::fromCode('search_not_supported');
            }
        }
        $where = $conditions === [] ? '' : ' WHERE (' . implode(' OR ', $conditions) . ')';
        $quoted = Database::identifier($table);
        $pdo = $this->database->reader();
        $count = $pdo->prepare('SELECT COUNT(*) FROM ' . $quoted . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $order = array_column(array_filter($columns, static fn (array $column): bool => $column['primary']), 'name');
        if ($order === [] && isset($columns[0])) {
            $order = [$columns[0]['name']];
        }
        $orderSql = $order === [] ? '' : ' ORDER BY ' . implode(', ', array_map(Database::identifier(...), $order));
        $sql = 'SELECT * FROM ' . $quoted . $where . $orderSql . ' LIMIT :page_size OFFSET :offset';
        $parameters = $params + ['page_size' => $pageSize, 'offset' => ($page - 1) * $pageSize];
        $rows = [];
        $shortened = false;
        $bytes = 0;
        $statement = null;
        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        try {
            $statement = $pdo->prepare($sql);
            foreach ($parameters as $name => $value) {
                $statement->bindValue(':' . $name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
            }
            $statement->execute();
            while ($row = $statement->fetch(PDO::FETCH_ASSOC)) {
                $row = Preview::row($row, $shortened);
                $bytes += Preview::bytes($row);
                $rows[] = $row;
                if ($bytes > Preview::RESULT_BYTES) {
                    $shortened = true;
                    break;
                }
            }
            $statement->closeCursor();
        } finally {
            if ($statement !== null) {
                try {
                    $statement->closeCursor();
                } catch (\PDOException) {
                    // Do not replace the original database error.
                }
            }
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
        }
        return ['table' => $table, 'columns' => $columns, 'rows' => $rows, 'page' => $page,
            'page_size' => $pageSize, 'total' => $total, 'sql' => $sql, 'params' => $parameters,
            'truncated' => $shortened,
            'notice' => $shortened ? Messages::text('browse_shortened') : null,
            'notice_i18n' => $shortened ? Messages::translations('browse_shortened') : null];
    }

    private function requireTable(string $table): string
    {
        $statement = $this->database->reader()->prepare(
            'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table'
        );
        $statement->execute(['schema' => $this->database->name(), 'table' => $table]);
        $row = $statement->fetch();
        if ($row === false || $row['TABLE_NAME'] !== $table) {
            throw ApiException::fromCode('table_missing', 404);
        }
        return $row['TABLE_TYPE'];
    }

    private static function columnMetadata(array $row): array
    {
        return [
            'name' => $row['COLUMN_NAME'],
            'type' => $row['COLUMN_TYPE'],
            'data_type' => $row['DATA_TYPE'],
            'nullable' => $row['IS_NULLABLE'] === 'YES',
            'default' => $row['COLUMN_DEFAULT'],
            'generated' => ($row['GENERATION_EXPRESSION'] ?? '') !== '',
            'generation_expression' => $row['GENERATION_EXPRESSION'] ?: null,
            'primary' => $row['COLUMN_KEY'] === 'PRI',
            'auto_increment' => str_contains(strtolower($row['EXTRA']), 'auto_increment'),
            'extra' => $row['EXTRA'],
            'comment' => $row['COLUMN_COMMENT'],
        ];
    }
}
