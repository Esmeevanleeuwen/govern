<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\PostgresSqlScript;

$checks = 0;
$assert = static function (bool $condition, string $message) use (&$checks): void {
    if (!$condition) throw new RuntimeException($message);
    $checks++;
};
$reject = static function (string $sql, string $code) use ($assert): void {
    try { PostgresSqlScript::split($sql); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === 422, 'Stable PostgreSQL parser rejection: ' . $code);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};

$sql = <<<'SQL'
/* nested /* ; 'not a quote' */ outer comment */
SELECT 'a; it''s literal' AS "column"";name";
--comment without a required whitespace after --
SELECT E'escape \'quote; \\ slash', e'another\'value;';
SELECT 'ordinary\backslash';
SQL;
$parts = PostgresSqlScript::split($sql);
$assert(count($parts) === 3, 'String and identifier quotes, E escapes and nested comments preserve three statements.');
$assert(str_contains($parts[0]['sql'], "'a; it''s literal'"), 'Raw literal contents remain exact.');
$assert(str_contains($parts[1]['sql'], "e'another\\'value;'"), 'Lowercase escape-string prefix is retained.');
$assert($parts[0]['line'] === 2 && $parts[1]['line'] === 4 && $parts[2]['line'] === 5,
    'Lines identify SQL after ordinary and nested comments.');
$assert(PostgresSqlScript::split(" ; ; -- only comments\r\n/* outer /* inner */ end */") === [], 'Empty/comment-only scripts contain no statement.');
$crlf = PostgresSqlScript::split("-- header\r\n/* first\r\nsecond */\r\nSELECT 1;\r\nSELECT 2;");
$assert($crlf[0]['line'] === 4 && $crlf[1]['line'] === 5, 'CRLF contributes one source line per break.');

$routine = <<<'SQL'
CREATE FUNCTION example() RETURNS text LANGUAGE plpgsql AS $body$
BEGIN
    RETURN 'literal; $other$ and ''quotes''';
END;
$body$;
SELECT $$text; 'not quoted' and /* not comment */$$, $tag$another;value$tag$;
SELECT $1, amount$literal$ FROM source;
SQL;
$parts = PostgresSqlScript::split($routine);
$assert(count($parts) === 3 && str_contains($parts[0]['sql'], "RETURN 'literal;"), 'Dollar-quoted routines remain one statement.');
$assert(str_contains($parts[1]['sql'], '$tag$another;value$tag$'), 'Tagged and untagged dollar strings retain literal semicolons.');
$assert($parts[2]['clean'] === 'SELECT $1, amount$literal$ FROM source', 'Parameters and dollars in identifiers are not dollar-string delimiters.');
$assert(count(PostgresSqlScript::split('SELECT $étiquette$multibyte;body$étiquette$; SELECT 2;')) === 2,
    'PostgreSQL Unicode dollar tags preserve statement boundaries.');
$literalCommands = PostgresSqlScript::split("SELECT '\\connect other', $$\\copy x FROM STDIN$$; SELECT 2;");
$assert(count($literalCommands) === 2, 'Client-looking text inside strings is ordinary data.');
$assert(count(PostgresSqlScript::split("SELECT 'backslash\\'; SELECT 2;")) === 2,
    'Standard strings keep a backslash literal before a closing quote.');
$legacy = PostgresSqlScript::split("SELECT 'backslash\\'quote; literal'; SELECT 2;", false);
$assert(count($legacy) === 2, 'A known non-standard session setting uses backslash quote escaping.');
$assert(count(PostgresSqlScript::split('SELECT json_value #>> \'{a,b}\'; SELECT 2;')) === 2,
    'PostgreSQL hash operators are not MySQL comments.');

foreach (["SELECT 'unfinished", 'SELECT "unfinished', 'SELECT $tag$unfinished', 'SELECT 1; /* unclosed /* nested */'] as $sql)
    $reject($sql, 'postgres_sql_syntax');
foreach (["\\connect other\nSELECT 1;", "SELECT 1\n\\g", "\\restrict token"] as $sql)
    $reject($sql, 'postgres_sql_client_command');
foreach (['COPY sample FROM STDIN;', 'COPY (SELECT 1) TO STDOUT;', 'COPY sample FROM /* comment */ STDIN WITH (FORMAT csv);'] as $sql)
    $reject($sql, 'postgres_sql_copy_unsupported');

foreach (['DROP TABLE "where"' => 'drop', 'TRUNCATE ONLY sample' => 'truncate', 'ALTER TABLE sample DROP COLUMN label' => 'alter_drop',
    'DELETE FROM "where"' => 'delete_no_where', 'UPDATE sample SET label=(SELECT label FROM another WHERE id=1)' => 'update_no_where',
    'WITH removed AS (DELETE FROM sample RETURNING *) SELECT * FROM removed' => 'dynamic',
    'EXPLAIN (ANALYZE true) DELETE FROM sample' => 'dynamic', 'DO \'literal\'' => 'dynamic', 'CALL action()' => 'dynamic'] as $sql => $reason) {
    $statement = PostgresSqlScript::split($sql)[0];
    $assert(PostgresSqlScript::destructiveReason($statement['clean']) === $reason, 'Destructive advisory: ' . $reason);
}
$safe = PostgresSqlScript::preview("UPDATE sample SET label='DROP; WHERE' WHERE id=1; SELECT 'DROP TABLE';");
$assert($safe['statement_count'] === 2 && $safe['destructive'] === [], 'Literal keywords do not create warnings or conceal an actual top-level WHERE.');
$create = PostgresSqlScript::preview('CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$BEGIN DELETE FROM sample; END$$;');
$assert($create['statement_count'] === 1 && $create['destructive'] === [], 'Stored function text is not executed during CREATE.');
$change = PostgresSqlScript::preview("SET standard_conforming_strings=off; SELECT 'legacy\\'quote'; DROP TABLE sample;");
$assert($change['statement_count'] === null && $change['destructive'][0]['reason'] === 'dynamic',
    'Mode-dependent tails retain conservative confirmation advice without invented counts or parsing assumptions.');
$assert(PostgresSqlScript::preview('SELECT 1; SELECT 2;')['statement_count'] === 2, 'Ordinary previews retain an exact statement count.');

echo "PASS: $checks PostgreSQL script boundary and confirmation checks.\n";
