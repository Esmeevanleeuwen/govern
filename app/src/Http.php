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
            throw new ApiException('Deze hostnaam is niet toegestaan voor de lokale werkplek.', 403);
        }
        if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
            throw new ApiException('Open de werkplek rechtstreeks in hetzelfde browservenster.', 403);
        }
        if (isset($_SERVER['HTTP_ORIGIN'])) {
            $origin = parse_url($_SERVER['HTTP_ORIGIN']);
            $originHost = strtolower(trim((string) ($origin['host'] ?? ''), '[]'));
            $secure = self::secure();
            $port = $parts['port'] ?? ($secure ? 443 : 80);
            $originPort = $origin['port'] ?? (($origin['scheme'] ?? '') === 'https' ? 443 : 80);
            if ($originHost !== $host || $originPort !== $port || ($origin['scheme'] ?? '') !== ($secure ? 'https' : 'http')) {
                throw new ApiException('Dit verzoek komt niet uit de eigen werkplek.', 403);
            }
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('govern_session');
        session_set_cookie_params(['httponly' => true, 'secure' => self::secure(), 'samesite' => 'Strict', 'path' => '/']);
        if (!session_start()) {
            throw new ApiException('De lokale browsersessie kan niet worden geopend.', 503);
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
            throw new ApiException('Gebruik POST voor deze handeling.', 405);
        }
        $received = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($received) || !hash_equals($token, $received)) {
            throw new ApiException('Vernieuw de pagina en probeer opnieuw; de browsersessie klopt niet meer.', 403);
        }
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
            throw new ApiException('Verstuur deze handeling als JSON.', 415);
        }
        $max = 1048576;
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) {
            throw new ApiException('Dit verzoek is te groot.', 413);
        }
        $raw = file_get_contents('php://input', false, null, 0, $max + 1);
        if ($raw === false || strlen($raw) > $max) {
            throw new ApiException('Dit verzoek is te groot.', 413);
        }
        try {
            $input = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('De ontvangen gegevens zijn geen geldige JSON.');
        }
        if (!is_array($input) || ($input !== [] && array_is_list($input))) {
            throw new ApiException('De ontvangen gegevens moeten een JSON-object zijn.');
        }
        return $input;
    }

    public static function get(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
            header('Allow: GET');
            throw new ApiException('Gebruik GET om deze informatie te bekijken.', 405);
        }
    }

    public static function text(array $input, string $key, bool $required = true): string
    {
        $value = $input[$key] ?? '';
        if (!is_string($value) || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
            throw new ApiException('Vul een geldige tekst in voor ' . $key . '.');
        }
        $value = trim($value);
        if ($required && $value === '') {
            throw new ApiException('Vul ' . $key . ' in.');
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
            throw new ApiException('Vul een geldig getal in voor ' . $key . '.');
        }
        return $value;
    }

    public static function json(mixed $data, int $status = 200, bool $success = true): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($success ? ['ok' => true, 'data' => $data] : ['ok' => false, 'error' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        exit;
    }

    private static function secure(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }
}
