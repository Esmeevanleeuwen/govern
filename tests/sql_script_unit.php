<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\SqlScript;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$rejectDelimiter = static function (string $sql) use ($assert): void {
    try {
        SqlScript::split($sql);
    } catch (ApiException $exception) {
        $assert($exception->errorCode === 'sql_delimiter_invalid', 'Invalid delimiter has its own error code.');
        return;
    }
    throw new RuntimeException('Invalid delimiter was accepted: ' . $sql);
};

$sql = <<<'SQL'
SELECT 'a; it''s fine' AS value;
-- a comment ; and DELIMITER $$
SELECT "double; quote";
SELECT `column``;name` FROM `table;name`;
SQL;
$parts = SqlScript::split($sql);
$assert(count($parts) === 3, 'Semicolons in strings, identifiers and comments do not split statements.');
$assert($parts[0]['sql'] === "SELECT 'a; it''s fine' AS value", 'Raw string contents are unchanged.');
$assert(str_contains($parts[2]['sql'], '`column``;name`'), 'Doubled identifier quotes remain unchanged.');
$assert(SqlScript::split(" ; ; -- only comments ;\r\n# another\n/* comment */") === [], 'Whitespace, empty statements and ordinary comments are not queries.');

$routine = "-- heading\r\nDELIMITER $$\r\nCREATE PROCEDURE demo()\r\nBEGIN\r\n SELECT '$$;';\r\n SELECT 2;\r\nEND$$\r\nDELIMITER ;\r\nCALL demo();";
$parts = SqlScript::split($routine);
$assert(count($parts) === 2, 'DELIMITER preserves a routine body as one server statement.');
$assert(str_starts_with($parts[0]['sql'], 'CREATE PROCEDURE'), 'Client DELIMITER commands are removed.');
$assert(str_contains($parts[0]['sql'], "SELECT '$$;';"), 'Delimiter inside a body string remains literal.');
$assert($parts[0]['line'] === 3 && $parts[1]['line'] === 9, 'Statement source lines include CRLF and delimiter directives.');
$assert($parts[1]['sql'] === 'CALL demo()', 'Default semicolon delimiter can be restored.');

$compound = <<<'SQL'
delimiter ;;
BEGIN NOT ATOMIC
 SELECT 1;
 SELECT 2;
END;;
DELIMITER ;
SELECT 3;
SQL;
$parts = SqlScript::split($compound);
$assert(count($parts) === 2 && str_ends_with($parts[0]['sql'], 'END'), 'Multi-character semicolon delimiters preserve compound statements.');
$slash = SqlScript::split("DELIMITER //\n-- // is a comment\nSELECT '//' //\n/* // comment */ SELECT 2//");
$assert(count($slash) === 2, 'A slash delimiter ignores occurrences in strings and comments.');
$assert(SqlScript::split("SELECT 'DELIMITER $$';\n/* DELIMITER bad value */ SELECT 2;")[1]['clean'] === 'SELECT 2', 'Delimiter-looking text inside SQL is not a client command.');
$assert(count(SqlScript::split("SELECT 1\nDELIMITER $$")) === 1, 'A delimiter directive cannot interrupt an unfinished SQL statement.');

$offset = 0;
$delimiter = ';';
$assert(SqlScript::next('DELIMITER $$', $offset, $delimiter) === null && $offset === 12 && $delimiter === '$$', 'A directive at EOF updates the client delimiter without creating SQL.');

$comments = SqlScript::split('/*!40101 SET @example = 1 */; /*M!100100 SELECT @example */; SELECT 1 /*! + 2 */;');
$assert(count($comments) === 3, 'Executable comments are not discarded as ordinary comments.');
$assert($comments[0]['sql'] === '/*!40101 SET @example = 1 */', 'Executable comment version and raw SQL are passed unchanged.');
$assert($comments[0]['clean'] === 'SET @example = 1' && $comments[1]['clean'] === 'SELECT @example', 'Executable comment bodies can be inspected for advisory SQL classification.');
$assert($comments[2]['clean'] === 'SELECT 1 + 2', 'Executable fragments remain part of the surrounding statement.');
$danger = SqlScript::preview('/*!40101 DROP TABLE `example` */;');
$assert($danger['statement_count'] === 1 && $danger['destructive'][0]['reason'] === 'drop', 'Executable destructive SQL participates in the existing confirmation preview.');

