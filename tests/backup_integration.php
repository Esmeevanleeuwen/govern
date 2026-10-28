<?php
declare(strict_types=1);

/**
 * Destructive integration test: ONLY use a disposable test database.
 * Usage: DB_*... php tests/backup_integration.php --confirm-database=govern_test
 * Container copy: set GOVERN_APP_ROOT=/var/www for the application's source path.
 * This test restores its original baseline and removes its own checkpoint files.
 */
$appRoot = getenv('GOVERN_APP_ROOT') ?: dirname(__DIR__) . '/app';
require $appRoot . '/src/bootstrap.php';

set_exception_handler(static function (Throwable $exception): never {
    fwrite(STDERR, 'Backup-integratie kon niet beginnen: ' . $exception->getMessage() . "\n");
    exit(1);
});

use Govern\BackupService;
use Govern\Config;

$options = getopt('', ['confirm-database:']);
$config = Config::fromEnvironment();
if (!isset($options['confirm-database']) || !hash_equals($config['name'], (string) $options['confirm-database'])) {
    fwrite(STDERR, "Alleen voor een wegwerp-testdatabase. Geef --confirm-database=EXACTE_NAAM mee.\n");
    exit(2);
}
$service = new BackupService($config);
$quote = static fn(string $name): string => '`' . str_replace('`', '``', $name) . '`';
$connect = static function (bool $selectDatabase = true) use ($config): PDO {
    $dsn = $config['socket'] !== ''
        ? 'mysql:unix_socket=' . $config['socket']
        : 'mysql:host=' . $config['host'] . ';port=' . $config['port'];
    if ($selectDatabase) {
        $dsn .= ';dbname=' . $config['name'];
    }
    $pdo = new PDO($dsn . ';charset=utf8mb4', $config['user'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
    ]);
    $pdo->exec("SET time_zone='+00:00'");
    return $pdo;
};
$catalog = static function (PDO $pdo) use ($config): array {
    $statement = $pdo->prepare('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME');
    $statement->execute([$config['name']]);
    return $statement->fetchAll();
};
$checks = [];
$check = static function (bool $condition, string $label) use (&$checks): void {
    if (!$condition) {
        throw new RuntimeException('Controle mislukt: ' . $label);
    }
    $checks[] = $label;
};
$created = [];
$remember = static function (?array $snapshot) use (&$created): void {
    if ($snapshot !== null) {
        $created[$snapshot['id']] = true;
    }
};
$baseline = null;
$failure = null;
$restoredBaseline = false;
$pdo = $connect();
$originalCatalog = $catalog($pdo);
$originalCounts = [];
foreach ($originalCatalog as $table) {
    if ($table['TABLE_TYPE'] === 'BASE TABLE') {
        $originalCounts[$table['TABLE_NAME']] = (int) $pdo->query('SELECT COUNT(*) FROM ' . $quote($table['TABLE_NAME']))->fetchColumn();
    }
}
$prefix = '_govern_test_' . bin2hex(random_bytes(5));
$names = [];
foreach (['data', 'log', 'view', 'function', 'procedure', 'trigger', 'event', 'later'] as $kind) {
    $names[$kind] = $prefix . '_' . $kind;
}
$t = $quote($names['data']);
$log = $quote($names['log']);
$view = $quote($names['view']);
$function = $quote($names['function']);
$procedure = $quote($names['procedure']);
$trigger = $quote($names['trigger']);
$event = $quote($names['event']);
$later = $quote($names['later']);
$unicode = 'café; Δ — 🧪';

