<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Config;
use Govern\Database;
use Govern\Http;
use Govern\MaintenanceLock;
use Govern\Preview;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $passed++;
};
$reject = static function (callable $action, int $status, string $message) use ($assert): void {
    try {
        $action();
    } catch (ApiException $exception) {
        $assert($exception->status === $status, $message);
        return;
    }
    throw new RuntimeException($message);
};

// SQL identifiers are escaped as identifiers, never mistaken for SQL fragments.
$assert(Database::identifier('source`name; SELECT 1') === '`source``name; SELECT 1`', 'Quoted identifiers preserve embedded delimiters.');
$reject(static fn () => Database::identifier("table\0name"), 400, 'NUL in an identifier is rejected.');

// Input with an unexpected shape must not be coerced into usable SQL or IDs.
$reject(static fn () => Http::text(['sql' => ['SELECT 1']], 'sql'), 400, 'Array query payload rejected.');
$reject(static fn () => Http::text(['sql' => "SELECT \0"], 'sql'), 400, 'NUL query payload rejected.');
$reject(static fn () => Http::text(['sql' => "\xff"], 'sql'), 400, 'Invalid UTF-8 query payload rejected.');
$reject(static fn () => Http::integer(['page' => '1; DROP TABLE x'], 'page', 1), 400, 'SQL cannot be smuggled into pagination.');
$assert(Http::text(['sql' => "  SELECT 'nü'  "], 'sql') === "SELECT 'nü'", 'Unicode SQL retained.');

// Large and binary cells render as explicit previews without invalid JSON bytes.
$shortened = false;
$row = Preview::row(['text' => str_repeat('é', Preview::CELL_BYTES)], $shortened);
$assert($shortened && preg_match('//u', $row['text']) === 1, 'Large UTF-8 previews stay valid and marked.');
$assert(str_contains($row['text'], '[weergave ingekort]'), 'Truncated cell is visibly labelled.');
$shortened = false;
$row = Preview::row(['binary' => "\xff\0", 'nullable' => null, 'decimal' => '1234567890123456789.12'], $shortened);
$assert($row['binary'] === '0xff00' && $row['nullable'] === null, 'Binary and NULL values remain distinguishable.');
$assert($row['decimal'] === '1234567890123456789.12', 'Large decimal strings retain precision.');

// No regular request may start while a restore owns the maintenance lock.
$directory = sys_get_temp_dir() . '/govern-unit-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
$owner = fopen($directory . '/.maintenance.lock', 'c');
try {
    flock($owner, LOCK_EX);
    $reject(static fn () => new MaintenanceLock($directory), 423, 'Exclusive restore lock blocks ordinary requests.');
    flock($owner, LOCK_UN);
    $reader = new MaintenanceLock($directory);
    $assert(!flock($owner, LOCK_EX | LOCK_NB), 'An active ordinary request prevents restore from starting.');
    unset($reader);
    $assert(flock($owner, LOCK_EX | LOCK_NB), 'Ordinary request releases maintenance lock.');
    flock($owner, LOCK_UN);
} finally {
    fclose($owner);
    unlink($directory . '/.maintenance.lock');
    rmdir($directory);
}

$oldPort = getenv('DB_PORT');
try {
    putenv('DB_PORT=3306;dbname=other');
    $reject(static fn () => Config::fromEnvironment(), 503, 'Invalid port cannot modify connection settings.');
} finally {
    $oldPort === false ? putenv('DB_PORT') : putenv('DB_PORT=' . $oldPort);
}

echo "Backend unit checks: $passed passed.\n";
