<?php
declare(strict_types=1);

namespace Govern;

final class Config
{
    public static function fromEnvironment(): array
    {
        $env = static function (string $key, string $default = ''): string {
            $value = getenv($key);
            return $value === false ? $default : $value;
        };
        $port = filter_var($env('DB_PORT', '3306'), FILTER_VALIDATE_INT);
        if ($port === false || $port < 1 || $port > 65535) {
            throw ApiException::fromCode('port_invalid', 503);
        }
        $name = $env('DB_NAME', 'bestuursatlas');
        if ($name === '' || strlen($name) > 192 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            throw ApiException::fromCode('database_name_invalid', 503);
        }
        $databaseNames = array_values(array_unique([$name, ...array_filter(array_map('trim', explode(',', $env('DB_DATABASES'))))]));
        foreach ($databaseNames as $databaseName) {
            if (strlen($databaseName) > 192 || preg_match('//u', $databaseName) !== 1
                || preg_match('/[\x00-\x1f\x7f]/', $databaseName)) {
                throw ApiException::fromCode('database_name_invalid', 503);
            }
        }
        $schema = $env('WORKBENCH_SCHEMA_FILE');
        if ($schema === '') {
            $local = dirname(__DIR__, 2) . '/docker/database/20-govern.sql';
            $schema = is_file($local) ? $local : '/var/www/workbench.sql';
        }
        $postgres = null;
        if ($env('PG_ENABLED', '0') === '1') {
            $pgPort = filter_var($env('PG_PORT', '5432'), FILTER_VALIDATE_INT);
            $pgName = $env('PG_DATABASE', 'govern_pg');
            $pgHost = $env('PG_HOST', 'postgres');
            $pgReadUser = $env('PG_READ_USER', 'govern_pg_reader');
            $pgUser = $env('PG_USER', 'govern_pg_writer');
            $pgSchemas = array_values(array_unique(array_filter(array_map('trim', explode(',', $env('PG_SCHEMAS', 'public'))), static fn (string $value): bool => $value !== '')));
            if ($pgPort === false || $pgPort < 1 || $pgPort > 65535 || !preg_match('/^[A-Za-z0-9_]{1,63}$/D', $pgName)
                || $pgHost === '' || preg_match('/[;\x00-\x20\x7f]/', $pgHost)
                || !preg_match('/^[A-Za-z0-9_]{1,63}$/D', $pgReadUser)
                || !preg_match('/^[A-Za-z0-9_]{1,63}$/D', $pgUser) || $pgSchemas === []
                || $pgReadUser === $pgUser || $pgReadUser === 'postgres' || $pgUser === 'postgres'
                || str_starts_with($pgReadUser, 'pg_') || str_starts_with($pgUser, 'pg_')) {
                throw ApiException::fromCode('postgres_config_invalid', 503);
            }
            foreach ($pgSchemas as $pgSchema) {
                if (strlen($pgSchema) > 63 || preg_match('//u', $pgSchema) !== 1
                    || preg_match('/[\x00-\x1f\x7f]/', $pgSchema) || str_starts_with($pgSchema, 'pg_') || $pgSchema === 'information_schema') {
                    throw ApiException::fromCode('postgres_config_invalid', 503);
                }
            }
            $postgres = ['engine' => 'postgres', 'host' => $pgHost, 'port' => $pgPort, 'name' => $pgName,
                'schema' => $pgSchemas[0], 'schemas' => $pgSchemas, 'read_user' => $pgReadUser,
                'read_password' => $env('PG_READ_PASSWORD'), 'user' => $pgUser,
                'password' => $env('PG_PASSWORD'), 'socket' => ''];
        }
        return [
            'engine' => 'mariadb',
            'postgres' => $postgres,
            'host' => $env('DB_HOST', 'database'),
            'port' => $port,
            'name' => $name,
            'databases' => $databaseNames,
            'user' => $env('DB_USER', 'govern'),
            'password' => $env('DB_PASSWORD'),
            'read_user' => $env('DB_READ_USER', 'govern_reader'),
            'read_password' => $env('DB_READ_PASSWORD'),
            'socket' => $env('DB_SOCKET'),
            'backup_dir' => $env('BACKUP_DIR', '/var/lib/govern/backups'),
            'dump_bin' => $env('DB_DUMP_BIN', 'mariadb-dump'),
            'client_bin' => $env('DB_CLIENT_BIN', 'mariadb'),
            'schema_file' => $schema,
            'allowed_hosts' => array_values(array_filter(array_map('trim', explode(',', $env('APP_ALLOWED_HOSTS', 'localhost,127.0.0.1,::1'))))),
        ];
    }
}
