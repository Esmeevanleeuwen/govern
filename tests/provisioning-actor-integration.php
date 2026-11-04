<?php
declare(strict_types=1);
/** Actual target-bound login checks in generated databases of a disposable stack. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\ApiException;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\DatabaseProvisioner;
$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (getenv('GOVERN_PROVISIONING_DISPOSABLE') !== '1' || ($options['confirm-database'] ?? '') !== $base['name']
    || ($base['postgres'] ?? null) === null) exit(2);
$checks = 0;
$assert = static function (bool $ok, string $label) use (&$checks): void { if (!$ok) throw new RuntimeException($label); ++$checks; };
$denied = static function (callable $fn, ?string $code = null) use ($assert): void {
    try { $fn(); }
    catch (ApiException $e) { $assert($code === null || $e->errorCode === $code, 'Expected fixed provisioner rejection.'); return; }
    catch (PDOException) { $assert($code === null, 'Database rejects the out-of-scope operation.'); return; }
    throw new RuntimeException('An out-of-scope operation unexpectedly succeeded.');
};
$assert(getenv('DB_ROOT_PASSWORD') === false && getenv('PG_ADMIN_PASSWORD') === false, 'The caller has no administrator credentials.');
$service = new DatabaseProvisioner();
foreach (['mariadb', 'postgres'] as $engine) {
    $name = 'govern_actor_' . bin2hex(random_bytes(6));
    $request = ['name' => $name, 'engine' => $engine, 'operation_id' => bin2hex(random_bytes(16))];
    $receipt = $service->create($request);
    $assert($receipt['created'] && $receipt['database'] === $name, 'A genuinely fresh target is created.');
    $assert($service->create($request) === $receipt, 'The same operation replays the same private credential receipt.');
    $config = (new ConnectionScope($base))->selectRequest($receipt['scope_key']);
    $db = new Database($config);
    $actor = $config;
    if ($engine === 'postgres') { $actor['sql_user'] = $receipt['import_user']; $actor['sql_password'] = $receipt['import_password']; }
    else { $actor['user'] = $receipt['import_user']; $actor['password'] = $receipt['import_password']; }
    $pdo = (new Database($actor))->scriptConnection();
    $table = $db->quoteIdentifier($db->schemaName()) . '.' . $db->quoteIdentifier('scope_probe');
    $pdo->exec('CREATE TABLE ' . $table . ' (id INTEGER PRIMARY KEY, label TEXT NULL)');
    $pdo->prepare('INSERT INTO ' . $table . ' VALUES (?,?)')->execute([1, 'source fixture']);
    $assert($db->reader()->query('SELECT label FROM ' . $table . ' WHERE id=1')->fetchColumn() === 'source fixture', 'Normal readers see import-owned objects.');
    $db->writer()->prepare('UPDATE ' . $table . ' SET label=? WHERE id=1')->execute(['writer fixture']);
    $assert($db->reader()->query('SELECT label FROM ' . $table . ' WHERE id=1')->fetchColumn() === 'writer fixture', 'Normal writers maintain imported rows.');
    $db->scriptConnection()->exec('ALTER TABLE ' . $table . ' ADD COLUMN maintained TEXT NULL');
    $assert(true, 'Normal SQL can maintain the imported structure.');
    $denied(static fn () => $db->reader()->exec('UPDATE ' . $table . " SET label='must fail' WHERE id=1"));
    $other = [...$actor, 'name' => $engine === 'postgres' ? $base['postgres']['name'] : $base['name']];
    $denied(static fn () => (new Database($other))->scriptConnection());
    if ($engine === 'postgres') {
        $role = $pdo->query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user')->fetch(PDO::FETCH_ASSOC);
        $assert(count($role) === 5 && !array_filter($role, static fn ($v): bool => in_array($v, [true, 't', '1', 1], true)), 'The importer has no elevated PostgreSQL flags.');
        $denied(static fn () => $pdo->exec('SET ROLE ' . $db->quoteIdentifier($config['sql_user'])));
    } else {
        $grants = implode("\n", $pdo->query('SHOW GRANTS')->fetchAll(PDO::FETCH_COLUMN));
        $assert(!str_contains($grants, 'WITH GRANT OPTION') && !preg_match('/GRANT\s+(?!USAGE\b)[^\n]+\sON\s+\*\.\*/i', $grants), 'No global privileges or grant option reach the importer.');
        $sibling = str_replace('_', 'x', $name);
        $denied(static fn () => $pdo->exec('CREATE DATABASE ' . $db->quoteIdentifier($sibling)));
    }
    $denied(static fn () => $service->create([...$request, 'operation_id' => bin2hex(random_bytes(16))]), 'database_exists');
    $assert($db->reader()->query('SELECT label FROM ' . $table . ' WHERE id=1')->fetchColumn() === 'writer fixture', 'A name collision preserves the existing database and rows.');
}
// Only generated databases were changed; cleanup never obtains administrator credentials.
echo 'Target-bound importer logins: ' . $checks . " checks passed.\n";
