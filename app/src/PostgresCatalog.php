<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** PostgreSQL metadata normalized for the same explorer and schema diagram. */
final class PostgresCatalog implements CatalogAdapter
{
    private ?array $tableCache = null;
    private ?array $columnCache = null;
    private ?array $referenceCache = null;
    private ?array $indexCache = null;

    public function __construct(private readonly Database $database) {}

    public function tables(): array
    {
        if ($this->tableCache !== null) return array_values($this->tableCache);
        $pdo = $this->database->reader();
        $schema = $pdo->prepare("SELECT nspname FROM pg_catalog.pg_namespace
            WHERE nspname = :schema AND pg_catalog.has_schema_privilege(current_user, oid, 'USAGE')");
        $schema->execute(['schema' => $this->database->schemaName()]);
        if ($schema->fetchColumn() === false) throw ApiException::fromCode('database_not_available', 403);
        $rows = $this->metadata("SELECT c.relname AS table_name, c.relkind, c.relhassubclass,
            pg_catalog.obj_description(c.oid, 'pg_class') AS comment,
            GREATEST(c.reltuples, 0)::bigint AS rows_estimate,
            (SELECT COUNT(*) FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS column_count
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :schema AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
            ORDER BY c.relname");
        $this->tableCache = [];
        foreach ($rows as $row) {
            if (str_starts_with($row['table_name'], '_govern_')) continue;
            $this->tableCache[$row['table_name']] = [
                'name' => $row['table_name'], 'schema' => $this->database->schemaName(),
                'type' => in_array($row['relkind'], ['v', 'm'], true) ? 'view' : 'table',
                'row_editable' => $row['relkind'] === 'p' || ($row['relkind'] === 'r' && !self::boolean($row['relhassubclass'])),
                'comment' => $row['comment'] ?? '', 'rows_estimate' => (int) $row['rows_estimate'],
                'columns' => (int) $row['column_count'],
            ];
        }
        return array_values($this->tableCache);
    }

    public function schema(): array
    {
        $tables = [];
        $columns = $this->allColumns();
        $references = $this->allReferences();
        foreach ($this->tables() as $table) {
            $tables[] = [...$table, 'columns' => $columns[$table['name']] ?? [],
                'foreign_keys' => $references[$table['name']] ?? []];
        }
        // The visualizer compares FK schema names with this namespace.
        return ['database' => $this->database->schemaName(), 'database_name' => $this->database->name(),
            'schema' => $this->database->schemaName(), 'connection' => 'postgres', 'tables' => $tables];
    }

    public function columns(string $table): array
    {
        $this->requireTable($table);
        return $this->allColumns()[$table] ?? [];
    }

    private function allColumns(): array
    {
        if ($this->columnCache !== null) return $this->columnCache;
        $this->tables();
        $rows = $this->metadata("SELECT c.relname AS table_name, a.attname AS column_name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
            CASE WHEN t.typtype = 'd' THEN bt.typname ELSE t.typname END AS data_type,
            CASE WHEN t.typtype = 'd' THEN bt.typtype ELSE t.typtype END AS type_kind,
            (CASE WHEN t.typtype = 'd' THEN bt.typnamespace ELSE t.typnamespace END)::regnamespace::text AS type_schema,
            NOT (a.attnotnull OR t.typnotnull) AS nullable,
            COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), t.typdefault) AS column_default,
            a.attgenerated, a.attidentity,
            EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key_column(number, position)
                WHERE i.indrelid = c.oid AND i.indisprimary
                  AND key_column.position <= i.indnkeyatts AND key_column.number = a.attnum) AS is_primary,
            pg_catalog.col_description(c.oid, a.attnum) AS comment
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
            WHERE n.nspname = :schema AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
            ORDER BY c.relname, a.attnum");
        $this->columnCache = [];
        foreach ($rows as $row) {
            if (!isset($this->tableCache[$row['table_name']])) continue;
            $generated = $row['attgenerated'] !== '';
            $identity = $row['attidentity'] !== '';
            $this->columnCache[$row['table_name']][] = [
                'name' => $row['column_name'], 'type' => $row['column_type'], 'data_type' => $row['data_type'],
                'type_kind' => $row['type_kind'], 'type_schema' => $row['type_schema'], 'identity' => $row['attidentity'],
                'nullable' => self::boolean($row['nullable']), 'default' => $generated ? null : $row['column_default'],
                'generated' => $generated, 'generation_expression' => $generated ? $row['column_default'] : null,
                'primary' => self::boolean($row['is_primary']),
                'auto_increment' => $identity || str_starts_with($row['column_default'] ?? '', 'nextval('),
                'extra' => $generated ? 'generated' : ($identity ? 'identity' : ''), 'comment' => $row['comment'] ?? '',
            ];
        }
        return $this->columnCache;
    }

    public function foreignKeys(string $table): array
    {
        $this->requireTable($table);
        return $this->allReferences()[$table] ?? [];
    }

    private function allReferences(): array
    {
        if ($this->referenceCache !== null) return $this->referenceCache;
        $this->tables();
        $rows = $this->metadata("SELECT source_table.relname AS table_name, con.conname AS constraint_name,
            source_column.attname AS column_name, target_schema.nspname AS referenced_schema,
            target_table.relname AS referenced_table, target_column.attname AS referenced_column
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class source_table ON source_table.oid = con.conrelid
            JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
            JOIN pg_catalog.pg_class target_table ON target_table.oid = con.confrelid
            JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
            CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS keys(source_num, target_num, position)
            JOIN pg_catalog.pg_attribute source_column ON source_column.attrelid = con.conrelid AND source_column.attnum = keys.source_num
            JOIN pg_catalog.pg_attribute target_column ON target_column.attrelid = con.confrelid AND target_column.attnum = keys.target_num
            WHERE con.contype = 'f' AND source_schema.nspname = :schema
              AND pg_catalog.has_table_privilege(current_user, source_table.oid, 'SELECT')
            ORDER BY source_table.relname, con.conname, keys.position");
        $groups = [];
        foreach ($rows as $row) {
            $table = $row['table_name'];
            if (!isset($this->tableCache[$table])) continue;
            $name = $row['constraint_name'];
            $groups[$table][$name] ??= ['name' => $name, 'columns' => [],
                'referenced_table' => $row['referenced_table'], 'referenced_schema' => $row['referenced_schema'],
                'referenced_columns' => []];
            $groups[$table][$name]['columns'][] = $row['column_name'];
            $groups[$table][$name]['referenced_columns'][] = $row['referenced_column'];
        }
        $this->referenceCache = array_map(array_values(...), $groups);
        return $this->referenceCache;
    }

    public function indexes(string $table): array
    {
        $this->requireTable($table);
        if ($this->indexCache === null) {
            $rows = $this->metadata("SELECT c.relname AS table_name, index_table.relname AS index_name,
                i.indisunique, i.indisprimary, i.indimmediate, i.indexprs IS NOT NULL AS has_expression, method.amname AS index_type,
                attribute.attname AS column_name, pg_catalog.pg_get_indexdef(i.indexrelid, key_position.n, true) AS expression,
                i.indpred IS NOT NULL AS partial
                FROM pg_catalog.pg_index i
                JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_catalog.pg_class index_table ON index_table.oid = i.indexrelid
                JOIN pg_catalog.pg_am method ON method.oid = index_table.relam
                CROSS JOIN LATERAL generate_series(1, i.indnkeyatts) AS key_position(n)
                LEFT JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = c.oid AND attribute.attnum = i.indkey[key_position.n - 1]
                WHERE n.nspname = :schema AND i.indisvalid
                  AND pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
                ORDER BY c.relname, index_table.relname, key_position.n");
            $groups = [];
            foreach ($rows as $row) {
                if (!isset($this->tableCache[$row['table_name']])) continue;
                $name = $row['index_name'];
                $groups[$row['table_name']][$name] ??= ['name' => $name, 'unique' => self::boolean($row['indisunique']),
                    'primary' => self::boolean($row['indisprimary']), 'columns' => [], 'sub_parts' => [],
                    'immediate' => self::boolean($row['indimmediate']), 'expression' => self::boolean($row['has_expression']),
                    'type' => $row['index_type'], 'partial' => self::boolean($row['partial'])];
                $groups[$row['table_name']][$name]['columns'][] = $row['column_name'] ?? $row['expression'];
                $groups[$row['table_name']][$name]['sub_parts'][] = null;
            }
            $this->indexCache = array_map(array_values(...), $groups);
        }
        return $this->indexCache[$table] ?? [];
    }

    public function structure(string $table): array
    {
        $metadata = $this->requireTable($table);
        return ['table' => $table, 'schema' => $this->database->schemaName(), 'type' => $metadata['type'],
            'row_editable' => $metadata['row_editable'],
            'columns' => $this->columns($table), 'indexes' => $this->indexes($table),
            'foreign_keys' => $this->foreignKeys($table), 'create_sql' => '', 'create_sql_available' => false];
    }

    public function browse(string $table, int $page, int $pageSize, string $search): array
    {
        $columns = $this->columns($table);
        $metadata = $this->requireTable($table);
        $keyColumns = $metadata['row_editable'] ? PostgresRowIdentity::columns($columns, $this->indexes($table)) : [];
        $page = max(1, $page);
        $pageSize = max(1, min(100, $pageSize));
        if ($page > 10000000) throw ApiException::fromCode('page_too_large');
        if (strlen($search) > 2048) throw ApiException::fromCode('search_too_long');
        $conditions = [];
        $params = [];
        if ($search !== '') {
            $pattern = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $search) . '%';
            foreach ($columns as $index => $column) {
                if (PostgresRowIdentity::binary($column)) continue;
                $key = 'search_' . $index;
                $conditions[] = 'CAST(' . $this->quote($column['name']) . " AS text) ILIKE :$key ESCAPE '='";
                $params[$key] = $pattern;
            }
            if ($conditions === []) throw ApiException::fromCode('search_not_supported');
        }
        $where = $conditions === [] ? '' : ' WHERE (' . implode(' OR ', $conditions) . ')';
        $qualified = $this->quote($this->database->schemaName()) . '.' . $this->quote($table);
        $pdo = $this->database->reader();
        $count = $pdo->prepare('SELECT COUNT(*) FROM ' . $qualified . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $order = array_column(array_filter($columns, static fn (array $column): bool => $column['primary']), 'name');
        $orderSql = $order !== [] ? ' ORDER BY ' . implode(', ', array_map($this->quote(...), $order))
            : (isset($columns[0]) ? ' ORDER BY CAST(' . $this->quote($columns[0]['name']) . ' AS text)' : '');
        $projection = [];
        foreach ($columns as $column) {
            $quoted = $this->quote($column['name']);
            $projection[] = PostgresRowIdentity::expression($this->database, $column) . ' AS ' . $quoted;
        }
        // PostgreSQL permits zero-column tables; SELECT * also represents their rows.
        $sql = 'SELECT ' . ($projection === [] ? '*' : implode(', ', $projection)) . ' FROM ' . $qualified . $where . $orderSql
            . ' LIMIT :page_size OFFSET :offset';
        $parameters = $params + ['page_size' => $pageSize, 'offset' => ($page - 1) * $pageSize];
        $statement = $pdo->prepare($sql);
        foreach ($parameters as $name => $value) $statement->bindValue(':' . $name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        $rows = [];
        $rowKeys = [];
        $bytes = 0;
        $shortened = false;
        try {
            $statement->execute();
            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                $rowKeys[] = PostgresRowIdentity::key($row, $keyColumns);
                foreach ($columns as $column) {
                    if (PostgresRowIdentity::binary($column) && $row[$column['name']] !== null) $row[$column['name']] = '0x' . $row[$column['name']];
                }
                $row = Preview::row($row, $shortened);
                $bytes += Preview::bytes($row);
                $rows[] = $row;
                if ($bytes > Preview::RESULT_BYTES) { $shortened = true; break; }
            }
        } finally {
            $statement->closeCursor();
        }
        return ['table' => $table, 'schema' => $this->database->schemaName(), 'columns' => $columns, 'rows' => $rows,
            'page' => $page, 'page_size' => $pageSize, 'total' => $total, 'sql' => $sql, 'params' => $parameters,
            'key_columns' => $keyColumns, 'row_keys' => $rowKeys, 'read_only' => !$metadata['row_editable'],
            'truncated' => $shortened, 'notice' => $shortened ? Messages::text('browse_shortened') : null,
            'notice_i18n' => $shortened ? Messages::translations('browse_shortened') : null];
    }

    private function requireTable(string $table): array
    {
        $this->tables();
        if (!isset($this->tableCache[$table])) throw ApiException::fromCode('table_missing', 404);
        return $this->tableCache[$table];
    }

    private function metadata(string $sql): array
    {
        $statement = $this->database->reader()->prepare($sql);
        $statement->execute(['schema' => $this->database->schemaName()]);
        return $statement->fetchAll();
    }

    private function quote(string $name): string { return $this->database->quoteIdentifier($name); }
    private static function boolean(mixed $value): bool { return $value === true || $value === 't' || $value === '1' || $value === 1; }
}
