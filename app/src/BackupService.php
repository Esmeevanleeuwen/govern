<?php
declare(strict_types=1);

namespace Govern;

use InvalidArgumentException;
use JsonException;
use PDO;
use RuntimeException;
use Throwable;

/** SQL checkpoints of one configured working database; no proprietary format. */
final class BackupService
{
    private const ID_PATTERN = '/\A[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}\z/';
    private string $directory;

    public function __construct(private readonly array $config)
    {
        $this->directory = rtrim((string) $config['backup_dir'], DIRECTORY_SEPARATOR);
        if ($this->directory === '' || str_contains($this->directory, "\0")) {
            throw new RuntimeException('De map voor herstelpunten is ongeldig.');
        }
        if (!is_dir($this->directory) && !mkdir($this->directory, 0700, true) && !is_dir($this->directory)) {
            throw new RuntimeException('De map voor herstelpunten kon niet worden aangemaakt.');
        }
        if (!is_writable($this->directory)) {
            throw new RuntimeException('De map voor herstelpunten is niet beschrijfbaar.');
        }
    }

    public function list(): array
    {
        return $this->locked(LOCK_SH, function (): array {
            $snapshots = [];
            foreach (glob($this->directory . '/*.json') ?: [] as $path) {
                $id = basename($path, '.json');
                if (!preg_match(self::ID_PATTERN, $id)) {
                    continue;
                }
                try {
                    $snapshots[] = $this->descriptor($this->readManifest($id, false));
                } catch (InvalidArgumentException | RuntimeException | JsonException) {
                    // An unfinished or externally damaged export is not a restore point.
                }
            }
            usort($snapshots, static fn(array $a, array $b): int => strcmp($b['id'], $a['id']));
            return $snapshots;
        });
    }

    public function create(string $label): array
    {
        $label = trim($label);
        if ($label === '' || strlen($label) > 600 || !preg_match('//u', $label)) {
            throw new InvalidArgumentException('Geef het herstelpunt een korte, leesbare naam.');
        }
        return $this->locked(LOCK_EX, fn(): array => $this->createUnlocked($label));
    }

    public function download(string $id): array
    {
        return $this->locked(LOCK_SH, function () use ($id): array {
            $this->readManifest($id, true);
            return ['path' => $this->path($id, 'sql'), 'filename' => 'govern-' . $id . '.sql'];
        });
    }

    public function restore(string $id, string $confirmation): array
    {
        if (!hash_equals((string) $this->config['name'], $confirmation)) {
            throw new InvalidArgumentException('Typ de exacte databasenaam om het terugzetten te bevestigen.');
        }
        return $this->locked(LOCK_EX, function () use ($id): array {
            $manifest = $this->readManifest($id, true);
            $pdo = $this->serverConnection();
            $this->validateCollation($pdo, $manifest);
            $exists = $this->databaseSettings($pdo) !== null;
            $safety = $exists ? $this->createUnlocked('Automatisch vóór terugzetten van ' . $id) : null;
            try {
                $this->applySnapshot($pdo, $manifest);
            } catch (Throwable $failure) {
                if ($safety !== null) {
                    try {
                        $this->applySnapshot($pdo, $this->readManifest($safety['id'], true));
                    } catch (Throwable $recoveryFailure) {
                        throw new RuntimeException(
                            'Het terugzetten en automatisch herstel zijn gestopt. De database kan gedeeltelijk zijn hersteld. '
                            . 'Het herstelpunt ' . $safety['id'] . ' is bewaard.', 0, $recoveryFailure
                        );
                    }
                    throw new RuntimeException(
                        'Het gekozen herstelpunt kon niet worden teruggezet. De vorige toestand is hersteld vanuit '
                        . $safety['id'] . '.', 0, $failure
                    );
                }
                throw new RuntimeException(
                    'Het terugzetten is gestopt. Er bestond geen werkdatabase om vooraf te bewaren; '
                    . 'het gekozen herstelpunt blijft beschikbaar.', 0, $failure
                );
            }
            return [
                'restored' => $id,
                'safety_snapshot' => $safety,
                'message' => $safety === null
                    ? 'De ontbrekende werkdatabase is opnieuw aangemaakt vanuit het herstelpunt.'
                    : 'Het herstelpunt is teruggezet. De vorige toestand is apart bewaard.',
            ];
        });
    }

