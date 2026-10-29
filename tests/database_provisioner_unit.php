<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\DatabaseProvisioner;
use Govern\Messages;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === $status,
            'Expected ' . $code . ', received ' . $exception->errorCode);
        return;
    }
    throw new RuntimeException('Expected a rejected operation: ' . $code);
};

foreach (['onderzoek', 'New_Project9', '123', str_repeat('a', 64), str_repeat('_', 32)] as $name)
    $assert(DatabaseProvisioner::validateName($name) === $name, 'Accepted exact supported name.');
foreach (['', ' name', 'name ', 'a-b', 'a.b', 'a/b', "a\0b", "bad\nname", 'één', str_repeat('a', 65),
    str_repeat('_', 33), 'mysql', 'MYSQL', 'information_schema', 'performance_schema', 'sys', 'SyS',
    "x`; DROP DATABASE test; --", null, [], 123] as $name)
    $reject(static fn () => DatabaseProvisioner::validateName($name), 'database_create_invalid', 422);

$requests = [];
$response = ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true]];
$client = new DatabaseProvisioner(null, static function (array $request) use (&$requests, &$response): mixed {
    $requests[] = $request;
    return $response;
});
$assert($client->isAvailable(), 'An explicitly injected test transport is available.');
$assert($client->prepare(['name' => 'new_db']) === ['database' => 'new_db', 'created' => true], 'Client returns exact prepared name and creation state.');
$assert($requests === [['action' => 'prepare_database', 'name' => 'new_db']], 'Only the fixed operation and validated name cross the socket boundary.');
$response['data']['created'] = false;
$assert($client->prepare(['name' => 'new_db'])['created'] === false, 'Existing database result remains distinct from new creation.');
$before = count($requests);
foreach ([[], ['name' => 'new_db', 'sql' => 'DROP DATABASE old'], ['name' => 'new_db', 'root' => '/'], ['name' => false],
    ['action' => 'prepare_database', 'name' => 'new_db'], ['name' => 'mysql']] as $input)
    $reject(static fn () => $client->prepare($input), 'database_create_invalid', 422);
$assert(count($requests) === $before, 'Invalid browser fields never reach the broker.');

foreach ([null, 'ok', [], ['ok' => 1], ['ok' => true], ['ok' => true, 'data' => ['database' => 'other', 'created' => true]],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => 'yes']],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true, 'sql' => 'anything']],
    ['ok' => true, 'data' => ['database' => 'new_db', 'created' => true], 'password' => 'do-not-forward'],
    ['ok' => false], ['ok' => false, 'error_code' => 'unknown-secret-error'],
    ['ok' => false, 'error_code' => 'database_prepare_failed', 'detail' => 'do-not-forward'],
] as $response) $reject(static fn () => $client->prepare(['name' => 'new_db']), 'database_manager_invalid', 502);
foreach (['database_create_invalid' => 422, 'database_prepare_failed' => 503] as $code => $status) {
    $response = ['ok' => false, 'error_code' => $code];
    $reject(static fn () => $client->prepare(['name' => 'new_db']), $code, $status);
    foreach (['nl', 'en'] as $language) $assert(Messages::text($code, [], $language) !== $code, 'Broker feedback is translated.');
}
$reject(static fn () => (new DatabaseProvisioner(null, static fn () => throw new RuntimeException('private-credential-value')))
    ->prepare(['name' => 'new_db']), 'database_manager_unavailable', 503);

$directory = sys_get_temp_dir() . '/govern-provisioner-' . bin2hex(random_bytes(6));
mkdir($directory, 0750);
$children = [];
$fixtures = [];
$fixture = <<<'PHP'
<?php
$server = stream_socket_server('unix://' . $argv[1], $number, $reason);
if (!$server) exit(2);
fwrite(STDOUT, "READY\n");
$peer = stream_socket_accept($server, 5);
if (!$peer) exit(3);
$request = fgets($peer, 4098);
fwrite(STDOUT, base64_encode($request) . "\n");
if ($argv[2] === 'stall') { sleep(14); }
elseif ($argv[2] === 'truncated') fwrite($peer, '{"ok":true');
elseif ($argv[2] === 'oversize') fwrite($peer, str_repeat('x', 4100) . "\n");
elseif ($argv[2] === 'invalid') fwrite($peer, "{bad json}\n");
else fwrite($peer, "{\"ok\":true,\"data\":{\"database\":\"new_db\",\"created\":true}}\n");
fclose($peer); fclose($server);
PHP;
$fixtureFile = $directory . '/fixture.php';
file_put_contents($fixtureFile, $fixture);
$start = static function (array $command, string $socket, ?array $environment = null) use (&$children, $assert): array {
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
    if (!is_resource($process)) throw new RuntimeException('Test socket process could not start.');
    fclose($pipes[0]);
    stream_set_timeout($pipes[1], 4);
    $line = fgets($pipes[1]);
    $children[] = [$process, $pipes];
    if ($line === false || !(str_starts_with($line, 'READY') || str_contains($line, 'manager ready'))) {
        stream_set_blocking($pipes[2], false);
        stream_set_blocking($pipes[1], false);
        throw new RuntimeException('Isolated socket startup failed: ' . $line . stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]));
    }
    $assert($line !== false && (str_starts_with($line, 'READY') || str_contains($line, 'manager ready')),
        'Isolated Unix fixture starts without a public port.');
    $assert(filetype($socket) === 'socket', 'Fixture exposes a Unix socket.');
    return [$process, $pipes];
};

