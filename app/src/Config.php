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
        $schema = $env('WORKBENCH_SCHEMA_FILE');
        if ($schema === '') {
            $local = dirname(__DIR__, 2) . '/docker/database/20-govern.sql';
            $schema = is_file($local) ? $local : '/var/www/workbench.sql';
        }
        return [
            'host' => $env('DB_HOST', 'database'),
            'port' => $port,
            'name' => $name,
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
