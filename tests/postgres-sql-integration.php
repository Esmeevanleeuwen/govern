<?php
declare(strict_types=1);

/** PostgreSQL script execution only in the explicitly confirmed disposable database. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\QueryRunner;

$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($base['postgres']['name'] ?? '') !== 'govern_pg' || ($options['confirm-database'] ?? '') !== 'govern_pg') {
    fwrite(STDERR, "Confirm the isolated govern_pg PostgreSQL database.\n");
    exit(2);
}
$config = (new ConnectionScope($base))->select('govern_pg', 'postgres', 'public');
$database = new Database($config);
$runner = new QueryRunner($database);
$pdo = $database->scriptConnection();
$name = 'zz_govern_pg_sql_' . bin2hex(random_bytes(6));
$table = $database->quoteIdentifier($name);
$view = $database->quoteIdentifier($name . '_view');
$function = $database->quoteIdentifier($name . '_function');
$procedure = $database->quoteIdentifier($name . '_procedure');
$shadowBoolean = false;
$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$run = static function (string $sql, bool $confirm = false) use ($runner): array {
    $result = $runner->executeScript($sql, $confirm);
    if ($result['confirm_required'] || $result['failed'] !== null)
        throw new RuntimeException('Unexpected script result: ' . json_encode($result, JSON_UNESCAPED_UNICODE));
    return $result;
};

try {
    $created = $run("CREATE TABLE $table (id bigint PRIMARY KEY, label text, amount numeric(30,2));
        INSERT INTO $table VALUES (9007199254740993,'original',123456789012345678901234.12);
        ALTER TABLE $table ADD extra integer NOT NULL DEFAULT 7;
        SELECT id,label,amount,extra FROM $table;");
    $assert($created['executed'] === 4 && $created['statements'][1]['affected_rows'] === 1,
        'Free SQL creates, inserts and alters an owned table in submission order.');
    $assert($created['statements'][3]['rows'] === [['9007199254740993','original','123456789012345678901234.12','7']],
        'Exact BIGINT/NUMERIC data survives native SQL and result formatting.');
    $assert($created['schema_refresh_needed'] && $created['statement_count'] === 4,
        'The response exposes catalog refresh and exact ordinary statement count.');
    $assert(in_array('extra', array_column((new Catalog($database))->structure($name)['columns'], 'name'), true),
        'The reader sees a new SQL-owned table through the live catalog/default grants.');

    $numbers = $run("SELECT 9007199254740993::bigint AS same,
        '123456789012345678901234.12'::numeric(30,2) AS same,
        0.123456789012345::double precision AS exact_float, NULL::text AS missing,
        pg_catalog.decode('00ff41','hex') AS binary_value;");
    $assert($numbers['statements'][0]['columns'] === ['same','same','exact_float','missing','binary_value'],
        'Duplicate result aliases retain ordinal column identity.');
    $assert($numbers['statements'][0]['rows'] === [['9007199254740993','123456789012345678901234.12','0.123456789012345',null,'0x00ff41']],
        'BIGINT, NUMERIC, FLOAT8, NULL and binary results preserve exact engine text: ' . json_encode($numbers['statements'][0]['rows']));
    $precision = ini_get('precision');
    $edgeFloats = $run("SELECT 1.0000000000000002::float8, 0.1::float8, 'Infinity'::float8, '-Infinity'::float8, 'NaN'::float8;");
    $assert($edgeFloats['statements'][0]['rows'] === [['1.0000000000000002','0.1','Infinity','-Infinity','NaN']]
        && ini_get('precision') === $precision, 'Adjacent FLOAT8 values round-trip and special values retain native labels without changing PHP precision afterward.');
    $boolean = $run("SELECT true AS yes,false AS no,''::text AS empty,NULL::bool AS missing;");
    $assert($boolean['statements'][0]['rows'] === [['true','false','',null]],
        'Boolean false stays distinct from empty text and NULL in SQL previews.');
    if ($pdo->query("SELECT pg_catalog.to_regtype('public.bool')::text")->fetchColumn() === null) {
        $pdo->exec("CREATE TYPE public.\"bool\" AS ENUM ('neither')");
        $shadowBoolean = true;
        try {
            $enum = $run("SELECT 'neither'::public.\"bool\" AS enum_value;");
            $assert($enum['statements'][0]['rows'] === [['neither']], 'A user enum named bool is never formatted as a builtin boolean.');
        } finally {
            $pdo->exec('DROP TYPE public."bool"');
            $shadowBoolean = false;
        }
    }

    $preview = $runner->executeScript("INSERT INTO $table (id,label) VALUES (2,'not attempted'); DELETE FROM $table;");
    $assert($preview['confirm_required'] && $preview['destructive'][0]['reason'] === 'delete_no_where',
        'Unbounded DELETE requires confirmation before any statement in the script runs.');
    $assert($pdo->query("SELECT count(*) FROM $table WHERE id=2")->fetchColumn() === '0',
        'The confirmation preview performs no earlier INSERT.');
    $changed = $run("UPDATE $table SET label='changed' WHERE id=9007199254740993;
        INSERT INTO $table (id,label) VALUES (2,'second'); DELETE FROM $table WHERE id=2;");
    $assert(array_column($changed['statements'], 'affected_rows') === [1,1,1], 'Bounded DML reports actual affected row counts.');

    $rolledBack = $run("BEGIN; UPDATE $table SET label='rolled back' WHERE id=9007199254740993; ROLLBACK;
        SELECT label FROM $table WHERE id=9007199254740993;");
    $assert(!$rolledBack['transaction_rolled_back'] && $rolledBack['statements'][3]['rows'] === [['changed']],
        'An explicit ROLLBACK takes effect in the shared script session.');
    $committed = $run("BEGIN; UPDATE $table SET label='committed' WHERE id=9007199254740993; COMMIT;");
    $assert(!$committed['transaction_rolled_back'] && $pdo->query("SELECT label FROM $table")->fetchColumn() === 'committed',
        'An explicit COMMIT persists and is not reported as rolled back.');
    $unfinished = $run("BEGIN; UPDATE $table SET label='unfinished' WHERE id=9007199254740993;");
    $assert($unfinished['transaction_rolled_back'] && $pdo->query("SELECT label FROM $table")->fetchColumn() === 'committed',
        'An unfinished transaction is rolled back before the throwaway session ends.');

    $partial = $runner->executeScript("INSERT INTO $table (id,label) VALUES(4,'already committed'); SELECT 1/0;
        INSERT INTO $table (id,label) VALUES(5,'must not run');");
    $assert($partial['failed']['index'] === 2 && $partial['executed'] === 1 && count($partial['statements']) === 1,
        'The first failure retains prior results and stops later statements.');
    $assert($pdo->query("SELECT count(*) FROM $table WHERE id=4")->fetchColumn() === '1'
        && $pdo->query("SELECT count(*) FROM $table WHERE id=5")->fetchColumn() === '0',
        'Committed work is preserved while later statements remain unattempted.');
    $failedTransaction = $runner->executeScript("BEGIN; INSERT INTO $table(id,label) VALUES(6,'rollback on error'); SELECT 1/0; COMMIT;");
    $assert($failedTransaction['failed']['index'] === 3 && $failedTransaction['transaction_rolled_back']
        && $pdo->query("SELECT count(*) FROM $table WHERE id=6")->fetchColumn() === '0',
        'An error inside an explicit transaction rolls back its uncommitted writes.');

    $body = '$routine$';
    $program = $run("CREATE FUNCTION $function(input integer) RETURNS integer LANGUAGE plpgsql AS $body
        BEGIN RETURN input+1; END; $body;
        DO $body BEGIN INSERT INTO $table(id,label) VALUES(10,'first; quote');
            INSERT INTO $table(id,label) VALUES(11,'second'); END; $body;
        SELECT $function(4),count(*) FROM $table WHERE id IN(10,11);", true);
    $assert($program['executed'] === 3 && $program['statements'][2]['rows'] === [['5','2']],
        'Dollar-quoted function/DO bodies retain internal semicolons and real effects.');
    $call = $run("CREATE PROCEDURE $procedure(OUT value_out bigint) LANGUAGE plpgsql AS $body BEGIN value_out:=42; END; $body;
        CALL $procedure(NULL);", true);
    $assert($call['statements'][1]['rows'] === [['42']] && count($call['statements'][1]['result_sets']) === 1,
        'PostgreSQL CALL exposes its native OUT row without invented MySQL result sets.');
    $views = $run("CREATE VIEW $view AS SELECT id,label FROM $table; SELECT count(*) FROM $view;");
    $assert($views['statements'][1]['rows'] === [['4']], 'Owned views can be created and queried.');
    $session = $run("SET govern_sql.marker='one session'; SELECT current_setting('govern_sql.marker');");
    $assert($session['statements'][1]['rows'] === [['one session']], 'Session settings are shared inside one script.');
    $fresh = $run("SELECT current_setting('govern_sql.marker',true);");
    $assert($fresh['statements'][0]['rows'] === [[null]], 'The next script starts with a new session.');

    $modes = $run("SET standard_conforming_strings=off; SELECT 'legacy\\'quote; value';
        SET standard_conforming_strings=on; SELECT 'finished';");
    $assert($modes['statements'][1]['rows'] === [["legacy'quote; value"]] && $modes['statements'][3]['rows'] === [['finished']],
        'Actual session string settings control subsequent lexical boundaries.');
    $limited = $run('SELECT generate_series(1,205) AS n;');
    $assert($limited['statements'][0]['returned_rows'] === 200 && $limited['statements'][0]['truncated'],
        'The row preview limit is independent of executed SQL effects.');
    $oversized = $run("SELECT repeat('x',40000) AS huge;");
    $assert($oversized['statements'][0]['truncated'] && strlen($oversized['statements'][0]['rows'][0][0]) < 40000,
        'Oversized cells have a bounded, explicit display preview.');

    $scope = (new ConnectionScope($base))->select('govern_pg','postgres','archive');
    $archive = (new QueryRunner(new Database($scope)))->executeScript("SELECT (pg_catalog.current_schemas(true))[1]::text, current_schema();");
    $assert($archive['failed'] === null && $archive['statements'][0]['rows'] === [['pg_catalog','archive']],
        'Catalog lookup stays first while the selected schema remains the unqualified creation target.');
    $denied = $runner->executeScript('CREATE ROLE govern_sql_forbidden LOGIN;');
    $assert($denied['failed'] !== null && str_contains($denied['failed']['detail'], 'permission denied'),
        'The SQL role cannot acquire database administration rights.');
    $existing = $pdo->query("SELECT to_regclass('public.govern_pg_values')::text")->fetchColumn();
    if ($existing !== null && $existing !== false) {
        $deniedOwner = $runner->executeScript('ALTER TABLE public.govern_pg_values ADD COLUMN govern_sql_must_not_add integer;');
        $assert($deniedOwner['failed'] !== null && str_contains($deniedOwner['failed']['detail'], 'owner'),
            'Existing administrator-owned objects retain their ownership boundary.');
    }
    foreach (["COPY $table FROM STDIN;", "\\connect other\nSELECT 1;"] as $unsupported) {
        try { $runner->executeScript($unsupported); throw new RuntimeException('Client transport command accepted.'); }
        catch (ApiException $exception) { $assert($exception->status === 422, 'Client-only transport fails explicitly before executing.'); }
    }
} finally {
    if ($shadowBoolean) $pdo->exec('DROP TYPE IF EXISTS public."bool"');
    $pdo->exec("DROP VIEW IF EXISTS $view; DROP TABLE IF EXISTS $table;
        DROP FUNCTION IF EXISTS $function(integer); DROP PROCEDURE IF EXISTS $procedure;");
}
echo "PASS: $checks PostgreSQL SQL-session, DDL/DML, exact-result, transaction and scope checks.\n";
