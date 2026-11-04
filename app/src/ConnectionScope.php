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

    /** Older cached API modules send the workspace key as the database alone. */
    public function selectRequest(string $name, ?string $connection = null, ?string $schema = null): array
    {
        if (str_starts_with($name, 'postgres:')) {
            $parts = explode(':', $name);
            if ($connection !== null || $schema !== null || count($parts) !== 3
                || preg_match('/%(?![0-9a-f]{2})/i', $name)) {
                throw ApiException::fromCode('database_not_available', 403);
            }
            $name = rawurldecode($parts[1]);
            $schema = rawurldecode($parts[2]);
            if ($name === '' || $schema === '' || preg_match('/[\x00-\x1f\x7f]/', $name . $schema)) {
                throw ApiException::fromCode('database_not_available', 403);
            }
            $connection = 'postgres';
        }
        $connection = $connection ?: 'mariadb';
        $name = $name !== '' ? $name : ($connection === 'postgres'
            ? ($this->base['postgres']['name'] ?? '') : $this->base['name']);
        return $this->select($name, $connection, $schema ?? '');
    }

    public function databases(): array
    {
        if ($this->known !== null) return $this->known;
        $entries = array_map(static fn (array $item): array => [...$item, 'connection' => 'mariadb',
            'engine' => 'mariadb', 'schema' => $item['name'], 'scope_key' => $item['name'], 'label' => $item['name']], $this->maria->databases());
        $pg = $this->base['postgres'] ?? null;
        if ($pg !== null) {
            $names = array_values(array_unique([$pg['name'], ...$this->managedPostgresNames()], SORT_STRING));
            foreach ($names as $name) {
                $configured = $this->postgresConfig($name);
                try { $schemas = (new Database($configured))->schemaNames(); }
                catch (\PDOException | ApiException) { $schemas = []; }
                foreach ($configured['schemas'] as $schema) {
                    $entries[] = ['name' => $name, 'connection' => 'postgres', 'engine' => 'postgres', 'schema' => $schema,
                        'scope_key' => self::scopeKey('postgres', $name, $schema),
                        'label' => $name . ' · ' . $schema . ' · PostgreSQL', 'available' => in_array($schema, $schemas, true)];
                }
            }
        }
        return $this->known = $entries;
    }

    /** Global configured tools, independent of the workspace currently selected. */
    public function engines(bool $canCreateMariaDb): array
    {
        $postgres = $this->base['postgres'] ?? null;
        $postgresCapabilities = $postgres === null ? null : self::capabilities($postgres);
        return [
            ['id' => 'mariadb', 'label' => 'MariaDB', 'configured' => true,
                'capabilities' => ['create_database' => $canCreateMariaDb, 'import' => true,
                    'query' => true, 'phpmyadmin' => true]],
            ['id' => 'postgres', 'label' => 'PostgreSQL', 'configured' => $postgres !== null,
                'capabilities' => ['create_database' => $postgresCapabilities['create_database'] ?? false, 'import' => $postgresCapabilities['import'] ?? false,
                    'query' => $postgresCapabilities['query'] ?? false, 'phpmyadmin' => false]],
        ];
    }

    public function select(string $name, string $connection = 'mariadb', string $schema = ''): array
    {
        if ($connection === 'mariadb') {
            if ($schema !== '' && $schema !== $name) throw ApiException::fromCode('database_not_available', 403);
            return [...$this->maria->select($name), 'engine' => 'mariadb', 'connection' => 'mariadb', 'scope_key' => $name];
        }
        $pg = $this->base['postgres'] ?? null;
        if ($connection !== 'postgres' || $pg === null
            || ($name !== $pg['name'] && !in_array($name, $this->managedPostgresNames(), true))) {
            throw ApiException::fromCode('database_not_available', 403);
        }
        $pg = $this->postgresConfig($name);
        $schema = $schema !== '' ? $schema : $pg['schema'];
        if (!in_array($schema, $pg['schemas'], true)) throw ApiException::fromCode('database_not_available', 403);
        $root = rtrim((string) $this->base['backup_dir'], DIRECTORY_SEPARATOR);
        return [...$this->base, ...$pg, 'connection' => 'postgres', 'schema' => $schema,
            'scope_key' => self::scopeKey('postgres', $name, $schema), 'maintenance_dir' => $root,
            'backup_dir' => $root . '/connections/' . hash('sha256', self::scopeKey('postgres', $name, $schema))];
    }

    private function managedPostgresNames(): array
    {
        return (new PostgresDatabaseRegistry($this->base['postgres']['registry_file'] ?? null))->names() ?? [];
    }

    private function postgresConfig(string $name): array
    {
        $pg = $this->base['postgres'];
        return $name === $pg['name'] ? $pg : [...$pg, 'name' => $name, 'schema' => 'public', 'schemas' => ['public']];
    }

    public static function capabilities(array $config): array
    {
        $maria = ($config['engine'] ?? 'mariadb') !== 'postgres';
        $rows = $maria || (($config['user'] ?? '') !== '' && ($config['password'] ?? '') !== '');
        $sql = $maria || (($config['sql_user'] ?? '') !== '' && ($config['sql_password'] ?? '') !== '');
        $snapshots = $maria || (($config['tools_socket'] ?? '') !== '');
        return ['browse' => true, 'structure' => true, 'schema' => true, 'explore' => true, 'record_map' => true, 'write' => $rows, 'query' => $sql,
            'query_builder' => $maria, 'saved_queries' => $maria, 'snapshots' => $snapshots, 'phpmyadmin' => $maria, 'import' => $sql,
            'create_database' => $maria || (new PostgresDatabaseProvisioner($config))->isAvailable(), 'ai' => $maria, 'context' => $maria];
    }

    public static function requireAction(array $config, string $action): void
    {
        if (($config['engine'] ?? 'mariadb') === 'postgres'
            && !in_array($action, ['bootstrap', 'schema', 'structure', 'browse', 'explore', 'record-map-records', 'record-map',
                'row-editor', 'insert-row', 'update-row', 'delete-row', 'query', 'import-inspection',
                'native-import-preview', 'native-import-execute', 'dataset-preview', 'dataset-import',
                'snapshots', 'create-snapshot', 'restore-snapshot', 'download-snapshot', 'prepare-database'], true)) {
            throw ApiException::fromCode('postgres_read_only', 403);
        }
    }
}
