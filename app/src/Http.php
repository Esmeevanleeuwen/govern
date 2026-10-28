<?php
declare(strict_types=1);

namespace Govern;

final class Http
{
    public static function start(array $config): string
    {
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        $authority = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $parts = parse_url('http://' . $authority);
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        $allowed = array_map(static fn (string $value): string => strtolower(trim($value, '[]')), $config['allowed_hosts']);
        if ($host === '' || !in_array($host, $allowed, true) || isset($parts['user']) || isset($parts['pass'])) {
            throw ApiException::fromCode('host_not_allowed', 403);
        }
        if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
            throw ApiException::fromCode('same_window_required', 403);
        }
        if (isset($_SERVER['HTTP_ORIGIN'])) {
            $origin = parse_url($_SERVER['HTTP_ORIGIN']);
            $originHost = strtolower(trim((string) ($origin['host'] ?? ''), '[]'));
            $secure = self::secure();
            $port = $parts['port'] ?? ($secure ? 443 : 80);
            $originPort = $origin['port'] ?? (($origin['scheme'] ?? '') === 'https' ? 443 : 80);
            if ($originHost !== $host || $originPort !== $port || ($origin['scheme'] ?? '') !== ($secure ? 'https' : 'http')) {
                throw ApiException::fromCode('origin_not_allowed', 403);
            }
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('govern_session');
        session_set_cookie_params(['httponly' => true, 'secure' => self::secure(), 'samesite' => 'Strict', 'path' => '/']);
        if (!session_start()) {
            throw ApiException::fromCode('session_unavailable', 503);
        }
        if (!isset($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        $token = $_SESSION['csrf'];
        // Long SQL/export requests must not lock every other tab in the browser.
        session_write_close();
        return $token;
    }

    public static function post(string $token): array
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            header('Allow: POST');
            throw ApiException::fromCode('post_required', 405);
        }
        $received = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($received) || !hash_equals($token, $received)) {
            throw ApiException::fromCode('csrf_invalid', 403);
        }
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
            throw ApiException::fromCode('json_required', 415);
        }
        $max = 1048576;
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) {
            throw ApiException::fromCode('request_too_large', 413);
        }
        $raw = file_get_contents('php://input', false, null, 0, $max + 1);
        if ($raw === false || strlen($raw) > $max) {
            throw ApiException::fromCode('request_too_large', 413);
        }
        try {
            $input = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ApiException::fromCode('json_invalid');
        }
        if (!is_array($input) || ($input !== [] && array_is_list($input))) {
            throw ApiException::fromCode('json_object_required');
        }
        return $input;
    }

    public static function get(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
            header('Allow: GET');
            throw ApiException::fromCode('get_required', 405);
        }
    }

    public static function text(array $input, string $key, bool $required = true): string
    {
        $value = $input[$key] ?? '';
        if (!is_string($value) || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
            throw ApiException::fromCode('text_invalid', 400, ['field' => $key]);
        }
        $value = trim($value);
        if ($required && $value === '') {
            throw ApiException::fromCode('field_required', 400, ['field' => $key]);
        }
        return $value;
    }

    public static function integer(array $input, string $key, int $default): int
    {
        if (!isset($input[$key])) {
            return $default;
        }
        $value = filter_var($input[$key], FILTER_VALIDATE_INT);
        if ($value === false) {
            throw ApiException::fromCode('integer_invalid', 400, ['field' => $key]);
        }
        return $value;
    }

    /** The string error remains compatible with older clients. */
    public static function envelope(mixed $data, bool $success = true, ?string $errorCode = null, array $errorParams = []): array
    {
        if ($success) {
            return ['ok' => true, 'data' => $data];
        }
        $result = ['ok' => false, 'error' => $data, 'error_code' => $errorCode ?? 'request_failed', 'error_params' => (object) $errorParams];
        if ($errorCode !== null && Messages::has($errorCode)) {
            $result['error_i18n'] = Messages::translations($errorCode, $errorParams);
        }
        return $result;
    }

    public static function json(mixed $data, int $status = 200, bool $success = true, ?string $errorCode = null, array $errorParams = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Language: ' . Messages::language());
        echo json_encode(self::envelope($data, $success, $errorCode, $errorParams), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        exit;
    }

    private static function secure(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }
}
