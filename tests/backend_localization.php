<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\BackupInputException;
use Govern\BackupService;
use Govern\Database;
use Govern\Http;
use Govern\Messages;
use Govern\Preview;
use Govern\QueryDesigner;

$passed = 0;
$assert = static function (bool $condition, string $label) use (&$passed): void {
    if (!$condition) {
        throw new RuntimeException($label);
    }
    $passed++;
};

$assert(Messages::language('') === 'nl', 'Missing language preserves Dutch.');
$assert(Messages::language('fr-FR, de;q=0.9') === 'nl', 'Unsupported languages preserve Dutch.');
$assert(Messages::language('en-GB,en;q=0.9,nl;q=0.8') === 'en', 'English regional tags are supported.');
$assert(Messages::language('en;q=0.5,nl-NL;q=0.9') === 'nl', 'The highest-quality supported locale wins.');
$assert(Messages::language('en;q=0') === 'nl', 'A disabled language is not selected.');
$assert(Messages::language('EN-us') === 'en', 'Language matching is case insensitive.');
$assert(Messages::language('en;q=2, fr') === 'nl', 'Invalid language quality does not select English.');

// Both catalogs use the same placeholders, including messages not exercised by DB-free tests.
$catalog = (new ReflectionClass(Messages::class))->getConstant('TEXT');
foreach ($catalog as $key => $translations) {
    preg_match_all('/\{([a-z_]+)\}/', $translations['nl'], $nl);
    preg_match_all('/\{([a-z_]+)\}/', $translations['en'], $en);
    sort($nl[1]);
    sort($en[1]);
    $assert($translations['nl'] !== '' && $translations['en'] !== '' && $nl[1] === $en[1], 'Catalog parity for ' . $key);
}

$originalLanguage = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? null;
$directory = sys_get_temp_dir() . '/govern-localization-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
try {
    unset($_SERVER['HTTP_ACCEPT_LANGUAGE']);
    $legacy = ApiException::fromCode('sql_required');
    $assert($legacy->getMessage() === 'Vul eerst een SQL-vraag in.', 'The original Dutch error string is unchanged.');
    $assert($legacy->status === 400 && $legacy->errorCode === 'sql_required', 'Status and stable code are independent of language.');

    $_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en';
    $english = ApiException::fromCode('sql_required');
    $assert($english->getMessage() === 'Enter a SQL query first.', 'Application errors are English when requested.');
    try {
        Http::text(['sql' => ['SELECT 1']], 'sql');
        throw new RuntimeException('Invalid input was accepted.');
    } catch (ApiException $error) {
        $assert($error->getMessage() === 'Enter valid text for sql.' && $error->errorCode === 'text_invalid', 'Validation uses stable keys and safe field parameters.');
        $payload = Http::envelope($error->getMessage(), false, $error->errorCode, $error->errorParams);
        $assert($payload['error'] === $error->getMessage() && $payload['error_code'] === 'text_invalid', 'Old error string remains alongside the code.');
        $assert($payload['error_i18n']['nl'] === 'Vul een geldige tekst in voor sql.' && $payload['error_i18n']['en'] === $error->getMessage(), 'Cached errors can switch languages without retrying.');
        $assert(json_decode(json_encode($payload), true)['error_params'] === ['field' => 'sql'], 'Parameters are JSON objects with safe field names.');
    }
    $emptyParameters = Http::envelope($english->getMessage(), false, $english->errorCode);
    $assert(str_contains(json_encode($emptyParameters), '"error_params":{}'), 'Empty error parameters use an object.');
    $assert(Http::envelope(['value' => 'nü'], true) === ['ok' => true, 'data' => ['value' => 'nü']], 'The success envelope is unchanged.');

    try {
        (new QueryDesigner(new Database([])))->compile([]);
        throw new RuntimeException('Invalid query design was accepted.');
    } catch (ApiException $error) {
        $assert($error->errorCode === 'design_fields_invalid' && str_contains($error->getMessage(), 'the query'), 'Nested query labels are translated at the source.');
        $translations = Messages::translations($error->errorCode, $error->errorParams);
        $assert(str_contains($translations['nl'], 'de query') && str_contains($translations['en'], 'the query'), 'Nested labels remain translatable in cached errors.');
    }

    $diagnostic = "Unknown column `nü` near '{limit}'";
    $sqlError = ApiException::fromCode('sql_error', 422, ['detail' => $diagnostic]);
    $assert($sqlError->getMessage() === 'SQL message: ' . $diagnostic, 'Raw SQL diagnostics and embedded placeholder text are preserved.');
    $assert(Messages::translations('explain_source', ['table' => 'naam`{limit}']) === [
        'nl' => 'Je leest de tabel of het overzicht naam`{limit}.',
        'en' => 'You are reading the table or view naam`{limit}.',
    ], 'Identifiers are inserted exactly without translating or interpreting them.');

    $shortened = false;
    $row = Preview::row(['text' => str_repeat('é', Preview::CELL_BYTES), 'decimal' => '1234567890123456789.12'], $shortened);
    $assert($shortened && str_contains($row['text'], '[preview shortened]') && $row['decimal'] === '1234567890123456789.12', 'English preview markers preserve exact numeric data.');

    $backup = new BackupService(['backup_dir' => $directory, 'name' => 'govern_test']);
    try {
        $backup->download('../not-a-restore-point');
        throw new RuntimeException('Invalid restore ID was accepted.');
    } catch (BackupInputException $error) {
        $assert($error instanceof InvalidArgumentException && $error->errorCode === 'snapshot_id_invalid', 'Backup validation preserves its existing exception family.');
        $assert($error->getMessage() === 'Invalid restore point.', 'Backup validation is localized.');
    }
    $assert(Messages::text('database_client_failed', ['exit' => 2, 'database_code' => 1045], 'nl') === 'De databaseclient is gestopt met foutcode 2. Databasefout 1045. Er is geen succesvolle bewerking gemeld.', 'Operational codes retain the original Dutch feedback.');
    $assert(Messages::text('database_client_failed', ['exit' => 2, 'database_code' => 1045], 'en') === 'The database client stopped with exit code 2. Database error 1045. No successful operation was reported.', 'Operational codes translate without exposing client stderr.');
    $assert(Messages::text('database_client_failed', ['exit' => 1], 'en') === 'The database client stopped with exit code 1. No successful operation was reported.', 'Missing operational details do not leave placeholders.');
} finally {
    if ($originalLanguage === null) {
        unset($_SERVER['HTTP_ACCEPT_LANGUAGE']);
    } else {
        $_SERVER['HTTP_ACCEPT_LANGUAGE'] = $originalLanguage;
    }
    foreach (scandir($directory) ?: [] as $file) {
        if ($file !== '.' && $file !== '..') {
            unlink($directory . '/' . $file);
        }
    }
    rmdir($directory);
}

echo "Backend localization checks: $passed passed.\n";
