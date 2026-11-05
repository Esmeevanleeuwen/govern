<?php
declare(strict_types=1);

namespace Govern;

/** Explicit, bounded Whisper-compatible audio transport. It never selects a cloud fallback. */
final class StudioTranscriber
{
    public const MAX_AUDIO_BYTES = 2097152;
    public const MAX_DURATION_MS = 12000;
    private const MAX_RESPONSE_BYTES = 65536;
    private readonly array $config;
    private readonly ?\Closure $transport;

    /** Optional test transport: (URL, headers, multipart bytes, timeout) => {status:int,body:string}. */
    public function __construct(array $config, ?callable $transport = null)
    {
        $this->config = self::validate($config);
        $this->transport = $transport === null ? null : \Closure::fromCallable($transport);
    }

    public static function fromEnvironment(): array
    {
        $env = static fn (string $key, string $fallback): string => getenv($key) === false ? $fallback : (string) getenv($key);
        $enabled = $env('STUDIO_TRANSCRIPTION_ENABLED', '0');
        $remote = $env('STUDIO_TRANSCRIPTION_ALLOW_REMOTE', '0');
        if (!in_array($enabled, ['0', '1'], true) || !in_array($remote, ['0', '1'], true)) {
            throw ApiException::fromCode('studio_transcription_config', 503);
        }
        return self::validate([
            'enabled' => $enabled === '1',
            'url' => $env('STUDIO_TRANSCRIPTION_URL', 'http://transcriber:8080/v1/audio/transcriptions'),
            'model' => $env('STUDIO_TRANSCRIPTION_MODEL', 'whisper-1'),
            'timeout_seconds' => $env('STUDIO_TRANSCRIPTION_TIMEOUT_SECONDS', '30'),
            'allow_remote' => $remote === '1',
            'api_key' => $env('STUDIO_TRANSCRIPTION_API_KEY', ''),
        ]);
    }

