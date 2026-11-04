<?php
declare(strict_types=1);
namespace Govern;

/** Reviewed, durable creation/import operations. API methods never execute the queued SQL. */
final class ImportWorkflow
{
    public const DATASET_BYTES = 16777216;
    public const SOURCE_SECONDS = 86400;
    private const TERMINAL = ['completed', 'partial', 'failed', 'cancelled'];
    private readonly ImportWorkflowStore $store;
    private readonly DatabaseProvisioner $provisioner;
    private readonly ?\Closure $accountCheck;

    public function __construct(private readonly array $base, ?string $directory = null,
        ?DatabaseProvisioner $provisioner = null, ?callable $accountCheck = null)
    {
        $this->store = new ImportWorkflowStore($directory);
        $this->provisioner = $provisioner ?? new DatabaseProvisioner();
        $this->accountCheck = $accountCheck === null ? null : \Closure::fromCallable($accountCheck);
    }

    public function capabilities(): array
    {
        return ['engines' => array_map(fn (string $engine): array => ['id' => $engine, 'engine' => $engine,
            'label' => $engine === 'postgres' ? 'PostgreSQL' : 'MariaDB',
            'available' => $engine === 'mariadb' || ($this->base['postgres'] ?? null) !== null,
            'can_create' => ($engine === 'mariadb' || ($this->base['postgres'] ?? null) !== null) && $this->provisioner->isAvailable($engine)], ['mariadb', 'postgres']),
            'worker_available' => $this->store->ready(), 'limits' => ['backup_bytes' => ImportBackupSql::MAX_BYTES,
                'dataset_bytes' => self::DATASET_BYTES, 'rows' => 100000, 'columns' => 256, 'max_cells' => 1000000,
                'backup_formats' => ['plain_sql'], 'dataset_formats' => ['csv', 'tsv', 'txt', 'xlsx', 'json'],
                'source_retention_seconds' => self::SOURCE_SECONDS]];
    }

