<?php
declare(strict_types=1);

/** Only the explicitly confirmed, disposable MariaDB/PostgreSQL fixture stack. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\RecordExplorer;

$options = getopt('', ['confirm-database:', 'confirm-postgres:']);
$base = Config::fromEnvironment();
if (($options['confirm-database'] ?? '') !== 'bestuursatlas' || $base['name'] !== 'bestuursatlas'
    || ($options['confirm-postgres'] ?? '') !== 'govern_pg' || ($base['postgres']['name'] ?? '') !== 'govern_pg') {
    fwrite(STDERR, "Confirm both isolated fixture databases: --confirm-database=bestuursatlas --confirm-postgres=govern_pg\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, string $code, int $status = 422) use ($assert): void {
    try { $action(); }
    catch (ApiException $error) {
        $assert($error->errorCode === $code && $error->status === $status, 'Stable rejection: ' . $code);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$scope = new ConnectionScope($base);
$pgDatabase = new Database($scope->select('govern_pg', 'postgres', 'public'));
$pg = new RecordExplorer($pgDatabase);
$before = $pgDatabase->reader()->query('SELECT count(*) FROM public.demo_projects')->fetchColumn();
$graph = $pg->explore('demo_organizations', ['id' => '1']);
$nodes = array_column($graph['nodes'], null, 'id');
$assert($graph['scope_key'] === 'postgres:govern_pg:public' && $nodes[$graph['center']]['label'] === 'Northbridge Council', 'The center is a real selected record in the exact scope.');
$assert(count($graph['nodes']) === 10 && count($graph['edges']) === 9 && !$graph['partial'], 'The sample organization has its real bounded neighborhood.');
$assert($nodes[$graph['center']]['key'] instanceof stdClass && $nodes[$graph['center']]['values'] instanceof stdClass, 'Record maps remain JSON objects.');
foreach ($graph['edges'] as $edge) {
    $assert(isset($nodes[$edge['source']], $nodes[$edge['target']]), 'Every edge refers to loaded records.');
    $assert($edge['source_values'] instanceof stdClass && $edge['target_values'] instanceof stdClass, 'Evidence maps remain JSON objects.');
    foreach ($edge['columns'] as $position => $column) {
        $assert($edge['source_values']->$column === $edge['target_values']->{$edge['referenced_columns'][$position]}, 'The sample edge carries exact catalog-backed values.');
    }
}
$again = $pg->explore('demo_organizations', ['id' => '1']);
$assert($again['center'] === $graph['center'] && array_column($again['edges'], 'id') === array_column($graph['edges'], 'id'), 'Record and edge identities are stable across refresh.');
$big = $pg->explore('govern_pg_values', ['id' => '9007199254740993']);
$bigNode = array_column($big['nodes'], null, 'id')[$big['center']];
$assert($bigNode['key']->id === '9007199254740993' && $bigNode['values']->amount === '123456789012345678901234.12', 'BIGINT keys and DECIMAL values remain exact strings.');
$assert($bigNode['values']->payload === '0x00ff41' && $bigNode['values']->missing === null, 'Binary previews and SQL NULL retain their meanings.');
$composite = $pg->explore('govern_pg_parent', ['id' => '11', 'tenant_id' => '7']);
$assert(count($composite['edges']) === 1 && $composite['edges'][0]['columns'] === ['parent_id', 'tenant_id'], 'Composite foreign keys preserve declared pair order.');
$assert(array_keys(get_object_vars(array_column($composite['nodes'], null, 'id')[$composite['center']]['key'])) === ['tenant_id', 'id'], 'INCLUDE payload columns never become PostgreSQL primary-key columns.');
$assert($pg->explore('govern_pg_parent', ['tenant_id' => '7', 'id' => '11'])['center'] === $composite['center'], 'Client key ordering cannot change record identity.');
$view = $pg->explore('demo_project_overview');
$assert($view['nodes'] === [] && $view['center'] === null && $view['omitted'][0]['code'] === 'keyless', 'Keyless views are reported instead of inventing record identities.');
$archive = new RecordExplorer(new Database($scope->select('govern_pg', 'postgres', 'archive')));
$archived = $archive->explore('govern_pg_values', ['id' => '1']);
$assert($archived['scope_key'] === 'postgres:govern_pg:archive' && $archived['nodes'][0]['label'] === 'Archive-only row', 'The same table name reads only the explicitly selected schema.');
$reject(static fn () => $archive->explore('demo_organizations'), 'table_missing', 404);
$reject(static fn () => $pg->explore('demo_organizations', ['id' => '999999']), 'explore_record_missing', 404);
$reject(static fn () => $pg->explore('demo_organizations', ['id' => '1', 'other' => '1']), 'explore_key_invalid');
$reject(static fn () => $pg->explore('govern_pg_parent', ['id' => '11']), 'explore_key_invalid');
$reject(static fn () => $pg->explore('demo_organizations', ['id' => 1]), 'explore_key_invalid');
$reject(static fn () => $pg->explore('demo_organizations', ['id' => '1 OR 1=1']), 'explore_key_invalid');
$reject(static fn () => $pg->explore('demo_organizations', ['id' => '999999999999999999999999999999']), 'explore_key_invalid');
$reject(static fn () => $pg->explore('demo_organizations', ['id' => str_repeat('1', 17000)]), 'explore_key_invalid');
$reject(static fn () => $pg->explore('demo_organizations; DROP TABLE demo_projects'), 'table_missing', 404);
$assert($pgDatabase->reader()->query('SELECT count(*) FROM public.demo_projects')->fetchColumn() === $before, 'Exploration changed no PostgreSQL example records.');

$mariaDatabase = new Database($base);
$maria = new RecordExplorer($mariaDatabase);
$pdo = $mariaDatabase->writer();
$prefix = 'zz_explore_' . bin2hex(random_bytes(5));
$parent = $prefix . '_parent';
$child = $prefix . '_child';
$self = $prefix . '_self';
$unique = $prefix . '_unique';
$keyless = $prefix . '_keyless';
$numeric = $prefix . '_numeric';
$floating = $prefix . '_floating';
$floatingChild = $prefix . '_floating_child';
$longKey = $prefix . '_long_key';
$quote = Database::identifier(...);
try {
    $pdo->exec('CREATE TABLE ' . $quote($parent) . ' (tenant INT NOT NULL, id DECIMAL(30,0) NOT NULL, name VARCHAR(160), details LONGTEXT, PRIMARY KEY(tenant,id), UNIQUE KEY alternate(id,tenant))');
    $pdo->exec('CREATE TABLE ' . $quote($child) . ' (id INT PRIMARY KEY, parent_id DECIMAL(30,0), alternate_parent_id DECIMAL(30,0), tenant INT, name VARCHAR(160), CONSTRAINT ' . $quote($prefix . '_fk_main') . ' FOREIGN KEY(parent_id,tenant) REFERENCES ' . $quote($parent) . '(id,tenant), CONSTRAINT ' . $quote($prefix . '_fk_alt') . ' FOREIGN KEY(alternate_parent_id,tenant) REFERENCES ' . $quote($parent) . '(id,tenant))');
    $insert = $pdo->prepare('INSERT INTO ' . $quote($parent) . ' VALUES (7,9007199254740993,?,?)');
    $insert->execute(['Exact parent', str_repeat('Long preview ', 20000)]);
    $insert = $pdo->prepare('INSERT INTO ' . $quote($child) . ' VALUES (?,9007199254740993,9007199254740993,7,?)');
    for ($i = 1; $i <= 40; $i++) $insert->execute([$i, 'Child ' . $i]);
    $bounded = $maria->explore($parent, ['id' => '9007199254740993', 'tenant' => '7']);
    $assert(count($bounded['nodes']) === 16 && count($bounded['edges']) === 30, 'Two foreign keys between the same records remain distinct and bounded.');
    $codes = array_column($bounded['omitted'], 'code');
    $assert($bounded['partial'] && in_array('neighbor_limit', $codes, true) && in_array('preview_limit', $codes, true), 'Fan-out and shortened previews are explicitly reported.');
    $center = array_column($bounded['nodes'], null, 'id')[$bounded['center']];
    $assert($center['key']->id === '9007199254740993' && $center['truncated'] && strlen($center['values']->details) < 2100, 'Shortened values never replace the exact MariaDB record key.');
    $candidateGraph = $maria->explore($child);
    $assert(count($candidateGraph['candidates']) === 25 && in_array('candidate_limit', array_column($candidateGraph['omitted'], 'code'), true), 'Large root tables report their bounded candidate list.');

    $pdo->exec('CREATE TABLE ' . $quote($self) . ' (id INT PRIMARY KEY, parent_id INT NULL, name VARCHAR(160), CONSTRAINT ' . $quote($prefix . '_fk_self') . ' FOREIGN KEY(parent_id) REFERENCES ' . $quote($self) . '(id))');
    $pdo->exec('INSERT INTO ' . $quote($self) . ' VALUES (1,NULL,"First"),(2,1,"Second"),(3,3,"Self loop")');
    $pdo->exec('UPDATE ' . $quote($self) . ' SET parent_id=2 WHERE id=1');
    $cycle = $maria->explore($self, ['id' => '1']);
    $assert(count($cycle['nodes']) === 2 && count($cycle['edges']) === 2, 'Cycles remain finite while retaining both directed relationships.');
    $loop = $maria->explore($self, ['id' => '3']);
    $assert(count($loop['nodes']) === 1 && count($loop['edges']) === 1 && $loop['edges'][0]['source'] === $loop['edges'][0]['target'], 'A self-loop is represented once.');

    $pdo->exec('CREATE TABLE ' . $quote($unique) . ' (code VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE, name VARCHAR(160))');
    $pdo->exec('INSERT INTO ' . $quote($unique) . ' VALUES ("MiXeD","Unique record")');
    $fallback = $maria->explore($unique, ['code' => 'mixed']);
    $assert($fallback['nodes'][0]['key']->code === 'MiXeD', 'A non-nullable unique key uses the real canonical stored value.');
    $pdo->exec('CREATE TABLE ' . $quote($keyless) . ' (id INT NULL UNIQUE, name VARCHAR(160))');
    $assert($maria->explore($keyless)['nodes'] === [], 'Nullable unique fields do not invent a complete row identity.');
    $pdo->exec('CREATE TABLE ' . $quote($numeric) . ' (`0` INT PRIMARY KEY, name VARCHAR(160))');
    $pdo->exec('INSERT INTO ' . $quote($numeric) . ' VALUES (1,"Numeric column")');
    $numbered = $maria->explore($numeric, ['0' => '1']);
    $assert(str_contains(json_encode($numbered), '"key":{"0":"1"}') && str_contains(json_encode($numbered), '"values":{"0":"1"'), 'Numeric field names remain JSON objects.');

    $pdo->exec('CREATE TABLE ' . $quote($floating) . ' (id DOUBLE PRIMARY KEY, name VARCHAR(160))');
    $pdo->exec('CREATE TABLE ' . $quote($floatingChild) . ' (id INT PRIMARY KEY, parent_id DOUBLE NOT NULL, CONSTRAINT '
        . $quote($prefix . '_fk_float') . ' FOREIGN KEY(parent_id) REFERENCES ' . $quote($floating) . '(id))');
    $pdo->exec('INSERT INTO ' . $quote($floating) . ' VALUES (1.2345678901234567,"First float"),(1.2345678901234569,"Second float")');
    $pdo->exec('INSERT INTO ' . $quote($floatingChild) . ' VALUES (1,1.2345678901234567),(2,1.2345678901234569)');
    $expectedFloats = $pdo->query('SELECT CAST(id AS CHAR) FROM ' . $quote($floating) . ' ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
    $floatCandidates = $maria->explore($floating)['candidates'];
    $assert(count($floatCandidates) === 2 && array_column(array_column($floatCandidates, 'key'), 'id') === $expectedFloats,
        'Distinct DOUBLE keys use the engine serialization instead of rounded PDO conversions.');
    $assert(count(array_unique(array_column($floatCandidates, 'id'))) === 2, 'Nearby DOUBLE primary keys have distinct graph identities.');
    foreach ($floatCandidates as $position => $candidate) {
        $exactGraph = $maria->explore($floating, get_object_vars($candidate['key']));
        $exactNode = array_column($exactGraph['nodes'], null, 'id')[$exactGraph['center']];
        $assert($exactGraph['center'] === $candidate['id'] && $exactNode['key']->id === $expectedFloats[$position],
            'A serialized DOUBLE key recenters the same real record with a stable identity.');
        $assert(count($exactGraph['edges']) === 1 && $exactGraph['edges'][0]['source_values']->parent_id === $expectedFloats[$position]
            && $exactGraph['edges'][0]['target_values']->id === $expectedFloats[$position],
            'DOUBLE foreign-key evidence retains the exact matching stored values.');
        $childGraph = $maria->explore($floatingChild, ['id' => (string) ($position + 1)]);
        $assert($childGraph['edges'][0]['target'] === $candidate['id'], 'Following a DOUBLE foreign key reaches the correct distinct parent.');
    }
    $pdo->exec('CREATE TABLE ' . $quote($longKey) . ' (code VARCHAR(2500) CHARACTER SET ascii NOT NULL UNIQUE, name VARCHAR(160))');
    $longValue = str_repeat('k', 2200);
    $insert = $pdo->prepare('INSERT INTO ' . $quote($longKey) . ' VALUES (?,"Long key")');
    $insert->execute([$longValue]);
    $unsupported = $maria->explore($longKey);
    $assert($unsupported['center'] === null && $unsupported['nodes'] === [] && $unsupported['candidates'] === []
        && in_array('unsupported_key', array_column($unsupported['omitted'], 'code'), true),
        'Stored keys exceeding the HTTP-safe budget are reported without unusable record actions.');
    $reject(static fn () => $maria->explore($longKey, ['code' => $longValue]), 'explore_key_invalid');
    $assert((int) $pdo->query('SELECT COUNT(*) FROM ' . $quote($child))->fetchColumn() === 40, 'Read-only exploration changed no fixture rows.');
} finally {
    foreach ([$longKey, $floatingChild, $floating, $numeric, $keyless, $unique, $child] as $name) $pdo->exec('DROP TABLE IF EXISTS ' . $quote($name));
    $pdo->exec('DROP TABLE IF EXISTS ' . $quote($self));
    $pdo->exec('DROP TABLE IF EXISTS ' . $quote($parent));
}
echo "PASS: $passed read-only record explorer identity, relationship, scope, preview and limit checks.\n";