    public static function validate(array $config): array
    {
        $url = $config['url'] ?? null;
        $model = $config['model'] ?? null;
        $key = $config['api_key'] ?? '';
        $timeout = filter_var($config['timeout_seconds'] ?? null, FILTER_VALIDATE_INT);
        if (!is_bool($config['enabled'] ?? null) || !is_bool($config['allow_remote'] ?? null)
            || !is_string($url) || strlen($url) > 512 || preg_match('/[\x00-\x20\x7f]/', $url)
            || !is_string($model) || preg_match('/\A[A-Za-z0-9][A-Za-z0-9._\/-]{0,159}\z/D', $model) !== 1
            || !is_string($key) || strlen($key) > 1024 || preg_match('/[\x00-\x20\x7f]/', $key)
            || $timeout === false || $timeout < 5 || $timeout > 90) {
            throw ApiException::fromCode('studio_transcription_config', 503);
        }
        $parts = parse_url($url);
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $local = in_array($host, ['localhost', '127.0.0.1', '::1', 'host.docker.internal',
            'transcriber', 'studio-transcriber', 'whisper', 'whispercpp'], true);
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            $octets = array_map('intval', explode('.', $host));
            $local = $local || $octets[0] === 10 || ($octets[0] === 172 && $octets[1] >= 16 && $octets[1] <= 31)
                || ($octets[0] === 192 && $octets[1] === 168);
        }
        if ($parts === false || $host === '' || !in_array($scheme, ['http', 'https'], true)
            || array_intersect(['user', 'pass', 'query', 'fragment'], array_keys($parts)) !== []
            || preg_match('/\A\/[A-Za-z0-9._~\/-]+\z/D', $parts['path'] ?? '') !== 1
            || isset($parts['port']) && ($parts['port'] < 1 || $parts['port'] > 65535)
            || (!$local && (!$config['allow_remote'] || $scheme !== 'https'))) {
            throw ApiException::fromCode('studio_transcription_config', 503);
        }
        return ['enabled' => $config['enabled'], 'url' => $url, 'model' => $model,
            'timeout_seconds' => $timeout, 'allow_remote' => $config['allow_remote'],
            'api_key' => $key, 'remote' => !$local];
    }

    /** Configuration status only; this does not claim that a model is loaded or reachable. */
    public static function status(array $config): array
    {
        $config = self::validate($config);
        return ['enabled' => $config['enabled'], 'provider' => 'whisper', 'language' => 'nl',
            'chunk_seconds' => 6, 'remote' => $config['remote']];
    }

    /** Only PCM16 mono RIFF/WAVE is accepted for the first live-capture path. */
    public static function validateWav(string $bytes): array
    {
        $size = strlen($bytes);
        $invalid = static fn (): ApiException => ApiException::fromCode('studio_audio_invalid', 422);
        if ($size < 46 || $size > self::MAX_AUDIO_BYTES || substr($bytes, 0, 4) !== 'RIFF'
            || substr($bytes, 8, 4) !== 'WAVE' || unpack('V', substr($bytes, 4, 4))[1] + 8 !== $size) {
            throw $invalid();
        }
        $format = null;
        $dataBytes = null;
        $offset = 12;
        while ($offset < $size) {
            if ($offset + 8 > $size) throw $invalid();
            $type = substr($bytes, $offset, 4);
            $length = unpack('V', substr($bytes, $offset + 4, 4))[1];
            $offset += 8;
            if ($length > $size - $offset) throw $invalid();
            if ($type === 'fmt ') {
                if ($format !== null || $length !== 16) throw $invalid();
                $format = unpack('vencoding/vchannels/Vrate/Vbyte_rate/valign/vbits', substr($bytes, $offset, 16));
            } elseif ($type === 'data') {
                if ($dataBytes !== null) throw $invalid();
                $dataBytes = $length;
            }
            $offset += $length + ($length % 2);
        }
        if ($offset !== $size || $format === null || $dataBytes === null || $dataBytes < 2 || $dataBytes % 2 !== 0
            || $format['encoding'] !== 1 || $format['channels'] !== 1 || $format['bits'] !== 16
            || $format['rate'] < 8000 || $format['rate'] > 48000 || $format['align'] !== 2
            || $format['byte_rate'] !== $format['rate'] * 2 || $dataBytes > $format['rate'] * 24) {
            throw $invalid();
        }
        return ['sample_rate' => $format['rate'], 'duration_ms' => (int) round($dataBytes * 500 / $format['rate']),
            'size' => $size];
    }

    public function transcribe(string $wavBytes): string
    {
        if (!$this->config['enabled']) throw ApiException::fromCode('studio_transcription_disabled', 503);
        self::validateWav($wavBytes);
        $boundary = 'govern-' . bin2hex(random_bytes(24));
        $body = '';
        foreach (['model' => $this->config['model'], 'language' => 'nl', 'response_format' => 'json', 'temperature' => '0'] as $name => $value) {
            $body .= '--' . $boundary . "\r\nContent-Disposition: form-data; name=\"" . $name . "\"\r\n\r\n" . $value . "\r\n";
        }
        $body .= '--' . $boundary . "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"capture.wav\"\r\n"
            . "Content-Type: audio/wav\r\n\r\n" . $wavBytes . "\r\n--" . $boundary . "--\r\n";
        $headers = ['Accept: application/json', 'Content-Type: multipart/form-data; boundary=' . $boundary,
            'Content-Length: ' . strlen($body), 'Connection: close'];
        if ($this->config['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $this->config['api_key'];
        $response = $this->transport === null ? $this->request($headers, $body)
            : ($this->transport)($this->config['url'], $headers, $body, $this->config['timeout_seconds']);
        if (!is_array($response) || ($response['status'] ?? null) !== 200 || !is_string($response['body'] ?? null)
            || strlen($response['body']) > self::MAX_RESPONSE_BYTES) {
            throw ApiException::fromCode('studio_transcription_response', 502);
        }
        try {
            $result = json_decode($response['body'], true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ApiException::fromCode('studio_transcription_response', 502);
        }
        if (!is_array($result) || !is_string($result['text'] ?? null) || strlen($result['text']) > 8000
            || preg_match('//u', $result['text']) !== 1 || str_contains($result['text'], "\0")) {
            throw ApiException::fromCode('studio_transcription_response', 502);
        }
        return trim($result['text']);
    }

    private function request(array $headers, string $body): array
    {
        $started = microtime(true);
        $timeout = $this->config['timeout_seconds'];
        $context = stream_context_create(['http' => [
            'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
            'timeout' => $timeout, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0,
        ], 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $stream = @fopen($this->config['url'], 'rb', false, $context);
        if ($stream === false) {
            throw ApiException::fromCode(microtime(true) - $started >= $timeout - 0.1
                ? 'studio_transcription_timeout' : 'studio_transcription_unavailable', 503);
        }
        try {
            $status = 0;
            foreach (stream_get_meta_data($stream)['wrapper_data'] ?? [] as $line) {
                if (preg_match('/\AHTTP\/\S+ (\d{3})\b/', $line, $match)) $status = (int) $match[1];
            }
            if ($status !== 200) throw ApiException::fromCode('studio_transcription_response', 502);
            $response = '';
            while (!feof($stream)) {
                $remaining = $timeout - (microtime(true) - $started);
                if ($remaining <= 0) throw ApiException::fromCode('studio_transcription_timeout', 504);
                stream_set_timeout($stream, (int) $remaining, (int) (($remaining - (int) $remaining) * 1000000));
                $part = @fread($stream, min(8192, self::MAX_RESPONSE_BYTES + 1 - strlen($response)));
                if (stream_get_meta_data($stream)['timed_out']) throw ApiException::fromCode('studio_transcription_timeout', 504);
                if ($part === false) throw ApiException::fromCode('studio_transcription_unavailable', 503);
                $response .= $part;
                if (strlen($response) > self::MAX_RESPONSE_BYTES) throw ApiException::fromCode('studio_transcription_response', 502);
                if ($part === '' && !feof($stream)) throw ApiException::fromCode('studio_transcription_unavailable', 503);
            }
            return ['status' => $status, 'body' => $response];
        } finally {
            fclose($stream);
        }
    }
}
