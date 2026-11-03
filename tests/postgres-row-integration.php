<?php
declare(strict_types=1);

/** Real PostgreSQL row writes; run only after postgres-row-fixture.sql in govern_pg. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\PostgresRowEditor;

$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($base['postgres']['name'] ?? '') !== 'govern_pg' || ($options['confirm-database'] ?? '') !== 'govern_pg') {
    fwrite(STDERR, "Enable PostgreSQL and confirm the isolated govern_pg database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, int $status, string $code) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->status === $status && $exception->errorCode === $code,
            $code . ': got ' . $exception->status . ' ' . $exception->errorCode);
        return;
    }
    throw new RuntimeException('Expected ' . $code);
};
$value = static fn (string $text): array => ['mode' => 'value', 'value' => $text];
$scope = new ConnectionScope($base);
$config = $scope->select('govern_pg', 'postgres', 'public');
$database = new Database($config);
$editor = new PostgresRowEditor($database);
$catalog = new Catalog($database);
$archive = new PostgresRowEditor(new Database($scope->select('govern_pg', 'postgres', 'archive')));
$pdo = $database->writer();
$key = ['tenant' => 'same', 'id' => '9007199254740993'];
$inserted = [];

try {
    $first = $editor->describe('govern_pg_edit_composite', $key);
    $assert($first['key_columns'] === ['tenant','id'] && $first['key'] === $key,
        'Composite identity retains declared order, omits INCLUDE payload and preserves exact BIGINT.');
    $other = $archive->describe('govern_pg_edit_composite', $key);
    $assert($first['version'] !== $other['version'], 'Versions bind identical rows to their selected schema.');
    $reject(static fn () => $archive->update(['table' => 'govern_pg_edit_composite', 'key' => $key,
        'version' => $first['version'], 'values' => ['label' => $value('scope replay')]]), 409, 'row_stale');
    $page = $catalog->browse('govern_pg_edit_composite', 1, 25, '');
    $assert($page['row_keys'] === [$key] && $page['key_columns'] === ['tenant','id'],
        'Browse exposes exact complete references aligned with visible rows.');
    $assert($editor->describe('govern_pg_edit_unique')['key_columns'] === ['code'],
        'A complete non-null unique key supports editing without a primary key.');
    foreach (['partial','nullable','expression','keyless'] as $type) {
        $description = $editor->describe('govern_pg_edit_' . $type);
        $assert(!$description['editable'] && $description['can_insert'] && $description['key_columns'] === [],
            'Unsafe ' . $type . ' key is never advertised as a row identity.');
    }
    $assert(!$editor->describe('govern_pg_edit_view')['can_insert'], 'Views cannot be mutated through the row editor.');
    $reject(static fn () => $editor->describe('govern_pg_edit_composite', ['tenant' => 'same']), 422, 'row_key_invalid');

    foreach (['float' => ['id' => '0.123456789012345'], 'binary' => ['id' => '00ff']] as $suffix => $exactKey) {
        $name = 'govern_pg_edit_' . $suffix;
        $before = $editor->describe($name, $exactKey);
        $assert($before['key'] === $exactKey, 'Exact ' . $suffix . ' key is read from the engine as text.');
        $editor->update(['table' => $name, 'key' => $exactKey, 'version' => $before['version'], 'values' => ['label' => $value('changed exact key')]]);
        $after = $editor->describe($name, $exactKey);
        $assert($after['row']['label'] === 'changed exact key', 'Exact ' . $suffix . ' identity is bound without rounding.');
        $editor->update(['table' => $name, 'key' => $exactKey, 'version' => $after['version'], 'values' => ['label' => $value($suffix . ' original')]]);
    }
    $longPage = $catalog->browse('govern_pg_edit_long_key', 1, 25, '');
    $assert($longPage['row_keys'] === [null], 'Oversized encoded row identity never enters an editor URL.');
    $reject(static fn () => $editor->describe('govern_pg_edit_long_key', ['code' => str_repeat('%',1500)]), 422, 'row_key_invalid');
    $partitionKey = ['tenant' => '1', 'id' => '9007199254740993'];
    $partition = $editor->describe('govern_pg_edit_partition', $partitionKey);
    $movedPartition = $editor->update(['table' => 'govern_pg_edit_partition', 'key' => $partitionKey,
        'version' => $partition['version'], 'values' => ['tenant' => $value('2')]]);
    $assert($movedPartition['key'] === ['tenant' => '2', 'id' => '9007199254740993'], 'Partition moves return the new full identity.');
    $editor->update(['table' => 'govern_pg_edit_partition', 'key' => $movedPartition['key'],
        'version' => $movedPartition['version'], 'values' => ['tenant' => $value('1')]]);

    $shadow = $editor->describe('govern_pg_edit_shadow', ['code' => 'red']);
    $shadowColumns = array_column($shadow['columns'], null, 'name');
    $assert($shadowColumns['code']['encoding'] === 'text', 'A user enum named bytea stays ordinary enum text.');
    $shadowPage = $catalog->browse('govern_pg_edit_shadow', 1, 25, 'red');
    $assert($shadowPage['rows'][0]['code'] === 'red' && $shadowPage['row_keys'] === [['code' => 'red']],
        'A user enum named bytea remains searchable and exposes its exact text key.');
    $shadowChanged = $editor->update(['table' => 'govern_pg_edit_shadow', 'key' => ['code' => 'red'],
        'version' => $shadow['version'], 'values' => ['code' => $value('blue'), 'label' => $value('shadow changed')]]);
    $assert($shadowChanged['key'] === ['code' => 'blue'] && $shadowChanged['row']['code'] === 'blue',
        'A shadow enum key is bound through enum input and RETURNING without binary decoding.');
    $editor->update(['table' => 'govern_pg_edit_shadow', 'key' => ['code' => 'blue'],
        'version' => $shadowChanged['version'], 'values' => ['code' => $value('red'), 'label' => $value('shadow original')]]);

    $quotedTable = 'govern_pg_edit_quoted"table';
    $quotedKey = ['0' => 'quoted key'];
    $quotedField = 'field:with"quotes';
    $quotedAmount = 'amount ":value_0';
    $quoted = $editor->describe($quotedTable, $quotedKey);
    $assert($quoted['key_columns'] === ['0'] && $quoted['key'] === $quotedKey && $quoted['row'][$quotedField] === 'quoted default',
        'Quoted table and column identifiers retain a numeric-named primary key.');
    $quotedLiteral = "literal ':value_0 ; -- nü";
    $quotedChanged = $editor->update(['table' => $quotedTable, 'key' => $quotedKey, 'version' => $quoted['version'],
        'values' => [$quotedField => $value($quotedLiteral), $quotedAmount => $value('123456789012345678901234.57')]]);
    $assert($quotedChanged['row'][$quotedField] === $quotedLiteral && $quotedChanged['row'][$quotedAmount] === '123456789012345678901234.57',
        'Placeholder-looking quoted identifiers and literal values use independent native parameters.');
    $quotedPage = $catalog->browse($quotedTable, 1, 25, "':value_0");
    $assert($quotedPage['row_keys'] === [$quotedKey] && $quotedPage['rows'][0][$quotedField] === $quotedLiteral,
        'Browse keeps quoted identifiers, bound search and numeric-named row identity aligned.');
    $quotedReset = $editor->update(['table' => $quotedTable, 'key' => $quotedKey, 'version' => $quotedChanged['version'],
        'values' => [$quotedField => ['mode' => 'default'], $quotedAmount => ['mode' => 'default']]]);
    $assert($quotedReset['row'][$quotedField] === 'quoted default' && $quotedReset['row'][$quotedAmount] === '0.00',
        'PostgreSQL DEFAULT resets quoted columns through the same editor path.');
    $keyless = $editor->insert(['table' => 'govern_pg_edit_keyless', 'values' => ['label' => $value('keyless test row')]]);
    $assert($keyless['affected_rows'] === 1 && $keyless['key'] === null, 'Insert works without inventing a keyless row identity.');
    $pdo->exec("DELETE FROM public.govern_pg_edit_keyless WHERE label='keyless test row'");

    $literal = "exact ' ; UPDATE ignored -- nü";
    $result = $editor->insert(['table' => 'govern_pg_edit', 'values' => [
        'label' => $value($literal), 'amount' => $value('123456789012345678901234.13'),
        'nullable_text' => ['mode' => 'null'], 'default_text' => ['mode' => 'default'], 'payload' => $value('00ff27'),
    ]]);
    $newKey = $result['key'];
    $inserted[] = ['govern_pg_edit', $newKey];
    $assert($result['affected_rows'] === 1 && is_string($newKey['id']), 'Identity defaults return an exact generated key.');
    $exact = $editor->describe('govern_pg_edit', $newKey);
    $assert($exact['row']['label'] === $literal && $exact['row']['amount'] === '123456789012345678901234.13',
        'Bound literals and exact NUMERIC inputs survive insert and readback.');
    $assert($exact['row']['nullable_text'] === null && $exact['row']['default_text'] === 'server default',
        'NULL and database default are separate modes.');
    $columns = array_column($exact['columns'], null, 'name');
    $assert($exact['row']['payload'] === '00ff27' && $columns['payload']['encoding'] === 'hex',
        'Bytea is edited through exact hexadecimal text.');
    $assert(!$columns['unsupported_values']['editable'] && $exact['row']['unsupported_values'] === '{1,2}', 'Unsupported array fields remain intact read-only values.');
    $assert($exact['row']['generated_label'] === $literal . '!' && !$columns['generated_label']['editable'],
        'Computed columns are refreshed from PostgreSQL and remain read-only.');
    $reject(static fn () => $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey,
        'version' => $exact['version'], 'values' => ['generated_label' => $value('forged')]]), 422, 'row_field_readonly_postgres');
    $reject(static fn () => $editor->insert(['table' => 'govern_pg_edit', 'values' => ['label' => $value('invalid hex'),
        'payload' => $value('not hex')]]), 422, 'row_hex_invalid');
    $reject(static fn () => $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey,
        'version' => $exact['version'], 'values' => ['amount' => ['mode' => 'value', 'value' => 12.5]]]), 422, 'row_values_invalid');
    $reject(static fn () => $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey,
        'version' => $exact['version'], 'values' => ['label' => ['mode' => 'null']]]), 422, 'row_null_invalid');
    $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey, 'version' => $exact['version'],
        'values' => ['nullable_text' => $value(''), 'default_text' => $value('changed')]]);
    $empty = $editor->describe('govern_pg_edit', $newKey);
    $assert($empty['row']['nullable_text'] === '', 'Empty text is not collapsed to NULL.');
    $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey, 'version' => $empty['version'],
        'values' => ['nullable_text' => ['mode' => 'null'], 'default_text' => ['mode' => 'default']]]);
    $defaults = $editor->describe('govern_pg_edit', $newKey);
    $assert($defaults['row']['nullable_text'] === null && $defaults['row']['default_text'] === 'server default',
        'UPDATE DEFAULT uses PostgreSQL defaults and preserves NULL distinction.');

    $independent = (new Database($config))->writer();
    $statement = $independent->prepare('UPDATE public.govern_pg_edit SET label=? WHERE id=?');
    $statement->execute(['external writer', $newKey['id']]);
    $reject(static fn () => $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey,
        'version' => $defaults['version'], 'values' => ['label' => $value('lost update')]]), 409, 'row_stale');
    $reject(static fn () => $editor->delete(['table' => 'govern_pg_edit', 'key' => $newKey,
        'version' => $defaults['version']]), 409, 'row_stale');
    $assert($editor->describe('govern_pg_edit', $newKey)['row']['label'] === 'external writer',
        'Both stale edit and stale delete preserve the newer row.');
    $large = str_repeat('exact unseen text ', 10000);
    $statement = $independent->prepare('UPDATE public.govern_pg_edit SET nullable_text=? WHERE id=?');
    $statement->execute([$large, $newKey['id']]);
    $beforeLarge = $editor->describe('govern_pg_edit', $newKey);
    $largeColumns = array_column($beforeLarge['columns'], null, 'name');
    $assert(!$largeColumns['nullable_text']['editable'] && $largeColumns['nullable_text']['large'],
        'Oversized fields are honest read-only previews.');
    $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey, 'version' => $beforeLarge['version'],
        'values' => ['label' => $value('other field saved')]]);
    $statement = $pdo->prepare('SELECT nullable_text FROM public.govern_pg_edit WHERE id=?');
    $statement->execute([$newKey['id']]);
    $assert($statement->fetchColumn() === $large, 'Editing another field preserves the complete oversized original.');
    $largeVersion = $editor->describe('govern_pg_edit', $newKey)['version'];
    $statement = $independent->prepare('UPDATE public.govern_pg_edit SET nullable_text=? WHERE id=?');
    $statement->execute([$large . 'changed beyond preview', $newKey['id']]);
    $reject(static fn () => $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey, 'version' => $largeVersion,
        'values' => ['label' => $value('lost large update')]]), 409, 'row_stale');

    $newIdentity = ['id' => '9007199254740998'];
    $beforeMove = $editor->describe('govern_pg_edit', $newKey);
    $moved = $editor->update(['table' => 'govern_pg_edit', 'key' => $newKey, 'version' => $beforeMove['version'],
        'values' => ['id' => $value($newIdentity['id'])]]);
    $inserted[array_key_last($inserted)][1] = $newIdentity;
    $assert($moved['key'] === $newIdentity && $moved['row']['id'] === $newIdentity['id'],
        'UPDATE RETURNING returns a changed exact primary key.');
    $reject(static fn () => $editor->describe('govern_pg_edit', $newKey), 404, 'row_missing');
    $always = $editor->insert(['table' => 'govern_pg_edit_always', 'values' => []]);
    $inserted[] = ['govern_pg_edit_always', $always['key']];
    $assert($always['row']['label'] === 'always default' && is_string($always['key']['id']),
        'DEFAULT VALUES supports generated-always identity columns.');
    $alwaysColumns = array_column($editor->describe('govern_pg_edit_always', $always['key'])['columns'], null, 'name');
    $assert(!$alwaysColumns['id']['editable'], 'GENERATED ALWAYS identity is not offered as ordinary input.');

    $readerConfig = [...$config, 'user' => $config['read_user'], 'password' => $config['read_password'], 'read_user' => $config['user'], 'read_password' => $config['password']];
    $readerEditor = new PostgresRowEditor(new Database($readerConfig));
    $reject(static fn () => $readerEditor->insert(['table' => 'govern_pg_edit', 'values' => ['label' => $value('reader write')]]),
        403, 'row_permission_denied');
    foreach (['CREATE TABLE public.govern_pg_forbidden_ddl (id integer)', 'CREATE TEMP TABLE govern_pg_forbidden_temp (id integer)'] as $sql) {
        try { $pdo->exec($sql); throw new RuntimeException('Writer acquired DDL rights.'); }
        catch (PDOException $exception) { $assert($exception->getCode() === '42501', 'Writer remains limited to table DML.'); }
    }
    $toDelete = $editor->describe('govern_pg_edit', $newIdentity);
    $deleted = $editor->delete(['table' => 'govern_pg_edit', 'key' => $newIdentity, 'version' => $toDelete['version']]);
    $assert($deleted['affected_rows'] === 1, 'Delete removes exactly the explicitly selected current row.');
    $reject(static fn () => $editor->describe('govern_pg_edit', $newIdentity), 404, 'row_missing');
    $assert($archive->describe('govern_pg_edit', ['id' => '1'])['row']['label'] === 'Archive row',
        'Public row mutations preserve the same-named archive table.');
} finally {
    foreach ($inserted as [$table, $cleanupKey]) {
        $statement = $pdo->prepare('DELETE FROM public.' . $database->quoteIdentifier($table) . ' WHERE id=?');
        $statement->execute([$cleanupKey['id']]);
    }
}
echo "PASS: $passed PostgreSQL row identity, exact CRUD, conflict, scope and permission checks.\n";
