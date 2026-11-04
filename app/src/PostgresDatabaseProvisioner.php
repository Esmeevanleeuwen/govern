<?php
declare(strict_types=1);

namespace Govern;

/** A fixed creation operation; administrator credentials stay in the private worker. */
final class PostgresDatabaseProvisioner
{
    private readonly ?\Closure $transport;

    public function __construct(private readonly array $config, ?callable $transport = null)
    {
        $this->transport = $transport === null ? null : \Closure::fromCallable($transport);
    }

    public static function validateName(mixed $name): string
    {
        if (!is_string($name) || preg_match('/\A[A-Za-z0-9_]{1,63}\z/D', $name) !== 1
            || str_starts_with(strtolower($name), 'pg_')
            || in_array(strtolower($name), ['postgres', 'template0', 'template1'], true)) {
            throw ApiException::fromCode('database_create_invalid', 422);
        }
        return $name;
    }

    public function isAvailable(): bool
    {
        if (($this->config['sql_user'] ?? '') === '' || ($this->config['sql_password'] ?? '') === '') return false;
        if ($this->transport !== null) return true;
        $socket = (string) ($this->config['tools_socket'] ?? '');
        if (!str_starts_with($socket, '/') || strlen($socket) > 103 || preg_match('/[\x00-\x1f\x7f]/', $socket)) return false;
        clearstatcache(true, $socket);
        return !is_link($socket) && @filetype($socket) === 'socket'
            && (new PostgresDatabaseRegistry($this->config['registry_file'] ?? null))->names() !== null;
    }

    public function prepare(array $input): array
    {
        if (array_keys($input) !== ['name']) throw ApiException::fromCode('database_create_invalid', 422);
        $name = self::validateName($input['name']);
        $request = ['action' => 'prepare_database', 'name' => $name];
        try {
            if (!$this->isAvailable()) throw ApiException::fromCode('database_manager_unavailable', 503);
            $response = $this->transport === null ? $this->exchange($request) : ($this->transport)($request);
        } catch (ApiException $exception) { throw $exception; }
        catch (\Throwable) { throw ApiException::fromCode('database_manager_unavailable', 503); }
        if (!is_array($response) || !is_bool($response['ok'] ?? null)) throw ApiException::fromCode('database_manager_invalid', 502);
        $keys = array_keys($response); sort($keys);
        if (!$response['ok']) {
            if ($keys !== ['error_code', 'ok'] || !is_string($response['error_code'] ?? null))
                throw ApiException::fromCode('database_manager_invalid', 502);
            $status = ['database_create_invalid' => 422, 'database_prepare_failed' => 503][$response['error_code'] ?? ''] ?? null;
            if ($status === null) throw ApiException::fromCode('database_manager_invalid', 502);
            throw ApiException::fromCode($response['error_code'], $status);
        }
        $data = $response['data'] ?? null;
        if ($keys !== ['data', 'ok'] || !is_array($data) || count($data) !== 2
            || ($data['database'] ?? null) !== $name || !is_bool($data['created'] ?? null)) {
            throw ApiException::fromCode('database_manager_invalid', 502);
        }
        return ['database' => $name, 'created' => $data['created']];
    }

    private function exchange(array $request): array
    {
        $stream = @stream_socket_client('unix://' . $this->config['tools_socket'], $number, $reason, 2, STREAM_CLIENT_CONNECT);
        if ($stream === false) throw ApiException::fromCode('database_manager_unavailable', 503);
        $deadline = microtime(true) + 90;
        try {
            @set_time_limit(95);
            $this->timeout($stream, $deadline);
            $raw = json_encode($request, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            if (@fwrite($stream, $raw) !== strlen($raw)) throw ApiException::fromCode('database_manager_unavailable', 503);
            $line = '';
            while (!str_ends_with($line, "\n")) {
                $this->timeout($stream, $deadline);
                $part = @fgets($stream, DatabaseProvisioner::MAX_BYTES + 2 - strlen($line));
                if (stream_get_meta_data($stream)['timed_out'] ?? false) throw ApiException::fromCode('database_manager_unavailable', 503);
                if ($part === false || strlen($line) + strlen($part) > DatabaseProvisioner::MAX_BYTES)
                    throw ApiException::fromCode('database_manager_invalid', 502);
                $line .= $part;
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
