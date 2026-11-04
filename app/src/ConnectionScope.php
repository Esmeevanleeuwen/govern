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
            'engine' => 'mariadb', 'schema' => $item['name'], 'schemas' => [$item['name']],
            'scope_key' => $item['name'], 'label' => $item['name'] . ' · MariaDB'], $this->maria->databases());
        $pg = $this->base['postgres'] ?? null;
        if ($pg !== null) {
            $available = $this->postgresDatabaseNames();
            $names = array_values(array_unique([$pg['name'], ...($pg['databases'] ?? []), ...$available]));
            foreach ($names as $name) {
                $allowed = $this->postgresSchemas($name);
                try { $actual = in_array($name, $available, true) ? (new Database([...$pg, 'name' => $name]))->schemaNames() : []; }
                catch (\PDOException | ApiException) { $actual = []; }
                $visible = array_values(array_intersect($allowed, $actual));
                $schema = in_array('public', $visible, true) ? 'public' : ($visible[0] ?? $allowed[0]);
                // A database has one picker identity; schema is secondary context.
                // Legacy explicit schema workspace keys remain valid below.
                $entries[] = ['name' => $name, 'connection' => 'postgres', 'engine' => 'postgres', 'schema' => $schema,
                    'schemas' => $allowed, 'available_schemas' => $visible,
                    'scope_key' => self::scopeKey('postgres', $name, $schema),
                    'label' => $name . ' · PostgreSQL', 'available' => $visible !== []];
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
        if ($connection !== 'postgres' || $pg === null || (!in_array($name, [$pg['name'], ...($pg['databases'] ?? [])], true)
            && !in_array($name, $this->postgresDatabaseNames(), true))) {
            throw ApiException::fromCode('database_not_available', 403);
        }
        $schema = $schema !== '' ? $schema : ($name === $pg['name'] ? $pg['schema'] : 'public');
        if (!in_array($schema, $this->postgresSchemas($name), true)) throw ApiException::fromCode('database_not_available', 403);
        $root = rtrim((string) $this->base['backup_dir'], DIRECTORY_SEPARATOR);
        return [...$this->base, ...$pg, 'name' => $name, 'connection' => 'postgres', 'schema' => $schema,
            'schemas' => $this->postgresSchemas($name), 'scope_key' => self::scopeKey('postgres', $name, $schema), 'maintenance_dir' => $root,
            'backup_dir' => $root . '/connections/' . hash('sha256', self::scopeKey('postgres', $name, $schema))];
    }

    private ?array $postgresNames = null;

    private function postgresSchemas(string $name): array
    {
        $pg = $this->base['postgres'];
        return $name === $pg['name'] ? $pg['schemas'] : array_values(array_unique(['public', ...$pg['schemas']]));
    }

    /** Require explicit CONNECT grants for both app roles, never PUBLIC visibility. */
    private function postgresDatabaseNames(): array
    {
        if ($this->postgresNames !== null) return $this->postgresNames;
        $pg = $this->base['postgres'] ?? null;
        if ($pg === null) return $this->postgresNames = [];
        foreach (array_values(array_unique([$pg['name'], ...($pg['databases'] ?? []), 'postgres'])) as $catalogDatabase) {
            try {
                $pdo = (new Database([...$pg, 'name' => $catalogDatabase]))->reader();
                $q = $pdo->prepare("SELECT d.datname FROM pg_catalog.pg_database d
                    WHERE d.datallowconn AND NOT d.datistemplate AND d.datname <> 'postgres'
                    AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(d.datacl) a JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname = :reader AND a.privilege_type = 'CONNECT')
                    AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(d.datacl) a JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname = :writer AND a.privilege_type = 'CONNECT') ORDER BY d.datname");
                $q->execute(['reader' => $pg['read_user'], 'writer' => $pg['user']]);
                return $this->postgresNames = $q->fetchAll(\PDO::FETCH_COLUMN);
            } catch (\PDOException | ApiException) { /* Try another fixed discovery database. */ }
        }
        return $this->postgresNames = [];
    }

    public static function capabilities(array $config): array
    {
        $maria = ($config['engine'] ?? 'mariadb') !== 'postgres';
        $rows = $maria || (($config['user'] ?? '') !== '' && ($config['password'] ?? '') !== '');
        $sql = $maria || (($config['sql_user'] ?? '') !== '' && ($config['sql_password'] ?? '') !== '');
        $snapshots = $maria || (($config['tools_socket'] ?? '') !== '');
        return ['browse' => true, 'structure' => true, 'schema' => true, 'explore' => true, 'record_map' => true, 'write' => $rows, 'query' => $sql,
            'query_builder' => $maria, 'saved_queries' => $maria, 'snapshots' => $snapshots, 'phpmyadmin' => $maria, 'import' => $sql,
            'create_database' => $maria || (new DatabaseProvisioner())->isAvailable('postgres'), 'create_table' => $sql, 'ai' => $maria, 'context' => $maria];
    }

    public static function requireAction(array $config, string $action): void
    {
        if (($config['engine'] ?? 'mariadb') === 'postgres'
            && !in_array($action, ['bootstrap', 'schema', 'structure', 'browse', 'explore', 'record-map-records', 'record-map',
                'row-editor', 'insert-row', 'update-row', 'delete-row', 'query', 'import-inspection',
                'native-import-preview', 'native-import-execute', 'dataset-preview', 'dataset-import',
                'snapshots', 'create-snapshot', 'restore-snapshot', 'download-snapshot',
                'table-definition-preview', 'table-definition-create'], true)) {
            throw ApiException::fromCode('postgres_read_only', 403);
        }
    }
}