$backslash = <<<'SQL'
SELECT 'a\'; SELECT 2;
SQL;
$assert(count(SqlScript::split($backslash, 'NO_BACKSLASH_ESCAPES')) === 2, 'NO_BACKSLASH_ESCAPES changes string boundaries.');
$assert(count(SqlScript::split($backslash)) === 1, 'Default mode retains backslash escaping.');
$ansi = <<<'SQL'
SELECT "a\"; SELECT 2;
SQL;
$assert(count(SqlScript::split($ansi, 'ANSI_QUOTES')) === 2, 'ANSI_QUOTES identifiers do not use string backslash escapes.');
$assert(count(SqlScript::split($ansi)) === 1, 'Double quotes remain string quotes in default mode.');

$changing = "SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'; " . $backslash;
$offset = 0;
$delimiter = ';';
$first = SqlScript::next($changing, $offset, $delimiter);
$second = SqlScript::next($changing, $offset, $delimiter, 'NO_BACKSLASH_ESCAPES');
$third = SqlScript::next($changing, $offset, $delimiter, 'NO_BACKSLASH_ESCAPES');
$assert(str_starts_with($first['sql'], 'SET SESSION') && $second['sql'] === "SELECT 'a\\'" && $third['sql'] === 'SELECT 2', 'The caller can provide the actual changed session mode for each next statement.');
$assert(SqlScript::next($changing, $offset, $delimiter, 'NO_BACKSLASH_ESCAPES') === null && $offset === strlen($changing), 'Incremental parsing consumes the complete source without looping at EOF.');

$assert(SqlScript::destructiveReason('DELETE FROM `where`') === 'delete_no_where', 'A quoted identifier named where is not a WHERE clause.');
$assert(SqlScript::destructiveReason('DELETE FROM "where"') === 'delete_no_where', 'An ANSI-quoted identifier named where is not a WHERE clause.');
$assert(SqlScript::destructiveReason("UPDATE t SET value = 'WHERE'") === 'update_no_where', 'A WHERE word inside a string is not a clause.');
$assert(SqlScript::destructiveReason('UPDATE `drop` SET `where` = 1 WHERE id = 2') === null, 'A real WHERE clause is retained beside quoted names.');
$assert(SqlScript::destructiveReason('ALTER TABLE `drop` ADD COLUMN `drop` INT') === null, 'An identifier named drop is not an ALTER DROP operation.');

$preview = SqlScript::preview("SELECT 'DROP TABLE hidden';\nDELETE FROM `where`;");
$assert($preview['statement_count'] === 2 && count($preview['destructive']) === 1 && $preview['destructive'][0]['index'] === 2 && $preview['destructive'][0]['line'] === 2, 'Known-mode preview counts and source locations are exact.');
$preview = SqlScript::preview("SET sql_mode = CONCAT(@@sql_mode, ',NO_BACKSLASH_ESCAPES');\nSELECT 'a\\';\nDROP TABLE t;");
$assert($preview['statement_count'] === null && $preview['destructive'][0]['index'] === null && $preview['destructive'][0]['reason'] === 'dynamic' && $preview['destructive'][0]['line'] === 3, 'Mode-dependent tails give possible-danger advice without invented statement counts.');
$preview = SqlScript::preview("SET @@SESSION.sql_mode = @saved_mode; SELECT 1;");
$assert($preview['statement_count'] === null && $preview['destructive'] === [], 'An ambiguous mode change alone does not add a blanket destructive confirmation.');
$preview = SqlScript::preview("SET @sql_mode = 'ordinary user variable'; SELECT 1;");
$assert($preview['statement_count'] === 2, 'An ordinary user variable named sql_mode does not change lexer state.');
$preview = SqlScript::preview("PREPARE prepared FROM 'DROP TABLE example'; EXECUTE prepared;");
$assert($preview['statement_count'] === null && $preview['destructive'][0]['reason'] === 'dynamic', 'Possible destructive SQL in a PREPARE expression is visible to the advisory preview.');
$preview = SqlScript::preview("SET `sql_mode` = @saved_mode; SELECT 1;");
$assert($preview['statement_count'] === null, 'Quoted session variable spelling remains mode-dependent.');
$preview = SqlScript::preview("DELIMITER //\nBEGIN NOT ATOMIC SET SESSION sql_mode = @saved_mode; END//\nDELIMITER ;\nSELECT 1;");
$assert($preview['statement_count'] === null, 'A mode change inside a compound statement also makes future boundaries uncertain.');
$preview = SqlScript::preview("CREATE TABLE `SET sql_mode = x` (id INT); SELECT 'PREPARE';");
$assert($preview['statement_count'] === 2, 'Quoted identifier and literal text do not masquerade as mode-changing commands.');

