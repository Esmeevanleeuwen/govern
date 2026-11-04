<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
require_once dirname(__DIR__) . '/docker/database-manager/DatabaseCreator.php';

use Govern\ApiException;
use Govern\DatabaseCreator;
use Govern\DatabaseProvisioner;

$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $fn, string $code) use ($assert): void {
    try { $fn(); } catch (ApiException $e) { $assert($e->errorCode === $code, 'Expected ' . $code . ', got ' . $e->errorCode); return; }
    throw new RuntimeException('Expected rejection ' . $code);
};
foreach (['research', 'a1_b2', str_repeat('a', 63)] as $name) {
    foreach (['mariadb', 'postgres'] as $engine) $assert(DatabaseProvisioner::validateCreateName($name, $engine) === $name, 'Exact fresh identifier.');
}
foreach (['', 'UPPER', '1start', 'with-dash', 'with space', 'pg_catalog', 'postgres', 'mysql', 'template1', str_repeat('a', 64)] as $name)
    $reject(static fn () => DatabaseProvisioner::validateCreateName($name, 'postgres'), 'database_create_invalid');
$reject(static fn () => DatabaseProvisioner::validateCreateName('research', 'sqlite'), 'database_create_invalid');
$payload = ['name' => 'research', 'engine' => 'postgres', 'operation_id' => str_repeat('a', 32)];
$result = ['database' => 'research', 'engine' => 'postgres', 'created' => true, 'scope_key' => 'postgres:research:public',
    'import_user' => 'govern_import_' . str_repeat('b', 16), 'import_password' => str_repeat('c', 64)];
$requestSeen = null;
$response = ['ok' => true, 'data' => $result];
$client = new DatabaseProvisioner(null, static function (array $request) use (&$requestSeen, &$response): array {
    $requestSeen = $request; return $response;
});
$assert($client->create($payload) === $result, 'Server caller receives target-bound credential receipt.');
$assert($requestSeen === ['action' => 'create_database', 'engine' => 'postgres', 'name' => 'research', 'operation_id' => str_repeat('a', 32)], 'Wire protocol is fixed operation only.');
$reject(static fn () => $client->create([...$payload, 'sql' => 'SELECT 1']), 'database_create_invalid');
$reject(static fn () => $client->create([...$payload, 'operation_id' => 'short']), 'database_create_invalid');
foreach (['database_exists', 'database_creation_uncertain', 'database_prepare_failed'] as $code) {
    $response = ['ok' => false, 'error_code' => $code];
    $reject(static fn () => $client->create($payload), $code);
}
foreach ([['database' => 'another'], ['scope_key' => 'postgres:another:public'], ['created' => false], ['import_user' => 'postgres'],
    ['import_password' => 'short'], ['unexpected' => true]] as $change) {
    $response = ['ok' => true, 'data' => [...$result, ...$change]];
    $reject(static fn () => $client->create($payload), 'database_manager_invalid');
}
$root = sys_get_temp_dir() . '/govern-create-unit-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    $db = new PDO('sqlite:' . $root . '/receipts.sqlite');
    $db->exec('CREATE TABLE receipts(operation_id TEXT PRIMARY KEY, engine TEXT NOT NULL, database_name TEXT NOT NULL, state TEXT NOT NULL, result TEXT)');
    $insert = $db->prepare('INSERT INTO receipts VALUES(?,?,?,?,?)');
    $insert->execute([$payload['operation_id'], 'postgres', 'research', 'pending', null]);
    $creator = new DatabaseCreator($root, ['PG_ENABLED' => '1']);
    $reject(static fn () => $creator->create($payload), 'database_creation_uncertain');
    $reject(static fn () => $creator->create([...$payload, 'name' => 'other']), 'database_create_invalid');
    $db->prepare('UPDATE receipts SET state=?,result=?')->execute(['complete', json_encode($result)]);
    $assert($creator->create($payload) === $result, 'Known completed receipt replays without connecting to a database.');
    $db->prepare('UPDATE receipts SET state=?,result=NULL')->execute(['collision']);
    $reject(static fn () => $creator->create($payload), 'database_exists');
    clearstatcache();
    $assert((fileperms($root) & 0777) === 0700 && (fileperms($root . '/receipts.sqlite') & 0777) === 0600, 'Private receipts and directory permissions.');
} finally {
    $db = null;
    foreach (glob($root . '/*') as $file) unlink($file);
    rmdir($root);
}
echo 'Fresh provisioning: ' . $checks . " checks passed.\n";
