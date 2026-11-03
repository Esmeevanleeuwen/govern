<?php
declare(strict_types=1);
/** Real SQL imports and mandatory recovery checkpoints in a disposable database. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\ApiException;
use Govern\BackupException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\MaintenanceLock;
use Govern\PostgresNativeImport;

$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($base['postgres']['name'] ?? '') !== 'govern_pg' || ($options['confirm-database'] ?? '') !== 'govern_pg') exit(2);
$checks = 0;
$assert = static function (bool $valid, string $message) use (&$checks): void {
    if (!$valid) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === $status, 'Expected ' . $code . ', received ' . $exception->errorCode);
        return;
    }
    throw new RuntimeException('Expected rejection ' . $code);
};
$config = (new ConnectionScope($base))->select('govern_pg', 'postgres', 'public');
$db = new Database($config);
$sql = $db->scriptConnection();
$name = 'govern_native_import_' . bin2hex(random_bytes(6));
$absent = $name . '_absent';
$qualified = 'public.' . $db->quoteIdentifier($name);
$importer = new PostgresNativeImport($db, new Catalog($db), $config);
$run = static function (string $text, string $token) use ($config, $importer): array {
    $lock = new MaintenanceLock($config['maintenance_dir'], true);
    return $importer->execute($text, $token, 'govern_pg.public');
};
try {
    $script = 'CREATE TABLE ' . $qualified . ' (id pg_catalog.int8 GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label pg_catalog.text);'
        . ' INSERT INTO ' . $qualified . " (label) VALUES ('native import');";
    $preview = $importer->preview($script);
    $assert($preview['statement_count'] === 2 && $preview['confirmation'] === 'govern_pg.public', 'SQL preflight reuses the PostgreSQL parser and complete scope.');
    $reject(static fn () => $importer->execute($script, $preview['preview_token'], 'govern_pg'), 'postgres_import_confirm', 422);
    $unavailable = new PostgresNativeImport($db, new Catalog($db), [...$config, 'tools_socket' => '/run/govern-postgres/absent-import-test.sock']);
    try {
        $lock = new MaintenanceLock($config['maintenance_dir'], true);
        $unavailable->execute($script, $preview['preview_token'], 'govern_pg.public');
        throw new RuntimeException('SQL executed without its mandatory checkpoint.');
    } catch (BackupException $exception) {
        $assert($exception->errorCode === 'postgres_tools_unavailable', 'Snapshot transport failure aborts before any import SQL.');
    } finally { unset($lock); }
    $assert($sql->query("SELECT pg_catalog.to_regclass('public." . $name . "')")->fetchColumn() === null, 'A failed checkpoint leaves the selected schema untouched.');
    $result = $run($script, $preview['preview_token']);
    $assert($result['completed'] && $result['executed'] === 2 && in_array($name, $result['added_tables'], true),
        'Post-import inspection discovers committed new tables without a stale catalog.');
    $assert(array_column($result['safety_snapshots'], 'schema') === ['public', 'archive'] && is_string($result['safety_snapshot']['id']),
        'Every configured existing schema gets a checkpoint before arbitrary SQL.');
    $assert($db->reader()->query('SELECT label FROM ' . $qualified)->fetchColumn() === 'native import', 'The independent reader sees the imported data.');
    $staleSql = 'CREATE TABLE public.' . $db->quoteIdentifier($absent) . ' (label text);';
    $stale = $importer->preview($staleSql);
    $sql->exec('ALTER TABLE ' . $qualified . ' ADD COLUMN changed text');
    $reject(static fn () => $run($staleSql, $stale['preview_token']), 'import_preview_stale', 409);
    $assert($sql->query("SELECT pg_catalog.to_regclass('public." . $absent . "')")->fetchColumn() === null, 'Stale preflight executes no SQL.');
    $partial = 'INSERT INTO ' . $qualified . " (label) VALUES ('committed before failure'); SELECT * FROM public.govern_import_missing_relation;";
    $partialPreview = $importer->preview($partial);
    $partialResult = $run($partial, $partialPreview['preview_token']);
    $assert(!$partialResult['completed'] && $partialResult['executed'] === 1 && $partialResult['failed']['index'] === 2,
        'Partial failures preserve completed-step diagnostics and stop execution.');
    $assert((int) $sql->query('SELECT COUNT(*) FROM ' . $qualified)->fetchColumn() === 2, 'Earlier autocommit writes remain visible and are not called rollback.');
    $unfinished = 'BEGIN; INSERT INTO ' . $qualified . " (label) VALUES ('unfinished transaction');";
    $unfinishedPreview = $importer->preview($unfinished);
    $unfinishedResult = $run($unfinished, $unfinishedPreview['preview_token']);
    $assert(!$unfinishedResult['completed'] && $unfinishedResult['transaction_rolled_back'], 'An unfinished import transaction is rolled back.');
    $assert((int) $sql->query('SELECT COUNT(*) FROM ' . $qualified)->fetchColumn() === 2, 'Uncommitted data is absent after the import session ends.');
} finally {
    foreach ([$name, $absent] as $table) $sql->exec('DROP TABLE IF EXISTS public.' . $db->quoteIdentifier($table));
}
echo "PASS: $checks PostgreSQL SQL import, recovery preflight, scope, stale-state and partial-failure checks.\n";
