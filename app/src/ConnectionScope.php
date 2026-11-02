<?php
declare(strict_types=1);

namespace Govern;

/** Server-configured connections; selection never accepts a hostname or credentials. */
final class ConnectionScope
{
    private ?array $known = null;
    private readonly DatabaseScope $maria;

    public function __construct(private readonly array $base)
    {
        $this->maria = new DatabaseScope($base);
    }

    public static function scopeKey(string $connection, string $name, string $schema = ''): string
    {
        return $connection === 'mariadb' ? $name : 'postgres:' . rawurlencode($name) . ':' . rawurlencode($schema);
    }

    public function databases(): array
    {
        if ($this->known !== null) return $this->known;
        $entries = array_map(static fn (array $item): array => [...$item, 'connection' => 'mariadb',
            'engine' => 'mariadb', 'schema' => $item['name'], 'scope_key' => $item['name'], 'label' => $item['name']], $this->maria->databases());
        $pg = $this->base['postgres'] ?? null;
        if ($pg !== null) {
            try { $schemas = (new Database($pg))->schemaNames(); }
            catch (\PDOException | ApiException) { $schemas = []; }
            foreach ($pg['schemas'] as $schema) {
                $entries[] = ['name' => $pg['name'], 'connection' => 'postgres', 'engine' => 'postgres', 'schema' => $schema,
                    'scope_key' => self::scopeKey('postgres', $pg['name'], $schema),
                    'label' => $pg['name'] . ' · ' . $schema . ' · PostgreSQL', 'available' => in_array($schema, $schemas, true)];
            }
        }
        return $this->known = $entries;
    }

    public function select(string $name, string $connection = 'mariadb', string $schema = ''): array
    {
        if ($connection === 'mariadb') {
            if ($schema !== '' && $schema !== $name) throw ApiException::fromCode('database_not_available', 403);
            return [...$this->maria->select($name), 'engine' => 'mariadb', 'connection' => 'mariadb', 'scope_key' => $name];
        }
        $pg = $this->base['postgres'] ?? null;
        if ($connection !== 'postgres' || $pg === null || $name !== $pg['name']) {
            throw ApiException::fromCode('database_not_available', 403);
        }
        $schema = $schema !== '' ? $schema : $pg['schema'];
        if (!in_array($schema, $pg['schemas'], true)) throw ApiException::fromCode('database_not_available', 403);
        $root = rtrim((string) $this->base['backup_dir'], DIRECTORY_SEPARATOR);
        return [...$this->base, ...$pg, 'connection' => 'postgres', 'schema' => $schema,
            'scope_key' => self::scopeKey('postgres', $name, $schema), 'maintenance_dir' => $root,
            'backup_dir' => $root . '/connections/' . hash('sha256', self::scopeKey('postgres', $name, $schema))];
    }

    public static function capabilities(array $config): array
    {
        $write = ($config['engine'] ?? 'mariadb') !== 'postgres';
        return ['browse' => true, 'structure' => true, 'schema' => true, 'record_map' => true, 'write' => $write, 'query' => $write,
            'saved_queries' => $write, 'snapshots' => $write, 'phpmyadmin' => $write, 'import' => $write,
            'create_database' => $write, 'ai' => $write, 'context' => $write];
    }

    public static function requireAction(array $config, string $action): void
    {
        if (($config['engine'] ?? 'mariadb') === 'postgres'
            && !in_array($action, ['bootstrap', 'schema', 'structure', 'browse', 'record-map-records', 'record-map'], true)) {
            throw ApiException::fromCode('postgres_read_only', 403);
        }
    }
}