    /** The caller owns the maintenance lock. */
    private function createUnlocked(string $label): array
    {
        $pdo = $this->serverConnection();
        $settings = $this->databaseSettings($pdo);
        if ($settings === null) {
            throw new RuntimeException('De werkdatabase bestaat niet. Je kunt wel een eerder herstelpunt terugzetten.');
        }
        $this->validateObjectOwners($pdo);
        $id = gmdate('Ymd\THis\Z') . '_' . bin2hex(random_bytes(8));
        $partial = $this->path($id, 'partial');
        $sqlPath = $this->path($id, 'sql');
        $manifestPath = $this->path($id, 'json');
        $credentials = $this->clientDefaults();
        try {
            $header = "-- Govern SQL-herstelpunt. Selecteer de bedoelde lege database vóór handmatige import.\n"
                . "-- Bewaart tabellen, views, triggers, events en leesbare eigen routines.\n"
                . "-- Maak geen gelijktijdige structuurwijzigingen tijdens een export.\n\n";
            $header .= $this->routineDefinitions($pdo);
            if (file_put_contents($partial, $header) === false) {
                throw new RuntimeException('Het SQL-bestand kon niet worden geschreven.');
            }
            chmod($partial, 0600);
            $this->runProcess([
                (string) $this->config['dump_bin'], '--defaults-extra-file=' . $credentials,
                '--single-transaction', '--quick', '--skip-lock-tables', '--triggers', '--events',
                '--hex-blob', '--skip-comments', '--default-character-set=utf8mb4', '--no-tablespaces',
                '--',
                (string) $this->config['name'],
            ], null, $partial, true);

            $size = filesize($partial);
            $hash = hash_file('sha256', $partial);
            if ($size === false || $size <= strlen($header) || $hash === false) {
                throw new RuntimeException('De SQL-export is leeg of onvolledig. Er is geen herstelpunt opgeslagen.');
            }
            $manifest = [
                'format' => 1, 'id' => $id, 'label' => $label,
                'created_at' => gmdate('Y-m-d\TH:i:s\Z'),
                'database' => (string) $this->config['name'],
                'charset' => $settings['charset'], 'collation' => $settings['collation'],
                'size_bytes' => $size, 'sha256' => $hash,
            ];
            if (!rename($partial, $sqlPath)) {
                throw new RuntimeException('Het SQL-bestand kon niet worden afgerond.');
            }
            $manifestTemp = $this->path($id, 'json.partial');
            if (file_put_contents($manifestTemp, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n") === false) {
                throw new RuntimeException('De gegevens van het herstelpunt konden niet worden opgeslagen.');
            }
            chmod($manifestTemp, 0600);
            if (!rename($manifestTemp, $manifestPath)) {
                throw new RuntimeException('Het herstelpunt kon niet worden afgerond.');
            }
            return $this->descriptor($manifest);
        } catch (Throwable $exception) {
            foreach ([$partial, $sqlPath, $manifestPath, $this->path($id, 'json.partial')] as $file) {
                if (is_file($file)) {
                    unlink($file);
                }
            }
            throw $exception;
        } finally {
            unlink($credentials);
        }
    }

    private function applySnapshot(PDO $pdo, array $manifest): void
    {
        $this->validateCollation($pdo, $manifest);
        $name = $this->identifier((string) $this->config['name']);
        $charset = $this->identifier($manifest['charset']);
        $collation = $this->identifier($manifest['collation']);
        $credentials = $this->clientDefaults();
        $output = tempnam($this->directory, '.restore-');
        if ($output === false) {
            unlink($credentials);
            throw new RuntimeException('Er kon geen tijdelijk herstelbestand worden gemaakt.');
        }
        chmod($output, 0600);
        try {
            // DDL is not transactional. A complete, separate safety export is made first.
            // Recreating the selected DB also removes objects added after the checkpoint.
            $pdo->exec("DROP DATABASE IF EXISTS $name");
            $pdo->exec("CREATE DATABASE $name CHARACTER SET $charset COLLATE $collation");
            $this->runProcess([
                (string) $this->config['client_bin'], '--defaults-extra-file=' . $credentials,
                '--default-character-set=utf8mb4', '--binary-mode',
                '--database=' . (string) $this->config['name'],
            ], $this->path($manifest['id'], 'sql'), $output, false);
        } finally {
            unlink($credentials);
            unlink($output);
        }
    }

    private function serverConnection(): PDO
    {
        $socket = (string) ($this->config['socket'] ?? '');
        $dsn = $socket !== ''
            ? 'mysql:unix_socket=' . $socket . ';charset=utf8mb4'
            : 'mysql:host=' . $this->config['host'] . ';port=' . (int) $this->config['port'] . ';charset=utf8mb4';
        $pdo = new PDO($dsn, (string) $this->config['user'], (string) $this->config['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }

    private function databaseSettings(PDO $pdo): ?array
    {
        $statement = $pdo->prepare('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
        $statement->execute([(string) $this->config['name']]);
        return $statement->fetch() ?: null;
    }

    private function validateCollation(PDO $pdo, array $manifest): void
    {
        $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME = ? AND COLLATION_NAME = ?');
        $statement->execute([$manifest['charset'], $manifest['collation']]);
        if ((int) $statement->fetchColumn() !== 1) {
            throw new RuntimeException('De tekenset van dit herstelpunt is niet beschikbaar op deze database-server.');
        }
    }

    private function validateObjectOwners(PDO $pdo): void
    {
        $owner = (string) $pdo->query('SELECT CURRENT_USER()')->fetchColumn();
        foreach (['VIEWS' => 'TABLE_SCHEMA', 'TRIGGERS' => 'TRIGGER_SCHEMA', 'EVENTS' => 'EVENT_SCHEMA', 'ROUTINES' => 'ROUTINE_SCHEMA'] as $table => $schemaColumn) {
            $statement = $pdo->prepare("SELECT DEFINER FROM information_schema.$table WHERE $schemaColumn = ?");
            $statement->execute([(string) $this->config['name']]);
            foreach ($statement as $row) {
                if ($row['DEFINER'] !== $owner) {
                    throw new RuntimeException('Een databaseobject heeft een andere eigenaar dan de werkdatabasegebruiker. Maak hiervan eerst een passende export; er is geen onvolledig herstelpunt opgeslagen.');
                }
            }
        }
    }

    /** Avoid granting global SELECT on mysql.proc just to use --routines. */
    private function routineDefinitions(PDO $pdo): string
    {
        $statement = $pdo->prepare('SELECT ROUTINE_NAME, ROUTINE_TYPE, SQL_MODE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME');
        $statement->execute([(string) $this->config['name']]);
        $routines = $statement->fetchAll();
        if ($routines === []) {
            return '';
        }
        $output = "SET @GOVERN_OLD_SQL_MODE=@@SQL_MODE;\n";
        foreach ($routines as $routine) {
            $type = $routine['ROUTINE_TYPE'];
            if (!in_array($type, ['FUNCTION', 'PROCEDURE'], true)) {
                throw new RuntimeException('Onbekend routinetype; het herstelpunt is niet gemaakt.');
            }
            $charset = $routine['CHARACTER_SET_CLIENT'];
            $collation = $routine['COLLATION_CONNECTION'];
            if (!preg_match('/\A[a-zA-Z0-9_]+\z/', $charset) || !preg_match('/\A[a-zA-Z0-9_]+\z/', $collation)) {
                throw new RuntimeException('De tekenset van een routine kan niet veilig worden bewaard.');
            }
            // Retrieve the definition in its original client encoding. It is written
            // with a matching SET NAMES, rather than silently recoding SQL literals.
            $pdo->exec('SET character_set_results = ' . $pdo->quote($charset));
            try {
                $qualified = $this->identifier((string) $this->config['name']) . '.' . $this->identifier($routine['ROUTINE_NAME']);
                $row = $pdo->query("SHOW CREATE $type $qualified")->fetch();
            } finally {
                $pdo->exec("SET character_set_results = 'utf8mb4'");
            }
            $definition = $row[$type === 'FUNCTION' ? 'Create Function' : 'Create Procedure'] ?? null;
            if (!is_string($definition) || $definition === '') {
                throw new RuntimeException('Een routine kan niet worden uitgelezen. Er is geen onvolledig herstelpunt opgeslagen.');
            }
            do {
                $delimiter = 'GOV_' . bin2hex(random_bytes(5));
            } while (str_contains($definition, $delimiter));
            $output .= 'SET NAMES ' . $this->identifier($charset) . ' COLLATE ' . $this->identifier($collation) . ";\n";
            $output .= 'SET SQL_MODE=' . $pdo->quote($routine['SQL_MODE']) . ";\n";
            $output .= "DELIMITER $delimiter\n$definition\n$delimiter\nDELIMITER ;\n\n";
        }
        return $output . "SET NAMES utf8mb4;\nSET SQL_MODE=@GOVERN_OLD_SQL_MODE;\n\n";
    }

    private function readManifest(string $id, bool $verify): array
    {
        $path = $this->path($id, 'json');
        $sqlPath = $this->path($id, 'sql');
        if (is_link($path) || is_link($sqlPath) || !is_file($path) || !is_file($sqlPath)) {
            throw new InvalidArgumentException('Dit herstelpunt bestaat niet.');
        }
        $manifest = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($manifest) || ($manifest['format'] ?? null) !== 1 || ($manifest['id'] ?? null) !== $id
            || ($manifest['database'] ?? null) !== (string) $this->config['name']
            || !is_string($manifest['label'] ?? null) || !is_string($manifest['created_at'] ?? null)
            || !is_string($manifest['charset'] ?? null) || !is_string($manifest['collation'] ?? null)
            || !is_int($manifest['size_bytes'] ?? null)
            || !preg_match('/\A[a-f0-9]{64}\z/', (string) ($manifest['sha256'] ?? ''))
            || filesize($sqlPath) !== $manifest['size_bytes']) {
            throw new RuntimeException('Het herstelpunt is onvolledig of hoort bij een andere database.');
        }
        if ($verify && !hash_equals($manifest['sha256'], (string) hash_file('sha256', $sqlPath))) {
            throw new RuntimeException('Het SQL-bestand is gewijzigd sinds het herstelpunt is gemaakt. Terugzetten is gestopt.');
        }
        return $manifest;
    }

    private function descriptor(array $manifest): array
    {
        return array_intersect_key($manifest, array_flip(['id', 'label', 'created_at', 'size_bytes', 'sha256']));
    }

    private function path(string $id, string $extension): string
    {
        if (!preg_match(self::ID_PATTERN, $id)) {
            throw new InvalidArgumentException('Ongeldig herstelpunt.');
        }
        return $this->directory . DIRECTORY_SEPARATOR . $id . '.' . $extension;
    }

    private function identifier(string $value): string
    {
        if ($value === '' || str_contains($value, "\0")) {
            throw new RuntimeException('Ongeldige databasenaam of objectnaam.');
        }
        return '`' . str_replace('`', '``', $value) . '`';
    }

    private function clientDefaults(): string
    {
        $path = tempnam($this->directory, '.client-');
        if ($path === false) {
            throw new RuntimeException('Tijdelijke database-instellingen konden niet worden gemaakt.');
        }
        chmod($path, 0600);
        $values = [
            'user' => (string) $this->config['user'], 'password' => (string) $this->config['password'],
            'default-character-set' => 'utf8mb4',
        ];
        if (($this->config['socket'] ?? '') !== '') {
            $values['protocol'] = 'SOCKET';
            $values['socket'] = (string) $this->config['socket'];
        } else {
            $values['protocol'] = 'TCP';
            $values['host'] = (string) $this->config['host'];
            $values['port'] = (string) $this->config['port'];
        }
        $text = "[client]\n";
        foreach ($values as $key => $value) {
            $value = str_replace(["\\", '"', "\n", "\r", "\0"], ["\\\\", '\\"', '\\n', '\\r', ''], $value);
            $text .= $key . '="' . $value . '"' . "\n";
        }
        if (file_put_contents($path, $text) === false) {
            unlink($path);
            throw new RuntimeException('Tijdelijke database-instellingen konden niet worden geschreven.');
        }
        return $path;
    }

    /** Passwords are only in the private defaults file, never process arguments. */
    private function runProcess(array $command, ?string $input, string $output, bool $append): void
    {
        $descriptors = [
            0 => $input === null ? ['pipe', 'r'] : ['file', $input, 'r'],
            1 => ['file', $output, $append ? 'a' : 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = proc_open($command, $descriptors, $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('De databaseclient kon niet worden gestart.');
        }
        if ($input === null) {
            fclose($pipes[0]);
        }
        stream_set_blocking($pipes[2], false);
        $deadline = microtime(true) + max(30, min(3600, (int) (getenv('BACKUP_TIMEOUT_SECONDS') ?: 180)));
        $error = '';
        $exitCode = -1;
        $timedOut = false;
        try {
            while (true) {
                $chunk = stream_get_contents($pipes[2]);
                if ($chunk !== false && strlen($error) < 8192) {
                    $error .= substr($chunk, 0, 8192 - strlen($error));
                }
                $status = proc_get_status($process);
                if (!$status['running']) {
                    $exitCode = (int) $status['exitcode'];
                    $tail = stream_get_contents($pipes[2]);
                    if ($tail !== false) {
                        $error .= substr($tail, 0, max(0, 8192 - strlen($error)));
                    }
                    break;
                }
                if (microtime(true) > $deadline) {
                    $timedOut = true;
                    proc_terminate($process);
                    usleep(100000);
                    if (proc_get_status($process)['running']) {
                        proc_terminate($process, 9);
                    }
                    break;
                }
                usleep(30000);
            }
        } finally {
            fclose($pipes[2]);
            $closedCode = proc_close($process);
            if ($exitCode < 0) {
                $exitCode = $closedCode;
            }
        }
        if ($timedOut) {
            throw new RuntimeException('De databasebewerking duurde te lang en is gestopt.');
        }
        if ($exitCode !== 0) {
            $detail = preg_match('/ERROR\s+([0-9]+)(?:\s+\([A-Z0-9]+\))?/', $error, $match) ? ' Databasefout ' . $match[1] . '.' : '';
            throw new RuntimeException('De databaseclient is gestopt met foutcode ' . $exitCode . '.' . $detail . ' Er is geen succesvolle bewerking gemeld.');
        }
    }

    private function locked(int $mode, callable $operation): mixed
    {
        $handle = fopen($this->directory . '/.maintenance.lock', 'c');
        if ($handle === false) {
            throw new RuntimeException('Het herstelpunten-slot kon niet worden geopend.');
        }
        try {
            if (!flock($handle, $mode | LOCK_NB)) {
                throw new RuntimeException('Er wordt al een herstelpunt gemaakt of teruggezet. Probeer het zo opnieuw.');
            }
            return $operation();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
