<?php
declare(strict_types=1);

/** Configured PostgreSQL selection and capability guards without any DB connection. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;

$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (callable $action, string $code, int $status = 403) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === $status, 'Stable rejection: ' . $code);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$values = ['PG_ENABLED' => '1', 'PG_HOST' => 'never-connect.invalid', 'PG_PORT' => '5432',
    'PG_DATABASE' => 'scope_unit_pg', 'PG_SCHEMAS' => 'public,archive,0,public',
    'PG_USER' => 'scope_unit_writer', 'PG_PASSWORD' => 'writer-unit-test-value',
    'PG_SQL_USER' => 'scope_unit_sql', 'PG_SQL_PASSWORD' => 'sql-unit-test-value',
    'PG_RESTORE_USER' => 'scope_unit_restore', 'PG_TOOLS_SOCKET' => '/unit-only/postgres.sock',
    'PG_DATABASE_REGISTRY' => '/unit-only/postgres-databases.json',
    'PG_READ_USER' => 'scope_unit_reader', 'PG_READ_PASSWORD' => 'only-a-unit-test-value'];
$original = [];
foreach ($values as $key => $value) { $original[$key] = getenv($key); putenv($key . '=' . $value); }
try {
    $base = Config::fromEnvironment();
    $assert($base['engine'] === 'mariadb', 'Opting into PostgreSQL preserves the default MariaDB engine.');
    $assert($base['postgres']['schemas'] === ['public', 'archive', '0'], 'Configured schemas deduplicate without dropping the literal zero name.');
    $assert($base['postgres']['user'] === 'scope_unit_writer' && $base['postgres']['password'] === 'writer-unit-test-value', 'PostgreSQL writer credentials are explicitly configured and distinct from the reader.');
    $scope = new ConnectionScope($base);
    $public = $scope->select('scope_unit_pg', 'postgres', 'public');
    $archive = $scope->select('scope_unit_pg', 'postgres', 'archive');
    $assert($public['schema'] === 'public' && $archive['schema'] === 'archive', 'Selection stays request-local.');
    $assert($scope->select('scope_unit_pg', 'postgres')['schema'] === 'public', 'Omitted schema selects the configured default.');
    $assert($scope->select('scope_unit_pg', 'postgres', '0')['schema'] === '0', 'The zero schema remains selectable.');
    $legacy = $scope->selectRequest('postgres:scope_unit_pg:archive');
    $assert($legacy['engine'] === 'postgres' && $legacy['name'] === 'scope_unit_pg' && $legacy['schema'] === 'archive',
        'Cached API modules can send the complete workspace key as their database.');
    $assert($scope->selectRequest('', 'postgres')['scope_key'] === $public['scope_key'], 'Explicit connection defaults remain unchanged.');
    $assert($scope->selectRequest('scope_unit_pg', 'postgres', 'archive')['scope_key'] === $archive['scope_key'],
        'Current explicit requests keep the same selected scope.');
    $assert($scope->selectRequest('postgres:scope_unit_pg:%30')['schema'] === '0', 'Packed identifiers are URL-decoded.');
    $quotedScope = new ConnectionScope([...$base, 'postgres' => [...$base['postgres'], 'schemas' => ['a:b %'], 'schema' => 'a:b %']]);
    $assert($quotedScope->selectRequest(ConnectionScope::scopeKey('postgres', 'scope_unit_pg', 'a:b %'))['schema'] === 'a:b %',
        'Encoded delimiters and spaces keep the exact configured schema.');
    foreach (['postgres:other:public', 'postgres:scope_unit_pg:missing', 'postgres:scope_unit_pg:pg_catalog',
        'postgres:scope_unit_pg', 'postgres::public', 'postgres:scope_unit_pg:', 'postgres:scope_unit_pg:archive:extra',
        'postgres:scope_unit_pg:%ZZ', 'postgres:scope_unit_pg:%00', 'postgres:scope_unit_pg:%0a'] as $key) {
        $reject(static fn () => $scope->selectRequest($key), 'database_not_available');
    }
    foreach (['mariadb', 'postgres', ''] as $connection) {
        $reject(static fn () => $scope->selectRequest('postgres:scope_unit_pg:public', $connection), 'database_not_available');
    }
    foreach (['public', 'archive', ''] as $schema) {
        $reject(static fn () => $scope->selectRequest('postgres:scope_unit_pg:public', null, $schema), 'database_not_available');
    }
    ConnectionScope::requireAction($legacy, 'query');
    $assert($public['scope_key'] !== $archive['scope_key'] && $public['backup_dir'] !== $archive['backup_dir'], 'Schemas have distinct cache and storage identities.');
    $assert(ConnectionScope::scopeKey('mariadb', 'existing') === 'existing', 'Existing MariaDB scope keys remain compatible.');
    $assert(ConnectionScope::scopeKey('postgres', 'data:set', 'a b') === 'postgres:data%3Aset:a%20b', 'Workspace keys encode identifier delimiters.');
    $capabilities = ConnectionScope::capabilities($public);
    foreach (['browse', 'structure', 'schema', 'explore', 'write', 'query', 'snapshots', 'import'] as $capability) $assert($capabilities[$capability] === true, 'Supported capability: ' . $capability);
    foreach (['query_builder', 'saved_queries', 'phpmyadmin', 'create_database', 'ai', 'context'] as $capability) {
        $assert($capabilities[$capability] === false, 'Unsupported PostgreSQL capability: ' . $capability);
    }
    $assert(!in_array(false, ConnectionScope::capabilities($base), true), 'MariaDB retains all existing capabilities.');
    $assert(!ConnectionScope::capabilities([...$public, 'password' => ''])['write'], 'Missing writer credentials retain read-only controls without reusing reader credentials.');
    $assert(!ConnectionScope::capabilities([...$public, 'sql_password' => ''])['query'], 'SQL credentials are separate from the reader and row writer.');
    $assert(!ConnectionScope::capabilities([...$public, 'tools_socket' => ''])['snapshots'], 'Missing private helper configuration is explicit.');
    $engines = $scope->engines(true);
    $assert($engines === [
        ['id' => 'mariadb', 'label' => 'MariaDB', 'configured' => true,
            'capabilities' => ['create_database' => true, 'import' => true, 'query' => true, 'phpmyadmin' => true]],
        ['id' => 'postgres', 'label' => 'PostgreSQL', 'configured' => true,
            'capabilities' => ['create_database' => false, 'import' => true, 'query' => true, 'phpmyadmin' => false]],
    ], 'Engine metadata exposes only fixed labels and configured tools, never connection credentials.');
    $scope->select('scope_unit_pg', 'postgres', 'archive');
    $assert($scope->engines(true) === $engines, 'Selecting PostgreSQL does not hide the global MariaDB creation path.');
    $withoutManager = $scope->engines(false);
    $assert(!$withoutManager[0]['capabilities']['create_database'] && $withoutManager[0]['capabilities']['import'],
        'An unavailable creation broker does not hide ordinary MariaDB import.');
    $assert($withoutManager[1] === $engines[1], 'MariaDB broker availability does not change PostgreSQL tools.');
    foreach (['sql_user', 'sql_password'] as $missing) {
        $readOnly = new ConnectionScope([...$base, 'postgres' => [...$base['postgres'], $missing => '']]);
        $readOnlyEngine = $readOnly->engines(true)[1];
        $assert($readOnlyEngine['configured'] && !$readOnlyEngine['capabilities']['import']
            && !$readOnlyEngine['capabilities']['query'] && !$readOnlyEngine['capabilities']['create_database'],
            'Configured PostgreSQL without ' . $missing . ' advertises no SQL or import tools.');
    }
    foreach (['bootstrap', 'schema', 'structure', 'browse', 'explore', 'row-editor', 'insert-row', 'update-row', 'delete-row',
        'query', 'snapshots', 'create-snapshot', 'restore-snapshot', 'download-snapshot', 'import-inspection',
        'native-import-preview', 'native-import-execute', 'dataset-preview', 'dataset-import', 'prepare-database'] as $action) {
        ConnectionScope::requireAction($public, $action);
        $assert(true, 'Supported action allowed without connecting: ' . $action);
    }
    foreach (['build-query', 'queries', 'save-query', 'delete-query',
        'ai-status', 'ai-context', 'ai-chat', 'context', 'unknown-action'] as $action) {
        $reject(static fn () => ConnectionScope::requireAction($public, $action), 'postgres_read_only');
        ConnectionScope::requireAction($base, $action);
    }
    foreach ([['other', 'postgres', 'public'], ['scope_unit_pg', 'other', 'public'], ['scope_unit_pg', 'postgres', 'pg_catalog'],
        ['scope_unit_pg', 'postgres', 'missing']] as [$name, $connection, $schema]) {
        $reject(static fn () => $scope->select($name, $connection, $schema), 'database_not_available');
    }
    $reject(static fn () => (new Database([...$public, 'password' => '']))->writer(), 'credentials_missing', 503);
    $database = new Database($public);
    $reject(static fn () => (new Database([...$public, 'sql_password' => '']))->scriptConnection(), 'credentials_missing', 503);
    $assert($database->quoteIdentifier('a"b') === '"a""b"', 'PostgreSQL identifier quoting retains embedded quotes.');
    putenv('PG_ENABLED=0');
    $disabled = Config::fromEnvironment();
    $assert($disabled['postgres'] === null, 'PostgreSQL is absent when disabled.');
    $disabledEngines = (new ConnectionScope($disabled))->engines(true);
    $assert($disabledEngines[1] === ['id' => 'postgres', 'label' => 'PostgreSQL', 'configured' => false,
        'capabilities' => ['create_database' => false, 'import' => false, 'query' => false, 'phpmyadmin' => false]],
        'An unconfigured PostgreSQL engine remains explainable without advertising unavailable tools.');
    $assert($disabledEngines[0] === $engines[0], 'Disabling PostgreSQL preserves the MariaDB engine descriptor.');
    $reject(static fn () => (new ConnectionScope($disabled))->select('scope_unit_pg', 'postgres', 'public'), 'database_not_available');
    $reject(static fn () => (new ConnectionScope($disabled))->selectRequest('postgres:scope_unit_pg:public'), 'database_not_available');
    putenv('PG_ENABLED=1');
    foreach ([['PG_PORT', '0'], ['PG_PORT', '65536'], ['PG_HOST', 'host;dbname=other'], ['PG_HOST', 'host with space'],
        ['PG_DATABASE', 'invalid;name'], ['PG_READ_USER', 'invalid;role'], ['PG_USER', 'postgres'],
        ['PG_USER', 'scope_unit_reader'], ['PG_READ_USER', 'scope_unit_writer'], ['PG_SQL_USER', 'postgres'],
        ['PG_SQL_USER', 'scope_unit_reader'], ['PG_RESTORE_USER', 'scope_unit_sql'], ['PG_SCHEMAS', ''],
        ['PG_SCHEMAS', 'pg_catalog'], ['PG_SCHEMAS', 'information_schema'], ['PG_SCHEMAS', "bad\nname"]] as [$key, $value]) {
        putenv($key . '=' . $value);
        $reject(static fn () => Config::fromEnvironment(), 'postgres_config_invalid', 503);
        putenv($key . '=' . $values[$key]);
    }
} finally {
    foreach ($original as $key => $value) putenv($value === false ? $key : $key . '=' . $value);
}
echo "PASS: $checks database-free PostgreSQL config, scope and capability checks.\n";
