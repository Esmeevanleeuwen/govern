<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\BackupException;
use Govern\BackupInputException;
use Govern\MaintenanceLock;
use Govern\PostgresBackupService;
$directory = sys_get_temp_dir() . '/govern-pg-backup-unit-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code) use ($assert): void {
    try { $action(); }
    catch (BackupException | BackupInputException $exception) { $assert($exception->errorCode === $code, $code); return; }
    throw new RuntimeException('Expected ' . $code);
};
$config = ['name' => 'govern_pg', 'schema' => 'public', 'maintenance_dir' => $directory,
    'backup_dir' => $directory . '/checkpoints', 'tools_socket' => '/missing-govern-unit.sock'];
$id = '20261103T120000Z_1234567890abcdef';
$descriptor = ['id' => $id, 'database' => 'govern_pg', 'schema' => 'public', 'format' => 'postgres-custom-v1',
    'label' => 'A checkpoint', 'created_at' => '2026-11-03T12:00:00Z', 'size_bytes' => 42, 'sha256' => str_repeat('a', 64)];
$seen = [];
$service = new PostgresBackupService($config, static function (array $request) use (&$seen, $descriptor, $id): array {
    $seen[] = $request;
    return ['ok' => true, 'data' => match ($request['action']) {
        'list' => [$descriptor], 'create' => [...$descriptor, 'label' => $request['label']],
        'restore' => ['restored' => $id, 'database' => 'govern_pg', 'schema' => 'public', 'safety_snapshot' => $descriptor],
        default => $descriptor,
    }];
});
try {
    $assert($service->list() === [$descriptor], 'Binary checkpoint descriptors retain their exact scope.');
    $assert($seen[0] === ['action' => 'list', 'database' => 'govern_pg', 'schema' => 'public'], 'Socket payload excludes credentials and paths.');
    $assert($service->create(' trimmed ')['label'] === 'trimmed', 'Labels normalize outer whitespace.');
    $reject(static fn () => $service->create(''), 'snapshot_label_invalid');
    $reject(static fn () => $service->create(str_repeat('x', 601)), 'snapshot_label_invalid');
    $reject(static fn () => $service->restore($id, 'govern_pg'), 'restore_confirmation_invalid');
    $reject(static fn () => $service->restore('../escape', 'govern_pg.public'), 'snapshot_id_invalid');
    $assert($service->restore($id, 'govern_pg.public')['safety_snapshot'] === $descriptor, 'Restore retains a safety checkpoint.');
    $lock = new MaintenanceLock($directory, true);
    $assert($service->createLocked('under one lock')['id'] === $id, 'Import reuses its existing exclusive maintenance lock.');
    unset($lock);
    $bad = new PostgresBackupService($config, static fn (): array => ['ok' => true, 'data' => [[...$descriptor, 'schema' => 'archive']]]);
    $reject(static fn () => $bad->list(), 'postgres_tools_invalid');
    $reject(static fn () => (new PostgresBackupService($config))->list(), 'postgres_tools_unavailable');
    $error = new PostgresBackupService($config, static fn (): array => ['ok' => false, 'error_code' => 'postgres_snapshot_dependencies']);
    $reject(static fn () => $error->restore($id, 'govern_pg.public'), 'postgres_snapshot_dependencies');
} finally {
    @unlink($directory . '/.maintenance.lock');
    rmdir($directory);
}
echo "PASS: $checks PostgreSQL checkpoint client/lock/scope/protocol checks.\n";
