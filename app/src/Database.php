<?php
declare(strict_types=1);

namespace Govern;

use PDO;

final class Database
{
    private ?PDO $read = null;
    private ?PDO $write = null;
    private const SQL_MODE = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE,ONLY_FULL_GROUP_BY';

    public function __construct(private readonly array $config) {}

    /** Only names obtained from the live catalog may be used for user-selected objects. */
    public static function identifier(string $name): string
    {
        if ($name === '' || str_contains($name, "\0")) {
            throw new ApiException('Ongeldige naam voor een databaseobject.');
        }
        return '`' . str_replace('`', '``', $name) . '`';
    }

    public function name(): string
    {
        return $this->config['name'];
    }

    public function reader(): PDO
    {
        if ($this->read === null) {
            if ($this->config['read_user'] === $this->config['user'] || strtolower($this->config['read_user']) === 'root') {
                throw new ApiException('Stel voor onderzoeken een afzonderlijke databasegebruiker met alleen leesrechten in.', 503);
            }
            $connection = $this->connect($this->config['read_user'], $this->config['read_password']);
            // SELECT on a DEFINER view can invoke a writing stored function.
            // Read-only transactions stop those side effects, even with elevated
            // privileges inside the stored object. Grants remain the other layer.
            $connection->exec('SET SESSION TRANSACTION READ ONLY');
            $this->read = $connection;
        }
        return $this->read;
    }

    public function writer(): PDO
    {
        return $this->write ??= $this->connect($this->config['user'], $this->config['password']);
    }

    public function discardReader(): void
    {
        // An investigation may change session settings. Never reuse that session.
        $this->read = null;
    }

    private function connect(string $user, #[\SensitiveParameter] string $password): PDO
    {
        if ($user === '' || $password === '') {
            throw new ApiException('De databasegegevens zijn nog niet ingesteld. Start Govern met het meegeleverde startscript.', 503);
        }
        $socket = $this->config['socket'];
        $address = $socket !== ''
            ? 'unix_socket=' . $socket
            : 'host=' . $this->config['host'] . ';port=' . $this->config['port'];
        $pdo = new PDO('mysql:' . $address . ';charset=utf8mb4', $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => true,
            PDO::ATTR_PERSISTENT => false,
            PDO::ATTR_TIMEOUT => 5,
            PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
            PDO::MYSQL_ATTR_LOCAL_INFILE => false,
        ]);
        $pdo->exec('USE ' . self::identifier($this->name()));
        $pdo->exec("SET time_zone = '+00:00'");
        $pdo->exec("SET SESSION sql_mode = '" . self::SQL_MODE . "'");
        $pdo->exec('SET SESSION lock_wait_timeout = 5');
        $pdo->exec('SET SESSION innodb_lock_wait_timeout = 5');
        $version = (string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
        $pdo->exec(stripos($version, 'MariaDB') !== false
            ? 'SET SESSION max_statement_time = 5'
            : 'SET SESSION max_execution_time = 5000');
        return $pdo;
    }
}
