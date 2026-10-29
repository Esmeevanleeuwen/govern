<?php
declare(strict_types=1);

/** Real provisioning in one explicitly confirmed disposable Govern stack. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\DatabaseProvisioner;
use Govern\DatabaseScope;

$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($options['confirm-database'] ?? '') !== $base['name']) {
    fwrite(STDERR, "Use a disposable stack and confirm its exact default database with --confirm-database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$rejected = static function (callable $action, string $message) use ($assert): void {
    try { $action(); }
    catch (PDOException) { $assert(true, $message); return; }
    throw new RuntimeException($message);
};
$invalid = static function (array $input) use ($assert): void {
    try { (new DatabaseProvisioner())->prepare($input); }
    catch (ApiException $exception) {
        $assert($exception->status === 422 && $exception->errorCode === 'database_create_invalid', 'Invalid names and extra privileges are rejected.');
        return;
    }
    throw new RuntimeException('Invalid preparation input was accepted.');
};
$suffix = bin2hex(random_bytes(6));
$name = 'govern_ui_import_' . $suffix;
$other = $name . '_second';
// An unescaped grant on the first underscore would also match this spelling.
$sibling = 'governxui_import_' . $suffix;
$owned = [$name, $other, $sibling];
$cleanup = (new Database($base))->writer();

try {
    $assert(getenv('DB_ROOT_PASSWORD') === false, 'The app service and its tests have no database root password.');
    foreach (['', 'mysql', 'MYSQL', 'information_schema', 'performance_schema', 'sys', 'a-b', 'a/b', 'a;b', ' a ',
        'a`b', "bad\0name", str_repeat('a', 65), str_repeat('_', 33)] as $bad) $invalid(['name' => $bad]);
    $invalid(['name' => $name, 'root_password' => 'forged']);
    $invalid(['name' => $name, 'sql' => 'GRANT ALL ON *.* TO govern']);
    $invalid(['name' => $name, 'action' => 'drop_database']);
    $service = new DatabaseProvisioner();
    $assert($service->isAvailable(), 'The isolated manager socket is available.');
    $prepared = $service->prepare(['name' => $name]);
    $assert($prepared['database'] === $name && $prepared['created'] === true, 'A new requested database is prepared without an .env change.');
    $config = (new DatabaseScope($base))->select($name);
    $database = new Database($config);
    $writer = $database->writer();
    $reader = $database->reader();
    $assert((new Catalog($database))->tables() === [], 'The new database starts empty, without example data.');
    $assert($writer->query('SELECT DATABASE()')->fetchColumn() === $name, 'The ordinary writer can select the new database.');
    $assert($reader->query('SELECT DATABASE()')->fetchColumn() === $name, 'The ordinary read-only account can select the same database.');
    $writer->exec('CREATE TABLE import_probe (id INT PRIMARY KEY, label VARCHAR(80)) ENGINE=InnoDB');
    $statement = $writer->prepare('INSERT INTO import_probe VALUES (?,?)');
    $statement->execute([1, 'preserve existing import']);
    $assert($reader->query('SELECT label FROM import_probe WHERE id=1')->fetchColumn() === 'preserve existing import',
        'New schema and data are readable through the ordinary read account.');
    $rejected(static fn () => $reader->exec("INSERT INTO import_probe VALUES (2,'must fail')"), 'The reader cannot write after provisioning.');
    $rejected(static fn () => $reader->exec('CREATE TABLE reader_must_not_create (id INT)'), 'The reader cannot create tables after provisioning.');
    $rejected(static fn () => $writer->exec('CREATE DATABASE ' . Database::identifier($sibling)),
        'Literal underscores in the grant never enable a similarly named schema.');
    $rejected(static fn () => $writer->exec('GRANT ALL ON ' . Database::identifier($name) . ".* TO 'govern_reader'@'%'"),
        'The writer is not granted authority to widen the reader account.');
    $writerGrants = implode("\n", $writer->query('SHOW GRANTS')->fetchAll(PDO::FETCH_COLUMN));
    $readerGrants = implode("\n", $reader->query('SHOW GRANTS')->fetchAll(PDO::FETCH_COLUMN));
    $assert(!preg_match('/GRANT\s+(?!USAGE\b)[^\n]+\sON\s+\*\.\*/i', $writerGrants), 'Provisioning never gives the writer global privileges.');
    $assert(!preg_match('/GRANT\s+(?!USAGE\b)[^\n]+\sON\s+\*\.\*/i', $readerGrants), 'Provisioning never gives the reader global privileges.');
    $again = $service->prepare(['name' => $name]);
    $assert($again['database'] === $name && $again['created'] === false, 'Preparing an existing name is idempotent.');
    $assert($writer->query('SELECT label FROM import_probe WHERE id=1')->fetchColumn() === 'preserve existing import',
        'Adding an existing database retains its tables and rows.');
    $assert(in_array('import_probe', array_column((new Catalog(new Database((new DatabaseScope($base))->select($name))))->tables(), 'name'), true),
        'A fresh catalog discovers the prepared database without cached configuration.');
    $createdOther = $service->prepare(['name' => $other]);
    $assert($createdOther['created'] === true, 'A second database can be added independently.');
    $available = array_column((new DatabaseScope($base))->databases(), null, 'name');
    $assert(isset($available[$base['name']], $available[$name], $available[$other])
        && $available[$name]['available'] && $available[$other]['available'], 'All prepared databases appear in a fresh picker source.');
    $assert(!isset($available[$sibling]) && !isset($available['mysql']), 'Unprepared and system schemas remain outside the workspace list.');
    $assert((new Catalog(new Database((new DatabaseScope($base))->select($other))))->tables() === [],
        'Preparing another database does not copy the first database.');
    $assert((new Database($base))->writer()->query('SELECT DATABASE()')->fetchColumn() === $base['name'],
        'Provisioning does not change the default connection target.');
    echo 'Database provisioning integration: ' . $passed . " checks passed.\n";
} finally {
    // Only generated fixture names are removed; this never deletes the confirmed base.
    foreach ($owned as $fixture) {
        if (!str_ends_with($fixture, $suffix) && !str_ends_with($fixture, $suffix . '_second')) continue;
        try { $cleanup->exec('DROP DATABASE IF EXISTS ' . Database::identifier($fixture)); }
        catch (PDOException) { /* A correctly denied sibling was never created. */ }
    }
}
