<?php
declare(strict_types=1);
/** Real private tools and PG18 restore, confined to one generated new test database. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\DatabaseProvisioner;
use Govern\PostgresBackupService;
$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (getenv('GOVERN_PROVISIONING_DISPOSABLE') !== '1' || ($options['confirm-database'] ?? '') !== $base['name']
    || ($base['postgres'] ?? null) === null) {
    fwrite(STDERR, "Use an isolated dual-engine stack and confirm its default database.\n"); exit(2);
}
$checks = 0;
$assert = static function (bool $ok, string $label) use (&$checks): void { if (!$ok) throw new RuntimeException($label); ++$checks; };
$assert(getenv('DB_ROOT_PASSWORD') === false && getenv('PG_ADMIN_PASSWORD') === false && getenv('PG_RESTORE_PASSWORD') === false,
    'The app-side service caller has no private administrator or restore passwords.');
$name = 'govern_backup_' . bin2hex(random_bytes(6));
$created = (new DatabaseProvisioner())->create(['name' => $name, 'engine' => 'postgres', 'operation_id' => bin2hex(random_bytes(16))]);
$config = (new ConnectionScope($base))->selectRequest($created['scope_key']);
$database = new Database($config);
$sql = $database->scriptConnection();
$sql->exec('CREATE TABLE public.backup_probe (id bigint PRIMARY KEY, label text, amount numeric(30,2))');
$sql->exec("INSERT INTO public.backup_probe VALUES (9007199254740993, 'original fixture', 123456789012345678901234.12)");
$read = static function () use ($database): array {
    return $database->reader()->query('SELECT id::text, label, amount::text FROM public.backup_probe ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
};
$before = $read();
$backup = new PostgresBackupService($config);
$point = $backup->create('Generated new-database checkpoint fixture');
$assert($point['database'] === $name && $point['schema'] === 'public', 'Checkpoint metadata binds the newly discovered database.');
$assert($point['restore_available'] === true, 'The supported isolated schema is restorable.');
$assert(in_array($point['id'], array_column($backup->list(), 'id'), true), 'The point is listed under the same new scope.');
$download = $backup->download($point['id']);
$assert(substr((string) file_get_contents($download['path']), 0, 5) === 'PGDMP', 'The verified download contains an actual native custom archive.');
$sql->exec("UPDATE public.backup_probe SET label='changed fixture' WHERE id=9007199254740993");
$sql->exec('CREATE TABLE public.created_after_checkpoint (id integer)');
$assert($read()[0]['label'] === 'changed fixture', 'The mutation is confirmed before recovery.');
$result = $backup->restore($point['id'], $name . '.public');
$assert($result['database'] === $name && $result['restored'] === $point['id'], 'The fixed-operation helper restores only the selected new scope.');
$assert(is_array($result['safety_snapshot']), 'A pre-restore safety copy is retained.');
$database->discardReader();
$assert($read() === $before, 'Restore reads back exact original text and numeric values through the ordinary reader.');
$assert(!in_array('created_after_checkpoint', array_column((new Catalog($database))->tables(), 'name'), true), 'Objects introduced after the point are removed.');
$database->writer()->exec("UPDATE public.backup_probe SET label='writer after restore' WHERE id=9007199254740993");
$assert($read()[0]['label'] === 'writer after restore', 'Normal DML grants survive normalized restore ownership.');
// Only this generated database is modified. Its copies remain in the disposable
// stack; the caller never gains administrator credentials for cleanup.
echo 'New PostgreSQL database checkpoint/restore: ' . $checks . " checks passed.\n";
