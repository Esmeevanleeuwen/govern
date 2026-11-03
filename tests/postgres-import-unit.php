<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\PostgresNativeImport;

$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$sql = "CREATE TABLE example (amount numeric(30,2));";
$assert(PostgresNativeImport::validate($sql) === $sql, 'SQL remains exact.');
foreach (['', "  \n", "SELECT \0 1", "\xFF", str_repeat('a', PostgresNativeImport::MAX_BYTES + 1)] as $bad) {
    try { PostgresNativeImport::validate($bad); throw new RuntimeException('Invalid import accepted.'); }
    catch (ApiException $exception) {
        $assert(in_array($exception->errorCode, ['import_sql_required', 'import_sql_invalid', 'postgres_import_sql_too_large'], true),
            'Invalid text and size fail before a database connection.');
    }
}
$state = ['public' => ['schema_version' => 'one', 'row_counts' => (object) ['table' => 3]],
    'archive' => ['schema_version' => 'two', 'row_counts' => (object) ['table' => 1]]];
$token = PostgresNativeImport::token('postgres:govern_pg:public', $sql, $state);
$assert(strlen($token) === 64, 'Preflight token is bounded.');
$assert($token !== PostgresNativeImport::token('postgres:govern_pg:archive', $sql, $state), 'Selected schema is bound.');
$assert($token !== PostgresNativeImport::token('postgres:other:public', $sql, $state), 'Database is bound.');
$assert($token !== PostgresNativeImport::token('postgres:govern_pg:public', $sql . ' SELECT 1;', $state), 'Complete file content is bound.');
$changed = $state;
$changed['archive']['schema_version'] = 'changed';
$assert($token !== PostgresNativeImport::token('postgres:govern_pg:public', $sql, $changed), 'Other configured schemas are protected too.');
echo "PASS: $checks PostgreSQL import validation and scoped preflight checks.\n";
