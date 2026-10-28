<?php
declare(strict_types=1);

require dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\BackupService;

$directory = sys_get_temp_dir() . '/govern-backup-test-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
$service = new BackupService(['backup_dir' => $directory, 'name' => 'govern_test']);
$id = '20261028T120000Z_0123456789abcdef';
$sql = "SELECT 1;\n";
$manifest = [
    'format' => 1, 'id' => $id, 'label' => 'Oefening',
    'created_at' => '2026-10-28T12:00:00Z', 'database' => 'govern_test',
    'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci',
    'size_bytes' => strlen($sql), 'sha256' => hash('sha256', $sql),
];
$passed = 0;
$check = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $passed++;
};
$rejects = static function (callable $operation, string $class) use ($check): void {
    try {
        $operation();
    } catch (Throwable $exception) {
        $check($exception instanceof $class, 'Verkeerd fouttype: ' . $exception::class);
        return;
    }
    throw new RuntimeException('De ongeldige bewerking werd niet geweigerd.');
};
try {
    file_put_contents("$directory/$id.sql", $sql);
    file_put_contents("$directory/$id.json", json_encode($manifest, JSON_THROW_ON_ERROR));
    $check(count($service->list()) === 1, 'Geldig herstelpunt ontbreekt.');
    $check($service->download($id)['path'] === "$directory/$id.sql", 'Download gebruikt een verkeerd pad.');
    $rejects(fn() => $service->download('../outside'), InvalidArgumentException::class);
    $rejects(fn() => $service->restore($id, 'another_database'), InvalidArgumentException::class);
    $rejects(fn() => $service->create('  '), InvalidArgumentException::class);

    // Keep the same byte length: restoring must check the hash, not only file size.
    file_put_contents("$directory/$id.sql", "SELECT 2;\n");
    $rejects(fn() => $service->download($id), RuntimeException::class);
    file_put_contents("$directory/$id.sql", $sql);

    $manifest['database'] = 'another_database';
    file_put_contents("$directory/$id.json", json_encode($manifest, JSON_THROW_ON_ERROR));
    $check($service->list() === [], 'Een herstelpunt van een andere database is zichtbaar.');
    $rejects(fn() => $service->download($id), RuntimeException::class);

    file_put_contents("$directory/$id.json", '{broken');
    $check($service->list() === [], 'Een beschadigd metadata-bestand blokkeert de lijst.');
    echo "Backup bestandscontroles: $passed geslaagd.\n";
} finally {
    foreach (scandir($directory) ?: [] as $file) {
        if ($file !== '.' && $file !== '..') {
            unlink($directory . '/' . $file);
        }
    }
    rmdir($directory);
}
