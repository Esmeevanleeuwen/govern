<?php
declare(strict_types=1);

namespace Govern;

/** A single-operation client; the web process never receives administrator credentials. */
final class DatabaseProvisioner
{
    public const MAX_BYTES = 4096;
    private const TIMEOUT = 12;
    private readonly string $socket;
    private readonly ?\Closure $transport;

    /** Test transport accepts the fixed request object and returns its decoded response. */
    public function __construct(?string $socket = null, ?callable $transport = null)
    {
        $this->socket = $socket ?? (getenv('DB_MANAGER_SOCKET') ?: '/run/govern-databases/provision.sock');
        $this->transport = $transport === null ? null : \Closure::fromCallable($transport);
    }

    public static function validateName(mixed $name): string
    {
        if (!is_string($name) || preg_match('/\A[A-Za-z0-9_]{1,64}\z/D', $name) !== 1
            || strlen(str_replace('_', '\\_', $name)) > 64
            || in_array(strtolower($name), ['mysql', 'information_schema', 'performance_schema', 'sys'], true)) {
            throw ApiException::fromCode('database_create_invalid', 422);
        }
        return $name;
    }

    public function isAvailable(): bool
    {
        if ($this->transport !== null) return true;
        if (!$this->validSocket()) return false;
        clearstatcache(true, $this->socket);
        return !is_link($this->socket) && @filetype($this->socket) === 'socket';
    }

    public function prepare(array $input): array
    {
        if (array_keys($input) !== ['name']) throw ApiException::fromCode('database_create_invalid', 422);
        $name = self::validateName($input['name']);
        $request = ['action' => 'prepare_database', 'name' => $name];
        try {
            $response = $this->transport === null ? $this->exchange($request) : ($this->transport)($request);
        } catch (ApiException $exception) { throw $exception; }
        catch (\Throwable) { throw ApiException::fromCode('database_manager_unavailable', 503); }
        if (!is_array($response) || !array_key_exists('ok', $response) || !is_bool($response['ok'])) {
            throw ApiException::fromCode('database_manager_invalid', 502);
        }
        $keys = array_keys($response); sort($keys);
        if (!$response['ok']) {
            if ($keys !== ['error_code', 'ok'] || !is_string($response['error_code'] ?? null))
                throw ApiException::fromCode('database_manager_invalid', 502);
            $status = ['database_create_invalid' => 422, 'database_prepare_failed' => 503][$response['error_code']] ?? null;
            if ($status === null) throw ApiException::fromCode('database_manager_invalid', 502);
            throw ApiException::fromCode($response['error_code'], $status);
        }
        $data = $response['data'] ?? null;
        if ($keys !== ['data', 'ok'] || !is_array($data) || ($data['database'] ?? null) !== $name
            || !is_bool($data['created'] ?? null) || count($data) !== 2) {
            throw ApiException::fromCode('database_manager_invalid', 502);
        }
        return ['database' => $name, 'created' => $data['created']];
    }

    private function validSocket(): bool
    {
        return str_starts_with($this->socket, '/') && strlen($this->socket) <= 103
            && preg_match('/[\x00-\x1f\x7f]/', $this->socket) !== 1;
    }

    private function exchange(array $request): array
    {
        if (!$this->isAvailable()) throw ApiException::fromCode('database_manager_unavailable', 503);
        $stream = @stream_socket_client('unix://' . $this->socket, $errorNumber, $errorString, 2, STREAM_CLIENT_CONNECT);
        if ($stream === false) throw ApiException::fromCode('database_manager_unavailable', 503);
        $deadline = microtime(true) + self::TIMEOUT;
        try {
            $raw = json_encode($request, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            $written = 0;
            while ($written < strlen($raw)) {
                $this->timeout($stream, $deadline);
                $count = @fwrite($stream, substr($raw, $written));
                if ($count === false || $count === 0) throw ApiException::fromCode('database_manager_unavailable', 503);
                $written += $count;
            }
            $line = '';
            while (!str_ends_with($line, "\n")) {
                $this->timeout($stream, $deadline);
                $part = @fgets($stream, self::MAX_BYTES + 2 - strlen($line));
                $metadata = stream_get_meta_data($stream);
                if ($metadata['timed_out'] ?? false) throw ApiException::fromCode('database_manager_unavailable', 503);
                if ($part === false) throw ApiException::fromCode('database_manager_invalid', 502);
                $line .= $part;
                if (strlen($line) > self::MAX_BYTES) throw ApiException::fromCode('database_manager_invalid', 502);
            }
        } finally { fclose($stream); }
        try { $response = json_decode($line, true, 8, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw ApiException::fromCode('database_manager_invalid', 502); }
        if (!is_array($response) || array_is_list($response)) throw ApiException::fromCode('database_manager_invalid', 502);
        return $response;
    }

    private function timeout(mixed $stream, float $deadline): void
    {
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) throw ApiException::fromCode('database_manager_unavailable', 503);
        stream_set_timeout($stream, (int) $remaining, (int) (($remaining - (int) $remaining) * 1000000));
    }
}