try {
    $missing = new DatabaseProvisioner($directory . '/missing.sock');
    $assert(!$missing->isAvailable(), 'Missing manager is reported unavailable.');
    $reject(static fn () => $missing->prepare(['name' => 'new_db']), 'database_manager_unavailable', 503);
    foreach (['http://localhost:11434', 'relative.sock', "/tmp/bad\0socket"] as $socket) {
        $invalid = new DatabaseProvisioner($socket);
        $assert(!$invalid->isAvailable(), 'Server-owned socket configuration still cannot become an HTTP transport.');
        $reject(static fn () => $invalid->prepare(['name' => 'new_db']), 'database_manager_unavailable', 503);
    }
    $plain = $directory . '/plain.sock'; file_put_contents($plain, 'untouched');
    $assert(!(new DatabaseProvisioner($plain))->isAvailable(), 'A regular file is not a provisioning service.');
    $link = $directory . '/link.sock'; symlink($plain, $link);
    $assert(!(new DatabaseProvisioner($link))->isAvailable(), 'Socket client does not follow a symlink.');
    $probeSocket = $directory . '/probe.sock';
    $probe = @stream_socket_server('unix://' . $probeSocket, $probeNumber, $probeReason);
    if ($probe === false) {
        if (getenv('GOVERN_ALLOW_SOCKET_SKIP') !== '1') throw new RuntimeException('Unix sockets are required for this test environment.');
        echo 'Database provisioner: ' . $passed . " checks passed; Unix integration explicitly skipped because this host cannot bind a Unix socket.\n";
        return;
    }
    fclose($probe); unlink($probeSocket);
    foreach (['valid', 'invalid', 'truncated', 'oversize', 'stall'] as $mode) {
        $socket = $directory . '/' . $mode . '.sock';
        [$process, $pipes] = $start([PHP_BINARY, $fixtureFile, $socket, $mode], $socket);
        $real = new DatabaseProvisioner($socket);
        if ($mode === 'valid') {
            $assert($real->isAvailable(), 'Real socket availability does not consume the fixture request.');
            $assert($real->prepare(['name' => 'new_db']) === ['database' => 'new_db', 'created' => true], 'Actual Unix request and response round trip succeeds.');
            $wire = base64_decode(trim((string) fgets($pipes[1])), true);
            $assert(json_decode((string) $wire, true) === ['action' => 'prepare_database', 'name' => 'new_db'], 'Actual wire request contains no credentials or browser SQL.');
        } else {
            $started = microtime(true);
            $reject(static fn () => $real->prepare(['name' => 'new_db']),
                $mode === 'stall' ? 'database_manager_unavailable' : 'database_manager_invalid', $mode === 'stall' ? 503 : 502);
            if ($mode === 'stall') $assert(microtime(true) - $started < 14, 'An unresponsive manager cannot hold the client indefinitely.');
        }
    }

    // Exercise the real manager's protocol and permission boundary without a database.
    $managerSocket = $directory . '/manager.sock';
    $environment = getenv();
    $environment['DB_MANAGER_SOCKET'] = $managerSocket;
    $environment['DB_ROOT_PASSWORD'] = '';
    $start([PHP_BINARY, dirname(__DIR__) . '/docker/database-manager/server.php'], $managerSocket, $environment);
    clearstatcache();
    $assert((fileperms($directory) & 0777) === 0750 && filegroup($directory) === 33, 'Manager directory permits Apache traversal without unlink access.');
    $assert((fileperms($managerSocket) & 0777) === 0660 && filegroup($managerSocket) === 33, 'Manager socket permits the Apache group, not other users.');
    $rawRequest = static function (string $raw) use ($managerSocket): array {
        $connection = stream_socket_client('unix://' . $managerSocket, $number, $reason, 2);
        if ($connection === false) throw new RuntimeException('Real manager socket unavailable.');
        stream_set_timeout($connection, 6);
        fwrite($connection, $raw);
        $line = fgets($connection, 4097);
        fclose($connection);
        return json_decode((string) $line, true, 8, JSON_THROW_ON_ERROR);
    };
    foreach (["{bad}\n", "[]\n", "{}\n", "{\"action\":\"sql\",\"name\":\"new_db\"}\n",
        "{\"action\":\"prepare_database\",\"name\":\"mysql\"}\n",
        "{\"action\":\"prepare_database\",\"name\":\"new_db\",\"sql\":\"DROP DATABASE x\"}\n",
        str_repeat('x', 4097) . "\n"] as $raw) {
        $assert($rawRequest($raw) === ['ok' => false, 'error_code' => 'database_create_invalid'], 'Real manager rejects unsupported or oversized requests before database access.');
    }
    $assert($rawRequest("{\"action\":\"prepare_database\",\"name\":\"new_db\"}\n")
        === ['ok' => false, 'error_code' => 'database_prepare_failed'], 'Missing private credentials produce only a safe fixed error code.');
    $assert(file_get_contents($plain) === 'untouched', 'Unrelated local files are preserved.');
    echo 'Database provisioner: ' . $passed . " checks passed.\n";
} finally {
    foreach ($children as [$process, $pipes]) {
        if (is_resource($process)) { proc_terminate($process); foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe); proc_close($process); }
    }
    foreach (glob($directory . '/*') ?: [] as $path) @unlink($path);
    @rmdir($directory);
}
