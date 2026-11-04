<?php
declare(strict_types=1);

/** Create/read/write checks on confirmed disposable fixtures, using existing app roles only. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\MaintenanceLock;
use Govern\PostgresRowEditor;
use Govern\RowEditor;
use Govern\TableDefinition;

$options = getopt('', ['engine:', 'confirm-database:']);
$engine = $options['engine'] ?? '';
$base = Config::fromEnvironment();
$expected = $engine === 'postgres' ? 'govern_pg' : 'bestuursatlas';
$configured = $engine === 'postgres' ? ($base['postgres'] ?? null) : ($engine === 'mariadb' ? $base : null);
if ($configured === null || $configured['name'] !== $expected || ($options['confirm-database'] ?? '') !== $expected
    || ($engine === 'postgres' && array_diff(['public', 'archive'], $configured['schemas']) !== [])) {
    fwrite(STDERR, "Select mariadb or postgres and confirm its isolated fixture database; PostgreSQL needs public and archive.\n");
    exit(2);
}
$scope = new ConnectionScope($base);
$config = $scope->select($expected, $engine, $engine === 'postgres' ? 'public' : $expected);
$database = new Database($config);
$service = new TableDefinition($database);
$sql = $database->scriptConnection();
$qualified = static fn (string $name, ?string $schema = null): string => $database->quoteIdentifier($schema ?? $database->schemaName())
    . '.' . $database->quoteIdentifier($name);
$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $error) {
        $assert($error->errorCode === $code && $error->status === $status,
            'Expected ' . $code . ', received ' . $error->errorCode . ' (' . $error->status . ').');
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$column = static fn (string $name, string $type = 'text'): array => ['name' => $name, 'type' => $type,
    'nullable' => true, 'primary' => false, 'generated' => false, 'default' => ['mode' => 'none']];
$literal = static fn (string $name, string $type, mixed $value): array => [...$column($name, $type),
    'nullable' => false, 'default' => ['mode' => 'literal', 'value' => $value]];
$name = 'zz_govern_definition_' . bin2hex(random_bytes(6));
$raceName = $name . '_race';
$staleName = $name . '_changed';
$scopeName = $name . '_scope';
$viewName = $name . '_view';
$cleanup = [];
$create = static function (TableDefinition $builder, array $preview) use ($config): array {
    $lock = new MaintenanceLock($config['maintenance_dir']);
    return $builder->create(['definition' => $preview['definition'], 'definition_token' => $preview['definition_token']]);
};
$textDefault = "O'Reilly \\ path; café\nsecond line";
$definition = ['name' => $name, 'columns' => [
    [...$column('id', 'whole'), 'nullable' => false, 'primary' => true, 'generated' => true],
    $literal('label', 'text', $textDefault), $literal('whole_value', 'whole', '9007199254740993'),
    [...$literal('amount', 'decimal', '123456789012345678901234.12'), 'precision' => 30, 'scale' => 2],
    $literal('enabled', 'boolean', false), $literal('day', 'date', '2028-02-29'),
    $literal('observed_at', 'datetime', '2028-02-29T23:59:59.123456'),
    [...$column('optional'), 'default' => ['mode' => 'null']],
    $literal('empty_text', 'text', ''), $column('without_default'),
]];

try {
    $preview = $service->preview($definition);
    $assert(!in_array($name, array_column((new Catalog($database))->tables(), 'name'), true), 'Review has no table-creation side effect.');
    $assert($preview['engine'] === $engine && $preview['database'] === $expected
        && $preview['schema'] === $database->schemaName(), 'Review carries the exact requested engine, database and schema.');
    $assert($preview['definition_token'] === $service->preview($definition)['definition_token'], 'An unchanged definition has a stable review token.');

    // Register cleanup before mutation, so a lost readback never leaves a probe.
    $cleanup[] = 'DROP TABLE IF EXISTS ' . $qualified($name);
    $ordinaryRead = new MaintenanceLock($config['maintenance_dir']);
    try { $created = $create($service, $preview); }
    finally { unset($ordinaryRead); }
    $assert($created['created'] && $created['verified'] && $created['scope_key'] === $config['scope_key'],
        'One confirmed CREATE succeeds beside an ordinary shared read and verifies in the same scope.');
    $assert($created['sql'] === $preview['sql'] && !isset($created['definition_token']), 'The executed statement is exactly the reviewed SQL.');
    $catalog = new Catalog($database);
    $assert(in_array($name, array_column($catalog->tables(), 'name'), true), 'The existing reader catalog discovers the table created by the SQL role.');
    $fields = array_column($catalog->structure($name)['columns'], null, 'name');
    $assert(count($fields) === count($definition['columns']) && $fields['id']['primary'] && $fields['id']['auto_increment']
        && !$fields['id']['nullable'] && !$fields['label']['nullable'] && $fields['optional']['nullable'],
        'Real metadata preserves columns, identity, the primary key and NULL rules.');
    $assert(str_contains(strtolower($fields['whole_value']['type']), 'bigint')
        && preg_match('/(?:decimal|numeric)\(30,\s*2\)/i', $fields['amount']['type']) === 1,
        'The catalog reports actual exact integer and decimal engine types.');

    $editor = $engine === 'postgres' ? new PostgresRowEditor($database) : new RowEditor($database);
    $descriptor = $editor->describe($name);
    $assert($descriptor['can_insert'] && $descriptor['editable'] && $descriptor['key_columns'] === ['id'],
        'The existing row editor immediately supports the new table.');
    $inserted = $editor->insert(['table' => $name, 'values' => []]);
    $assert($inserted['affected_rows'] === 1 && $inserted['key'] === ['id' => '1'],
        'The ordinary row writer can insert all defaults and obtain the exact generated key.');
    $row = $editor->describe($name, $inserted['key'])['row'];
    $assert($row['label'] === $textDefault && $row['whole_value'] === '9007199254740993'
        && $row['amount'] === '123456789012345678901234.12', 'Text escapes and numbers beyond floating-point precision survive real DDL/default evaluation.');
    $assert($row['enabled'] === ($engine === 'postgres' ? 'false' : '0') && $row['day'] === '2028-02-29'
        && $row['observed_at'] === '2028-02-29 23:59:59.123456', 'Boolean, leap-day and microsecond datetime defaults retain their engine values.');
    $assert($row['optional'] === null && $row['without_default'] === null && $row['empty_text'] === '',
        'SQL NULL, no explicit default and empty text are preserved.');
    $page = (new Catalog($database))->browse($name, 1, 25, '');
    $assert($page['total'] === 1 && $page['row_keys'] === [['id' => '1']]
        && $page['rows'][0]['amount'] === $row['amount'], 'Browse exposes the created row and its exact key without numeric rounding.');

    $reject(static fn () => $service->preview($definition), 'table_definition_exists', 409);
    $reject(static fn () => $create($service, $preview), 'table_definition_exists', 409);
    $assert($editor->describe($name, $inserted['key'])['row'] === $row, 'Repeated create attempts leave an existing table and row untouched.');

    $stale = ['name' => $staleName, 'columns' => [$column('label')]];
    $stalePreview = $service->preview($stale);
    $changed = [...$stalePreview, 'definition' => [...$stale, 'columns' => [$column('different_column')]]];
    $reject(static fn () => $create($service, $changed), 'table_definition_changed', 409);
    $assert(!in_array($staleName, array_column((new Catalog($database))->tables(), 'name'), true), 'A stale definition token performs no DDL.');

    $raced = ['name' => $raceName, 'columns' => [$column('label')]];
    $racePreview = $service->preview($raced);
    $cleanup[] = 'DROP TABLE IF EXISTS ' . $qualified($raceName);
    $sql->exec('CREATE TABLE ' . $qualified($raceName) . ' (marker INTEGER NOT NULL)');
    $sql->exec('INSERT INTO ' . $qualified($raceName) . ' (marker) VALUES (73)');
    $reject(static fn () => $create($service, $racePreview), 'table_definition_exists', 409);
    $assert($database->reader()->query('SELECT marker FROM ' . $qualified($raceName))->fetchColumn() === '73',
        'A name occupied after review is neither adopted nor overwritten.');

    $cleanup[] = 'DROP VIEW IF EXISTS ' . $qualified($viewName);
    $sql->exec('CREATE VIEW ' . $qualified($viewName) . ' AS SELECT 1 AS marker');
    $reject(static fn () => $service->preview(['name' => $viewName, 'columns' => [$column('label')]]), 'table_definition_exists', 409);

    if ($engine === 'postgres') {
        $archiveDb = new Database($scope->select($expected, 'postgres', 'archive'));
        $archive = new TableDefinition($archiveDb);
        $scoped = ['name' => $scopeName, 'columns' => [$column('label')]];
        $publicPreview = $service->preview($scoped);
        $reject(static fn () => $create($archive, $publicPreview), 'table_definition_changed', 409);
        $assert(!in_array($scopeName, array_column((new Catalog($archiveDb))->tables(), 'name'), true), 'Cross-schema review reuse creates nothing in archive.');
        $cleanup[] = 'DROP TABLE IF EXISTS ' . $qualified($name, 'archive');
        $archivePreview = $archive->preview(['name' => $name, 'columns' => [$column('archive_only')]]);
        $archiveCreated = $create($archive, $archivePreview);
        $assert($archiveCreated['created'] && $archiveCreated['scope_key'] === 'postgres:govern_pg:archive',
            'The same table name can be created deliberately in a different configured schema.');
        $assert(array_column((new Catalog($archiveDb))->columns($name), 'name') === ['archive_only']
            && array_column((new Catalog($database))->columns($name), 'name') === array_column($definition['columns'], 'name'),
            'Same-name tables retain their separate schemas and definitions.');

        foreach (['sequence', 'type', 'materialized'] as $kind) {
            $occupiedName = $name . '_' . $kind;
            $qualifiedName = $qualified($occupiedName);
            $cleanup[] = match ($kind) {
                'sequence' => 'DROP SEQUENCE IF EXISTS ' . $qualifiedName,
                'type' => 'DROP TYPE IF EXISTS ' . $qualifiedName,
                'materialized' => 'DROP MATERIALIZED VIEW IF EXISTS ' . $qualifiedName,
            };
            $sql->exec(match ($kind) {
                'sequence' => 'CREATE SEQUENCE ' . $qualifiedName,
                'type' => 'CREATE TYPE ' . $qualifiedName . " AS ENUM ('sample')",
                'materialized' => 'CREATE MATERIALIZED VIEW ' . $qualifiedName . ' AS SELECT 1 AS marker',
            });
            $reject(static fn () => $service->preview(['name' => $occupiedName, 'columns' => [$column('label')]]), 'table_definition_exists', 409);
        }
    }
} finally {
    $cleanupErrors = [];
    foreach (array_reverse($cleanup) as $statement) {
        try { $sql->exec($statement); }
        catch (Throwable $error) { $cleanupErrors[] = $error; }
    }
    if ($cleanupErrors !== []) throw new RuntimeException('Could not remove every isolated table-definition probe.', 0, $cleanupErrors[0]);
}
echo "PASS: $checks $engine native table creation, exact defaults, existing row editor, conflicts and scope checks.\n";
