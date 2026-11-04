<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Fixed new-database operation with a private durable idempotency receipt. */
final class DatabaseCreator
{
    public function __construct(private readonly string $directory, private readonly array $environment) {}

    public static function fromEnvironment(): self
    {
        $keys = ['DB_HOST', 'DB_PORT', 'DB_ROOT_PASSWORD', 'DB_USER', 'DB_READ_USER',
            'PG_ENABLED', 'PG_HOST', 'PG_PORT', 'PG_ADMIN_PASSWORD', 'PG_READ_USER', 'PG_USER', 'PG_SQL_USER', 'PG_RESTORE_USER'];
        $values = [];
        foreach ($keys as $key) $values[$key] = getenv($key) === false ? '' : (string) getenv($key);
        return new self(getenv('DB_PROVISION_DIR') ?: '/var/lib/govern/provisioning', $values);
    }

    public function create(array $input): array
    {
        $keys = array_keys($input); sort($keys);
        if ($keys !== ['engine', 'name', 'operation_id'] || !is_string($input['engine'] ?? null))
            throw ApiException::fromCode('database_create_invalid', 422);
        $engine = $input['engine'];
        $name = DatabaseProvisioner::validateCreateName($input['name'], $engine);
        $id = $input['operation_id'];
        if (!is_string($id) || !preg_match('/\A[A-Za-z0-9_-]{16,96}\z/D', $id))
            throw ApiException::fromCode('database_create_invalid', 422);
        if ($engine === 'postgres' && ($this->environment['PG_ENABLED'] ?? '') !== '1')
            throw ApiException::fromCode('database_manager_unavailable', 503);
        $receipts = $this->receipts();
        // All helper processes use the same lock, including tests and restarts.
        $lock = fopen($this->directory . '/create.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_EX)) throw ApiException::fromCode('database_prepare_failed', 503);
        try {
            $query = $receipts->prepare('SELECT * FROM receipts WHERE operation_id = ?');
            $query->execute([$id]);
            $prior = $query->fetch(PDO::FETCH_ASSOC);
            if ($prior !== false) {
                if ($prior['engine'] !== $engine || $prior['database_name'] !== $name)
                    throw ApiException::fromCode('database_create_invalid', 422);
                if ($prior['state'] === 'complete') return json_decode($prior['result'], true, 8, JSON_THROW_ON_ERROR);
                if ($prior['state'] === 'collision') throw ApiException::fromCode('database_exists', 409);
                // A lost response is not permission to adopt somebody else's database.
                throw ApiException::fromCode('database_creation_uncertain', 409);
            }
            $user = 'govern_import_' . substr(hash('sha256', $engine . ':' . $name . ':' . $id), 0, 16);
            $password = bin2hex(random_bytes(32));
            $insert = $receipts->prepare('INSERT INTO receipts(operation_id, engine, database_name, state, result) VALUES(?,?,?,?,?)');
            $insert->execute([$id, $engine, $name, 'pending', null]);
            try {
                if ($engine === 'postgres') $this->postgres($name, $user, $password);
                else $this->maria($name, $user, $password);
                $result = ['database' => $name, 'engine' => $engine, 'created' => true,
                    'scope_key' => ConnectionScope::scopeKey($engine, $name, $engine === 'postgres' ? 'public' : ''),
                    'import_user' => $user, 'import_password' => $password];
                $save = $receipts->prepare('UPDATE receipts SET state = ?, result = ? WHERE operation_id = ?');
                $save->execute(['complete', json_encode($result, JSON_THROW_ON_ERROR), $id]);
                return $result;
            } catch (ApiException $exception) {
                if ($exception->errorCode === 'database_exists') {
                    $receipts->prepare('UPDATE receipts SET state = ? WHERE operation_id = ?')->execute(['collision', $id]);
                    throw $exception;
                }
                throw ApiException::fromCode('database_creation_uncertain', 409);
            } catch (\Throwable) {
                // CREATE DATABASE and grants are separate effects on both engines.
                throw ApiException::fromCode('database_creation_uncertain', 409);
            }
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    private function receipts(): PDO
    {
        if (!str_starts_with($this->directory, '/') || preg_match('/[\x00-\x1f\x7f]/', $this->directory)
            || is_link($this->directory) || (!is_dir($this->directory) && !mkdir($this->directory, 0700, true)))
            throw ApiException::fromCode('database_prepare_failed', 503);
        if (!chmod($this->directory, 0700)) throw ApiException::fromCode('database_prepare_failed', 503);
        $path = $this->directory . '/receipts.sqlite';
        if (is_link($path)) throw ApiException::fromCode('database_prepare_failed', 503);
        $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        chmod($path, 0600);
        $pdo->exec('PRAGMA busy_timeout=10000');
        $pdo->exec('PRAGMA synchronous=FULL');
        $pdo->exec('CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY, engine TEXT NOT NULL,
            database_name TEXT NOT NULL, state TEXT NOT NULL, result TEXT)');
        return $pdo;
    }

    private function role(string $key, string $fallback): string
    {
        $role = ($this->environment[$key] ?? '') ?: $fallback;
        $limit = str_starts_with($key, 'PG_') ? 63 : 64;
        if (!preg_match('/\A[A-Za-z0-9_]{1,' . $limit . '}\z/D', $role)
            || in_array(strtolower($role), ['root', 'postgres'], true) || str_starts_with($role, 'pg_'))
            throw ApiException::fromCode('database_prepare_failed', 503);
        return $role;
    }

    private function maria(string $name, string $user, string $password): void
    {
        $host = ($this->environment['DB_HOST'] ?? '') ?: 'database';
        $port = (int) (($this->environment['DB_PORT'] ?? '') ?: 3306);
        $adminPassword = $this->environment['DB_ROOT_PASSWORD'] ?? '';
        if (!preg_match('/\A[A-Za-z0-9.:-]+\z/D', $host) || $port < 1 || $port > 65535 || !$adminPassword)
            throw ApiException::fromCode('database_prepare_failed', 503);
        $pdo = new PDO('mysql:host=' . $host . ';port=' . $port . ';charset=utf8mb4', 'root', $adminPassword,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 5, PDO::MYSQL_ATTR_MULTI_STATEMENTS => false]);
        $pdo->exec("SET SESSION sql_mode='NO_BACKSLASH_ESCAPES', max_statement_time=5, lock_wait_timeout=3, innodb_lock_wait_timeout=3");
        try { $pdo->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); }
        catch (\PDOException $exception) {
            if ((int) ($exception->errorInfo[1] ?? 0) === 1007) throw ApiException::fromCode('database_exists', 409);
            throw $exception;
        }
        $writer = $this->role('DB_USER', 'govern');
        $reader = $this->role('DB_READ_USER', 'govern_reader');
        if ($writer === $reader) throw ApiException::fromCode('database_prepare_failed', 503);
        $pattern = str_replace('_', '\\_', $name);
        $pdo->exec("CREATE USER '" . $user . "'@'%' IDENTIFIED BY " . $pdo->quote($password));
        foreach ([$writer, $user] as $role) $pdo->exec("GRANT ALL PRIVILEGES ON `" . $pattern . "`.* TO '" . $role . "'@'%'");
        $pdo->exec("GRANT SELECT, SHOW VIEW ON `" . $pattern . "`.* TO '" . $reader . "'@'%'");
    }

    private function postgres(string $name, string $user, string $password): void
    {
        $host = ($this->environment['PG_HOST'] ?? '') ?: 'postgres';
        $port = (int) (($this->environment['PG_PORT'] ?? '') ?: 5432);
        $adminPassword = $this->environment['PG_ADMIN_PASSWORD'] ?? '';
        if (!preg_match('/\A[A-Za-z0-9.:-]+\z/D', $host) || $port < 1 || $port > 65535 || !$adminPassword)
            throw ApiException::fromCode('database_prepare_failed', 503);
        $reader = $this->role('PG_READ_USER', 'govern_pg_reader');
        $writer = $this->role('PG_USER', 'govern_pg_writer');
        $sql = $this->role('PG_SQL_USER', 'govern_pg_sql');
        $restore = $this->role('PG_RESTORE_USER', 'govern_pg_restore');
        if (count(array_unique([$reader, $writer, $sql, $restore])) !== 4) throw ApiException::fromCode('database_prepare_failed', 503);
        $connect = static fn (string $database): PDO => new PDO('pgsql:host=' . $host . ';port=' . $port . ';dbname=' . $database . ';connect_timeout=5',
            'postgres', $adminPassword, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
        $pdo = $connect('postgres');
        $pdo->exec("SET statement_timeout='8s'");
        $pdo->exec("SET lock_timeout='3s'");
        $q = static fn (string $value): string => '"' . str_replace('"', '""', $value) . '"';
        try { $pdo->exec('CREATE DATABASE ' . $q($name) . " TEMPLATE template0 ENCODING 'UTF8'"); }
        catch (\PDOException $exception) {
            if ($exception->getCode() === '42P04') throw ApiException::fromCode('database_exists', 409);
            throw $exception;
        }
        $pdo->exec('REVOKE ALL ON DATABASE ' . $q($name) . ' FROM PUBLIC');
        $pdo->exec('CREATE ROLE ' . $q($user) . ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ' . $pdo->quote($password));
        foreach ([$reader, $writer, $sql, $restore, $user] as $role) $pdo->exec('GRANT CONNECT ON DATABASE ' . $q($name) . ' TO ' . $q($role));
        $pdo->exec('ALTER ROLE ' . $q($reader) . ' IN DATABASE ' . $q($name) . ' SET default_transaction_read_only = on');
        $pdo = $connect($name);
        $pdo->exec("SET statement_timeout='8s'");
        $pdo->exec('REVOKE ALL ON SCHEMA public FROM PUBLIC');
        foreach ([$reader, $writer] as $role) $pdo->exec('GRANT USAGE ON SCHEMA public TO ' . $q($role));
        foreach ([$sql, $restore, $user] as $role) $pdo->exec('GRANT USAGE,CREATE ON SCHEMA public TO ' . $q($role));
        // The importer cannot become any application role. SQL may maintain
        // importer-owned objects, without ADMIN OPTION or elevated flags.
        $pdo->exec('COMMENT ON ROLE ' . $q($user) . ' IS ' . $pdo->quote('govern-import-target:' . $name));
        $pdo->exec('GRANT ' . $q($user) . ' TO ' . $q($sql) . ' WITH ADMIN FALSE, INHERIT TRUE, SET TRUE');
        foreach ([$sql, $restore, $user] as $creator) {
            $prefix = 'ALTER DEFAULT PRIVILEGES FOR ROLE ' . $q($creator) . ' IN SCHEMA public ';
            $pdo->exec($prefix . 'GRANT SELECT ON TABLES TO ' . $q($reader));
            $pdo->exec($prefix . 'GRANT SELECT ON SEQUENCES TO ' . $q($reader));
            foreach ([$writer, $sql, $restore] as $recipient) {
                $pdo->exec($prefix . 'GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ' . $q($recipient));
                $pdo->exec($prefix . 'GRANT USAGE,SELECT ON SEQUENCES TO ' . $q($recipient));
            }
        }
    }
}
