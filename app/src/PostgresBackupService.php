<?php
declare(strict_types=1);

namespace Govern;

/** PostgreSQL checkpoints via the private, fixed-operation Unix-socket helper. */
final class PostgresBackupService
{
    private const ID_PATTERN = '/\A[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}\z/D';
    private const MAX_BYTES = 1048576;
    private readonly string $socket;
    private readonly ?\Closure $transport;

    public function __construct(private readonly array $config, ?callable $transport = null)
    {
        $this->socket = (string) ($config['tools_socket'] ?? getenv('PG_TOOLS_SOCKET') ?: '/run/govern-postgres/tools.sock');
        $this->transport = $transport === null ? null : \Closure::fromCallable($transport);
    }

    public function list(): array
    {
        $lock = $this->lock();
        $data = $this->request('list');
        if (!array_is_list($data)) throw new BackupException('postgres_tools_invalid');
        foreach ($data as $item) $this->descriptor($item);
        return $data;
    }

    public function create(string $label): array
    {
        $lock = $this->lock(true);
        return $this->createUnderExclusiveLock($label);
    }

    /** Caller must already hold the global exclusive MaintenanceLock. */
    public function createUnderExclusiveLock(string $label): array
    {
        $label = trim($label);
        if ($label === '' || strlen($label) > 600 || preg_match('//u', $label) !== 1)
            throw new BackupInputException('snapshot_label_invalid');
        return $this->descriptor($this->request('create', ['label' => $label]));
    }

    public function createLocked(string $label): array { return $this->createUnderExclusiveLock($label); }

    public function restore(string $id, string $confirmation): array
    {
        $this->id($id);
        $expected = $this->config['name'] . '.' . $this->config['schema'];
        if (!hash_equals($expected, $confirmation)) throw new BackupInputException('restore_confirmation_invalid');
        $lock = $this->lock(true);
        $result = $this->request('restore', ['id' => $id]);
        if (($result['restored'] ?? null) !== $id || ($result['database'] ?? null) !== $this->config['name']
            || ($result['schema'] ?? null) !== $this->config['schema'] || !array_key_exists('safety_snapshot', $result))
            throw new BackupException('postgres_tools_invalid');
        if ($result['safety_snapshot'] !== null) $this->descriptor($result['safety_snapshot']);
        $message = $result['safety_snapshot'] === null ? 'postgres_restore_created_schema' : 'restore_succeeded';
        return [...$result, 'message' => Messages::text($message), 'message_i18n' => Messages::translations($message)];
    }

    public function download(string $id): array
    {
        $this->id($id);
        $lock = $this->lock();
        $data = $this->descriptor($this->request('download', ['id' => $id]));
        if ($data['id'] !== $id) throw new BackupException('postgres_tools_invalid');
        $path = rtrim((string) $this->config['backup_dir'], DIRECTORY_SEPARATOR) . '/' . $id . '.dump';
        if (is_link($path) || !is_file($path) || filesize($path) !== $data['size_bytes']
            || !hash_equals($data['sha256'], (string) hash_file('sha256', $path)))
            throw new BackupException('snapshot_changed');
        return ['path' => $path, 'filename' => 'govern-' . $id . '.dump'];
    }

    private function descriptor(mixed $data): array
    {
        if (!is_array($data) || !is_string($data['id'] ?? null) || preg_match(self::ID_PATTERN, $data['id']) !== 1
            || ($data['format'] ?? null) !== 'postgres-custom-v1' || ($data['database'] ?? null) !== $this->config['name']
            || ($data['schema'] ?? null) !== $this->config['schema'] || !is_string($data['label'] ?? null)
            || !is_string($data['created_at'] ?? null) || !is_int($data['size_bytes'] ?? null) || $data['size_bytes'] < 1
            || !is_string($data['sha256'] ?? null) || preg_match('/\A[a-f0-9]{64}\z/D', $data['sha256']) !== 1)
            throw new BackupException('postgres_tools_invalid');
        return $data;
    }

    private function id(string $id): void
    {
        if (preg_match(self::ID_PATTERN, $id) !== 1) throw new BackupInputException('snapshot_id_invalid');
    }

    private function lock(bool $exclusive = false): MaintenanceLock
    {
        return new MaintenanceLock((string) ($this->config['maintenance_dir'] ?? dirname((string) $this->config['backup_dir'])), $exclusive);
    }

    private function request(string $action, array $extra = []): array
    {
        $request = ['action' => $action, 'database' => $this->config['name'], 'schema' => $this->config['schema'], ...$extra];
        try { $result = $this->transport === null ? $this->exchange($request) : ($this->transport)($request); }
        catch (BackupException $exception) { throw $exception; }
        catch (\Throwable) { throw new BackupException('postgres_tools_unavailable'); }
        if (!is_array($result) || !is_bool($result['ok'] ?? null)) throw new BackupException('postgres_tools_invalid');
        if (!$result['ok']) {
            $code = $result['error_code'] ?? '';
            $allowed = ['postgres_tools_invalid', 'postgres_snapshot_failed', 'postgres_snapshot_unsupported',
                'postgres_snapshot_dependencies', 'postgres_restore_failed', 'postgres_restore_owner_failed',
                'postgres_schema_unavailable', 'backup_directory_invalid', 'snapshot_id_invalid', 'snapshot_label_invalid',
                'snapshot_invalid', 'snapshot_changed', 'snapshot_missing', 'snapshot_write_failed'];
            if (!is_string($code) || !in_array($code, $allowed, true)) throw new BackupException('postgres_tools_invalid');
            if (in_array($code, ['snapshot_id_invalid', 'snapshot_label_invalid', 'snapshot_missing'], true))
                throw new BackupInputException($code);
            throw new BackupException($code);
        }
        if (!is_array($result['data'] ?? null)) throw new BackupException('postgres_tools_invalid');
        return $result['data'];
    }

    private function exchange(array $request): array
    {
        if (!str_starts_with($this->socket, '/') || strlen($this->socket) > 103 || is_link($this->socket)
            || @filetype($this->socket) !== 'socket') throw new BackupException('postgres_tools_unavailable');
        $stream = @stream_socket_client('unix://' . $this->socket, $number, $error, 2, STREAM_CLIENT_CONNECT);
        if ($stream === false) throw new BackupException('postgres_tools_unavailable');
        try {
            stream_set_timeout($stream, 600);
            @set_time_limit(600);
            $raw = json_encode($request, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            if (strlen($raw) > 4096 || fwrite($stream, $raw) !== strlen($raw)) throw new BackupException('postgres_tools_unavailable');
            $line = '';
            while (!str_ends_with($line, "\n")) {
                $part = fgets($stream, self::MAX_BYTES + 2 - strlen($line));
                if ($part === false || strlen($line) + strlen($part) > self::MAX_BYTES)
                    throw new BackupException('postgres_tools_invalid');
                $line .= $part;
            }
        } finally { fclose($stream); }
        try { $response = json_decode($line, true, 16, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw new BackupException('postgres_tools_invalid'); }
        if (!is_array($response)) throw new BackupException('postgres_tools_invalid');
        return $response;
    }
}