$assert(!SqlScript::changesSqlMode('SELECT ROW_COUNT()') && !SqlScript::changesSqlMode('INSERT INTO t VALUES (1)'), 'Ordinary SQL does not require diagnostic-changing mode probes.');
$assert(!SqlScript::changesSqlMode("PREPARE prepared FROM ''") && SqlScript::changesSqlMode('EXECUTE prepared'), 'Prepare itself does not execute its eventual session changes.');
$assert(!SqlScript::changesSqlMode("CREATE PROCEDURE demo() BEGIN SET sql_mode = ''; END"), 'Creating a routine does not execute its mode-changing body.');
$assert(SqlScript::changesSqlMode("SET SESSION sql_mode = ''") && SqlScript::changesSqlMode("BEGIN NOT ATOMIC SET sql_mode = ''; END"), 'Direct and compound executing mode assignments are identified.');
$assert(SqlScript::changesSqlMode("mode_block: BEGIN NOT ATOMIC SET sql_mode = ''; END mode_block"), 'A labelled anonymous block still executes its mode-changing body.');
$assert(!SqlScript::changesSqlMode("SET @sql_mode = ''"), 'A user variable with the same name does not require a mode probe.');
$assert(SqlScript::literalSqlMode("SET SESSION sql_mode = 'no_backslash_escapes'", '') === 'NO_BACKSLASH_ESCAPES', 'A standard literal assignment can avoid a diagnostic-changing query.');
$assert(SqlScript::literalSqlMode("SET @@SESSION.sql_mode = '';", 'ANSI_QUOTES') === '', 'Empty literal mode is distinct from an unknown expression.');
$assert(SqlScript::literalSqlMode('SET sql_mode = "ANSI_QUOTES"', '') === 'ANSI_QUOTES', 'Double-quoted mode literals are recognized outside ANSI mode.');
$assert(SqlScript::literalSqlMode('SET sql_mode = "ANSI_QUOTES"', 'ANSI_QUOTES') === null, 'ANSI identifiers cannot be treated as double-quoted string values.');
$assert(SqlScript::literalSqlMode("SET sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES')", '') === null, 'Expressions are never evaluated as literal modes.');
$assert(SqlScript::literalSqlMode("SET GLOBAL sql_mode = 'ANSI_QUOTES'", '') === null && SqlScript::literalSqlMode("SET @sql_mode = 'ANSI_QUOTES'", '') === null, 'Global and user-variable assignments cannot predict this session mode.');
$assert(SqlScript::literalSqlMode("SET sql_mode = 'ANSI_QUOTES', @example = 1", '') === null, 'Multiple assignments use the live-mode path.');
$assert(count(SqlScript::split($ansi, SqlScript::literalSqlMode("SET sql_mode = 'ANSI'", '') ?? '')) === 2, 'ANSI aliases preserve their quoting effect without a hidden normalization query.');

foreach (["DELIMITER\nSELECT 1;", "DELIMITER a b\nSELECT 1;", "DELIMITER '$$'\nSELECT 1;", "DELIMITER a\\b\nSELECT 1;", 'DELIMITER ' . str_repeat('a', 33) . "\nSELECT 1;"] as $invalid) $rejectDelimiter($invalid);
$assert(SqlScript::split("# café\nSELECT 'nü';")[0]['sql'] === "# café\nSELECT 'nü'", 'UTF-8 source remains unchanged.');

echo $passed . " SQL script parser checks passed.\n";
