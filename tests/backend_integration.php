<?php
declare(strict_types=1);

/**
 * Real database checks. Supply the usual environment and explicitly name an
 * isolated test database: php tests/backend_integration.php --confirm-database=...
 * Creates/removes one random probe table and one saved query. Never use real data.
 */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\QueryRunner;
use Govern\SavedQueries;

$config = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($options['confirm-database'] ?? '') !== $config['name']) {
    fwrite(STDERR, "Run only in an isolated test database; confirm its exact name with --confirm-database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $passed++;
};
$reject = static function (callable $action, array $statuses, string $message) use ($assert): void {
    try {
        $action();
    } catch (ApiException $exception) {
        $assert(in_array($exception->status, $statuses, true), $message . ' (status ' . $exception->status . ')');
        return;
    }
    throw new RuntimeException($message);
};
$database = new Database($config);
$catalog = new Catalog($database);
$runner = new QueryRunner($database);
$queries = new SavedQueries($database, $config);
$pdo = $database->writer();
$name = 'zz_govern_probe_' . bin2hex(random_bytes(6));
$quoted = Database::identifier($name);
$function = Database::identifier($name . '_fn');
$viewName = $name . '_view';
$view = Database::identifier($viewName);
$id = null;

try {
    $beforeNames = array_column($catalog->tables(), 'name');
    $pdo->exec('CREATE TABLE ' . $quoted . ' (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        parent_id INT NULL,
        label VARCHAR(80) NOT NULL,
        amount DECIMAL(30,2) NOT NULL DEFAULT 0,
        hits INT NOT NULL DEFAULT 0,
        display_label VARCHAR(100) GENERATED ALWAYS AS (CONCAT(label,\'!\')) STORED,
        CONSTRAINT ' . Database::identifier($name . '_parent_fk') . ' FOREIGN KEY (parent_id) REFERENCES ' . $quoted . '(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $insert = $pdo->prepare('INSERT INTO ' . $quoted . ' (parent_id,label,amount) VALUES (?,?,?)');
    $insert->execute([null, 'literal%_value', '123456789012345678901234.12']);
    $insert->execute([1, 'nü <tag>', '2.00']);

    $afterNames = array_column($catalog->tables(), 'name');
    $assert(!in_array($name, $beforeNames, true) && in_array($name, $afterNames, true), 'New table discovered without app configuration.');
    $structure = $catalog->structure($name);
    $fields = array_column($structure['columns'], null, 'name');
    $assert($fields['display_label']['generated'] && !$fields['id']['generated'] && $fields['id']['auto_increment'], 'Real generated-column metadata is distinguished from defaults.');
    $assert(count($structure['foreign_keys']) === 1 && $structure['foreign_keys'][0]['referenced_table'] === $name, 'Live foreign-key metadata discovered.');
    $assert(str_contains($structure['create_sql'], 'CREATE TABLE'), 'Actual create statement returned.');

    $page = $catalog->browse($name, 1, 1, '');
    $assert($page['total'] === 2 && count($page['rows']) === 1 && $page['rows'][0]['id'] === '1', 'Pagination uses stable primary-key order.');
    $assert($page['rows'][0]['amount'] === '123456789012345678901234.12', 'Decimal precision retained from PDO to response.');
    $search = $catalog->browse($name, 1, 25, '%_');
    $assert($search['total'] === 1 && $search['rows'][0]['label'] === 'literal%_value', 'LIKE wildcards are searched literally.');
    $assert($catalog->browse($name, 1, 25, "' OR 1=1 --")['total'] === 0, 'Search values remain bound data.');
    $reject(static fn () => $catalog->structure($name . '`; DROP TABLE x; --'), [404], 'Uncatalogued identifiers rejected.');

    $result = $runner->execute('SELECT 1 AS item, 2 AS item, NULL AS missing');
    $assert($result['columns'] === ['item', 'item', 'missing'] && $result['rows'][0] === ['1', '2', null], 'Duplicate labels and NULL retained.');
    $result = $runner->execute("SELECT '; DROP TABLE example' AS literal, ':named' AS another");
    $assert($result['rows'][0] === ['; DROP TABLE example', ':named'], 'SQL-like text inside literals is not rejected by a blacklist.');
    $result = $runner->execute('WITH items AS (SELECT 7 AS n) SELECT n FROM items');
    $assert($result['rows'] === [['7']], 'Read-only CTE accepted.');
    $result = $runner->execute("SELECT UNHEX('FF00') AS binary_value");
    $assert($result['rows'][0][0] === '0xff00', 'Binary value is a recognizable hexadecimal preview.');
    $result = $runner->execute("SELECT REPEAT('é',40000) AS large_value");
    $assert($result['truncated'] && str_contains($result['rows'][0][0], '[weergave ingekort]'), 'Large cell preview visibly bounded.');
    $result = $runner->execute('WITH RECURSIVE n AS (SELECT 1 AS x UNION ALL SELECT x+1 FROM n WHERE x<500) SELECT x FROM n LIMIT 500');
    $assert(count($result['rows']) === 200 && $result['truncated'], 'Result row limit enforced even with explicit larger LIMIT.');

    $reject(static fn () => $runner->execute('UPDATE ' . $quoted . " SET label='changed'"), [403], 'Reader cannot update data.');
    $reject(static fn () => $runner->execute('DROP TABLE ' . $quoted), [403], 'Reader cannot drop tables.');
    $reject(static fn () => $runner->execute('SELECT * FROM mysql.user'), [403], 'Reader cannot read privileged system tables.');
    $reject(static fn () => $runner->execute('SELECT 1; DROP TABLE ' . $quoted), [422], 'Multiple SQL statements rejected by native driver.');
    $assert($pdo->query('SELECT COUNT(*) FROM ' . $quoted . " WHERE label='changed'")->fetchColumn() === '0', 'Rejected mutations made no changes.');
    $start = microtime(true);
    $reject(static fn () => $runner->execute('SELECT SLEEP(8)'), [408], 'Long-running SQL is interrupted.');
    $assert(microtime(true) - $start < 7.5, 'Timeout returned before full sleep completed.');
    $assert($runner->execute('SELECT 1 AS recovered')['rows'] === [['1']], 'Next query works after interruption.');

    // SELECT grants alone do not stop writes performed by a DEFINER view's
    // stored function. Prove the fixture writes, then verify both read paths.
    $pdo->exec('CREATE FUNCTION ' . $function . '() RETURNS INT MODIFIES SQL DATA SQL SECURITY DEFINER
        BEGIN UPDATE ' . $quoted . ' SET hits=hits+1 WHERE id=1; RETURN 1; END');
    $pdo->exec('CREATE SQL SECURITY DEFINER VIEW ' . $view . ' AS SELECT ' . $function . '() AS touched');
    $pdo->query('SELECT * FROM ' . $view)->fetchAll();
    $assert((int) $pdo->query('SELECT hits FROM ' . $quoted . ' WHERE id=1')->fetchColumn() > 0, 'DEFINER fixture really performs a write under its owner.');
    $pdo->exec('UPDATE ' . $quoted . ' SET hits=0 WHERE id=1');
    $reject(static fn () => $runner->execute('SELECT * FROM ' . $view), [403], 'Research query cannot write indirectly through a DEFINER view.');
    try {
        $catalog->browse($viewName, 1, 25, '');
        throw new RuntimeException('Catalog browse allowed a writing DEFINER function.');
    } catch (PDOException $exception) {
        $assert((int) ($exception->errorInfo[1] ?? 0) === 1792, 'Catalog browsing also uses a READ ONLY transaction.');
    }
    $assert($pdo->query('SELECT hits FROM ' . $quoted . ' WHERE id=1')->fetchColumn() === '0', 'Rejected indirect writes made no change.');
    try {
        $runner->execute('SET SESSION TRANSACTION READ WRITE');
    } catch (ApiException $exception) {
        if (!in_array($exception->status, [403, 422], true)) {
            throw $exception;
        }
    }
    $reject(static fn () => $runner->execute('SELECT * FROM ' . $view), [403], 'Changing session settings cannot unprotect the next request.');
    $assert($pdo->query('SELECT hits FROM ' . $quoted . ' WHERE id=1')->fetchColumn() === '0', 'Session-changing query leaves the data unchanged.');

    $saved = $queries->save(['name' => 'Integration ' . $name, 'sql' => 'SELECT 42 AS answer', 'notes' => 'nü']);
    $id = $saved['id'];
    $assert($saved['sql'] === 'SELECT 42 AS answer' && $saved['notes'] === 'nü', 'Saved-query round trip.');
    $saved = $queries->save(['id' => $id, 'name' => 'Integration ' . $name, 'sql' => 'SELECT 43 AS answer', 'notes' => 'updated']);
    $assert($saved['sql'] === 'SELECT 43 AS answer', 'Saved-query update uses the same record.');
    $assert(in_array($id, array_column($queries->list(), 'id'), true), 'Saved query visible through read-only account.');
    $queries->delete($id);
    $assert(!in_array($id, array_column($queries->list(), 'id'), true), 'Saved-query deletion works.');
    $id = null;
    $assert(!in_array('_govern_queries', array_column($catalog->tables(), 'name'), true), 'Internal support table excluded from ordinary catalog.');
    echo "Backend integration checks: $passed passed.\n";
} finally {
    if ($id !== null) {
        $cleanup = $pdo->prepare('DELETE FROM `_govern_queries` WHERE id=?');
        $cleanup->execute([$id]);
    }
    $pdo->exec('DROP VIEW IF EXISTS ' . $view);
    $pdo->exec('DROP FUNCTION IF EXISTS ' . $function);
    $pdo->exec('DROP TABLE IF EXISTS ' . $quoted);
}
