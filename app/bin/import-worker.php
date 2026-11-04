<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
use Govern\Config;
use Govern\ImportWorkflow;
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$directory = getenv('IMPORT_DIR') ?: '/var/lib/govern/imports';
if ((!is_dir($directory) && !@mkdir($directory, 0700, true)) || is_link($directory)) {
    fwrite(STDERR, "Import worker storage is unavailable.\n"); exit(1);
}
$handle = @fopen($directory . '/.worker.lock', 'c');
if ($handle === false || !flock($handle, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "An import worker is already active, or its lock is unavailable.\n"); exit(1);
}
$once = in_array('--once', $argv, true); $drain = in_array('--drain', $argv, true);
try {
    $workflow = new ImportWorkflow(Config::fromEnvironment(), $directory);
    $workflow->recoverInterrupted();
    do {
        $worked = $workflow->workOnce();
        if ($once || $drain && !$worked) break;
        if (!$worked) usleep(1000000);
    } while (true);
} catch (\Throwable $exception) {
    fwrite(STDERR, 'Import worker stopped [' . get_class($exception) . "].\n"); exit(1);
} finally { flock($handle, LOCK_UN); fclose($handle); }
