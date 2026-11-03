<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\ApiException;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\DatasetImport;
use Govern\PostgresDatasetImport;

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
$scope = new ConnectionScope($base);
$config = $scope->select('govern_pg', 'postgres', 'public');
$db = new Database($config);
$service = new PostgresDatasetImport($db);
$sql = $db->scriptConnection();
$name = 'govern_dataset_' . bin2hex(random_bytes(6));
$replacement = $name . '_replace';
$qualified = 'public.' . $db->quoteIdentifier($name);
$file = tempnam(sys_get_temp_dir(), 'govern-pg-dataset-');
try {
    file_put_contents($file, '[{"identifier":"001","label":"One","amount":123456789012345678901234.12,"nullable":null},'
        . '{"identifier":"002","label":"Second","amount":2.00,"nullable":""}]');
    $parsed = DatasetImport::read(['name' => 'exact.json', 'tmp_name' => $file]);
    $preview = $service->preview($parsed);
    $assert($preview['schema'] === 'public' && $preview['confirmation'] === 'govern_pg.public', 'Preview captures the complete schema scope.');
    $assert($preview['datasets'][0]['columns'][0]['type'] === 'TEXT', 'Preview describes actual PostgreSQL storage.');
    $input = ['dataset' => '0', 'table' => $name, 'mode' => 'create', 'confirmation' => 'govern_pg.public', 'sha256' => $parsed['sha256']];
    $reject(static fn () => $service->commit($parsed, [...$input, 'confirmation' => 'govern_pg']), 'dataset_changed', 409);
    $result = $service->commit($parsed, $input);
    $assert($result['imported'] === 2 && $result['schema'] === 'public', 'Create commits every source row to the selected schema.');
    $rows = $db->reader()->query('SELECT identifier,amount,nullable FROM ' . $qualified . ' ORDER BY "_govern_id"')->fetchAll(PDO::FETCH_ASSOC);
    $assert($rows[0]['identifier'] === '001' && $rows[0]['amount'] === '123456789012345678901234.12', 'Exact JSON decimals and leading zeroes survive reading and import.');
    $assert($rows[0]['nullable'] === null && $rows[1]['nullable'] === '', 'NULL and empty text remain separate.');
    $db->writer()->exec('UPDATE ' . $qualified . " SET label='row writer changed' WHERE identifier='001'");
    $assert($db->reader()->query('SELECT label FROM ' . $qualified . " WHERE identifier='001'")->fetchColumn() === 'row writer changed',
        'Reader and row writer immediately receive new SQL-owned table permissions.');
    $reject(static fn () => $service->commit($parsed, $input), 'dataset_exists', 409);
    $target = array_values(array_filter($service->preview($parsed)['datasets'][0]['targets'], static fn (array $item): bool => $item['name'] === $name))[0];
    $append = [...$input, 'mode' => 'append', 'version' => $target['version']];
    $service->commit($parsed, $append);
    $assert((int) $sql->query('SELECT COUNT(*) FROM ' . $qualified)->fetchColumn() === 4, 'Append commits the complete dataset.');
    $sql->exec('ALTER TABLE ' . $qualified . ' ADD CONSTRAINT import_shape_probe CHECK (length(label)>0)');
    $reject(static fn () => $service->commit($parsed, $append), 'dataset_changed', 409);
    $sql->exec('ALTER TABLE ' . $qualified . ' DROP CONSTRAINT import_shape_probe');
    $sql->exec('ALTER TABLE ' . $qualified . ' ALTER COLUMN label TYPE varchar(3) USING left(label,3)');
    $target = array_values(array_filter($service->preview($parsed)['datasets'][0]['targets'], static fn (array $item): bool => $item['name'] === $name))[0];
    $reject(static fn () => $service->commit($parsed, [...$append, 'version' => $target['version']]), 'postgres_dataset_write_failed', 422);
    $assert((int) $sql->query('SELECT COUNT(*) FROM ' . $qualified)->fetchColumn() === 4, 'A later invalid row rolls back all appended rows.');
    $archive = new PostgresDatasetImport(new Database($scope->select('govern_pg', 'postgres', 'archive')));
    $archive->commit($parsed, [...$input, 'confirmation' => 'govern_pg.archive']);
    $other = array_values(array_filter($archive->preview($parsed)['datasets'][0]['targets'], static fn (array $item): bool => $item['name'] === $name))[0];
    $reject(static fn () => $service->commit($parsed, [...$append, 'version' => $other['version']]), 'dataset_changed', 409);
    $assert((int) $sql->query('SELECT COUNT(*) FROM archive.' . $db->quoteIdentifier($name))->fetchColumn() === 2, 'Equal table names stay isolated across schema scopes.');
    $service->commit($parsed, [...$input, 'table' => $replacement]);
    $oldTarget = array_values(array_filter($service->preview($parsed)['datasets'][0]['targets'], static fn (array $item): bool => $item['name'] === $replacement))[0];
    $sql->exec('DROP TABLE public.' . $db->quoteIdentifier($replacement));
    $service->commit($parsed, [...$input, 'table' => $replacement]);
    $reject(static fn () => $service->commit($parsed, [...$append, 'table' => $replacement, 'version' => $oldTarget['version']]), 'dataset_changed', 409);
    $assert((int) $sql->query('SELECT COUNT(*) FROM public.' . $db->quoteIdentifier($replacement))->fetchColumn() === 2,
        'A replacement relation with identical columns cannot receive a stale append.');
} finally {
    foreach (['public', 'archive'] as $schema) $sql->exec('DROP TABLE IF EXISTS ' . $db->quoteIdentifier($schema) . '.' . $db->quoteIdentifier($name));
    $sql->exec('DROP TABLE IF EXISTS public.' . $db->quoteIdentifier($replacement));
    unlink($file);
}
echo "PASS: $checks PostgreSQL dataset exact-value, create/append, freshness, scope and rollback checks.\n";
