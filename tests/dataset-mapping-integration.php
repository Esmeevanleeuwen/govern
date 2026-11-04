<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\DatasetMapping;
use Govern\DatasetMappingException;

$base = Config::fromEnvironment();
$options = getopt('', ['connection:', 'confirm-database:']);
$connection = $options['connection'] ?? 'mariadb';
$name = $connection === 'postgres' ? ($base['postgres']['name'] ?? '') : $base['name'];
if ($name === '' || ($options['confirm-database'] ?? '') !== $name) exit(2);
$config = (new ConnectionScope($base))->select($name, $connection);
$db = new Database($config);
$mapping = new DatasetMapping($db);
$pdo = $db->scriptConnection();
$prefix = 'zz_mapping_' . bin2hex(random_bytes(5));
$names = [$prefix, $prefix . '_partial', $prefix . '_unique', $prefix . '_heartbeat'];
$quoted = static fn (string $n): string => $db->quoteIdentifier($db->schemaName()) . '.' . $db->quoteIdentifier($n);
$checks = 0;
$assert = static function (bool $ok) use (&$checks): void { ++$checks; if (!$ok) throw new RuntimeException('Dataset mapping integration assertion failed'); };
$columns = [['name' => 'postal'], ['name' => 'name'], ['name' => 'unused']];
$parsed = ['sha256' => str_repeat('a', 64), 'datasets' => [['columns' => $columns, 'rows' => [['00123', 'Zoë', '']], 'count' => 1]]];
$maps = [['source' => 'unused', 'target' => null, 'empty_as_null' => false],
    ['source' => 'name', 'target' => 'full_name', 'empty_as_null' => false],
    ['source' => 'postal', 'target' => 'postal_code', 'empty_as_null' => false]];
$plan = ['dataset' => 0, 'table' => $prefix, 'mode' => 'create', 'mapping' => $maps];
$targets = static fn (): array => array_column($mapping->preview($parsed)['targets'], null, 'name');
try {
    $result = $mapping->execute($parsed, [$plan]);
    $assert($result['imported'] === 1);
    $rows = $db->reader()->query('SELECT full_name, postal_code FROM ' . $quoted($prefix))->fetchAll();
    $assert($rows === [['full_name' => 'Zoë', 'postal_code' => '00123']]);
    try { $mapping->execute($parsed, [$plan]); $assert(false); }
    catch (ApiException $error) { $assert($error->errorCode === 'dataset_exists'); }
    $target = $targets()[$prefix];
    $append = [...$plan, 'mode' => 'append', 'version' => $target['version']];
    $mapping->execute($parsed, [$append]);
    $assert((int) $db->reader()->query('SELECT COUNT(*) FROM ' . $quoted($prefix))->fetchColumn() === 2);
    // Pure row changes do not invalidate a structure plan (including MariaDB's next identity value).
    $mapping->execute($parsed, [$append]);
    $assert((int) $db->reader()->query('SELECT COUNT(*) FROM ' . $quoted($prefix))->fetchColumn() === 3);
    $pdo->exec('ALTER TABLE ' . $quoted($prefix) . ($connection === 'postgres'
        ? ' ALTER COLUMN full_name TYPE varchar(3)' : ' MODIFY full_name VARCHAR(3) NULL'));
    try { $mapping->prepare($parsed, [$append]); $assert(false); }
    catch (ApiException $error) { $assert($error->errorCode === 'dataset_changed'); }
    $append['version'] = $targets()[$prefix]['version'];
    $invalid = $parsed;
    $invalid['datasets'][0]['rows'][] = ['00234', 'longer', ''];
    try { $mapping->prepare($invalid, [$append]); $assert(false); }
    catch (ApiException $error) { $assert($error->errorCode === 'dataset_mapping_value' && $error->errorParams['row'] === 2); }
    // Deliberately different source headings map into a text column with a generated key.
    $pdo->exec('CREATE TABLE ' . $quoted($names[2]) . ' (postal_code ' . ($connection === 'postgres' ? 'text' : 'LONGTEXT') . ' NOT NULL'
        . ($connection === 'postgres' ? ' UNIQUE)' : ', UNIQUE (postal_code(20))) ENGINE=InnoDB'));
    $target = $targets()[$names[2]];
    $many = $parsed;
    $many['datasets'][] = ['columns' => $columns, 'rows' => [['00123', 'one', ''], ['00123', 'two', '']], 'count' => 2];
    $first = [...$plan, 'table' => $names[1]];
    $second = ['dataset' => 1, 'table' => $names[2], 'mode' => 'append', 'version' => $target['version'],
        'mapping' => [['source' => 'postal', 'target' => 'postal_code', 'empty_as_null' => false],
            ['source' => 'name', 'target' => null, 'empty_as_null' => false], ['source' => 'unused', 'target' => null, 'empty_as_null' => false]]];
    $events = [];
    try { $mapping->execute($many, [$first, $second], static function ($item) use (&$events): void { $events[] = $item; }); $assert(false); }
    catch (DatasetMappingException $error) {
        $assert(!$error->uncertain && count($error->completedTables) === 1);
        $assert($error->completedTables[0]['table'] === $names[1] && $events === $error->completedTables);
    }
    $assert((int) $db->reader()->query('SELECT COUNT(*) FROM ' . $quoted($names[2]))->fetchColumn() === 0);
    $assert((int) $db->reader()->query('SELECT COUNT(*) FROM ' . $quoted($names[1]))->fetchColumn() === 1);
    $heartbeatParsed = $parsed;
    $heartbeatParsed['datasets'][0]['rows'] = array_fill(0, 500, ['00123', 'one', '']);
    $heartbeatParsed['datasets'][0]['count'] = 500;
    $heartbeats = $publications = 0;
    try {
        $mapping->execute($heartbeatParsed, [[...$plan, 'table' => $names[3]]],
            static function () use (&$publications): void { ++$publications; },
            static function () use (&$heartbeats): void { ++$heartbeats; throw new RuntimeException('Heartbeat deadline fixture'); });
        $assert(false);
    } catch (DatasetMappingException $error) {
        $assert(!$error->uncertain && $error->completedTables === []);
        $assert($heartbeats === 1 && $publications === 0);
    }
    $assert(!isset($targets()[$names[3]]));
    $wideColumns = array_map(static fn (int $i): array => ['name' => 'column_' . $i], range(1, 20));
    $wideRows = array_fill(0, 20, array_fill(0, 20, str_repeat('x', 30000)));
    $large = ['sha256' => str_repeat('c', 64), 'datasets' => [
        ['columns' => $wideColumns, 'rows' => $wideRows, 'count' => 20],
        ['columns' => [['name' => 'large_text']], 'rows' => [[str_repeat('y', 1048576)]], 'count' => 1]]];
    $sampled = $mapping->preview($large)['datasets'];
    $previewBytes = 0;
    foreach ($sampled as $dataset) foreach ($dataset['rows'] as $row) $previewBytes += Govern\Preview::bytes($row);
    $assert($previewBytes <= Govern\Preview::RESULT_BYTES && $sampled[0]['preview_truncated'] && $sampled[1]['preview_truncated']);
    $assert($sampled[0]['count'] === 20 && count($sampled[0]['rows']) < 20);
    $assert(strlen($sampled[1]['rows'][0][0]) < 1048576);
    echo "Dataset mapping $connection integration checks: $checks passed.\n";
} finally {
    foreach (array_reverse($names) as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $quoted($table));
}
