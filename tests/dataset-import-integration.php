<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Config;
use Govern\Database;
use Govern\DatasetImport;

$config = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($options['confirm-database'] ?? '') !== $config['name']) exit(2);
$db = new Database($config);
$service = new DatasetImport($db);
$pdo = $db->writer();
$name = 'zz_import_' . bin2hex(random_bytes(6));
$numericName = (string) random_int(100000000, 999999999);
$file = tempnam(sys_get_temp_dir(), 'govern-reader-test-');
file_put_contents($file, "id;name\n001;First\n002;Second\n");
$assert = static function (bool $valid): void {if (!$valid) throw new RuntimeException('Dataset integration assertion failed');};
try {
    $pdo->exec('CREATE TABLE ' . Database::identifier($numericName) . ' (id TEXT, name TEXT) ENGINE=InnoDB');
    $parsed = DatasetImport::read(['name' => 'test.csv', 'tmp_name' => $file]);
    $input = ['dataset' => '0', 'table' => $name, 'mode' => 'create', 'confirmation' => $db->name(), 'sha256' => $parsed['sha256']];
    $preview = $service->preview($parsed);
    $assert($preview['datasets'][0]['count'] === 2);
    $result = $service->commit($parsed, $input);
    $assert($result['imported'] === 2);
    $assert($pdo->query('SELECT id FROM ' . Database::identifier($name) . ' ORDER BY _govern_id LIMIT 1')->fetchColumn() === '001');
    try {$service->commit($parsed, $input); throw new RuntimeException('Overwrite accepted');}
    catch (ApiException $e) {$assert($e->errorCode === 'dataset_exists');}
    $targets = $service->preview($parsed)['datasets'][0]['targets'];
    $target = array_values(array_filter($targets, static fn(array $t): bool => $t['name'] === $name))[0];
    $input['mode'] = 'append'; $input['version'] = $target['version'];
    $service->commit($parsed, $input);
    $assert((int) $pdo->query('SELECT COUNT(*) FROM ' . Database::identifier($name))->fetchColumn() === 4);
    $pdo->exec('UPDATE ' . Database::identifier($name) . " SET name = 'ok'");
    $pdo->exec('ALTER TABLE ' . Database::identifier($name) . ' MODIFY name VARCHAR(3) NULL');
    try {$service->commit($parsed, $input); throw new RuntimeException('Stale schema accepted');}
    catch (ApiException $e) {$assert($e->errorCode === 'dataset_changed');}
    $target = array_values(array_filter($service->preview($parsed)['datasets'][0]['targets'], static fn(array $t): bool => $t['name'] === $name))[0];
    $input['version'] = $target['version'];
    try {$service->commit($parsed, $input); throw new RuntimeException('Truncation accepted');}
    catch (PDOException) {}
    $assert((int) $pdo->query('SELECT COUNT(*) FROM ' . Database::identifier($name))->fetchColumn() === 4);
    echo "Dataset create, readback, append, schema conflict and rollback checks passed.\n";
} finally {
    $pdo->exec('DROP TABLE IF EXISTS ' . Database::identifier($name));
    $pdo->exec('DROP TABLE IF EXISTS ' . Database::identifier($numericName));
    unlink($file);
}
