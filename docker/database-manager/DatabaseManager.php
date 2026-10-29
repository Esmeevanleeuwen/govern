<?php
declare(strict_types=1);

namespace Govern;

/** Private broker operation. No generic SQL, destructive operation or credential mutation exists. */
final class DatabaseManager
{
    public function __construct(private readonly \PDO $admin, private readonly string $writer = 'govern',
        private readonly string $reader = 'govern_reader')
    {
        foreach ([$writer, $reader] as $role) {
            if (preg_match('/\A[A-Za-z0-9_]{1,64}\z/D', $role) !== 1 || strtolower($role) === 'root')
                throw ApiException::fromCode('database_prepare_failed', 503);
        }
        if ($writer === $reader) throw ApiException::fromCode('database_prepare_failed', 503);
    }

    public static function fromEnvironment(): self
    {
        $host = getenv('DB_HOST') ?: 'database';
        $port = filter_var(getenv('DB_PORT') ?: '3306', FILTER_VALIDATE_INT);
        $password = getenv('DB_ROOT_PASSWORD');
        if ($password === false || $password === '' || strlen($host) > 255
            || preg_match('/\A[A-Za-z0-9.:-]+\z/D', $host) !== 1 || $port === false || $port < 1 || $port > 65535)
            throw ApiException::fromCode('database_prepare_failed', 503);
        try {
            $admin = new \PDO('mysql:host=' . $host . ';port=' . $port . ';charset=utf8mb4', 'root', $password,
                [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_EMULATE_PREPARES => false,
                    \PDO::ATTR_TIMEOUT => 5, \PDO::MYSQL_ATTR_MULTI_STATEMENTS => false]);
            return new self($admin, getenv('DB_USER') ?: 'govern', getenv('DB_READ_USER') ?: 'govern_reader');
        } catch (\Throwable) { throw ApiException::fromCode('database_prepare_failed', 503); }
    }

    public function prepare(string $name): array
    {
        $name = DatabaseProvisioner::validateName($name);
        $pattern = str_replace('_', '\\_', $name);
        try {
            $this->admin->exec("SET SESSION sql_mode='NO_BACKSLASH_ESCAPES', max_statement_time=5, lock_wait_timeout=3, innodb_lock_wait_timeout=3");
            $existing = $this->admin->prepare('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ?');
            $existing->execute([$name]);
            $created = $existing->fetchColumn() === false;
            $existing->closeCursor();
            $this->admin->exec('CREATE DATABASE IF NOT EXISTS `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            $this->admin->exec("GRANT ALL PRIVILEGES ON `" . $pattern . "`.* TO '" . $this->writer . "'@'%'");
            $this->admin->exec("GRANT SELECT, SHOW VIEW ON `" . $pattern . "`.* TO '" . $this->reader . "'@'%'");
            return ['database' => $name, 'created' => $created];
        } catch (\Throwable) {
            // DDL is not atomic. Retrying repeats only creation-if-missing and scoped grants;
            // it never drops a partially prepared database or replaces existing contents.
            throw ApiException::fromCode('database_prepare_failed', 503);
        }
    }
}
