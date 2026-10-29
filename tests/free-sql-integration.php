<?php
declare(strict_types=1);

/** Run only against a disposable database; every probe object is removed. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\QueryRunner;

$config = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($options['confirm-database'] ?? '') !== $config['name']) {
    fwrite(STDERR, "Use a disposable database and confirm its name with --confirm-database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$database = new Database($config);
$runner = new QueryRunner($database);
$pdo = $database->writer();
$catalog = new Catalog($database);
$name = 'zz_govern_sql_' . bin2hex(random_bytes(6));
$table = Database::identifier($name);
$view = Database::identifier($name . '_view');
$procedure = Database::identifier($name . '_procedure');
$largeProcedure = Database::identifier($name . '_large');
$errorProcedure = Database::identifier($name . '_error');
$function = Database::identifier($name . '_function');
$trigger = Database::identifier($name . '_trigger');
$mode = (string) $pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
$run = static function (string $sql, bool $confirm = false) use ($runner): array {
    $result = $runner->executeScript($sql, $confirm);
    if (($result['confirm_required'] ?? false) || ($result['failed'] ?? null) !== null) {
        throw new RuntimeException('Unexpected script result: ' . json_encode($result, JSON_UNESCAPED_UNICODE));
    }
    return $result;
};
$rowSets = static fn (array $statement): array => array_values(array_filter(
    $statement['result_sets'] ?? [], static fn (array $set): bool => $set['columns'] !== []));

try {
    $created = $run("CREATE TABLE $table (id BIGINT UNSIGNED PRIMARY KEY, label VARCHAR(80), amount DECIMAL(30,2)) ENGINE=InnoDB;
        INSERT INTO $table VALUES (9007199254740993, 'original', 123456789012345678901234.12);
        ALTER TABLE $table ADD extra INT NOT NULL DEFAULT 7;
        SELECT id, label, amount, extra FROM $table;");
    $assert($created['executed'] === 4 && $created['statements'][1]['affected_rows'] === 1,
        'Free SQL creates, inserts and alters in order on the writable connection.');
    $assert($created['statements'][3]['rows'] === [['9007199254740993', 'original', '123456789012345678901234.12', '7']],
        'Written BIGINT and DECIMAL values retain exact precision.');
    $assert(in_array('extra', array_column($catalog->structure($name)['columns'], 'name'), true),
        'DDL changes are visible through the live catalog.');
    $assert(($created['schema_refresh_needed'] ?? false) === true, 'Manual SQL marks the live catalog for refreshing.');

    $exact = $run("SELECT CAST(9007199254740993 AS UNSIGNED) AS same,
        CAST('123456789012345678901234.12' AS DECIMAL(30,2)) AS same,
        NULL AS missing, UNHEX('FF00') AS binary_value;");
    $assert($exact['statements'][0]['columns'] === ['same', 'same', 'missing', 'binary_value']
        && $exact['statements'][0]['rows'] === [['9007199254740993', '123456789012345678901234.12', null, '0xff00']],
        'Duplicate aliases, NULL, exact numbers and binary previews survive free SQL.');
    $read = $run("SHOW COLUMNS FROM $table; EXPLAIN SELECT * FROM $table WHERE id = 9007199254740993;");
    $assert(in_array('extra', array_column($read['statements'][0]['rows'], 0), true)
        && $read['statements'][1]['columns'] !== [], 'SHOW and EXPLAIN are ordinary supported SQL.');

    $comments = $run('/*! SELECT 17 AS executable */; /*M! SELECT 18 AS maria */;');
    $assert(array_column($comments['statements'], 'rows') === [[['17']], [['18']]],
        'Standalone MySQL and MariaDB executable comments are executed.');

    $routine = $run("DELIMITER //
CREATE PROCEDURE $procedure(IN wanted BIGINT UNSIGNED)
BEGIN
  SELECT id, label FROM $table WHERE id = wanted;
  SELECT 'second; set' AS marker;
END//
DELIMITER ;
CALL $procedure(9007199254740993);
SELECT 42 AS after_call;");
    $assert($routine['executed'] === 3, 'DELIMITER directives are client syntax, not executed statements.');
    $sets = $rowSets($routine['statements'][1]);
    $assert(count($sets) === 2 && $sets[0]['rows'] === [['9007199254740993', 'original']]
        && $sets[1]['rows'] === [['second; set']], 'CALL preserves every result set, including semicolons in strings.');
    $assert($routine['statements'][1]['columns'] === $sets[0]['columns']
        && $routine['statements'][1]['rows'] === $sets[0]['rows'], 'The first result stays available in the compatible flat fields.');
    $assert($routine['statements'][2]['rows'] === [['42']], 'The connection is usable after all CALL rowsets are consumed.');

    $programmed = $run("DELIMITER $$
CREATE FUNCTION $function(value_in INT) RETURNS INT DETERMINISTIC NO SQL
BEGIN
  RETURN value_in + 1;
END$$
CREATE TRIGGER $trigger BEFORE INSERT ON $table FOR EACH ROW
BEGIN
  SET NEW.label = CONCAT('trigger:', NEW.label);
END$$
DELIMITER ;
INSERT INTO $table (id, label) VALUES (2, 'written');
SELECT $function(4), label FROM $table WHERE id = 2;");
    $assert($programmed['executed'] === 4 && $programmed['statements'][3]['rows'] === [['5', 'trigger:written']],
        'Functions and triggers with compound bodies run through the same workspace.');
    $pdo->exec('DROP TRIGGER ' . $trigger);
    $viewResult = $run("CREATE VIEW $view AS SELECT id, label FROM $table; SELECT COUNT(*) FROM $view;");
    $assert($viewResult['statements'][1]['rows'] === [['2']], 'Views can be created and queried in the workspace.');
    $changed = $run("UPDATE $table SET label = 'updated' WHERE id = 2;
        DELETE FROM $table WHERE id = 2; SELECT COUNT(*) FROM $table WHERE id = 2;");
    $assert($changed['statements'][0]['affected_rows'] === 1 && $changed['statements'][1]['affected_rows'] === 1
        && $changed['statements'][2]['rows'] === [['0']], 'UPDATE and DELETE report real affected rows and visible stored changes.');

    // Compare server diagnostics across consecutive user statements. Internal
    // metadata/warning probes must not replace ROW_COUNT() or FOUND_ROWS().
    $beforeDiagnostics = (int) $pdo->query("SELECT COUNT(*) FROM $table")->fetchColumn();
    $diagnostics = $run("INSERT INTO $table (id, label) VALUES (60, 'diagnostic insert');
        SELECT ROW_COUNT() AS inserted;
        UPDATE $table SET label = 'diagnostic update' WHERE id = 60;
        SELECT ROW_COUNT() AS updated;
        SELECT SQL_CALC_FOUND_ROWS id FROM $table ORDER BY id LIMIT 1;
        SELECT FOUND_ROWS() AS total;");
    $assert($diagnostics['statements'][1]['rows'] === [['1']],
        'ROW_COUNT immediately after INSERT retains the native affected-row diagnostic.');
    $assert($diagnostics['statements'][3]['rows'] === [['1']],
        'ROW_COUNT immediately after UPDATE retains the native affected-row diagnostic.');
    $assert(count($diagnostics['statements'][4]['rows']) === 1
        && $diagnostics['statements'][5]['rows'] === [[(string) ($beforeDiagnostics + 1)]],
        'FOUND_ROWS after SQL_CALC_FOUND_ROWS retains the full matching row count.');
    $prepared = $run("PREPARE govern_free_sql_insert FROM
        'INSERT INTO $table (id, label) VALUES (61, ''prepared insert'')';
        EXECUTE govern_free_sql_insert;
        SELECT ROW_COUNT() AS prepared_inserted;
        DEALLOCATE PREPARE govern_free_sql_insert;");
    $assert($prepared['statements'][2]['rows'] === [['1']]
        && $pdo->query("SELECT label FROM $table WHERE id = 61")->fetchColumn() === 'prepared insert',
        'EXECUTE of a prepared INSERT preserves ROW_COUNT and its actual stored change.');

    $committed = $run("START TRANSACTION; INSERT INTO $table (id, label) VALUES (20, 'committed'); COMMIT;");
    $assert(($committed['transaction_rolled_back'] ?? null) === false
        && $pdo->query("SELECT label FROM $table WHERE id = 20")->fetchColumn() === 'committed',
        'COMMIT persists changes before the script session closes.');
    $rolledBack = $run("START TRANSACTION; INSERT INTO $table (id, label) VALUES (21, 'rolled back'); ROLLBACK;");
    $assert(($rolledBack['transaction_rolled_back'] ?? null) === false
        && $pdo->query("SELECT COUNT(*) FROM $table WHERE id = 21")->fetchColumn() === '0',
        'An explicit ROLLBACK reverts changes within the script.');
    $unfinished = $run("START TRANSACTION; INSERT INTO $table (id, label) VALUES (22, 'unfinished');");
    $assert(($unfinished['transaction_rolled_back'] ?? false) === true
        && $pdo->query("SELECT COUNT(*) FROM $table WHERE id = 22")->fetchColumn() === '0',
        'An unfinished transaction is rolled back and reported rather than implied to be saved.');

    $warning = $run("SELECT CAST('not-a-number' AS UNSIGNED) AS converted;");
    $firstWarning = $warning['statements'][0];
    $assert(($firstWarning['warning_count'] ?? 0) > 0 && ($firstWarning['warnings'] ?? []) !== []
        && is_int($firstWarning['warnings'][0]['code']) && is_string($firstWarning['warnings'][0]['message']),
        'Database warnings are returned with level, code and message.');
    $warningSql = "SELECT CAST('govern diagnostic value' AS UNSIGNED) AS converted";
    $pdo->query($warningSql)->fetchAll(PDO::FETCH_NUM);
    $nativeWarnings = $pdo->query('SHOW WARNINGS')->fetchAll(PDO::FETCH_NUM);
    $warningDiagnostics = $run($warningSql . '; SHOW WARNINGS;');
    $assert($nativeWarnings !== [] && $warningDiagnostics['statements'][1]['rows'] === $nativeWarnings,
        'Explicit SHOW WARNINGS sees the exact original native diagnostic after its preceding statement.');

    $changedMode = $run(<<<'SQL'
SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES';
SELECT 'tail\' AS slash;
SELECT 'next' AS following;
SQL);
    $assert($changedMode['executed'] === 3 && $changedMode['statements'][1]['rows'] === [["tail\\"]]
        && $changedMode['statements'][2]['rows'] === [['next']], 'Parsing follows the active SQL mode between statements.');
    $ansi = $run(<<<'SQL'
SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES';
SELECT 7 AS "name;inside";
SELECT 8 AS after_identifier;
SQL);
    $assert($ansi['statements'][1]['columns'] === ['name;inside'] && $ansi['statements'][2]['rows'] === [['8']],
        'ANSI quoted identifiers keep their internal delimiters.');
    $resetMode = $run('SELECT @@SESSION.sql_mode;');
    $assert($resetMode['statements'][0]['rows'] === [[$mode]], 'A changed SQL mode does not leak into the next script session.');
    $variables = $run('SET @govern_free_sql_probe = 37; SELECT @govern_free_sql_probe;');
    $assert($variables['statements'][1]['rows'] === [['37']], 'Session variables work across statements in one run.');
    $fresh = $run('SELECT @govern_free_sql_probe;');
    $assert($fresh['statements'][0]['rows'] === [[null]], 'Session variables do not leak across script submissions.');

    $large = $run("DELIMITER //
CREATE PROCEDURE $largeProcedure()
BEGIN
  WITH RECURSIVE sequence_rows AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM sequence_rows WHERE n < 205)
    SELECT n FROM sequence_rows;
  SELECT 'after limit' AS marker;
END//
DELIMITER ;
CALL $largeProcedure();
SELECT 99 AS after_large_call;");
    $largeSets = $rowSets($large['statements'][1]);
    $assert(count($largeSets) === 2 && count($largeSets[0]['rows']) === 200 && $largeSets[0]['truncated'] === true,
        'Each CALL rowset retains the normal bounded preview.');
    $assert($largeSets[1]['rows'] === [['after limit']] && $large['statements'][2]['rows'] === [['99']],
        'Truncating one rowset does not lose later rowsets or statements.');

    $partial = $runner->executeScript("INSERT INTO $table (id, label) VALUES (30, 'before error');
        SELECT * FROM `" . $name . "_absent`; INSERT INTO $table (id, label) VALUES (31, 'not run');");
    $assert($partial['executed'] === 1 && $partial['failed']['index'] === 2
        && $pdo->query("SELECT label FROM $table WHERE id = 30")->fetchColumn() === 'before error'
        && $pdo->query("SELECT COUNT(*) FROM $table WHERE id = 31")->fetchColumn() === '0',
        'A failure retains earlier autocommitted changes and stops later statements.');
    $run("DELIMITER //
CREATE PROCEDURE $errorProcedure()
BEGIN
  SELECT 1 AS before_error;
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'govern call failure';
END//
DELIMITER ;");
    $callFailure = $runner->executeScript("CALL $errorProcedure(); SELECT 55 AS not_run;");
    $assert($callFailure['failed']['index'] === 1 && str_contains($callFailure['failed']['detail'], 'govern call failure'),
        'An error from a later CALL rowset is visible instead of being discarded.');
    $afterError = $run('SELECT 56 AS recovered;');
    $assert($afterError['statements'][0]['rows'] === [['56']], 'A failed CALL does not poison later script submissions.');

    $beforeDelete = $pdo->query("SELECT COUNT(*) FROM $table")->fetchColumn();
    $pending = $runner->executeScript("INSERT INTO $table (id, label) VALUES (50, 'not yet'); DELETE FROM $table;");
    $assert($pending['confirm_required'] === true && $pending['destructive'][0]['reason'] === 'delete_no_where'
        && $pdo->query("SELECT COUNT(*) FROM $table")->fetchColumn() === $beforeDelete,
        'A normal destructive script executes nothing before confirmation, including earlier inserts.');
    $dropPending = $runner->executeScript("DROP VIEW $view;");
    $assert($dropPending['confirm_required'] === true, 'Dropping an object uses the existing confirmation step.');
    $dropped = $run("DROP VIEW $view;", true);
    $assert($dropped['executed'] === 1 && !in_array($name . '_view', array_column($catalog->tables(), 'name'), true),
        'Confirmed DROP really changes the live database.');
    $account = $run('SELECT CURRENT_USER();');
    $assert($account['statements'][0]['rows'] === [[$pdo->query('SELECT CURRENT_USER()')->fetchColumn()]],
        'Free SQL uses the existing scoped writer account.');
    try {
        $runner->execute("UPDATE $table SET label = 'reader changed' WHERE id = 20");
        throw new RuntimeException('The visual-design reader unexpectedly wrote data.');
    } catch (ApiException $exception) {
        $assert($exception->status === 403, 'Visual designs retain the separate read-only connection.');
    }
    echo "Free SQL integration checks: $passed passed.\n";
} finally {
    foreach (['DROP TRIGGER IF EXISTS ' . $trigger, 'DROP VIEW IF EXISTS ' . $view,
        'DROP PROCEDURE IF EXISTS ' . $errorProcedure, 'DROP PROCEDURE IF EXISTS ' . $largeProcedure,
        'DROP PROCEDURE IF EXISTS ' . $procedure, 'DROP FUNCTION IF EXISTS ' . $function,
        'DROP TABLE IF EXISTS ' . $table] as $sql) {
        $pdo->exec($sql);
    }
}
