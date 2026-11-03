<?php
declare(strict_types=1);

/** Read-only map tests against explicitly prepared, disposable engine fixtures. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\RecordMap;

$options = getopt('', ['engine:', 'confirm-database:']);
$base = Config::fromEnvironment();
$engine = $options['engine'] ?? '';
$config = $engine === 'postgres' ? ($base['postgres'] ?? null) : ($engine === 'mariadb' ? $base : null);
$expected = $engine === 'postgres' ? 'govern_pg' : 'bestuursatlas';
if ($config === null || $config['name'] !== $expected || ($options['confirm-database'] ?? '') !== $expected) {
    fwrite(STDERR, "Select mariadb or postgres and confirm its isolated fixture database.\n"); exit(2);
}
$config = [...$config, 'schema' => $engine === 'postgres' ? 'public' : $expected,
    'user' => 'record_map_nonexistent_writer', 'password' => 'no-writer-is-ever-used'];
$database = new Database($config);
$service = new RecordMap($database, new Catalog($database), $config);
$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $error) { $assert($error->errorCode === $code && $error->status === $status, 'Expected ' . $code); return; }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$relation = static function (array $items, string $constraint, string $direction): array {
    foreach ($items as $item) if ($item['constraint'] === $constraint && $item['direction'] === $direction) return $item;
    throw new RuntimeException('Missing declared relation ' . $constraint . '/' . $direction);
};
$key = ['id' => '9007199254740993'];
$rootInput = ['table' => 'zz_record_map_people', 'key' => $key];
$page = $service->records('zz_record_map_people', 1, 1);
$assert($page['supported'] && count($page['nodes']) === 1 && $page['has_more'] && $page['next_page'] === 2, 'Root choices have bounded, explicit pagination.');
$assert((array) $page['nodes'][0]['key'] === ['id' => '0'], 'Primary-key pagination starts in stable database order.');
$found = $service->records('zz_record_map_people', 1, 25, '%_');
$assert(count($found['nodes']) === 1, 'Literal LIKE wildcards match only the intended source record.');
$root = $found['nodes'][0];
$assert((array) $root['key'] === $key && $root['row']->id === $key['id'], 'Large integer keys remain exact strings in both key and row.');
$assert($root['row']->amount === '123456789012345678901234.12', 'Source previews retain exact decimal values.');
$assert($root['row']->payload === '0x00ff41', 'Binary source values use safe hexadecimal previews.');
$assert($root['row']->notes === '<img src=x onerror="window.mapInjected=1">', 'HTML-like data remains literal source text.');
$assert($service->records('zz_record_map_people', 1, 25, "' OR 1=1 --")['nodes'] === [], 'SQL-looking search content remains a bound value.');
$inspected = $service->explore($rootInput);
$assert($inspected['focus']['id'] === $root['id'] && count($inspected['nodes']) === 1 && $inspected['edges'] === [], 'Inspecting does not invent or automatically crawl relationships.');
$assert($service->explore(['table' => 'zz_record_map_people', 'key' => (object) $key])['focus']['id'] === $root['id'], 'JSON object keys and native callers resolve to the same node.');
$projectLink = $relation($inspected['relations'], 'zz_record_map_project_lead', 'incoming');
$assert($projectLink['supported'] && !$projectLink['external'], 'Incoming declared references are discoverable in the current scope.');
$projects = $service->explore([...$rootInput, 'relation' => $projectLink['id'], 'page_size' => 1]);
$assert(count($projects['edges']) === 1 && count($projects['nodes']) === 2 && $projects['has_more'] && $projects['next_offset'] === 1,
    'Fan-out expansion returns one relation page and its next offset.');
$next = $service->explore([...$rootInput, 'relation' => $projectLink['id'], 'offset' => 1, 'page_size' => 1]);
$assert(count($next['edges']) === 1 && !$next['has_more'] && $next['edges'][0]['id'] !== $projects['edges'][0]['id'], 'Next page reaches a different real neighbour with no fabricated continuation.');
$edge = $projects['edges'][0];
$assert($edge['kind'] === 'foreign_key' && $edge['source_table'] === 'zz_record_map_projects' && $edge['target_table'] === 'zz_record_map_people'
    && $edge['target'] === $root['id'] && (array) $edge['target_key'] === $key, 'Incoming visual edges retain the database FK direction and source keys.');
$assert(str_contains($edge['evidence']['sql'], 'zz_record_map_projects') && !str_contains($edge['evidence']['sql'], $key['id'])
    && in_array($key['id'], (array) $edge['evidence']['params'], true), 'Evidence names actual source SQL and separately bound matching values.');
$assert($edge['evidence']['column_pairs'] === [['source' => 'lead_id', 'target' => 'id']]
    && $edge['source_values']->lead_id === $key['id'] && $edge['target_values']->id === $key['id'],
    'Evidence preserves the declared source and target column pair with exact matching stored values.');
$project = current(array_filter($projects['nodes'], static fn (array $node): bool => $node['table'] === 'zz_record_map_projects'));
$projectKey = (array) $project['key'];
$assert($projectKey === ['tenant_id' => '7', 'id' => '11'], 'Composite key identity follows declared PK order, not another unique index or payload columns.');
$projectInput = ['table' => 'zz_record_map_projects', 'key' => ['id' => '11', 'tenant_id' => '7']];
$projectInfo = $service->explore($projectInput);
$assert($projectInfo['focus']['id'] === $project['id'], 'Different JSON property order cannot split the same record into multiple nodes.');
$taskLink = $relation($projectInfo['relations'], 'zz_record_map_task_project', 'incoming');
$tasks = $service->explore([...$projectInput, 'relation' => $taskLink['id'], 'page_size' => 2]);
$assert(count($tasks['edges']) === 2 && $tasks['has_more'] && $tasks['next_offset'] === 2, 'Composite FK fan-out paginates actual matching records.');
$assert($tasks['edges'][0]['source_columns'] === ['project_id', 'tenant_id'] && $tasks['edges'][0]['target_columns'] === ['id', 'tenant_id'], 'Composite FK ordinality is preserved end to end.');
$tasksLast = $service->explore([...$projectInput, 'relation' => $taskLink['id'], 'offset' => 2, 'page_size' => 2]);
$assert(count($tasksLast['edges']) === 1 && !$tasksLast['has_more'], 'Composite FK pagination reaches exactly three children.');
$taskInfo = $service->explore(['table' => 'zz_record_map_tasks', 'key' => ['id' => '1']]);
$outLink = $relation($taskInfo['relations'], 'zz_record_map_task_project', 'outgoing');
$outgoing = $service->explore(['table' => 'zz_record_map_tasks', 'key' => ['id' => '1'], 'relation' => $outLink['id']]);
$assert(count($outgoing['edges']) === 1 && $outgoing['edges'][0]['target'] === $project['id'], 'Outgoing traversal resolves the same composite-key target.');
$nullLink = $service->explore(['table' => 'zz_record_map_tasks', 'key' => ['id' => '4'], 'relation' => $outLink['id']]);
$assert($nullLink['edges'] === [] && count($nullLink['nodes']) === 1, 'A partially NULL FK never creates a false connection.');
$selfLink = $relation($inspected['relations'], 'zz_record_map_people_manager', 'outgoing');
$self = $service->explore([...$rootInput, 'relation' => $selfLink['id']]);
$assert(count($self['nodes']) === 1 && count($self['edges']) === 1 && $self['edges'][0]['source'] === $self['edges'][0]['target'], 'Self-links do not duplicate their source node.');
$selfAgain = $service->explore([...$rootInput, 'relation' => $selfLink['id']]);
$assert($selfAgain['edges'][0]['id'] === $self['edges'][0]['id'], 'Repeated expansion has stable relationship identity.');
$floatCast = $engine === 'postgres' ? 'TEXT' : 'CHAR';
$floatTable = $database->quoteIdentifier($database->schemaName()) . '.' . $database->quoteIdentifier('zz_record_map_float_parent');
$floatExpected = $database->reader()->query('SELECT CAST(id AS ' . $floatCast . ') FROM ' . $floatTable . ' ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
$floatNodes = $service->records('zz_record_map_float_parent')['nodes'];
$assert(count($floatNodes) === 2 && array_map(static fn (array $node): string => $node['key']->id, $floatNodes) === $floatExpected,
    'Adjacent DOUBLE identities retain the engine serialization rather than rounded PDO conversions.');
$assert(count(array_unique(array_column($floatNodes, 'id'))) === 2, 'Adjacent DOUBLE records have distinct graph identities.');
foreach ($floatNodes as $position => $floatNode) {
    $floatInput = ['table' => 'zz_record_map_float_parent', 'key' => (array) $floatNode['key']];
    $floatInfo = $service->explore($floatInput);
    $assert($floatInfo['focus']['id'] === $floatNode['id'] && $floatInfo['focus']['row']->id === $floatExpected[$position],
        'A serialized DOUBLE key re-reads the same exact record.');
    $floatIncoming = $relation($floatInfo['relations'], 'zz_record_map_float_link', 'incoming');
    $floatLinked = $service->explore([...$floatInput, 'relation' => $floatIncoming['id']]);
    $floatChild = current(array_filter($floatLinked['nodes'], static fn (array $node): bool => $node['table'] === 'zz_record_map_float_child'));
    $assert(count($floatLinked['edges']) === 1 && $floatChild['row']->parent_id === $floatExpected[$position]
        && $floatLinked['edges'][0]['source_values']->parent_id === $floatExpected[$position]
        && $floatLinked['edges'][0]['target_values']->id === $floatExpected[$position]
        && in_array($floatExpected[$position], (array) $floatLinked['edges'][0]['evidence']['params'], true),
        'DOUBLE foreign-key evidence retains the exact matching stored value.');
    $childInput = ['table' => 'zz_record_map_float_child', 'key' => ['id' => (string) ($position + 1)]];
    $childInfo = $service->explore($childInput);
    $floatOutgoing = $relation($childInfo['relations'], 'zz_record_map_float_link', 'outgoing');
    $childLinked = $service->explore([...$childInput, 'relation' => $floatOutgoing['id']]);
    $assert(count($childLinked['edges']) === 1 && $childLinked['edges'][0]['target'] === $floatNode['id'],
        'Following an adjacent DOUBLE foreign key reaches the correct distinct parent.');
}
if ($engine === 'mariadb') {
    // Only the fixture owner writes; the map's connection still has a deliberately
    // unusable writer identity and must re-read its source through the reader.
    $fixtureOwner = (new Database($base))->writer();
    try {
        $fixtureOwner->exec('UPDATE zz_record_map_people SET manager_id=9007199254740994 WHERE id=9007199254740993');
        $changedLink = $service->explore([...$rootInput, 'relation' => $selfLink['id']]);
        $assert(count($changedLink['edges']) === 1 && $changedLink['edges'][0]['id'] !== $self['edges'][0]['id']
            && (array) $changedLink['edges'][0]['target_key'] === ['id' => '9007199254740994'], 'Expansion re-reads a changed FK and returns the current target rather than stale evidence.');
    } finally {
        $fixtureOwner->exec('UPDATE zz_record_map_people SET manager_id=id WHERE id=9007199254740993');
    }
}
$external = $relation($inspected['relations'], 'zz_record_map_people_external', 'outgoing');
$assert($external['external'] && !$external['supported'] && $external['reason_code'] === 'record_map_external_relation', 'Cross-schema relationships are visible as unavailable.');
$reject(static fn () => $service->explore([...$rootInput, 'relation' => $external['id']]), 'record_map_relation_unsupported', 422);
foreach (['zz_record_map_no_identity', 'zz_record_map_people_view', 'zz_record_map_binary_key'] as $unsupported) {
    $result = $service->records($unsupported);
    $assert(!$result['supported'] && $result['nodes'] === [] && $result['reason_code'] === 'record_map_identity_unsupported', 'Unsupported identities are explicit for ' . $unsupported);
}
$odd = $service->records('zz_record_map_odd`table');
$assert(count($odd['nodes']) === 1 && (array) $odd['nodes'][0]['key'] === ['odd`id' => '1'], 'Quoted table and key names are live catalog identifiers.');
$reject(static fn () => $service->records('_govern_zz_record_map_probe'), 'table_missing', 404);
$reject(static fn () => $service->explore([...$rootInput, 'relation' => 'forged; DROP TABLE x']), 'record_map_relation_missing', 404);
foreach ([[], ['table' => 'zz_record_map_people', 'key' => []], [...$rootInput, 'sql' => 'SELECT 1'],
    ['table' => 'zz_record_map_people', 'key' => ['id' => 9007199254740993]],
    ['table' => 'zz_record_map_people', 'key' => ['id' => $key['id'], 'name' => 'Atlas%_']],
    [...$rootInput, 'relation' => $projectLink['id'], 'offset' => -1]] as $input) {
    $reject(static fn () => $service->explore($input), 'record_map_input_invalid', 422);
}
$reject(static fn () => $service->explore(['table' => 'zz_record_map_people', 'key' => ['id' => 'not-a-number']]), 'record_map_record_missing', 404);
$reject(static fn () => $service->explore(['table' => 'zz_record_map_people', 'key' => ['id' => '09007199254740993']]), 'record_map_record_missing', 404);
$reject(static fn () => $service->explore(['table' => 'zz_record_map_people', 'key' => ['id' => '99999999']]), 'record_map_record_missing', 404);
if ($engine === 'postgres') {
    $archiveDb = new Database([...$config, 'schema' => 'archive']);
    $archive = new RecordMap($archiveDb, new Catalog($archiveDb));
    $archiveNode = $archive->explore($rootInput)['focus'];
    $assert($archiveNode['id'] !== $root['id'] && $archiveNode['row']->name === 'Archive-only record', 'Same table and key in another PostgreSQL schema has distinct identity and contents.');
}
$assert($service->records('zz_record_map_people', 1, 50)['nodes'][1]['row']->name === 'Atlas%_', 'Map reads leave source data unchanged.');
echo "PASS: $checks $engine record-map identity, relation, evidence, pagination and read-only checks.\n";
