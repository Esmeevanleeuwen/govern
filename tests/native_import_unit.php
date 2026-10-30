<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\NativeImport;

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

check(NativeImport::validate("CREATE TABLE example (id INT);") === "CREATE TABLE example (id INT);", 'Valid SQL rejected');
foreach (['', "  \n", "SELECT \0 1", "\xFF", str_repeat('a', NativeImport::MAX_BYTES + 1)] as $bad) {
    try {
        NativeImport::validate($bad);
        throw new RuntimeException('Invalid SQL accepted');
    } catch (ApiException $e) {
        check(in_array($e->errorCode, ['import_sql_required','import_sql_invalid','import_sql_too_large'], true), 'Wrong error');
    }
}
$before = ['tables' => ['one'], 'views' => [], 'row_counts' => ['one' => 3]];
$token = NativeImport::token('research', 'SELECT 1;', $before);
check(strlen($token) === 64, 'Invalid token length');
check($token !== NativeImport::token('other', 'SELECT 1;', $before), 'Database not bound');
check($token !== NativeImport::token('research', 'SELECT 2;', $before), 'File not bound');
check($token !== NativeImport::token('research', 'SELECT 1;', ['tables' => ['two']]), 'Inspection not bound');
echo "Native import validation passed\n";
