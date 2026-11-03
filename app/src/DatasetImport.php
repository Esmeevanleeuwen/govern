<?php
declare(strict_types=1);
namespace Govern;

use PDO;

/** Shared tabular import flow. Readers never receive database credentials. */
final class DatasetImport
{
    public function __construct(private readonly Database $database) {}

    public static function upload(string $csrf): array
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw ApiException::fromCode('post_required', 405);
        if (!hash_equals($csrf, (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) throw ApiException::fromCode('csrf_invalid', 403);
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data;')) throw ApiException::fromCode('dataset_invalid', 415);
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null)
            || !is_uploaded_file($file['tmp_name']) || filesize($file['tmp_name']) > 16777216) {
            throw ApiException::fromCode('dataset_upload', 422);
        }
        return $file;
    }

    public static function read(array $file): array
    {
        $name = $file['name'];
        if (!is_string($name) || strlen($name) > 512 || str_contains($name, "\0")) throw ApiException::fromCode('dataset_invalid', 422);
        $output = tempnam(sys_get_temp_dir(), 'govern-dataset-');
        if ($output === false) throw ApiException::fromCode('dataset_unavailable', 503);
        try {
            $process = proc_open(['python3', '-I', dirname(__DIR__) . '/importers/tabular.py', $name],
                [0 => ['file', $file['tmp_name'], 'r'], 1 => ['file', $output, 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
            if (!is_resource($process)) throw ApiException::fromCode('dataset_unavailable', 503);
            $status = proc_close($process);
            if (filesize($output) > 67108864) throw ApiException::fromCode('dataset_invalid', 422);
            $parsed = json_decode((string) file_get_contents($output), true, 64);
            if ($status !== 0 || !isset($parsed['datasets'], $parsed['sha256'])) {
                throw ApiException::fromCode('dataset_invalid', 422);
            }
            return $parsed;
        } finally {
            unlink($output);
        }
    }

    private function targets(array $dataset): array
    {
        $pdo = $this->database->reader();
        $q = $pdo->prepare('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION');
        $q->execute([$this->database->name()]);
        $tables = [];
        foreach ($q->fetchAll() as $column) $tables[$column['TABLE_NAME']][] = $column;
        $t = $pdo->prepare("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB'");
        $t->execute([$this->database->name()]);
        $allowed = $t->fetchAll(PDO::FETCH_COLUMN);
        $names = array_column($dataset['columns'], 'name');
        $result = [];
        foreach ($tables as $name => $columns) {
            if (str_starts_with($name, '_govern_') || !in_array($name, $allowed, true)) continue;
            $importable = [];
            $valid = true;
            foreach ($columns as $column) {
                if (str_contains($column['EXTRA'], 'auto_increment')) continue;
                if (!in_array($column['DATA_TYPE'], ['longtext', 'mediumtext', 'text', 'varchar'], true) || $column['EXTRA'] !== '') { $valid = false; break; }
                $importable[] = $column['COLUMN_NAME'];
            }
            if ($valid && $names === $importable) $result[] = ['name' => $name, 'version' => hash('sha256', json_encode($columns, JSON_THROW_ON_ERROR))];
        }
        return $result;
    }

    public function preview(array $parsed): array
    {
        $datasets = [];
        foreach ($parsed['datasets'] as $index => $dataset) {
            $datasets[] = [...$dataset, 'index' => $index, 'rows' => array_slice($dataset['rows'], 0, 20),
                'targets' => $this->targets($dataset)];
        }
        return ['database' => $this->database->name(), 'sha256' => $parsed['sha256'], 'datasets' => $datasets];
    }

    public function commit(array $parsed, array $input): array
    {
        if (($input['confirmation'] ?? '') !== $this->database->name() || !hash_equals($parsed['sha256'], Http::text($input, 'sha256'))) {
            throw ApiException::fromCode('dataset_changed', 409);
        }
        $index = filter_var($input['dataset'] ?? null, FILTER_VALIDATE_INT);
        if ($index === false || !isset($parsed['datasets'][$index])) throw ApiException::fromCode('dataset_invalid', 422);
        $dataset = $parsed['datasets'][$index];
        $name = Http::text($input, 'table');
        $mode = Http::text($input, 'mode');
        if (!in_array($mode, ['create', 'append'], true)) throw ApiException::fromCode('dataset_invalid', 422);
        $pdo = $this->database->writer();
        $stage = null;
        $target = null;
        if ($mode === 'append') {
            foreach ($this->targets($dataset) as $candidate) if ($candidate['name'] === $name) $target = $candidate;
            if ($target === null || !hash_equals($target['version'], Http::text($input, 'version'))) throw ApiException::fromCode('dataset_changed', 409);
        } else {
            if (preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/D', $name) !== 1 || str_starts_with(strtolower($name), '_govern_')) throw ApiException::fromCode('dataset_name', 422);
            $q = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND LOWER(TABLE_NAME) = LOWER(?)');
            $q->execute([$this->database->name(), $name]);
            if ((int) $q->fetchColumn() !== 0) throw ApiException::fromCode('dataset_exists', 409);
            $stage = '_govern_import_' . bin2hex(random_bytes(12));
        }
        $columns = array_map(static fn(array $c): string => Database::identifier($c['name']), $dataset['columns']);
        try {
            if ($stage !== null) {
                $definitions = implode(', ', array_map(static fn(string $c): string => $c . ' LONGTEXT NULL', $columns));
                $pdo->exec('CREATE TABLE ' . Database::identifier($stage) . ' (`_govern_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' . $definitions . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            }
            $pdo->beginTransaction();
            // Acquires a metadata lock for the entire append transaction before checking schema.
            $pdo->query('SELECT 1 FROM ' . Database::identifier($stage ?? $name) . ' LIMIT 0')->closeCursor();
            if ($target !== null) {
                $q = $pdo->prepare('SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION');
                $q->execute([$this->database->name(), $name]);
                $cols = array_map(static fn(array $c): array => ['TABLE_NAME' => $name, ...$c], $q->fetchAll());
                if (hash('sha256', json_encode($cols, JSON_THROW_ON_ERROR)) !== $target['version']) throw ApiException::fromCode('dataset_changed', 409);
            }
            $q = $pdo->prepare('INSERT INTO ' . Database::identifier($stage ?? $name) . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')');
            foreach ($dataset['rows'] as $row) $q->execute($row);
            $pdo->commit();
            if ($stage !== null) {
                // No overwrite: RENAME fails if the chosen destination appeared meanwhile.
                $pdo->exec('RENAME TABLE ' . Database::identifier($stage) . ' TO ' . Database::identifier($name));
                $stage = null;
            }
            return ['database' => $this->database->name(), 'table' => $name, 'imported' => $dataset['count'], 'mode' => $mode];
        } finally {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($stage !== null) $pdo->exec('DROP TABLE ' . Database::identifier($stage));
        }
    }
}
