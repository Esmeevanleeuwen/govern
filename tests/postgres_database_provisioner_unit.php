<?php
declare(strict_types=1);

/** Run as root in the disposable app container to exercise trusted registry permissions. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\ConnectionScope;
use Govern\PostgresDatabaseProvisioner;
use Govern\PostgresDatabaseRegistry;

$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === $status, 'Stable rejection: ' . $code);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
foreach (['new_db', 'Exact_Case9', '123', str_repeat('a', 63), str_repeat('_', 63)] as $name)
    $assert(PostgresDatabaseProvisioner::validateName($name) === $name, 'Accept supported exact PostgreSQL name.');
foreach (['', ' new', 'new ', 'a-b', 'a.b', 'a/b', "a\0b", "bad\nname", 'één', str_repeat('a', 64),
    'postgres', 'POSTGRES', 'template0', 'Template1', 'pg_private', 'PG_catalog', null, [], 12] as $name)
    $reject(static fn () => PostgresDatabaseProvisioner::validateName($name), 'database_create_invalid', 422);

$config = ['engine' => 'postgres', 'name' => 'configured_db', 'schema' => 'archive', 'schemas' => ['archive', 'public'],
    'host' => 'never-connect.invalid', 'port' => 5432, 'read_user' => 'fixture_reader', 'read_password' => 'fixture',
    'user' => 'fixture_writer', 'password' => 'fixture', 'sql_user' => 'fixture_sql', 'sql_password' => 'fixture'];
$requests = [];
$response = ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true]];
$client = new PostgresDatabaseProvisioner($config, static function (array $request) use (&$requests, &$response): mixed {
    $requests[] = $request;
    return $response;
});
$assert($client->isAvailable(), 'Injected fixed-operation transport is available.');
$assert($client->prepare(['name' => 'new_db']) === ['database' => 'new_db', 'created' => true], 'Return exact actual database name.');
$assert($requests === [['action' => 'prepare_database', 'name' => 'new_db']], 'Only the creation operation and exact name cross the socket.');
$response['data']['created'] = false;
$assert(!$client->prepare(['name' => 'new_db'])['created'], 'Repeated creation preserves existing managed database.');
$before = count($requests);
foreach ([[], ['name' => 'new_db', 'sql' => 'SELECT 1'], ['name' => 'new_db', 'schema' => 'other'],
    ['name' => 'new_db', 'host' => 'other'], ['name' => []], ['name' => 'postgres']] as $input)
    $reject(static fn () => $client->prepare($input), 'database_create_invalid', 422);
$assert(count($requests) === $before, 'Unsupported browser fields never reach the worker.');
foreach ([null, [], ['ok' => 1], ['ok' => true], ['ok' => true, 'data' => ['database' => 'other', 'created' => true]],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => 'yes']],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true, 'password' => 'private']],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true], 'extra' => 1],
    ['ok' => false], ['ok' => false, 'error_code' => []], ['ok' => false, 'error_code' => 'unknown'],
    ['ok' => false, 'error_code' => 'database_prepare_failed', 'detail' => 'private'],
] as $response) $reject(static fn () => $client->prepare(['name' => 'new_db']), 'database_manager_invalid', 502);
foreach (['database_create_invalid' => 422, 'database_prepare_failed' => 503] as $code => $status) {
    $response = ['ok' => false, 'error_code' => $code];
    $reject(static fn () => $client->prepare(['name' => 'new_db']), $code, $status);
}
$reject(static fn () => (new PostgresDatabaseProvisioner($config, static fn () => throw new RuntimeException('private')))
    ->prepare(['name' => 'new_db']), 'database_manager_unavailable', 503);
$assert(!(new PostgresDatabaseProvisioner([...$config, 'sql_password' => ''], static fn () => []))->isAvailable(),
    'A creation broker does not enable an unusable SQL workspace.');

$directory = sys_get_temp_dir() . '/govern-pg-provision-' . bin2hex(random_bytes(6));
mkdir($directory, 0750);
$path = $directory . '/databases.json';
$registry = new PostgresDatabaseRegistry($path);
$write = static function (mixed $value) use ($path): void {
    file_put_contents($path, is_string($value) ? $value : json_encode($value, JSON_THROW_ON_ERROR));
    chmod($path, 0640);
    clearstatcache();
};
$server = null;
$socket = $directory . '/tools.sock';
$children = [];
try {
    $assert(fileowner($directory) === 0, 'Registry permission checks require root in the disposable app container.');
    $assert($registry->names() === null, 'A missing registry grants no database access.');
    $write(['version' => 1, 'databases' => []]);
    $assert($registry->names() === [], 'An initialized empty registry is trusted.');
    foreach (['{bad}', ['version' => 2, 'databases' => []], ['version' => 1, 'databases' => [] , 'extra' => 1],
        ['version' => 1, 'databases' => ['postgres']], ['version' => 1, 'databases' => ['ok', 'ok']],
        ['version' => 1, 'databases' => ['host;dbname=other']], ['version' => 1, 'databases' => (object) ['x' => 'new_db']],
        ['version' => 1, 'databases' => (object) []], ['version' => 1, 'databases' => (object) ['new_db']],
        ['version' => 1, 'databases' => [false]], str_repeat('x', PostgresDatabaseRegistry::MAX_BYTES + 1),
    ] as $invalid) {
        $write($invalid);
        $assert($registry->names() === null, 'Invalid registry contents fail closed.');
    }
    $write(['version' => 1, 'databases' => ['managed_a', 'managed_b']]);
    $assert($registry->names() === ['managed_a', 'managed_b'], 'Trusted names persist in the worker-owned file.');
    chmod($path, 0660);
    $assert($registry->names() === null, 'An app-writable registry grants no access.');
    chmod($path, 0640);
    chmod($directory, 0770);
    $assert($registry->names() === null, 'An app-writable directory cannot supply a trusted registry.');
    chmod($directory, 0750);
    chown($path, 33);
    $assert($registry->names() === null, 'A web-owned registry grants no access.');
    chown($path, 0);
    rename($path, $path . '.actual');
    symlink($path . '.actual', $path);
    $assert($registry->names() === null, 'Registry symlinks are rejected.');
    unlink($path);
    rename($path . '.actual', $path);

    $base = ['name' => 'maria_fixture', 'backup_dir' => $directory . '/backups', 'postgres' => [...$config, 'registry_file' => $path]];
    $scope = new ConnectionScope($base);
    $a = $scope->selectRequest('postgres:managed_a:public');
    $b = $scope->selectRequest('managed_b', 'postgres');
    $assert($a['name'] === 'managed_a' && $b['name'] === 'managed_b' && $a['schema'] === $b['schema'], 'Database identity stays separate from schema.');
    $assert($a['schemas'] === ['public'] && $b['schemas'] === ['public'], 'Managed databases receive only the fixed public schema.');
    $assert($a['scope_key'] !== $b['scope_key'] && $a['backup_dir'] !== $b['backup_dir'], 'Equal schema/table names in different databases have separate state and backup roots.');
    $assert($scope->select('configured_db', 'postgres')['schema'] === 'archive', 'The configured database retains its original schema default.');
    $assert($scope->select('configured_db', 'postgres')['schemas'] === ['archive', 'public'], 'Configured schemas never leak into newly managed databases.');
    foreach ([['managed_a', 'archive'], ['unregistered', 'public'], ['postgres', 'public']] as [$name, $schema])
        $reject(static fn () => $scope->select($name, 'postgres', $schema), 'database_not_available', 403);
    $assert((new ConnectionScope($base))->select('managed_a', 'postgres')['scope_key'] === $a['scope_key'], 'A fresh request resolves the same durable registered database.');
    $write(['version' => 1, 'databases' => []]);
    $reject(static fn () => $scope->select('managed_a', 'postgres'), 'database_not_available', 403);
    $assert($scope->select('configured_db', 'postgres')['schema'] === 'archive', 'Configured access remains independent of the registry.');

    $serviceConfig = [...$config, 'registry_file' => $path, 'tools_socket' => $socket];
    $service = new PostgresDatabaseProvisioner($serviceConfig);
    $assert(!$service->isAvailable(), 'A trusted registry without the private socket cannot enable creation.');
    $server = stream_socket_server('unix://' . $socket, $number, $reason);
    $assert(is_resource($server) && $service->isAvailable(), 'Only the Unix worker socket and trusted registry enable creation.');
    $assert(ConnectionScope::capabilities($serviceConfig)['create_database'], 'The selected PostgreSQL workspace advertises its available broker.');
    $assert((new ConnectionScope([...$base, 'postgres' => $serviceConfig]))->engines(false)[1]['capabilities']['create_database'],
        'PostgreSQL creation metadata is independent of MariaDB broker availability.');
    $assert(!ConnectionScope::capabilities([...$serviceConfig, 'sql_password' => ''])['create_database'], 'Missing SQL credentials disable creation capability.');
    fclose($server);
    $server = null;
    unlink($socket);
    $fixture = <<<'PHP'
$server = stream_socket_server('unix://' . $argv[1], $number, $reason);
if (!$server) exit(2);
fwrite(STDOUT, "READY\n");
$peer = stream_socket_accept($server, 5);
if (!$peer) exit(3);
fwrite(STDOUT, base64_encode(fgets($peer, 4098)) . "\n");
$response = match ($argv[2]) {
    'invalid' => "{bad}\n", 'truncated' => '{"ok":true',
    'oversize' => str_repeat('x', 4100) . "\n",
    default => "{\"ok\":true,\"data\":{\"database\":\"new_db\",\"created\":true}}\n",
};
fwrite($peer, $response);
fclose($peer); fclose($server);
PHP;
    foreach (['valid', 'invalid', 'truncated', 'oversize'] as $mode) {
        $process = proc_open([PHP_BINARY, '-r', $fixture, $socket, $mode],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('The isolated Unix fixture could not start.');
        fclose($pipes[0]);
        $children[] = [$process, $pipes];
        stream_set_timeout($pipes[1], 5);
        $assert(fgets($pipes[1]) === "READY\n", 'The isolated worker fixture exposes a real Unix socket.');
        if ($mode === 'valid') {
            $assert($service->prepare(['name' => 'new_db']) === ['database' => 'new_db', 'created' => true], 'A real Unix request completes creation protocol parsing.');
            $wire = base64_decode(trim((string) fgets($pipes[1])), true);
            $assert(json_decode((string) $wire, true) === ['action' => 'prepare_database', 'name' => 'new_db'],
                'The actual wire carries neither credentials nor SQL nor browser paths.');
        } else $reject(static fn () => $service->prepare(['name' => 'new_db']), 'database_manager_invalid', 502);
        unlink($socket);
    }
    $write('{bad}');
    $assert(!$service->isAvailable() && !ConnectionScope::capabilities($serviceConfig)['create_database'], 'Corrupt registry disables creation.');
    $reject(static fn () => $service->prepare(['name' => 'new_db']), 'database_manager_unavailable', 503);
} finally {
    if (is_resource($server)) fclose($server);
    foreach ($children as [$process, $pipes]) {
        foreach ([1, 2] as $pipe) if (is_resource($pipes[$pipe])) fclose($pipes[$pipe]);
        if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    }
    foreach ([$socket, $path, $path . '.actual'] as $file) if (file_exists($file) || is_link($file)) unlink($file);
    rmdir($directory);
}
echo "PASS: $checks PostgreSQL creation protocol, trusted registry and multidatabase scope checks.\n";
