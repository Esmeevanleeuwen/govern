<?php
declare(strict_types=1);

// Run only in the private database-manager service, never under a web server.
require_once __DIR__ . '/../../app/src/bootstrap.php';
require_once __DIR__ . '/DatabaseManager.php';
require_once __DIR__ . '/DatabaseCreator.php';

use Govern\ApiException;
use Govern\DatabaseManager;
use Govern\DatabaseCreator;
use Govern\DatabaseProvisioner;

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('display_errors', '0');
ini_set('zend.exception_ignore_args', '1');
$socket = getenv('DB_MANAGER_SOCKET') ?: '/run/govern-databases/provision.sock';
$server = null;
$groupSetting = getenv('DB_MANAGER_GID');
$group = filter_var($groupSetting === false ? '33' : $groupSetting, FILTER_VALIDATE_INT);
try {
    if ($group === false || $group < 0 || $group > 2147483647) throw new RuntimeException('Invalid application group.');
    if (!str_starts_with($socket, '/') || strlen($socket) > 103 || preg_match('/[\x00-\x1f\x7f]/', $socket))
        throw new RuntimeException('Invalid socket configuration.');
    $directory = dirname($socket);
    if (!is_dir($directory) && !@mkdir($directory, 0750, true)) throw new RuntimeException('Socket directory unavailable.');
    if (is_link($directory) || !@chgrp($directory, $group) || !@chmod($directory, 0750))
        throw new RuntimeException('Socket directory permissions unavailable.');
    clearstatcache(true, $socket);
    if (file_exists($socket) || is_link($socket)) {
        if (is_link($socket) || filetype($socket) !== 'socket') throw new RuntimeException('Refusing to replace a non-socket file.');
        $active = @stream_socket_client('unix://' . $socket, $number, $reason, 0.2);
        if ($active !== false) { fclose($active); throw new RuntimeException('A database manager is already running.'); }
        if (!@unlink($socket)) throw new RuntimeException('Stale socket could not be removed.');
    }
    $server = @stream_socket_server('unix://' . $socket, $number, $reason, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN);
    if ($server === false || !@chgrp($socket, $group) || !@chmod($socket, 0660)) throw new RuntimeException('Socket could not be opened.');
    fwrite(STDOUT, "Govern database manager ready.\n");
    while (true) {
        $connection = @stream_socket_accept($server, 5);
        if ($connection === false) continue;
        try {
            $deadline = microtime(true) + 5;
            $line = '';
            while (!str_ends_with($line, "\n")) {
                $remaining = $deadline - microtime(true);
                if ($remaining <= 0) throw ApiException::fromCode('database_create_invalid', 422);
                stream_set_timeout($connection, (int) $remaining, (int) (($remaining - (int) $remaining) * 1000000));
                $part = @fgets($connection, DatabaseProvisioner::MAX_BYTES + 2 - strlen($line));
                if ($part === false) throw ApiException::fromCode('database_create_invalid', 422);
                $line .= $part;
                if (strlen($line) > DatabaseProvisioner::MAX_BYTES) throw ApiException::fromCode('database_create_invalid', 422);
            }
            try { $input = json_decode($line, true, 4, JSON_THROW_ON_ERROR); }
            catch (JsonException) { throw ApiException::fromCode('database_create_invalid', 422); }
            if (!is_array($input)) throw ApiException::fromCode('database_create_invalid', 422);
            $keys = array_keys($input); sort($keys);
            if ($keys === ['action', 'name'] && $input['action'] === 'prepare_database') {
                $name = DatabaseProvisioner::validateName($input['name']);
                $data = DatabaseManager::fromEnvironment()->prepare($name);
            } elseif ($keys === ['action', 'engine', 'name', 'operation_id'] && $input['action'] === 'create_database') {
                unset($input['action']);
                $data = DatabaseCreator::fromEnvironment()->create($input);
            } else throw ApiException::fromCode('database_create_invalid', 422);
            $response = ['ok' => true, 'data' => $data];
        } catch (Throwable $exception) {
            $code = $exception instanceof ApiException && in_array($exception->errorCode,
                ['database_create_invalid', 'database_exists', 'database_creation_uncertain', 'database_manager_unavailable'], true)
                ? $exception->errorCode : 'database_prepare_failed';
            $response = ['ok' => false, 'error_code' => $code];
        }
        stream_set_timeout($connection, 2);
        @fwrite($connection, json_encode($response, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        fclose($connection);
    }
} catch (Throwable) {
    // No exception text, request body or environment is emitted to logs.
    fwrite(STDERR, "Govern database manager could not start. Check its private service configuration.\n");
    exit(1);
} finally {
    if (is_resource($server)) fclose($server);
}
