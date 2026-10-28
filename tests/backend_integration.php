<?php
declare(strict_types=1);

/**
 * Real database checks. Supply the usual environment and explicitly name an
 * isolated test database: php tests/backend_integration.php --confirm-database=...
 * Creates/removes random probe objects and one saved query. Never use real data.
 */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\QueryDesigner;
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
$designer = new QueryDesigner($database);
$queries = new SavedQueries($database, $config);
$pdo = $database->writer();
$name = 'zz_govern_probe_' . bin2hex(random_bytes(6));
$quoted = Database::identifier($name);
$function = Database::identifier($name . '_fn');
$viewName = $name . '_view';
$view = Database::identifier($viewName);
$parentName = $name . '_parent';
$childName = $name . '_child';
$parent = Database::identifier($parentName);
$child = Database::identifier($childName);
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

    // Exercise the visual compiler through real prepared execution and its
    // standalone SQL export. Adjacent values expose accidental float conversion.
    $oddColumn = ':filter_0`name';
    $pdo->exec('ALTER TABLE ' . $quoted . ' ADD large_id BIGINT UNSIGNED NULL, ADD note VARCHAR(80) NULL,
        ADD ' . Database::identifier($oddColumn) . ' VARCHAR(80) NULL');
    $update = $pdo->prepare('UPDATE ' . $quoted . ' SET large_id=?, note=?, ' . Database::identifier($oddColumn) . '=? WHERE id=?');
    $update->execute(['9007199254740993', null, 'marker', 1]);
    $update->execute(['9007199254740992', '', 'other', 2]);
    $insertDesign = $pdo->prepare('INSERT INTO ' . $quoted . ' (label,amount,large_id,note) VALUES (?,?,?,?)');
    $literalText = "wild%_=\\'nü";
    $insertDesign->execute([$literalText, '123456789012345678901234.13', '18446744073709551615', 'filled']);
    $baseDesign = ['table' => $name, 'join' => null,
        'columns' => [['source' => 'base', 'column' => 'id'], ['source' => 'base', 'column' => 'label']],
        'filters' => [], 'match' => 'all', 'order' => [['source' => 'base', 'column' => 'id', 'direction' => 'asc']], 'limit' => 200];
    $filter = static fn (string $column, string $operator, string $value): array => ['source' => 'base', 'column' => $column, 'operator' => $operator, 'value' => $value];
    $runDesign = static function (array $design) use ($designer, $runner): array {
        $built = $designer->compile($design);
        return $runner->execute($built['prepared_sql'], $built['params']);
    };
    $design = $baseDesign;
    $design['filters'] = [$filter('large_id', 'eq', '9007199254740993')];
    $built = $designer->compile($design);
    $result = $runner->execute($built['prepared_sql'], $built['params']);
    $assert($result['rows'] === [['1', 'literal%_value']] && $built['params']['filter_0'] === '9007199254740993', 'Bound BIGINT comparison distinguishes adjacent values above 2^53 without float conversion.');
    $assert($runner->execute($built['sql'])['rows'] === $result['rows'], 'Standalone SQL has the same exact BIGINT semantics as prepared execution.');
    $design['filters'] = [$filter('large_id', 'eq', '18446744073709551615')];
    $assert($runDesign($design)['rows'] === [['3', $literalText]], 'Unsigned BIGINT maximum remains exact.');
    $design['filters'] = [$filter('amount', 'eq', '123456789012345678901234.12')];
    $assert($runDesign($design)['rows'] === [['1', 'literal%_value']], 'Large DECIMAL values with adjacent cents remain distinct.');
    $design['filters'] = [$filter('amount', 'eq', '123456789012345678901234.125')];
    $assert($runDesign($design)['rows'] === [], 'A filter is not rounded to the target column scale.');
    foreach (['contains' => '%_=', 'starts_with' => 'wild%_=', 'ends_with' => "\\'nü"] as $operator => $value) {
        $design['filters'] = [$filter('label', $operator, $value)];
        $built = $designer->compile($design);
        $assert($runner->execute($built['prepared_sql'], $built['params'])['rows'] === [['3', $literalText]]
            && $runner->execute($built['sql'])['rows'] === [['3', $literalText]], 'Literal ' . $operator . ' search agrees in prepared and displayed SQL.');
    }
    $design['filters'] = [$filter('note', 'eq', '')];
    $assert($runDesign($design)['rows'] === [['2', 'nü <tag>']], 'Empty text is distinct from SQL NULL.');
    $design['filters'] = [['source' => 'base', 'column' => 'note', 'operator' => 'is_null']];
    $assert($runDesign($design)['rows'] === [['1', 'literal%_value']], 'NULL filter requires no fabricated value.');
    $design['filters'] = [$filter('label', 'eq', "' OR 1=1 --")];
    $assert($runDesign($design)['rows'] === [], 'SQL-looking filter values stay bound data.');
    $design['filters'] = [$filter('note', 'eq', '  text  ')];
    $assert($designer->compile($design)['params']['filter_0'] === '  text  ', 'Whitespace in a filter value is preserved.');

    $design = $baseDesign;
    $design['columns'] = [['source' => 'base', 'column' => $oddColumn]];
    $design['filters'] = [$filter($oddColumn, 'eq', 'marker')];
    $built = $designer->compile($design);
    $assert($runner->execute($built['prepared_sql'], $built['params'])['rows'] === [['marker']]
        && $runner->execute($built['sql'])['rows'] === [['marker']], 'Placeholder-looking identifiers and embedded backticks survive standalone SQL generation.');

    $design = $baseDesign;
    $design['filters'] = [$filter('id', 'eq', '1'), $filter('note', 'eq', 'filled')];
    $design['match'] = 'any';
    $assert(array_column($runDesign($design)['rows'], 0) === ['1', '3'], 'OR combines filters within one explicit group.');
    $design['match'] = 'all';
    $assert($runDesign($design)['rows'] === [], 'AND preserves every requested filter.');
    $design = $baseDesign;
    $design['order'] = [['source' => 'base', 'column' => 'large_id', 'direction' => 'desc']];
    $design['limit'] = 2;
    $assert(array_column($runDesign($design)['rows'], 0) === ['3', '1'], 'Ordering and bound integer LIMIT apply to real data.');

    $design = $baseDesign;
    $design['join'] = ['foreign_key' => $name . '_parent_fk', 'type' => 'left'];
    $design['columns'] = [['source' => 'base', 'column' => 'id'], ['source' => 'related', 'column' => 'label']];
    $result = $runDesign($design);
    $assert($result['columns'] === ['basis.id', 'gekoppeld.label'] && $result['rows'] === [['1', null], ['2', 'literal%_value'], ['3', null]], 'LEFT self-JOIN preserves unmatched rows and unambiguous source labels.');
    $design['join']['type'] = 'inner';
    $assert($runDesign($design)['rows'] === [['2', 'literal%_value']], 'INNER self-JOIN keeps only matching rows.');
    $design['join']['type'] = 'left';
    $design['filters'] = [['source' => 'related', 'column' => 'label', 'operator' => 'eq', 'value' => 'literal%_value']];
    $assert($runDesign($design)['rows'] === [['2', 'literal%_value']], 'Related-field WHERE filters can remove unmatched LEFT JOIN rows.');

    $pdo->exec('CREATE TABLE ' . $parent . ' (tenant INT NOT NULL, id INT NOT NULL, label VARCHAR(30), PRIMARY KEY(tenant,id)) ENGINE=InnoDB');
    $pdo->exec('CREATE TABLE ' . $child . ' (id INT PRIMARY KEY, tenant INT, parent_id INT,
        CONSTRAINT ' . Database::identifier($name . '_composite_fk') . ' FOREIGN KEY (tenant,parent_id) REFERENCES ' . $parent . ' (tenant,id)) ENGINE=InnoDB');
    $pdo->exec('INSERT INTO ' . $parent . " VALUES (1,7,'wrong tenant'),(2,7,'right tenant')");
    $pdo->exec('INSERT INTO ' . $child . ' VALUES (1,2,7)');
    $compositeDesign = $baseDesign;
    $compositeDesign['table'] = $childName;
    $compositeDesign['join'] = ['foreign_key' => $name . '_composite_fk', 'type' => 'inner'];
    $compositeDesign['columns'] = [['source' => 'base', 'column' => 'id'], ['source' => 'related', 'column' => 'label']];
    $assert($runDesign($compositeDesign)['rows'] === [['1', 'right tenant']], 'A composite foreign key joins every part, preventing cross-tenant false matches.');

    foreach ([
        'unexpected key' => ['raw_sql' => 'SELECT 1'],
        'non-list columns' => ['columns' => ['source' => 'base', 'column' => 'id']],
        'no selected columns' => ['columns' => []],
        'duplicate selection' => ['columns' => [$baseDesign['columns'][0], $baseDesign['columns'][0]]],
        'missing related source' => ['columns' => [['source' => 'related', 'column' => 'id']]],
        'missing column' => ['columns' => [['source' => 'base', 'column' => 'does_not_exist']]],
        'unknown foreign key' => ['join' => ['foreign_key' => 'unknown', 'type' => 'left']],
        'wrong join type' => ['join' => ['foreign_key' => $name . '_parent_fk', 'type' => 'cross']],
        'unknown filter field' => ['filters' => [$filter('id', 'eq', '1') + ['raw' => 'OR 1=1']]],
        'numeric JSON value' => ['filters' => [['source' => 'base', 'column' => 'large_id', 'operator' => 'eq', 'value' => 42]]],
        'NULL with a value' => ['filters' => [$filter('note', 'is_null', '')]],
        'missing value' => ['filters' => [['source' => 'base', 'column' => 'note', 'operator' => 'eq']]],
        'unknown operator' => ['filters' => [$filter('note', 'raw SQL', 'x')]],
        'LIKE on a number' => ['filters' => [$filter('id', 'contains', '1')]],
        'invalid numeric text' => ['filters' => [$filter('large_id', 'eq', '12 OR 1=1')]],
        'inexact numeric magnitude' => ['filters' => [$filter('large_id', 'eq', str_repeat('9', 66))]],
        'NUL value' => ['filters' => [$filter('note', 'eq', "x\0y")]],
        'invalid UTF-8 value' => ['filters' => [$filter('note', 'eq', "\xff")]],
        'non-list filters' => ['filters' => ['x' => $filter('note', 'eq', '')]],
        'invalid match' => ['match' => 'xor'],
        'duplicate sort' => ['order' => [$baseDesign['order'][0], $baseDesign['order'][0]]],
        'invalid direction' => ['order' => [['source' => 'base', 'column' => 'id', 'direction' => 'desc; DROP TABLE x']]],
        'string limit' => ['limit' => '20'],
        'floating limit' => ['limit' => 1.5],
        'empty limit' => ['limit' => 0],
        'oversized limit' => ['limit' => 201],
    ] as $label => $change) {
        $invalid = array_replace($baseDesign, $change);
        $reject(static fn () => $designer->compile($invalid), [422], 'Designer rejects ' . $label . ' instead of silently changing the question.');
    }
    $stale = $baseDesign;
    $stale['columns'] = [['source' => 'base', 'column' => $oddColumn]];
    $designer->compile($stale);
    $pdo->exec('ALTER TABLE ' . $quoted . ' DROP COLUMN ' . Database::identifier($oddColumn));
    $reject(static fn () => $designer->compile($stale), [422], 'Designer revalidates the live schema after a column is removed.');

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

    // A normal view must remain usable by the compiler and both execution
    // forms. Keep its compiled query for the changed-definition check below.
    $pdo->exec('CREATE VIEW ' . $view . ' AS SELECT id AS touched FROM ' . $quoted . ' WHERE id=1');
    $viewDesign = $baseDesign;
    $viewDesign['table'] = $viewName;
    $viewDesign['columns'] = [['source' => 'base', 'column' => 'touched']];
    $viewDesign['order'] = [];
    $readableCompiled = $designer->compile($viewDesign);
    $assert($runner->execute($readableCompiled['prepared_sql'], $readableCompiled['params'])['rows'] === [['1']], 'A normal readable view compiles and executes with bound parameters.');
    $assert($runner->execute($readableCompiled['sql'])['rows'] === [['1']], 'The normal view also works through the standalone SQL export.');
    $pdo->exec('DROP VIEW ' . $view);

    // SELECT grants alone do not stop writes performed by a DEFINER view's
    // stored function. Prove the fixture writes, then verify both read paths.
    $pdo->exec('CREATE FUNCTION ' . $function . '() RETURNS INT MODIFIES SQL DATA SQL SECURITY DEFINER
        BEGIN UPDATE ' . $quoted . ' SET hits=hits+1 WHERE id=1; RETURN 1; END');
    $pdo->exec('CREATE SQL SECURITY DEFINER VIEW ' . $view . ' AS SELECT ' . $function . '() AS touched');
    $pdo->query('SELECT * FROM ' . $view)->fetchAll();
    $assert((int) $pdo->query('SELECT hits FROM ' . $quoted . ' WHERE id=1')->fetchColumn() > 0, 'DEFINER fixture really performs a write under its owner.');
    $pdo->exec('UPDATE ' . $quoted . ' SET hits=0 WHERE id=1');
    // Some MariaDB versions cannot expose columns for a view whose constant
    // expression invokes a writing function under READ ONLY metadata access.
    // Reject exactly that unavailable-metadata case; do not hide other errors.
    $unsafeColumns = $catalog->columns($viewName);
    if ($unsafeColumns === []) {
        try {
            $designer->compile($viewDesign);
            throw new RuntimeException('An uninspectable view was compiled without usable column metadata.');
        } catch (ApiException $exception) {
            $assert($exception->status === 422 && str_contains($exception->getMessage(), 'geen leesbare kolommen'), 'Unavailable view metadata is explicitly rejected before a question is compiled.');
        }
    } else {
        $assert(in_array('touched', array_column($unsafeColumns, 'name'), true), 'Inspectable writing-view metadata exposes the expected column.');
        $compiledView = $designer->compile($viewDesign);
        $reject(static fn () => $runner->execute($compiledView['prepared_sql'], $compiledView['params']), [403], 'An inspectable writing view compiles but cannot write during execution.');
    }
    $assert($pdo->query('SELECT hits FROM ' . $quoted . ' WHERE id=1')->fetchColumn() === '0', 'Metadata inspection and compilation cannot write through a DEFINER view.');
    $reject(static fn () => $runner->execute($readableCompiled['prepared_sql'], $readableCompiled['params']), [403], 'A genuinely compiled parameter query stays READ ONLY after its view definition changes.');
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
    $pdo->exec('DROP TABLE IF EXISTS ' . $child);
    $pdo->exec('DROP TABLE IF EXISTS ' . $parent);
    $pdo->exec('DROP TABLE IF EXISTS ' . $quoted);
}
