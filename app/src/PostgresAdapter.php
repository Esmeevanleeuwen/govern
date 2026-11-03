<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Separate PostgreSQL reader and scoped DML writer sessions. */
final class PostgresAdapter implements DatabaseAdapter
{
    private ?PDO $read = null;
    private ?PDO $write = null;

    public function __construct(private readonly array $config) {}

    public function reader(): PDO
    {
        return $this->read ??= $this->connect('read');
    }

    public function writer(): PDO
    {
        return $this->write ??= $this->connect('write');
    }

    private function connect(string $kind): PDO
    {
        $readOnly = $kind === 'read';
        $user = $this->config[match ($kind) { 'read' => 'read_user', 'sql' => 'sql_user', default => 'user' }] ?? '';
        $password = $this->config[match ($kind) { 'read' => 'read_password', 'sql' => 'sql_password', default => 'password' }] ?? '';
        if ($user === '' || $password === '') throw ApiException::fromCode('credentials_missing', 503);
        $roleError = $readOnly ? 'reader_required' : ($kind === 'sql' ? 'postgres_sql_required' : 'postgres_writer_required');
        if (in_array(strtolower($user), ['root', 'postgres'], true)
            || ($kind !== 'read' && $user === ($this->config['read_user'] ?? ''))
            || ($kind === 'read' && in_array($user, [$this->config['user'] ?? '', $this->config['sql_user'] ?? ''], true))
            || ($kind === 'sql' && in_array($user, [$this->config['user'] ?? '', $this->config['restore_user'] ?? ''], true))) {
            throw ApiException::fromCode($roleError, 503);
        }
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
            if ($privilege === true || $privilege === 't' || $privilege === '1') throw ApiException::fromCode($roleError, 503);
        }
        if (!$role) throw ApiException::fromCode($roleError, 503);
        $pdo->exec("SET TIME ZONE 'UTC'");
        $pdo->exec("SET DateStyle = 'ISO, YMD'");
        $pdo->exec("SET IntervalStyle = 'postgres'");
        $pdo->exec('SET extra_float_digits = 3');
        $pdo->exec('SET standard_conforming_strings = on');
        $pdo->exec("SET statement_timeout = '5s'");
        $pdo->exec("SET lock_timeout = '5s'");
        $pdo->exec("SET idle_in_transaction_session_timeout = '10s'");
        $pdo->exec('SET default_transaction_read_only = ' . ($readOnly ? 'on' : 'off'));
        // Only the explicit free-SQL session resolves unqualified names in the
        // selected schema. Catalog/row services retain fully qualified names.
        $schema = (string) ($this->config['schema'] ?? 'public');
        if ($schema === '' || str_contains($schema, "\0")) throw ApiException::fromCode('database_not_available', 403);
        $pdo->exec($kind === 'sql'
            ? 'SET search_path = "' . str_replace('"', '""', $schema) . '"'
            : 'SET search_path = pg_catalog');
        return $pdo;
    }

    public function scriptConnection(): PDO { return $this->connect('sql'); }
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
