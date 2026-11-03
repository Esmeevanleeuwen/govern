<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** Observable PostgreSQL state, without inventing a MariaDB template or DDL. */
final class PostgresImportInspection
{
    private const MAX_COUNTED_TABLES = 40;
    private const MAX_ESTIMATED_ROWS = 250000;

    public function __construct(private readonly Database $database, private readonly Catalog $catalog) {}

    public function inspect(): array
    {
        $objects = $this->catalog->tables();
        $schema = $this->catalog->schema();
        $tables = $views = $counts = $unchecked = [];
        $foreignKeys = 0;
        $counted = 0;
        $definitions = [];
        foreach ($schema['tables'] as $table) {
            $foreignKeys += count($table['foreign_keys']);
            $definitions[] = [...$table, 'indexes' => $this->catalog->indexes($table['name'])];
        }
        foreach ($objects as $object) {
            $name = (string) $object['name'];
            if ($object['type'] === 'view') { $views[] = $name; continue; }
            $tables[] = $name;
            if ($counted >= self::MAX_COUNTED_TABLES || $object['rows_estimate'] > self::MAX_ESTIMATED_ROWS) {
                $unchecked[] = $name;
                continue;
            }
            $counted++;
            try {
                $counts[$name] = (int) $this->database->reader()->query('SELECT COUNT(*) FROM '
                    . $this->database->quoteIdentifier($this->database->schemaName()) . '.'
                    . $this->database->quoteIdentifier($name))->fetchColumn();
            } catch (PDOException) { $unchecked[] = $name; }
        }
        // Internal tables and routines also belong to the protected state.
        $statement = $this->database->reader()->prepare("SELECT c.oid::text, c.relname, c.relkind,
            a.attnum::text, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull::text, a.attidentity, a.attgenerated,
            CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid,true) END AS view_definition,
            pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS expression
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
            WHERE n.nspname=:schema AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.relname,a.attnum");
        $statement->execute(['schema' => $this->database->schemaName()]);
        $inventory = $statement->fetchAll(PDO::FETCH_ASSOC);
        $statement = $this->database->reader()->prepare("SELECT p.oid::text, p.proname,
            pg_catalog.pg_get_functiondef(p.oid) AS definition
            FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=:schema AND p.prokind IN ('f','p') ORDER BY p.oid");
        $statement->execute(['schema' => $this->database->schemaName()]);
        $routines = $statement->fetchAll(PDO::FETCH_ASSOC);
        $statement = $this->database->reader()->prepare("SELECT con.oid::text, con.conname,
            pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
            FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_namespace n ON n.oid=con.connamespace
            WHERE n.nspname=:schema ORDER BY con.oid");
        $statement->execute(['schema' => $this->database->schemaName()]);
        $constraints = $statement->fetchAll(PDO::FETCH_ASSOC);
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(),
            'scope_key' => ConnectionScope::scopeKey('postgres', $this->database->name(), $this->database->schemaName()),
            'tables' => $tables, 'views' => $views, 'foreign_keys' => $foreignKeys,
            'row_counts' => (object) $counts, 'unchecked_rows' => $unchecked,
            'total_records' => $unchecked === [] ? array_sum($counts) : null,
            'template' => null, 'expected_foreign_keys' => null, 'missing_tables' => [],
            'missing_views' => [], 'missing_foreign_keys' => [], 'sections' => [],
            'inspection_available' => true,
            'schema_version' => hash('sha256', serialize([$definitions, $inventory, $routines, $constraints]))];
    }
}
