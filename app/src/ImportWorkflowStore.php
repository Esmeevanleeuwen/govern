<?php
declare(strict_types=1);
namespace Govern;

/** Private installation control records, separate from imported work databases. */
final class ImportWorkflowStore
{
    public readonly \PDO $pdo;
    public readonly string $directory;

    public function __construct(?string $directory = null)
    {
        $this->directory = $directory ?? (getenv('IMPORT_DIR') ?: '/var/lib/govern/imports');
        if (!str_starts_with($this->directory, '/') || is_link($this->directory)
            || (!is_dir($this->directory) && !@mkdir($this->directory, 0700, true)) || !is_writable($this->directory)) throw ApiException::fromCode('workflow_unavailable', 503);
        $path = $this->directory . '/control.sqlite';
        if (is_link($path)) throw ApiException::fromCode('workflow_unavailable', 503);
        $mask = umask(0077);
        try {
            $this->pdo = new \PDO('sqlite:' . $path, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC, \PDO::ATTR_EMULATE_PREPARES => false]);
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, body TEXT NOT NULL, bytes INTEGER NOT NULL, expires_at INTEGER NOT NULL, uploaded_at INTEGER NOT NULL, deleted_at INTEGER)');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources(id), body TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id), submission_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), body TEXT NOT NULL, created_at INTEGER NOT NULL)');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
        } catch (\PDOException) { throw ApiException::fromCode('workflow_unavailable', 503); }
        finally { umask($mask); }
    }

    public static function id(mixed $id): string
    {
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/D', $id)) throw ApiException::fromCode('workflow_invalid', 422);
        return $id;
    }
    public static function encode(array $body): string { return json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); }
    public static function decode(string $body): array { return json_decode($body, true, 64, JSON_THROW_ON_ERROR); }
    public function one(string $sql, array $values = []): ?array
    {
        $query = $this->pdo->prepare($sql); $query->execute($values); $record = $query->fetch(); return $record === false ? null : $record;
    }
    public function execute(string $sql, array $values = []): void { $query = $this->pdo->prepare($sql); $query->execute($values); }
    public function heartbeat(): void
    {
        $this->execute("INSERT INTO settings(name,value) VALUES('worker_seen',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", [(string) time()]);
    }
    public function ready(): bool
    {
        $last = $this->one("SELECT value FROM settings WHERE name='worker_seen'"); return $last !== null && (int) $last['value'] > time() - 60;
    }
    public function record(array $job, ?string $event = null): void
    {
        $job['updated_at'] = gmdate('c');
        $encoded = self::encode($job);
        $this->execute("UPDATE jobs SET state=?,body=CASE WHEN json_extract(body,'$.stop_requested')=1 THEN json_set(?,'$.stop_requested',json('true')) ELSE ? END,updated_at=? WHERE id=?",
            [$job['state'], $encoded, $encoded, time(), $job['id']]);
        if ($event !== null) $this->execute('INSERT INTO events(job_id,body,created_at) VALUES(?,?,?)', [$job['id'], self::encode(['stage' => $job['stage'], 'state' => $job['state'], 'event' => $event, 'completed_units' => $job['completed_units'], 'unit_kind' => $job['unit_kind']]), time()]);
    }
}
