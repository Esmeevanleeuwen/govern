<?php
declare(strict_types=1);

namespace Govern;

/** Server-owned local inference settings; requests cannot choose a destination. */
final class AiConfig
{
    public static function fromEnvironment(): array
    {
        $env = static fn (string $key, string $default): string => getenv($key) === false ? $default : (string) getenv($key);
        $enabled = $env('AI_ENABLED', '0');
        if (!in_array($enabled, ['0', '1'], true)) throw ApiException::fromCode('ai_config_invalid', 503);
        return self::validate([
            'enabled' => $enabled === '1',
            'base_url' => $env('AI_BASE_URL', 'http://host.docker.internal:11434'),
            'model' => $env('AI_MODEL', 'qwen3:4b-instruct'),
            'timeout_seconds' => $env('AI_TIMEOUT_SECONDS', '60'),
        ]);
    }

    public static function validate(array $config): array
    {
        $url = $config['base_url'] ?? null;
        $model = $config['model'] ?? null;
        $timeout = filter_var($config['timeout_seconds'] ?? null, FILTER_VALIDATE_INT);
        if (!is_bool($config['enabled'] ?? null) || !is_string($url) || strlen($url) > 256
            || preg_match('/[\x00-\x20\x7f]/', $url) || !is_string($model) || strlen($model) > 160
            || preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?\z/D', $model) !== 1
            || preg_match('/(?:^|[:\/-])cloud(?:$|[:\/-])/i', $model)
            || $timeout === false || $timeout < 5 || $timeout > 120) {
            throw ApiException::fromCode('ai_config_invalid', 503);
        }
        $parts = parse_url($url);
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        if ($parts === false || strtolower((string) ($parts['scheme'] ?? '')) !== 'http'
            || !in_array($host, ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'ollama'], true)
            || array_intersect(['user', 'pass', 'query', 'fragment'], array_keys($parts)) !== []
            || !in_array($parts['path'] ?? '', ['', '/'], true)
            || isset($parts['port']) && ($parts['port'] < 1 || $parts['port'] > 65535)) {
            throw ApiException::fromCode('ai_config_invalid', 503);
        }
        $authority = $host === '::1' ? '[::1]' : $host;
        if (isset($parts['port'])) $authority .= ':' . $parts['port'];
        return ['enabled' => $config['enabled'], 'base_url' => 'http://' . $authority,
            'model' => $model, 'timeout_seconds' => $timeout];
    }
}
