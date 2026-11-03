<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Shared facade; the selected connection decides the SQL engine. */
final class Database
{
    private DatabaseAdapter $adapter;
    public const SQL_MODE = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE,ONLY_FULL_GROUP_BY';

    public function __construct(private readonly array $config)
    {
        $this->adapter = match ($this->engine()) {
            'mariadb' => new MariaDbAdapter($config),
            'postgres' => new PostgresAdapter($config),
            default => throw ApiException::fromCode('database_not_available', 403),
        };
    }

    /** Existing MariaDB services use this static identifier helper. */
    public static function identifier(string $name): string
    {
        if ($name === '' || str_contains($name, "\0")) throw ApiException::fromCode('identifier_invalid');
        return '`' . str_replace('`', '``', $name) . '`';
    }

    public function quoteIdentifier(string $name): string
    {
        if ($this->engine() !== 'postgres') return self::identifier($name);
        if ($name === '' || str_contains($name, "\0")) throw ApiException::fromCode('identifier_invalid');
        return '"' . str_replace('"', '""', $name) . '"';
    }

    public function engine(): string { return $this->config['engine'] ?? 'mariadb'; }
    public function name(): string { return $this->config['name']; }
    public function schemaName(): string { return $this->engine() === 'postgres' ? ($this->config['schema'] ?? 'public') : $this->name(); }
    public function reader(): PDO { return $this->adapter->reader(); }
    public function writer(): PDO { return $this->adapter->writer(); }
    public function scriptConnection(): PDO { return $this->adapter->scriptConnection(); }
    public function discardReader(): void { $this->adapter->discardReader(); }
    public function databaseNames(): array { return $this->adapter->databaseNames(); }

    public function schemaNames(): array
    {
        return $this->adapter instanceof PostgresAdapter ? $this->adapter->schemaNames() : [$this->name()];
    }
}