    /** The API validates is_uploaded_file, method, session and CSRF before calling this. */
    public function upload(array $file, string $kind, array $settings = [], ?int $accountId = null): array
    {
        $this->cleanup();
        $name = $file['name'] ?? null; $path = $file['tmp_name'] ?? null;
        if (!in_array($kind, ['backup', 'dataset'], true) || !is_string($name) || $name === '' || strlen($name) > 512
            || preg_match('/[\x00-\x1f\x7f]/', $name) || !is_string($path) || !is_file($path) || is_link($path)) {
            throw ApiException::fromCode('workflow_upload', 422);
        }
        $bytes = filesize($path);
        if ($bytes === false || $bytes < 1 || $bytes > ($kind === 'backup' ? ImportBackupSql::MAX_BYTES : self::DATASET_BYTES)) throw ApiException::fromCode('workflow_upload', 413);
        if ($kind === 'dataset' && !in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), ['csv','tsv','txt','xlsx','json'], true)) throw ApiException::fromCode('workflow_upload',422);
        $raw = file_get_contents($path);
        if ($raw === false || strlen($raw) !== $bytes) throw ApiException::fromCode('workflow_upload', 422);
        $id = bin2hex(random_bytes(16)); $destination = $this->sourcePath($id);
        $uploadedAt=time();
        $this->store->pdo->exec('BEGIN IMMEDIATE');
        try {
            $capacity=$this->store->one('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM sources WHERE deleted_at IS NULL');
            if ((int)$capacity['count']>=64 || (int)$capacity['bytes']+$bytes>268435456) throw ApiException::fromCode('workflow_capacity',413);
            $this->store->execute('INSERT INTO sources(id,body,bytes,expires_at,uploaded_at) VALUES(?,?,?,?,?)',
                [$id,ImportWorkflowStore::encode(['pending'=>true]),$bytes,$uploadedAt+600,$uploadedAt]);
            $this->store->pdo->exec('COMMIT');
        } catch (\Throwable $exception) { $this->store->pdo->exec('ROLLBACK'); throw $exception; }
        $mask = umask(0077);
        try {
            $handle = @fopen($destination, 'xb');
            if ($handle === false) throw ApiException::fromCode('workflow_unavailable', 503);
            try {
                if (fwrite($handle, $raw) !== $bytes || !fflush($handle)
                    || function_exists('fsync') && !fsync($handle)) throw ApiException::fromCode('workflow_unavailable', 503);
            }
            finally { fclose($handle); }
        } catch (\Throwable $exception) {
            @unlink($destination); $this->store->execute('DELETE FROM sources WHERE id=?',[$id]); throw $exception;
        }
        finally { umask($mask); }
        try {
            $summary = $kind === 'backup' ? ImportBackupSql::inspect($raw) : ['engine' => null, 'requires_engine' => false,
                'blocked' => false, 'datasets' => $this->previewDatasets(DatasetImport::read(['name' => $name, 'tmp_name' => $destination], $settings))];
            $source = ['source_id' => $id, 'name' => basename(str_replace('\\', '/', $name)), 'kind' => $kind,
                'bytes' => $bytes, 'sha256' => hash('sha256', $raw), 'settings' => $settings,
                'submitted_by' => $accountId, 'uploaded_at' => $uploadedAt, 'expires_at' => $uploadedAt + self::SOURCE_SECONDS,
                'warnings' => [], ...$summary];
            $metadata = $source;
            // Source values live only in the expiring private file. Response
            // samples must not become permanent copies in control metadata.
            foreach ($metadata['datasets'] ?? [] as $index => $dataset) unset($metadata['datasets'][$index]['rows']);
            $this->store->execute('UPDATE sources SET body=?,expires_at=? WHERE id=?',
                [ImportWorkflowStore::encode($metadata),$source['expires_at'],$id]);
            return $source;
        } catch (\Throwable $exception) {
            @unlink($destination); $this->store->execute('DELETE FROM sources WHERE id=?',[$id]); throw $exception;
        }
    }

    public function targets(array $input): array
    {
        $this->shape($input, ['source_id', 'scope_key']);
        $source = $this->source($input['source_id'] ?? null);
        if ($source['kind'] !== 'dataset') throw ApiException::fromCode('workflow_invalid', 422);
        $config = $this->existingScope($input['scope_key'] ?? null);
        $lock = new MaintenanceLock($config['maintenance_dir']);
        return (new DatasetMapping(new Database($config)))->preview($this->parsed($source));
    }

    public function plan(array $input, int $accountId): array
    {
        $this->shape($input, ['kind', 'source_id', 'engine', 'name', 'target_mode', 'scope_key', 'schema', 'source_engine', 'tables']);
        $kind = $input['kind'] ?? null; $engine = $input['engine'] ?? null;
        $mode = $input['target_mode'] ?? 'new_database';
        if ($accountId < 1 || !in_array($kind, ['empty', 'backup', 'dataset'], true)
            || !in_array($engine, ['mariadb', 'postgres'], true)
            || !in_array($mode, ['new_database', 'new_table', 'append'], true)
            || ($kind !== 'dataset' && $mode !== 'new_database')) throw ApiException::fromCode('workflow_invalid', 422);
        $config = null; $schema = $engine === 'postgres' ? 'public' : '';
        if ($mode === 'new_database') {
            $name = self::newName($input['name'] ?? null);
            DatabaseProvisioner::validateCreateName($name, $engine);
            if (($engine === 'postgres' && ($this->base['postgres'] ?? null) === null) || !$this->provisioner->isAvailable($engine)) throw ApiException::fromCode('workflow_engine_unavailable', 503);
            if (array_key_exists('scope_key', $input) && $input['scope_key'] !== '') throw ApiException::fromCode('workflow_invalid', 422);
            if (isset($input['schema']) && !in_array($input['schema'], ['', 'public'], true)) throw ApiException::fromCode('workflow_invalid', 422);
            $this->availableName($name, $engine);
        } else {
            $config = $this->existingScope($input['scope_key'] ?? null);
            if ($config['engine'] !== $engine || (isset($input['name']) && $input['name'] !== $config['name'])) throw ApiException::fromCode('workflow_plan_changed', 409);
            $name = $config['name']; $schema = $engine === 'postgres' ? $config['schema'] : '';
            if (isset($input['schema']) && $input['schema'] !== $schema) throw ApiException::fromCode('workflow_plan_changed', 409);
        }
        $source = null; $tables = []; $inspection = [];
        if ($kind === 'empty') {
            if (isset($input['source_id']) || !empty($input['tables'])) throw ApiException::fromCode('workflow_invalid', 422);
        } else {
            $source = $this->source($input['source_id'] ?? null);
            if ($source['kind'] !== $kind) throw ApiException::fromCode('workflow_invalid', 422);
            if ($kind === 'backup') {
                if ($source['blocked']) throw ApiException::fromCode('workflow_backup_unsupported', 422);
                $sourceEngine = $source['engine'] ?? ($input['source_engine'] ?? null);
                if ($sourceEngine === null) throw ApiException::fromCode('workflow_source_ambiguous', 422);
                if ($sourceEngine !== $engine) throw ApiException::fromCode('workflow_engine_incompatible', 422);
                $inspection = ImportBackupSql::analyze($this->sourceBytes($source), $engine);
            } else {
                $parsed = $this->parsed($source);
                if (!is_array($input['tables'] ?? null) || !array_is_list($input['tables'])) throw ApiException::fromCode('workflow_invalid', 422);
                $tables = DatasetMapping::normalize($parsed, $input['tables']);
                foreach ($tables as $table) {
                    if (($mode === 'new_database' || $mode === 'new_table') && $table['mode'] !== 'create'
                        || $mode === 'append' && $table['mode'] !== 'append') throw ApiException::fromCode('workflow_invalid', 422);
                }
                if ($config !== null) {
                    $lock = new MaintenanceLock($config['maintenance_dir']);
                    $tables = (new DatasetMapping(new Database($config)))->prepare($parsed, $tables);
                }
                $inspection['rows'] = array_sum(array_map(fn (array $table): int => $parsed['datasets'][$table['dataset']]['count'], $tables));
            }
        }
        $id = bin2hex(random_bytes(16));
        $scopeKey = $config['scope_key'] ?? ConnectionScope::scopeKey($engine, $name, $schema);
        $summary = ['kind' => $kind, 'engine' => $engine, 'database' => $name, 'name' => $name,
            'schema' => $schema, 'scope_key' => $scopeKey, 'target_mode' => $mode, 'tables' => $tables,
            'source_name' => $source['name'] ?? null, 'rows' => $inspection['rows'] ?? null,
            'statement_count' => $inspection['statement_count'] ?? null, 'warnings' => [],
            'declared_tables' => $inspection['tables'] ?? []];
        $body = ['kind' => $kind, 'engine' => $engine, 'name' => $name, 'schema' => $schema,
            'scope_key' => $scopeKey, 'target_mode' => $mode, 'tables' => $tables, 'source_id' => $source['source_id'] ?? null,
            'source_sha256' => $source['sha256'] ?? null, 'account_id' => $accountId, 'summary' => $summary];
        $expires = min(time() + 900, $source['expires_at'] ?? PHP_INT_MAX);
        $this->store->execute('INSERT INTO plans(id,source_id,body,expires_at,created_at) VALUES(?,?,?,?,?)',
            [$id, $source['source_id'] ?? null, ImportWorkflowStore::encode($body), $expires, time()]);
        return ['plan_id' => $id, 'summary' => $summary, 'expires_at' => $expires];
    }

    public function submit(array $input, int $accountId): array
    {
        $this->shape($input, ['plan_id', 'submission_key']);
        $id = ImportWorkflowStore::id($input['plan_id'] ?? null); $key = $input['submission_key'] ?? null;
        if ($accountId < 1 || !is_string($key) || !preg_match('/\A[A-Za-z0-9_-]{16,96}\z/D', $key)) throw ApiException::fromCode('workflow_invalid', 422);
        $this->store->pdo->exec('BEGIN IMMEDIATE');
        try {
            $existing = $this->store->one('SELECT * FROM jobs WHERE submission_key=? OR plan_id=?', [$key, $id]);
            if ($existing !== null) {
                if ($existing['plan_id'] !== $id) throw ApiException::fromCode('workflow_plan_changed', 409);
                $this->store->pdo->exec('COMMIT'); return ['job' => ImportWorkflowStore::decode($existing['body'])];
            }
            if (!$this->store->ready()) throw ApiException::fromCode('workflow_worker_unavailable', 503);
            $record = $this->store->one('SELECT * FROM plans WHERE id=?', [$id]);
            if ($record === null || (int) $record['expires_at'] <= time()) throw ApiException::fromCode('workflow_expired', 409);
            $plan = ImportWorkflowStore::decode($record['body']);
            if ($plan['source_id'] !== null) $this->source($plan['source_id']);
            $pending = $this->store->one("SELECT COUNT(*) AS count FROM jobs WHERE state IN ('queued','provisioning','importing','verifying')");
            if ((int) $pending['count'] >= 25) throw ApiException::fromCode('workflow_capacity', 429);
            $job = ['id' => bin2hex(random_bytes(16)), 'plan_id' => $id, 'kind' => $plan['kind'],
                'engine' => $plan['engine'], 'database' => $plan['name'], 'schema' => $plan['schema'],
                'scope_key' => $plan['scope_key'], 'target_mode' => $plan['target_mode'], 'tables' => $plan['tables'],
                'state' => 'queued', 'stage' => 'queued', 'completed_units' => 0, 'unit_kind' => null,
                'stop_requested' => false, 'created_database' => false, 'action_required' => false,
                'initiated_by' => $accountId, 'created_at' => gmdate('c'), 'updated_at' => gmdate('c'),
                'result' => null, 'error_code' => null];
            $this->store->execute('INSERT INTO jobs(id,plan_id,submission_key,state,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                [$job['id'], $id, $key, $job['state'], ImportWorkflowStore::encode($job), time(), time()]);
            if ($plan['source_id'] !== null) $this->store->execute('UPDATE sources SET expires_at=uploaded_at+604800 WHERE id=?', [$plan['source_id']]);
            $this->store->record($job, 'accepted');
            $this->store->pdo->exec('COMMIT'); return ['job' => $job];
        } catch (\Throwable $exception) { $this->store->pdo->exec('ROLLBACK'); throw $exception; }
    }

    public function job(string $id): array
    {
        $record = $this->store->one('SELECT body FROM jobs WHERE id=?', [ImportWorkflowStore::id($id)]);
        if ($record === null) throw ApiException::fromCode('workflow_not_found', 404);
        return ['job' => ImportWorkflowStore::decode($record['body'])];
    }

    public function jobs(): array
    {
        $records = $this->store->pdo->query('SELECT body FROM jobs ORDER BY created_at DESC,rowid DESC LIMIT 50')->fetchAll();
        return ['jobs' => array_map(static fn (array $row): array => ImportWorkflowStore::decode($row['body']), $records)];
    }

    /** Adds observed recovery state, without changing database authorization. */
    public function decorateDatabases(array $entries): array
    {
        $jobs = $this->store->pdo->query("SELECT body FROM jobs WHERE state IN ('partial','failed','cancelled','unknown') ORDER BY created_at DESC,rowid DESC")->fetchAll();
        $affected = [];
        foreach ($jobs as $record) {
            $job = ImportWorkflowStore::decode($record['body']);
            if (($job['action_required'] ?? false) && (($job['created_database'] ?? false)
                || $job['state'] === 'unknown' && ($job['target_mode'] ?? '') === 'new_database')) {
                $key = $job['engine'] . ':' . $job['database'];
                if (!isset($affected[$key])) $affected[$key] = $job['id'];
            }
        }
        foreach ($entries as &$entry) {
            $key = $entry['engine'] . ':' . $entry['name'];
            if (isset($affected[$key])) { $entry['action_required'] = true; $entry['import_job_id'] = $affected[$key]; }
        }
        return $entries;
    }

    public function stop(array $input): array
    {
        $this->shape($input, ['id']);
        $this->store->pdo->exec('BEGIN IMMEDIATE');
        try {
            $job = $this->job(ImportWorkflowStore::id($input['id'] ?? null))['job'];
            if ($job['state'] === 'queued') {
                $job['stop_requested'] = true; $job['state'] = $job['stage'] = 'cancelled';
                $plan = $this->store->one('SELECT source_id FROM plans WHERE id=?', [$job['plan_id']]);
                if (($plan['source_id'] ?? null) !== null) $this->store->execute('UPDATE sources SET expires_at=MIN(uploaded_at+604800,?) WHERE id=?', [time()+self::SOURCE_SECONDS,$plan['source_id']]);
            } elseif (in_array($job['state'], ['provisioning', 'importing', 'verifying'], true)) $job['stop_requested'] = true;
            $this->store->record($job, 'stop_requested'); $this->store->pdo->exec('COMMIT');
            return ['job' => $job];
        } catch (\Throwable $exception) { $this->store->pdo->exec('ROLLBACK'); throw $exception; }
    }

    /** Only a worker holding the installation worker lock calls this on startup. */
    public function recoverInterrupted(): void
    {
        foreach ($this->store->pdo->query("SELECT body FROM jobs WHERE state IN ('provisioning','importing','verifying')")->fetchAll() as $record) {
            $job = ImportWorkflowStore::decode($record['body']);
            $job['state'] = $job['stage'] = 'unknown'; $job['error_code'] = 'workflow_interrupted';
            $job['action_required'] = true; $this->store->record($job, 'interrupted_without_replay');
        }
        $this->store->heartbeat();
    }

    public function workOnce(): bool
    {
        $this->store->heartbeat(); $this->cleanup();
        // An idle worker must not briefly exclude ordinary database requests.
        // Recheck under the lock below because a queued stop may race this read.
        if ($this->store->one("SELECT id FROM jobs WHERE state='queued' LIMIT 1") === null) return false;
        try { $lock = new MaintenanceLock($this->base['maintenance_dir'] ?? $this->base['backup_dir'], true); }
        catch (ApiException $exception) { if ($exception->status === 423) return false; throw $exception; }
        $this->store->pdo->exec('BEGIN IMMEDIATE');
        try {
            $record = $this->store->one("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,rowid LIMIT 1");
            if ($record === null) { $this->store->pdo->exec('COMMIT'); return false; }
            $job = ImportWorkflowStore::decode($record['body']);
            $job['state'] = $job['stage'] = $job['target_mode'] === 'new_database' ? 'provisioning' : 'importing';
            $this->store->record($job, 'claimed'); $this->store->pdo->exec('COMMIT');
        } catch (\Throwable $exception) { $this->store->pdo->exec('ROLLBACK'); throw $exception; }
        $this->executeJob($job);
        return true;
    }

    private function shape(array $input, array $allowed): void
    {
        if (array_diff(array_keys($input), $allowed) !== []) throw ApiException::fromCode('workflow_invalid', 422);
    }
    private static function newName(mixed $name): string
    {
        if (!is_string($name) || !preg_match('/\A[a-z][a-z0-9_]{0,62}\z/D', $name)
            || in_array($name, ['mysql', 'information_schema', 'performance_schema', 'sys', 'postgres', 'template0', 'template1'], true)) throw ApiException::fromCode('database_create_invalid', 422);
        return $name;
    }
    private function existingScope(mixed $key): array
    {
        if (!is_string($key) || $key === '') throw ApiException::fromCode('workflow_invalid', 422);
        return (new ConnectionScope($this->base))->selectRequest($key);
    }
    private function availableName(string $name, string $engine): void
    {
        self::assertUnused($name, $engine, (new ConnectionScope($this->base))->databases());
    }
    /** Unavailable configured entries are placeholders, not proof of occupancy. */
    public static function assertUnused(string $name, string $engine, array $databases): void
    {
        foreach ($databases as $item) {
            if (($item['available'] ?? true) !== false && $item['engine'] === $engine && strcasecmp($item['name'], $name) === 0) {
                throw ApiException::fromCode('workflow_target_exists', 409);
            }
        }
    }
    private function sourcePath(string $id): string { return $this->store->directory . '/' . ImportWorkflowStore::id($id) . '.source'; }
    private function source(mixed $id): array
    {
        $id = ImportWorkflowStore::id($id);
        $record = $this->store->one('SELECT * FROM sources WHERE id=?', [$id]);
        if ($record === null || $record['deleted_at'] !== null || (int) $record['expires_at'] <= time()) throw ApiException::fromCode('workflow_expired', 409);
        $body=ImportWorkflowStore::decode($record['body']);
        if ($body['pending']??false) throw ApiException::fromCode('workflow_expired',409);
        return [...$body, 'expires_at' => (int) $record['expires_at']];
    }
    private function sourceBytes(array $source): string
    {
        $path = $this->sourcePath($source['source_id']);
        if (is_link($path) || !is_file($path)) throw ApiException::fromCode('workflow_expired', 409);
        $raw = file_get_contents($path);
        if ($raw === false || !hash_equals($source['sha256'], hash('sha256', $raw))) throw ApiException::fromCode('workflow_plan_changed', 409);
        return $raw;
    }
    private function parsed(array $source): array
    {
        $this->sourceBytes($source);
        return DatasetImport::read(['name' => $source['name'], 'tmp_name' => $this->sourcePath($source['source_id'])], $source['settings']);
    }
    private function previewDatasets(array $parsed): array
    {
        $result = []; $remaining = Preview::RESULT_BYTES;
        foreach ($parsed['datasets'] as $index => $dataset) {
            $rows = []; $shortened = count($dataset['rows']) > 20;
            foreach (array_slice($dataset['rows'], 0, 20) as $row) {
                $row = Preview::row($row, $shortened); $bytes = Preview::bytes($row);
                if ($bytes > $remaining) { $shortened = true; break; }
                $remaining -= $bytes; $rows[] = $row;
            }
            $result[] = [...$dataset, 'index' => $index, 'rows' => $rows, 'preview_truncated' => $shortened];
        }
        return $result;
    }
    private function cleanup(): void
    {
        $query = $this->store->pdo->prepare('SELECT id FROM sources WHERE deleted_at IS NULL AND expires_at<=?'); $query->execute([time()]);
        foreach ($query->fetchAll() as $record) {
            $path = $this->sourcePath($record['id']);
            if (!file_exists($path) || @unlink($path)) $this->store->execute('UPDATE sources SET deleted_at=? WHERE id=?', [time(), $record['id']]);
        }
        foreach (new \DirectoryIterator($this->store->directory) as $file) {
            if (!$file->isFile() || $file->isLink() || !preg_match('/\A([a-f0-9]{32})\.source\z/D', $file->getFilename(), $match)
                || $file->getMTime() > time()-600) continue;
            if ($this->store->one('SELECT id FROM sources WHERE id=?', [$match[1]]) === null) @unlink($file->getPathname());
        }
    }
    private function activeAccount(int $id): bool
    {
        if ($this->accountCheck !== null) return (bool) ($this->accountCheck)($id);
        $path = (getenv('AUTH_DIR') ?: '/var/lib/govern/auth') . '/accounts.sqlite';
        if (!is_file($path) || is_link($path)) return false;
        try {
            $auth = new \PDO('sqlite:' . $path, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::SQLITE_ATTR_OPEN_FLAGS => \PDO::SQLITE_OPEN_READONLY]);
            $auth->exec('PRAGMA busy_timeout = 5000');
            $query = $auth->prepare("SELECT 1 FROM users WHERE id=? AND status='active'"); $query->execute([$id]);
            return $query->fetchColumn() !== false;
        } catch (\PDOException) { return false; }
    }

    private function executeJob(array $job): void
    {
        // Implemented below: claim and evidence are durable before any engine mutation.
        $runner = new ImportWorkflowRunner($this->base, $this->store, $this->provisioner, $this->activeAccount(...));
        $runner->execute($job);
    }
}
