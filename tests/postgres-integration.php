<?php
declare(strict_types=1);

/** Read-only PostgreSQL integration after postgres-fixture.sql, in govern_pg only. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;

$options = getopt('', ['confirm-database:']);
$base = Config::fromEnvironment();
$config = $base['postgres'] ?? null;
if ($config === null || $config['name'] !== 'govern_pg' || ($options['confirm-database'] ?? '') !== $config['name']) {
    fwrite(STDERR, "Enable PostgreSQL and explicitly confirm the isolated govern_pg database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$config['schema'] = 'public';
$database = new Database($config);
$catalog = new Catalog($database);
$tables = array_column($catalog->tables(), null, 'name');
$assert(isset($tables['govern_pg_values'], $tables['govern_pg_values_view']), 'Discover PostgreSQL tables and views.');
$assert(!isset($tables['_govern_pg_internal_probe']), 'Internal workbench tables are omitted.');
$assert($tables['govern_pg_values_view']['type'] === 'view', 'Views have the existing normalized view type.');
$assert($tables['govern_pg_values']['comment'] === 'PostgreSQL integration values', 'Live table comments are retained.');

$schema = $catalog->schema();
$byName = array_column($schema['tables'], null, 'name');
$assert($schema['database'] === 'public', 'Diagram uses the selected schema as its relationship namespace.');
$assert(array_keys($byName) === array_keys($tables), 'Bootstrap and diagram use the same live catalog.');
$fk = $byName['govern_pg_child']['foreign_keys'][0];
$assert($fk['columns'] === ['parent_id', 'tenant_id'] && $fk['referenced_columns'] === ['id', 'tenant_id'], 'Composite FK pairs retain their declared order.');
$assert($fk['referenced_schema'] === 'public' && $fk['referenced_table'] === 'govern_pg_parent', 'Foreign keys identify their actual schema and target.');
$parentColumns = array_column($byName['govern_pg_parent']['columns'], null, 'name');
$assert($parentColumns['tenant_id']['primary'] && $parentColumns['id']['primary'] && !$parentColumns['label']['primary'],
    'Primary-key INCLUDE payload columns are not mistaken for key columns.');

$structure = $catalog->structure('govern_pg_values');
$columns = array_column($structure['columns'], null, 'name');
$assert($columns['id']['primary'] && !$columns['id']['nullable'], 'Primary-key and nullability flags are normalized.');
$assert($columns['display_label']['generated'] && !$columns['label']['generated'], 'Generated columns remain distinct.');
$assert($columns['amount']['comment'] === 'Exact decimal amount', 'Live column comments are retained.');
$assert($structure['columns'] === $byName['govern_pg_values']['columns'], 'Structure and diagram share the same column metadata.');
$assert($structure['create_sql'] === '', 'Unsupported full-table DDL is not fabricated.');

$page = $catalog->browse('govern_pg_values', 1, 1, '');
$assert($page['total'] === 2 && count($page['rows']) === 1, 'Pagination counts real rows.');
$row = $page['rows'][0];
$assert($row['id'] === '9007199254740993', 'BIGINT above JavaScript safe range stays exact text.');
$assert($row['amount'] === '123456789012345678901234.12', 'Decimal precision survives the complete preview.');
$assert($row['missing'] === null, 'SQL NULL stays distinct from empty text.');
$assert(json_decode($row['metadata'], true, 16, JSON_THROW_ON_ERROR)['nested']['value'] === 3, 'JSONB remains valid structured content.');
$assert($row['payload'] === '0x00ff41', 'Binary data uses the existing hexadecimal preview.');
$assert($row['display_label'] === 'literal%_value!', 'Generated values are read from PostgreSQL.');
$assert($page['key_columns'] === ['id'] && $page['row_keys'] === [['id' => '9007199254740993']], 'Browse advertises exact safe row identities.');
$assert($catalog->browse('govern_pg_values', 2, 1, '')['rows'][0]['missing'] === '', 'Pagination keeps empty text distinct from NULL.');
$assert($catalog->browse('govern_pg_values', 1, 25, '%_')['total'] === 1, 'Search treats wildcard characters literally.');
$assert($catalog->browse('govern_pg_values', 1, 25, "' OR 1=1 --")['total'] === 0, 'SQL-looking search text remains a bound value.');
try {
    $catalog->structure('govern_pg_values"; DROP TABLE x; --');
    throw new RuntimeException('Fabricated identifier was accepted.');
} catch (ApiException $exception) {
    $assert($exception->status === 404, 'Uncatalogued identifiers are rejected.');
}

$archive = new Catalog(new Database([...$config, 'schema' => 'archive']));
$assert($archive->browse('govern_pg_values', 1, 25, '')['rows'][0]['label'] === 'Archive-only row', 'Same-named tables in separate schemas stay isolated.');
$assert($catalog->browse('govern_pg_values', 1, 25, '')['rows'][0]['label'] === 'literal%_value', 'Returning to public does not reuse the archive relation.');
$scope = new ConnectionScope($base);
$publicConfig = $scope->select('govern_pg', 'postgres', 'public');
$archiveConfig = $scope->select('govern_pg', 'postgres', 'archive');
$assert($publicConfig['schema'] === 'public' && $archiveConfig['schema'] === 'archive', 'Each request resolves its own connection and schema.');
$assert(ConnectionScope::scopeKey('postgres', 'govern_pg', 'public') !== ConnectionScope::scopeKey('postgres', 'govern_pg', 'archive'), 'Frontend cache identities distinguish schemas.');
$assert($database->writer()->query('SELECT current_user')->fetchColumn() === $config['user'], 'Row writes use the separately configured writer.');
$sqlSession = $database->scriptConnection();
$assert($sqlSession->query('SELECT current_user')->fetchColumn() === $config['sql_user'], 'Free SQL uses its separate scoped login.');
$assert($sqlSession !== $database->scriptConnection(), 'Every free SQL run receives a fresh session.');

// A fresh direct connection proves the role's grants independently of the
// adapter's read-only session setting and of the API's capability checks.
$reader = new PDO('pgsql:host=' . $config['host'] . ';port=' . $config['port'] . ';dbname=' . $config['name'],
    $config['read_user'], $config['read_password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$reader->exec('SET default_transaction_read_only = off');
foreach ([
    "INSERT INTO public.govern_pg_values (id,label,amount,metadata) VALUES (3,'must fail',0,'{}')",
    'CREATE TABLE public.govern_pg_forbidden (id integer)',
    'CREATE TEMP TABLE govern_pg_forbidden_temp (id integer)',
] as $sql) {
    try {
        $reader->exec($sql);
        throw new RuntimeException('The PostgreSQL reader role was permitted to write.');
    } catch (PDOException $exception) {
        $assert($exception->getCode() === '42501', 'Reader permissions deny data, schema and temporary-table writes.');
    }
}
echo "PASS: $passed PostgreSQL catalog, exact-value, namespace and reader-permission checks.\n";