try {
    $baseline = $service->create('Integratietest: oorspronkelijke toestand');
    $remember($baseline);
    $pdo->exec("CREATE TABLE $t (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, title VARCHAR(150) NOT NULL, amount INT NOT NULL, doubled INT GENERATED ALWAYS AS (amount * 2) STORED, note TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE $log (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, data_id INT NOT NULL, payload TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE FUNCTION $function (p_label VARCHAR(150)) RETURNS VARCHAR(255) DETERMINISTIC BEGIN DECLARE marker VARCHAR(100) DEFAULT 'café; Δ — 🧪'; RETURN CONCAT(p_label, ' / ', marker); END");
    $pdo->exec("CREATE PROCEDURE $procedure (IN p_label VARCHAR(150)) BEGIN INSERT INTO $t (title, amount, note) VALUES (p_label, 3, 'procedure; café'); END");
    $pdo->exec("CREATE TRIGGER $trigger AFTER INSERT ON $t FOR EACH ROW INSERT INTO $log (data_id, payload) VALUES (NEW.id, CONCAT('trigger: ', NEW.note))");
    $pdo->exec("CREATE VIEW $view AS SELECT id, doubled, $function(title) AS explanation FROM $t");
    $pdo->exec("CREATE EVENT $event ON SCHEDULE EVERY 1 DAY STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY ON COMPLETION PRESERVE DISABLE DO UPDATE $t SET amount=amount+1");
    $statement = $pdo->prepare("INSERT INTO $t (title,amount,note) VALUES (?,21,?)");
    $statement->execute(['Eerste', $unicode]);
    $pdo->exec("CALL $procedure('Tweede')");
    $expectedData = $pdo->query("SELECT * FROM $t ORDER BY id")->fetchAll();
    $expectedLog = $pdo->query("SELECT * FROM $log ORDER BY id")->fetchAll();
    $expectedView = $pdo->query("SELECT * FROM $view ORDER BY id")->fetchAll();
    $target = $service->create('Integratietest: gegevens, view, routine, trigger en event');
    $remember($target);
    $check(is_file($service->download($target['id'])['path']), 'SQL-export bestaat en checksum klopt');

    $pdo->exec("UPDATE $t SET amount=99, note='gewijzigd'");
    $pdo->exec("ALTER TABLE $t ADD COLUMN experiment VARCHAR(40) NULL");
    $pdo->exec("CREATE TABLE $later (id INT PRIMARY KEY)");
    $pdo->exec("DROP VIEW $view");
    $pdo->exec("DROP PROCEDURE $procedure");
    $pdo->exec("DROP FUNCTION $function");
    $pdo->exec("DROP TRIGGER $trigger");
    $pdo->exec("DROP EVENT $event");

    $rejected = false;
    try {
        $service->restore($target['id'], 'verkeerde_database');
    } catch (InvalidArgumentException) {
        $rejected = true;
    }
    $check($rejected && (int) $pdo->query("SELECT amount FROM $t WHERE id=1")->fetchColumn() === 99, 'Verkeerde bevestiging heeft geen bijwerking');

    // A separate, owned fixture checks hash refusal without damaging real snapshots.
    $corruptId = gmdate('Ymd\THis\Z') . '_' . bin2hex(random_bytes(8));
    $manifestPath = $config['backup_dir'] . '/' . $target['id'] . '.json';
    $manifest = json_decode(file_get_contents($manifestPath), true, 32, JSON_THROW_ON_ERROR);
    $manifest['id'] = $corruptId;
    $corruptSql = file_get_contents($service->download($target['id'])['path']);
    $corruptSql[10] = $corruptSql[10] === 'X' ? 'Y' : 'X';
    file_put_contents($config['backup_dir'] . '/' . $corruptId . '.sql', $corruptSql);
    file_put_contents($config['backup_dir'] . '/' . $corruptId . '.json', json_encode($manifest, JSON_THROW_ON_ERROR));
    $created[$corruptId] = true;
    $rejected = false;
    try {
        $service->restore($corruptId, $config['name']);
    } catch (RuntimeException) {
        $rejected = true;
    }
    $check($rejected && (int) $pdo->query("SELECT amount FROM $t WHERE id=1")->fetchColumn() === 99, 'Gewijzigde SQL-export wordt vóór DROP geweigerd');

    $result = $service->restore($target['id'], $config['name']);
    $remember($result['safety_snapshot']);
    $check($result['safety_snapshot'] !== null, 'Automatisch herstelpunt bewaart de toestand vóór terugzetten');
    $pdo = $connect();
    $check($pdo->query("SELECT * FROM $t ORDER BY id")->fetchAll() === $expectedData, 'Gegevens en berekende kolom herstellen exact');
    $check($pdo->query("SELECT * FROM $log ORDER BY id")->fetchAll() === $expectedLog, 'Triggergegevens zijn niet dubbel uitgevoerd bij import');
    $check($pdo->query("SELECT * FROM $view ORDER BY id")->fetchAll() === $expectedView, 'View en Unicode-functie herstellen exact');
    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?');
    $statement->execute([$config['name'], $names['later']]);
    $check((int) $statement->fetchColumn() === 0, 'Een tabel van na het herstelpunt is verwijderd');
    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?');
    $statement->execute([$config['name'], $names['data'], 'experiment']);
    $check((int) $statement->fetchColumn() === 0, 'Een later toegevoegde kolom is verwijderd');
    $pdo->exec("CALL $procedure('Derde')");
    $check((int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn() === 3
        && (int) $pdo->query("SELECT COUNT(*) FROM $log")->fetchColumn() === 3, 'Procedure en trigger werken na herstel');
    $statement = $pdo->prepare('SELECT STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA=? AND EVENT_NAME=?');
    $statement->execute([$config['name'], $names['event']]);
    $check($statement->fetchColumn() === 'DISABLED', 'Event en uitgeschakelde status zijn behouden');

    // Recovery must remain possible even after phpMyAdmin dropped the whole DB.
    $server = $connect(false);
    $server->exec('DROP DATABASE ' . $quote($config['name']));
    $result = $service->restore($target['id'], $config['name']);
    $check($result['safety_snapshot'] === null, 'Ontbrekende database herstelt zonder fictieve voorafgaande backup');
    $pdo = $connect();
    $check($pdo->query("SELECT * FROM $t ORDER BY id")->fetchAll() === $expectedData, 'Volledige data herstelt na DROP DATABASE');
} catch (Throwable $exception) {
    $failure = $exception;
} finally {
    if ($baseline !== null) {
        try {
            $result = $service->restore($baseline['id'], $config['name']);
            $remember($result['safety_snapshot']);
            $pdo = $connect();
            $check($catalog($pdo) === $originalCatalog, 'Oorspronkelijke tabellen en views zijn teruggezet');
            foreach ($originalCounts as $name => $count) {
                if ((int) $pdo->query('SELECT COUNT(*) FROM ' . $quote($name))->fetchColumn() !== $count) {
                    throw new RuntimeException('Oorspronkelijk rijaantal wijkt af in ' . $name);
                }
            }
            $check(true, 'Oorspronkelijke rijaantallen zijn behouden');
            $restoredBaseline = true;
        } catch (Throwable $restoreFailure) {
            $failure = $restoreFailure;
            fwrite(STDERR, 'Oorspronkelijk herstelpunt bewaren: ' . $baseline['id'] . "\n");
        }
    }
    if ($restoredBaseline) {
        foreach (array_keys($created) as $id) {
            foreach (['json', 'sql'] as $extension) {
                $path = $config['backup_dir'] . '/' . $id . '.' . $extension;
                if (is_file($path)) {
                    unlink($path);
                }
            }
        }
    }
}

if ($failure !== null) {
    fwrite(STDERR, 'Backup-integratie mislukt: ' . $failure->getMessage() . "\n");
    exit(1);
}
echo json_encode(['passed' => count($checks), 'failed' => 0, 'original_database_restored' => $restoredBaseline, 'checks' => $checks], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
