<?php
declare(strict_types=1);

/** Real row edits in two explicitly named disposable databases; never use work data. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\BackupInputException;
use Govern\BackupService;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\DatabaseScope;
use Govern\QueryRunner;
use Govern\RowEditor;
use Govern\SavedQueries;

$base = Config::fromEnvironment();
$second = getenv('GOVERN_TEST_SECOND_DATABASE') ?: '';
$options = getopt('', ['confirm-database:', 'confirm-second-database:']);
if (($options['confirm-database'] ?? '') !== $base['name'] || $second === '' || $second === $base['name']
    || ($options['confirm-second-database'] ?? '') !== $second) {
    fwrite(STDERR, "Use two disposable databases and confirm both exact names with --confirm-database and --confirm-second-database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, array $statuses, string $message) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert(in_array($exception->status, $statuses, true), $message . ' (status ' . $exception->status . ')');
        return;
    }
    throw new RuntimeException($message);
};
$value = static fn (string $text): array => ['mode' => 'value', 'value' => $text];
$suffix = bin2hex(random_bytes(6));
$name = 'zz_govern_row_' . $suffix;
$names = ['main' => $name, 'auto' => $name . '_auto', 'unique' => $name . '_unique',
    'nullable' => $name . '_nullable', 'prefix' => $name . '_prefix', 'keyless' => $name . '_keyless',
    'binary' => $name . '_binary', 'decimal' => $name . '_decimal', 'numeric' => $name . '_numeric',
    'child' => $name . '_child', 'view' => $name . '_view'];
$q = array_map(Database::identifier(...), $names);
$scope = new DatabaseScope($base);
$configs = [$scope->select($base['name']), $scope->select($second)];
$databases = array_map(static fn (array $config): Database => new Database($config), $configs);
$pdos = array_map(static fn (Database $database): PDO => $database->writer(), $databases);
$editors = array_map(static fn (Database $database): RowEditor => new RowEditor($database), $databases);
$catalogs = array_map(static fn (Database $database): Catalog => new Catalog($database), $databases);
$queries = array_map(static fn (Database $database, array $config): SavedQueries => new SavedQueries($database, $config), $databases, $configs);
$queryIds = [null, null];
$snapshots = [];
$snapshotCleanup = [];
$key = ['tenant' => 'same', 'id' => '9007199254740993'];
$initialObjects = $pdos[1]->prepare('SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=?) +
    (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?) +
    (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?)');
$initialObjects->execute([$second, $second, $second]);
$canRestoreSecond = $initialObjects->fetchColumn() === '0';

try {
    $available = $scope->databases();
    $availableByName = array_column($available, null, 'name');
    $assert(isset($availableByName[$base['name']], $availableByName[$second])
        && $availableByName[$base['name']]['available'] && $availableByName[$second]['available'],
        'Discovery includes both accessible configured databases.');
    $assert(array_intersect(array_map('strtolower', array_keys($availableByName)),
        ['information_schema', 'mysql', 'performance_schema', 'sys']) === [], 'The picker does not expose system schemas.');
    $reject(static fn () => $scope->select('zz_govern_no_access_' . $suffix), [403],
        'A fabricated database cannot silently select or modify another schema.');
    $reject(static fn () => $scope->select('information_schema'), [403],
        'System schemas cannot become a working database.');
    $assert($base['name'] !== $configs[1]['name'] && $base['name'] === $configs[0]['name'],
        'Resolving a target returns an independent request configuration.');
    $assert(rtrim($configs[0]['backup_dir'], DIRECTORY_SEPARATOR) === rtrim($base['backup_dir'], DIRECTORY_SEPARATOR),
        'Default-database checkpoints keep their existing directory.');
    $assert(rtrim($configs[1]['backup_dir'], DIRECTORY_SEPARATOR) === rtrim($base['backup_dir'], DIRECTORY_SEPARATOR)
        . '/databases/' . hash('sha256', $second), 'Another database has its own stable checkpoint directory.');

    foreach ($pdos as $pdo) {
        $pdo->exec('CREATE TABLE ' . $q['main'] . " (
            tenant VARCHAR(30) NOT NULL,
            id BIGINT UNSIGNED NOT NULL,
            label VARCHAR(80) NOT NULL DEFAULT 'from default',
            note LONGTEXT NULL,
            amount DECIMAL(30,2) NOT NULL DEFAULT 0,
            optional_value INT NOT NULL DEFAULT 7,
            binary_value VARBINARY(32) NULL,
            display_label VARCHAR(100) GENERATED ALWAYS AS (CONCAT(label,'!')) STORED,
            PRIMARY KEY (tenant,id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $statement = $pdo->prepare('INSERT INTO ' . $q['main'] . ' (tenant,id,label,note,amount) VALUES (?,?,?,?,?)');
        $statement->execute(['same', '9007199254740993', 'shared', null, '123456789012345678901234.12']);
    }
    $first = $editors[0]->describe($name, $key);
    $other = $editors[1]->describe($name, $key);
    $columns = array_column($first['columns'], null, 'name');
    $assert($first['key_columns'] === ['tenant', 'id'] && $first['key'] === $key,
        'A full composite primary key identifies the row without number conversion.');
    $assert($first['row']['id'] === '9007199254740993'
        && $first['row']['amount'] === '123456789012345678901234.12', 'The exact row endpoint preserves BIGINT and DECIMAL values.');
    $assert($first['version'] !== $other['version'], 'Identical table names, keys and values still produce database-scoped row versions.');
    $assert($columns['display_label']['generated'] && !$columns['display_label']['editable'],
        'Generated fields are displayed as computed values, not writable inputs.');
    $page = $catalogs[0]->browse($name, 1, 25, '');
    $assert($page['key_columns'] === ['tenant', 'id'] && $page['row_keys'] === [$key],
        'Browse returns exact row references aligned with its visible rows.');

    $changed = $editors[0]->update(['table' => $name, 'key' => $key, 'version' => $first['version'],
        'values' => ['label' => $value('changed in A')]]);
    $assert($changed['affected_rows'] === 1 && $editors[0]->describe($name, $key)['row']['label'] === 'changed in A',
        'An edit is written and visible in the selected database.');
    $assert($editors[1]->describe($name, $key)['row']['label'] === 'shared', 'The same row in the other database remains unchanged.');
    foreach ($databases as $index => $database) {
        $result = (new QueryRunner($database))->executeScript('SELECT DATABASE(),label FROM ' . $q['main'], false);
        $assert($result['failed'] === null && $result['statements'][0]['rows'] === [[$configs[$index]['name'], $index === 0 ? 'changed in A' : 'shared']],
            'A query starts in its explicitly selected schema and reads that schema\'s own table.');
    }
    $reject(static fn () => $editors[1]->update(['table' => $name, 'key' => $key, 'version' => $first['version'],
        'values' => ['label' => $value('wrong database')]]), [409], 'A row version cannot be replayed in another database.');

    $insertKey = ['tenant' => 'same', 'id' => '9007199254740994'];
    $literal = "literal ' ; DROP TABLE ignored; -- nü";
    $inserted = $editors[0]->insert(['table' => $name, 'values' => [
        'tenant' => $value($insertKey['tenant']), 'id' => $value($insertKey['id']), 'label' => $value($literal),
        'note' => ['mode' => 'null'], 'amount' => $value('123456789012345678901234.13'),
        'optional_value' => ['mode' => 'default'], 'binary_value' => $value('ff0027'),
    ]]);
    $insertedRow = $editors[0]->describe($name, $insertKey);
    $assert($inserted['affected_rows'] === 1 && $insertedRow['row']['label'] === $literal
        && $insertedRow['row']['amount'] === '123456789012345678901234.13', 'Insert values remain bound data with exact decimal precision.');
    $assert($insertedRow['row']['note'] === null && $insertedRow['row']['optional_value'] === '7',
        'SQL NULL and use-default are distinct insert modes.');
    $assert(strtolower($insertedRow['row']['binary_value']) === 'ff0027'
        && $columns['binary_value']['encoding'] === 'hex', 'Binary data has an explicit exact hex representation.');
    $assert($insertedRow['row']['display_label'] === $literal . '!', 'The database computes generated columns on insert.');
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $insertedRow['version'], 'values' => ['display_label' => $value('forged')]]), [400, 422],
        'A forged generated-column input is rejected.');
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $insertedRow['version'], 'values' => ['label`=1; DROP TABLE x; --' => $value('forged')]]), [400, 422],
        'A fabricated column cannot become an SQL identifier.');
    $reject(static fn () => $editors[0]->describe($name . '`; DROP TABLE ignored; --', $key), [400, 404, 422],
        'An uncatalogued table cannot become an SQL identifier.');
    $reject(static fn () => $editors[0]->describe($name, ['tenant' => 'same']), [400, 422],
        'An incomplete composite key cannot select an arbitrary record.');
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $insertedRow['version'], 'values' => ['amount' => ['mode' => 'value', 'value' => 12.5]]]), [400, 422],
        'A JSON numeric value is rejected instead of silently converting exact decimal input.');
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $insertedRow['version'], 'values' => ['label' => ['mode' => 'null']]]), [400, 422],
        'A non-nullable field cannot be forced into SQL NULL.');
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $insertedRow['version'], 'values' => ['binary_value' => $value('not hex')]]), [400, 422],
        'An invalid binary encoding is rejected before the record changes.');

    $editors[0]->update(['table' => $name, 'key' => $insertKey, 'version' => $insertedRow['version'],
        'values' => ['note' => $value(''), 'optional_value' => $value('13')]]);
    $empty = $editors[0]->describe($name, $insertKey);
    $assert($empty['row']['note'] === '' && $empty['row']['optional_value'] === '13', 'An empty string is stored separately from NULL.');
    $editors[0]->update(['table' => $name, 'key' => $insertKey, 'version' => $empty['version'],
        'values' => ['note' => ['mode' => 'null'], 'optional_value' => ['mode' => 'default']]]);
    $defaults = $editors[0]->describe($name, $insertKey);
    $assert($defaults['row']['note'] === null && $defaults['row']['optional_value'] === '7',
        'Update default mode is evaluated by the database and NULL remains distinct.');

    $stale = $editors[0]->describe($name, $insertKey);
    $independent = (new Database($configs[0]))->writer();
    $statement = $independent->prepare('UPDATE ' . $q['main'] . ' SET label=? WHERE tenant=? AND id=?');
    $statement->execute(['external edit', $insertKey['tenant'], $insertKey['id']]);
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $stale['version'], 'values' => ['label' => $value('stale overwrite')]]), [409],
        'A stale form cannot overwrite a change made by another connection.');
    $assert($editors[0]->describe($name, $insertKey)['row']['label'] === 'external edit', 'Conflict rejection preserves the newer stored data.');
    $reject(static fn () => $editors[0]->delete(['table' => $name, 'key' => $insertKey, 'version' => $stale['version']]),
        [409], 'A stale delete cannot remove a newer version.');

    $large = str_repeat('exact original ', 15000);
    $statement = $pdos[0]->prepare('UPDATE ' . $q['main'] . ' SET note=? WHERE tenant=? AND id=?');
    $statement->execute([$large, $insertKey['tenant'], $insertKey['id']]);
    $largeRow = $editors[0]->describe($name, $insertKey);
    $largeColumns = array_column($largeRow['columns'], null, 'name');
    $assert(!$largeColumns['note']['editable'] && $largeColumns['note']['large'], 'An oversized field is an explicit read-only preview.');
    $editors[0]->update(['table' => $name, 'key' => $insertKey, 'version' => $largeRow['version'],
        'values' => ['label' => $value('other field saved')]]);
    $statement = $pdos[0]->prepare('SELECT note FROM ' . $q['main'] . ' WHERE tenant=? AND id=?');
    $statement->execute(array_values($insertKey));
    $assert($statement->fetchColumn() === $large, 'Saving another field never replaces the original large value with its preview.');
    $largeBeforeConflict = $editors[0]->describe($name, $insertKey);
    $statement = $independent->prepare('UPDATE ' . $q['main'] . ' SET note=? WHERE tenant=? AND id=?');
    $statement->execute([$large . 'changed beyond the preview', $insertKey['tenant'], $insertKey['id']]);
    $reject(static fn () => $editors[0]->update(['table' => $name, 'key' => $insertKey,
        'version' => $largeBeforeConflict['version'], 'values' => ['label' => $value('stale preview overwrite')]]), [409],
        'An unseen change beyond a large-field preview still invalidates the row version.');

    $beforeKeyChange = $editors[0]->describe($name, $insertKey);
    $newKey = ['tenant' => 'new tenant', 'id' => '9007199254740996'];
    $moved = $editors[0]->update(['table' => $name, 'key' => $insertKey, 'version' => $beforeKeyChange['version'],
        'values' => ['tenant' => $value($newKey['tenant']), 'id' => $value($newKey['id'])]]);
    $assert($moved['key'] === $newKey && $editors[0]->describe($name, $newKey)['row']['label'] === 'other field saved',
        'Changing a primary key returns the complete new record identity.');
    $reject(static fn () => $editors[0]->describe($name, $insertKey), [404], 'The previous primary key no longer selects a moved record.');

    $pdos[0]->exec('CREATE TABLE ' . $q['auto'] . " (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        label VARCHAR(30) NOT NULL DEFAULT 'automatic', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    $assert(in_array($names['auto'], array_column($catalogs[0]->tables(), 'name'), true)
        && !in_array($names['auto'], array_column($catalogs[1]->tables(), 'name'), true),
        'The table catalog only includes objects from its selected schema.');
    $reject(static fn () => $editors[1]->describe($names['auto']), [404],
        'An object existing only in another schema cannot be edited through the selected schema.');
    $auto = $editors[0]->insert(['table' => $names['auto'], 'values' => ['label' => ['mode' => 'default']]]);
    $assert(is_string($auto['key']['id']) && ctype_digit($auto['key']['id'])
        && $editors[0]->describe($names['auto'], $auto['key'])['row']['label'] === 'automatic',
        'Auto-increment and expression defaults are assigned by the database.');
    $pdos[0]->exec('CREATE TABLE ' . $q['unique'] . ' (code VARCHAR(30) NOT NULL UNIQUE, label VARCHAR(30)) ENGINE=InnoDB');
    $pdos[0]->exec('INSERT INTO ' . $q['unique'] . " VALUES ('one','unique')");
    $unique = $editors[0]->describe($names['unique'], ['code' => 'one']);
    $assert($unique['editable'] && $unique['key_columns'] === ['code'], 'A complete non-null unique key can identify an editable row.');
    $pdos[0]->exec('CREATE TABLE ' . $q['nullable'] . ' (code VARCHAR(30) NULL UNIQUE, label VARCHAR(30)) ENGINE=InnoDB');
    $pdos[0]->exec('INSERT INTO ' . $q['nullable'] . " VALUES (NULL,'first'),(NULL,'second')");
    $assert(!$editors[0]->describe($names['nullable'])['editable'], 'A nullable unique index does not invent a safe identity.');
    $pdos[0]->exec('CREATE TABLE ' . $q['prefix'] . ' (code VARCHAR(30) NOT NULL, label VARCHAR(30), UNIQUE KEY prefix_code(code(5))) ENGINE=InnoDB');
    $assert(!$editors[0]->describe($names['prefix'])['editable'], 'A prefix-only unique index is not treated as a full record key.');
    $pdos[0]->exec('CREATE TABLE ' . $q['keyless'] . ' (id INT, label VARCHAR(30)) ENGINE=InnoDB');
    $pdos[0]->exec('INSERT INTO ' . $q['keyless'] . " VALUES (1,'duplicate'),(1,'duplicate')");
    $keyless = $editors[0]->describe($names['keyless']);
    $keylessPage = $catalogs[0]->browse($names['keyless'], 1, 25, '');
    $assert(!$keyless['editable'] && $keyless['can_insert'] && $keylessPage['row_keys'] === [null, null],
        'Duplicate keyless rows remain browseable without unsafe edit references.');
    $editors[0]->insert(['table' => $names['keyless'], 'values' => ['id' => $value('2'), 'label' => $value('new row')]]);
    $assert($pdos[0]->query('SELECT COUNT(*) FROM ' . $q['keyless'])->fetchColumn() === '3',
        'A base table without a key can still accept a new row.');
    $reject(static fn () => $editors[0]->update(['table' => $names['keyless'], 'key' => ['id' => '1'],
        'version' => str_repeat('a', 64), 'values' => ['label' => $value('unsafe')]]), [400, 409, 422],
        'A keyless update is rejected rather than choosing a duplicate row.');

    $pdos[0]->exec('CREATE TABLE ' . $q['binary'] . ' (id VARBINARY(12) PRIMARY KEY, label VARCHAR(30)) ENGINE=InnoDB');
    $pdos[0]->exec('INSERT INTO ' . $q['binary'] . " VALUES (UNHEX('ff0027'),'binary key')");
    $binaryPage = $catalogs[0]->browse($names['binary'], 1, 25, '');
    $binaryKey = $binaryPage['row_keys'][0];
    $binary = $editors[0]->describe($names['binary'], $binaryKey);
    $assert(strtolower($binaryKey['id']) === 'ff0027' && strtolower($binary['row']['id']) === 'ff0027',
        'Binary record keys come from exact bytes rather than display text.');
    $editors[0]->update(['table' => $names['binary'], 'key' => $binaryKey, 'version' => $binary['version'],
        'values' => ['label' => $value('changed binary key row')]]);
    $assert($editors[0]->describe($names['binary'], $binaryKey)['row']['label'] === 'changed binary key row',
        'An exact binary key updates its intended row.');
    $pdos[0]->exec('CREATE TABLE ' . $q['decimal'] . ' (id DECIMAL(30,2) PRIMARY KEY, label VARCHAR(30)) ENGINE=InnoDB');
    $pdos[0]->exec('INSERT INTO ' . $q['decimal'] . " VALUES (0.00,'zero'),(9007199254740993.00,'adjacent'),(9007199254740993.01,'target')");
    $decimalKey = ['id' => '9007199254740993.01'];
    $decimalPage = $catalogs[0]->browse($names['decimal'], 1, 25, '');
    $assert($decimalPage['row_keys'] === [['id' => '0.00'], ['id' => '9007199254740993.00'], $decimalKey],
        'DECIMAL record references preserve neighboring keys beyond binary floating-point precision.');
    $decimalRow = $editors[0]->describe($names['decimal'], $decimalKey);
    $assert($decimalRow['row']['label'] === 'target' && $decimalRow['key'] === $decimalKey,
        'A DECIMAL key reads its exact record without approximate numeric coercion.');
    foreach (['bad', '1e0', '9007199254740993.001', ['0.00'], 0] as $invalidKey) {
        $reject(static fn () => $editors[0]->describe($names['decimal'], ['id' => $invalidKey]), [422],
            'Malformed, over-precision or non-string DECIMAL keys cannot match an unintended numeric row.');
    }
    $decimalChanged = $editors[0]->update(['table' => $names['decimal'], 'key' => $decimalKey,
        'version' => $decimalRow['version'], 'values' => ['label' => $value('exact decimal changed')]]);
    $assert($decimalChanged['affected_rows'] === 1
        && $editors[0]->describe($names['decimal'], $decimalKey)['row']['label'] === 'exact decimal changed'
        && $editors[0]->describe($names['decimal'], ['id' => '9007199254740993.00'])['row']['label'] === 'adjacent',
        'Updating a precise DECIMAL key preserves the adjacent representable record.');
    $decimalCurrent = $editors[0]->describe($names['decimal'], $decimalKey);
    $editors[0]->delete(['table' => $names['decimal'], 'key' => $decimalKey, 'version' => $decimalCurrent['version']]);
    $assert($pdos[0]->query('SELECT COUNT(*) FROM ' . $q['decimal'])->fetchColumn() === '2'
        && $editors[0]->describe($names['decimal'], ['id' => '0.00'])['row']['label'] === 'zero',
        'Deleting an exact DECIMAL key removes one record and preserves the numeric zero trap.');
    $pdos[0]->exec('CREATE TABLE ' . $q['numeric'] . ' (`0` BIGINT UNSIGNED PRIMARY KEY, `1` VARCHAR(40)) ENGINE=InnoDB');
    $numericKey = ['0' => '9007199254740997'];
    $numericInsert = $editors[0]->insert(['table' => $names['numeric'],
        'values' => ['0' => $value($numericKey['0']), '1' => $value('numeric identifiers')]]);
    $numericRow = $editors[0]->describe($names['numeric'], $numericKey);
    $assert($numericInsert['affected_rows'] === 1 && $numericInsert['key'] === $numericKey
        && $numericRow['key_columns'] === ['0'] && $numericRow['row']['1'] === 'numeric identifiers',
        'Numeric-only column names remain valid field and primary-key identifiers.');
    $numericChanged = $editors[0]->update(['table' => $names['numeric'], 'key' => $numericKey,
        'version' => $numericRow['version'], 'values' => ['1' => $value('numeric field changed')]]);
    $numericPage = $catalogs[0]->browse($names['numeric'], 1, 25, '');
    $assert($numericChanged['affected_rows'] === 1 && $numericChanged['key'] === $numericKey
        && $numericPage['row_keys'] === [$numericKey] && $numericPage['rows'][0]['1'] === 'numeric field changed',
        'Numeric-only fields stay mapped to their column names through edit and browse.');
    $pdos[0]->exec('CREATE VIEW ' . $q['view'] . ' AS SELECT tenant,id,label FROM ' . $q['main']);
    $view = $editors[0]->describe($names['view']);
    $assert(!$view['editable'] && !$view['can_insert'], 'Views retain an honest official-tool route instead of guessed editability.');

    $pdos[0]->exec('CREATE TABLE ' . $q['child'] . ' (id INT PRIMARY KEY, tenant VARCHAR(30) NOT NULL, parent_id BIGINT UNSIGNED NOT NULL,
        FOREIGN KEY (tenant,parent_id) REFERENCES ' . $q['main'] . '(tenant,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $pdos[0]->exec('INSERT INTO ' . $q['child'] . " VALUES (1,'same',9007199254740993)");
    $parentRow = $editors[0]->describe($name, $key);
    $reject(static fn () => $editors[0]->delete(['table' => $name, 'key' => $key, 'version' => $parentRow['version']]),
        [409, 422], 'A foreign-key rejection is returned without losing the parent row.');
    $assert($editors[0]->describe($name, $key)['row']['label'] === 'changed in A', 'A failed delete preserves the original record.');
    $deleteRow = $editors[0]->describe($name, $newKey);
    $deleted = $editors[0]->delete(['table' => $name, 'key' => $newKey, 'version' => $deleteRow['version']]);
    $assert($deleted['affected_rows'] === 1, 'Deleting an identified row reports one actual removed record.');
    $reject(static fn () => $editors[0]->describe($name, $newKey), [404], 'The deleted record is absent when read again.');

    foreach ($queries as $index => $saved) {
        $item = $saved->save(['name' => 'multi-db ' . $suffix . ' ' . $index, 'sql' => 'SELECT ' . ($index + 1) . ' AS scoped_value', 'notes' => 'isolated probe']);
        $queryIds[$index] = $item['id'];
    }
    $aNames = array_column($queries[0]->list(), 'name');
    $bNames = array_column($queries[1]->list(), 'name');
    $assert(in_array('multi-db ' . $suffix . ' 0', $aNames, true) && !in_array('multi-db ' . $suffix . ' 1', $aNames, true)
        && in_array('multi-db ' . $suffix . ' 1', $bNames, true) && !in_array('multi-db ' . $suffix . ' 0', $bNames, true),
        'Saved research stays in the selected database, even when record IDs overlap.');

    $backups = array_map(static fn (array $config): BackupService => new BackupService($config), $configs);
    foreach ($backups as $index => $backup) {
        $snapshots[$index] = $backup->create('multi-db probe ' . $suffix . ' ' . $index);
        $snapshotCleanup[] = [$configs[$index]['backup_dir'], $snapshots[$index]['id']];
    }
    $assert(in_array($snapshots[0]['id'], array_column($backups[0]->list(), 'id'), true)
        && !in_array($snapshots[1]['id'], array_column($backups[0]->list(), 'id'), true)
        && in_array($snapshots[1]['id'], array_column($backups[1]->list(), 'id'), true)
        && !in_array($snapshots[0]['id'], array_column($backups[1]->list(), 'id'), true),
        'Checkpoint lists stay separate for the two selected schemas.');
    try {
        $backups[1]->restore($snapshots[0]['id'], $second);
        throw new RuntimeException('A checkpoint from another database was accepted.');
    } catch (BackupInputException $exception) {
        $assert($exception->errorCode === 'snapshot_missing', 'Cross-database restore cannot locate or apply another schema checkpoint.');
    }
    $assert($editors[1]->describe($name, $key)['row']['label'] === 'shared', 'Rejecting cross-database restore leaves the other database untouched.');
    if ($canRestoreSecond) {
        // Only the initially empty, explicitly confirmed second schema is ever
        // recreated. Its current objects and saved queries belong to this run.
        $statement = $pdos[1]->prepare('UPDATE ' . $q['main'] . ' SET label=? WHERE tenant=? AND id=?');
        $statement->execute(['after checkpoint', ...array_values($key)]);
        $assert($editors[1]->describe($name, $key)['row']['label'] === 'after checkpoint',
            'The second-schema restore probe changes its own checkpointed row.');
        try {
            $restored = $backups[1]->restore($snapshots[1]['id'], $second);
        } finally {
            // A restore creates an automatic safety checkpoint, including on a
            // failed apply. Only this run's exact target label is cleaned up.
            foreach ($backups[1]->list() as $snapshot) {
                if ($snapshot['label'] === 'Automatisch vóór terugzetten van ' . $snapshots[1]['id']) {
                    $snapshotCleanup[] = [$configs[1]['backup_dir'], $snapshot['id']];
                }
            }
        }
        $assert($restored['restored'] === $snapshots[1]['id'] && $restored['safety_snapshot'] !== null,
            'The selected second-schema checkpoint restores with its own safety export.');
        $assert($editors[1]->describe($name, $key)['row']['label'] === 'shared',
            'A second-schema restore brings back its checkpointed data.');
        $assert($editors[0]->describe($name, $key)['row']['label'] === 'changed in A',
            'Restoring the second schema preserves the independent first-schema marker.');
        $assert(in_array('multi-db ' . $suffix . ' 1', array_column($queries[1]->list(), 'name'), true),
            'Saved queries created during this test survive their selected-schema checkpoint restore.');
    } else {
        echo "Second-schema restore skipped: the explicitly confirmed schema contained pre-existing objects.\n";
    }
    echo "Multi-database and row editing integration checks: $passed passed.\n";
} finally {
    foreach ($queries as $index => $saved) {
        if ($queryIds[$index] !== null) $saved->delete($queryIds[$index]);
    }
    foreach ($snapshotCleanup as [$directory, $id]) {
        foreach (['sql', 'json'] as $extension) {
            $file = rtrim($directory, DIRECTORY_SEPARATOR) . '/' . $id . '.' . $extension;
            if (is_file($file)) unlink($file);
        }
    }
    foreach ($pdos as $pdo) {
        foreach (['view', 'child', 'numeric', 'decimal', 'binary', 'keyless', 'prefix', 'nullable', 'unique', 'auto', 'main'] as $keyName) {
            $pdo->exec(($keyName === 'view' ? 'DROP VIEW IF EXISTS ' : 'DROP TABLE IF EXISTS ') . $q[$keyName]);
        }
    }
}
