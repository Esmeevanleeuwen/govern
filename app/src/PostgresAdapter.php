<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** PostgreSQL starts with an actual read-only role, never a writer fallback. */
final class PostgresAdapter implements DatabaseAdapter
{
    private ?PDO $read = null;

    public function __construct(private readonly array $config) {}

    public function reader(): PDO
    {
        if ($this->read !== null) return $this->read;
        $user = $this->config['read_user'] ?? '';
        $password = $this->config['read_password'] ?? '';
        if ($user === '' || $password === '') throw ApiException::fromCode('credentials_missing', 503);
        if (in_array(strtolower($user), ['root', 'postgres'], true)) throw ApiException::fromCode('reader_required', 503);
        $host = $this->config['host'];
        $name = $this->config['name'];
        // PDO's DSN delimiters must never be accepted as connection parameters.
        foreach ([$host, $name] as $value) {
            if (preg_match('/[;\x00-\x1f\x7f]/', $value)) throw ApiException::fromCode('database_not_available', 403);
        }
        $quote = static fn (string $value): string => "'" . str_replace(['\\', "'"], ['\\\\', "\\'"], $value) . "'";
        $pdo = new PDO('pgsql:host=' . $quote($host) . ';port=' . (int) $this->config['port']
            . ';dbname=' . $quote($name) . ';connect_timeout=5', $user, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => true,
                PDO::ATTR_PERSISTENT => false,
            ]);
        $role = $pdo->query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
            FROM pg_catalog.pg_roles WHERE rolname = current_user')->fetch();
        foreach ($role ?: [] as $privilege) {
            if ($privilege === true || $privilege === 't' || $privilege === '1') throw ApiException::fromCode('reader_required', 503);
        }
        if (!$role) throw ApiException::fromCode('reader_required', 503);
        $pdo->exec("SET TIME ZONE 'UTC'");
        $pdo->exec("SET statement_timeout = '5s'");
        $pdo->exec("SET lock_timeout = '5s'");
        $pdo->exec("SET idle_in_transaction_session_timeout = '10s'");
        $pdo->exec('SET default_transaction_read_only = on');
        // Catalog and table names are always qualified; never use an editable schema search path.
        $pdo->exec('SET search_path = pg_catalog');
        return $this->read = $pdo;
    }

    public function writer(): PDO { throw ApiException::fromCode('postgres_read_only', 403); }
    public function scriptConnection(): PDO { throw ApiException::fromCode('postgres_read_only', 403); }
    public function discardReader(): void { $this->read = null; }
    public function databaseNames(): array { $this->reader(); return [$this->config['name']]; }

    public function schemaNames(): array
    {
        return $this->reader()->query("SELECT nspname FROM pg_catalog.pg_namespace
            WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
              AND pg_catalog.has_schema_privilege(current_user, oid, 'USAGE')
            ORDER BY nspname")->fetchAll(PDO::FETCH_COLUMN);
    }
}
