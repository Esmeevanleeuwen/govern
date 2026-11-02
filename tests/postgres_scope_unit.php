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
    'PG_READ_USER' => 'scope_unit_reader', 'PG_READ_PASSWORD' => 'only-a-unit-test-value'];
$original = [];
foreach ($values as $key => $value) { $original[$key] = getenv($key); putenv($key . '=' . $value); }
try {
    $base = Config::fromEnvironment();
    $assert($base['engine'] === 'mariadb', 'Opting into PostgreSQL preserves the default MariaDB engine.');
    $assert($base['postgres']['schemas'] === ['public', 'archive', '0'], 'Configured schemas deduplicate without dropping the literal zero name.');
    $assert($base['postgres']['user'] === '' && $base['postgres']['password'] === '', 'PostgreSQL app config contains no writer fallback.');
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
    $reject(static fn () => ConnectionScope::requireAction($legacy, 'query'), 'postgres_read_only');
    $assert($public['scope_key'] !== $archive['scope_key'] && $public['backup_dir'] !== $archive['backup_dir'], 'Schemas have distinct cache and storage identities.');
    $assert(ConnectionScope::scopeKey('mariadb', 'existing') === 'existing', 'Existing MariaDB scope keys remain compatible.');
    $assert(ConnectionScope::scopeKey('postgres', 'data:set', 'a b') === 'postgres:data%3Aset:a%20b', 'Workspace keys encode identifier delimiters.');
    $capabilities = ConnectionScope::capabilities($public);
    foreach (['browse', 'structure', 'schema'] as $capability) $assert($capabilities[$capability] === true, 'Supported read capability: ' . $capability);
    foreach (['write', 'query', 'saved_queries', 'snapshots', 'phpmyadmin', 'import', 'create_database', 'ai', 'context'] as $capability) {
        $assert($capabilities[$capability] === false, 'Unsupported PostgreSQL capability: ' . $capability);
    }
    $assert(!in_array(false, ConnectionScope::capabilities($base), true), 'MariaDB retains all existing capabilities.');
    foreach (['bootstrap', 'schema', 'structure', 'browse'] as $action) {
        ConnectionScope::requireAction($public, $action);
        $assert(true, 'Supported action allowed without connecting: ' . $action);
    }
    foreach (['query', 'build-query', 'queries', 'save-query', 'delete-query', 'row-editor', 'insert-row', 'update-row',
        'delete-row', 'snapshots', 'create-snapshot', 'restore-snapshot', 'download-snapshot', 'prepare-database',
        'import-inspection', 'ai-status', 'ai-context', 'ai-chat', 'context', 'unknown-action'] as $action) {
        $reject(static fn () => ConnectionScope::requireAction($public, $action), 'postgres_read_only');
        ConnectionScope::requireAction($base, $action);
    }
    foreach ([['other', 'postgres', 'public'], ['scope_unit_pg', 'other', 'public'], ['scope_unit_pg', 'postgres', 'pg_catalog'],
        ['scope_unit_pg', 'postgres', 'missing']] as [$name, $connection, $schema]) {
        $reject(static fn () => $scope->select($name, $connection, $schema), 'database_not_available');
    }
    $database = new Database($public);
    foreach (['writer', 'scriptConnection'] as $method) $reject(static fn () => $database->$method(), 'postgres_read_only');
    $assert($database->quoteIdentifier('a"b') === '"a""b"', 'PostgreSQL identifier quoting retains embedded quotes.');
    putenv('PG_ENABLED=0');
    $disabled = Config::fromEnvironment();
    $assert($disabled['postgres'] === null, 'PostgreSQL is absent when disabled.');
    $reject(static fn () => (new ConnectionScope($disabled))->select('scope_unit_pg', 'postgres', 'public'), 'database_not_available');
    $reject(static fn () => (new ConnectionScope($disabled))->selectRequest('postgres:scope_unit_pg:public'), 'database_not_available');
    putenv('PG_ENABLED=1');
    foreach ([['PG_PORT', '0'], ['PG_PORT', '65536'], ['PG_HOST', 'host;dbname=other'], ['PG_HOST', 'host with space'],
        ['PG_DATABASE', 'invalid;name'], ['PG_READ_USER', 'invalid;role'], ['PG_SCHEMAS', ''],
        ['PG_SCHEMAS', 'pg_catalog'], ['PG_SCHEMAS', 'information_schema'], ['PG_SCHEMAS', "bad\nname"]] as [$key, $value]) {
        putenv($key . '=' . $value);
        $reject(static fn () => Config::fromEnvironment(), 'postgres_config_invalid', 503);
        putenv($key . '=' . $values[$key]);
    }
} finally {
    foreach ($original as $key => $value) putenv($value === false ? $key : $key . '=' . $value);
}
echo "PASS: $checks database-free PostgreSQL config, scope and capability checks.\n";
