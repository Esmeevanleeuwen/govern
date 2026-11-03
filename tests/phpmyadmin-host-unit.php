<?php
declare(strict_types=1);

// Exercise the actual official-image configuration in separate PHP processes:
// a denied host exits before native phpMyAdmin is configured.
$configuration = dirname(__DIR__) . '/docker/phpmyadmin/config.user.inc.php';
$domain = 'govern.example.test';
$cases = [
    ['local default', [], '', 'http://localhost:8080/phpmyadmin/'],
    ['local hostname and port', ['HTTP_HOST' => 'localhost:8081'], '', 'http://localhost:8081/phpmyadmin/'],
    ['local IPv4', ['HTTP_HOST' => '127.0.0.1:8080'], '', 'http://127.0.0.1:8080/phpmyadmin/'],
    ['local IPv6', ['HTTP_HOST' => '[::1]:8080'], '', 'http://[::1]:8080/phpmyadmin/'],
    ['local hostname case', ['HTTP_HOST' => 'LOCALHOST:8080'], '', 'http://localhost:8080/phpmyadmin/'],
    ['local HTTPS route', ['HTTP_HOST' => 'localhost', 'HTTP_X_FORWARDED_PROTO' => 'https'], '', 'https://localhost/phpmyadmin/'],
    ['exact HTTPS domain', ['HTTP_HOST' => $domain, 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, 'https://' . $domain . '/phpmyadmin/'],
    ['domain case', ['HTTP_HOST' => strtoupper($domain), 'HTTP_X_FORWARDED_PROTO' => 'https'], strtoupper($domain), 'https://' . $domain . '/phpmyadmin/'],
    ['HTTPS test port', ['HTTP_HOST' => $domain . ':18443', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, 'https://' . $domain . ':18443/phpmyadmin/'],
    ['domain not enabled', ['HTTP_HOST' => $domain, 'HTTP_X_FORWARDED_PROTO' => 'https'], '', null],
    ['domain requires HTTPS', ['HTTP_HOST' => $domain, 'HTTP_X_FORWARDED_PROTO' => 'http'], $domain, null],
    ['domain requires gateway scheme', ['HTTP_HOST' => $domain], $domain, null],
    ['unrelated domain', ['HTTP_HOST' => 'other.example.test', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['subdomains not implicit', ['HTTP_HOST' => 'sub.' . $domain, 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['hostname suffix is not exact', ['HTTP_HOST' => $domain . '.other.test', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['local lookalike is not local', ['HTTP_HOST' => 'localhost.other.test'], '', null],
    ['other loopback address not enabled', ['HTTP_HOST' => '127.0.0.2'], '', null],
    ['userinfo is not an authority', ['HTTP_HOST' => 'user@' . $domain, 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['path is not an authority', ['HTTP_HOST' => $domain . '/path', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['query is not an authority', ['HTTP_HOST' => $domain . '?key=value', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['fragment is not an authority', ['HTTP_HOST' => $domain . '#fragment', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['control characters rejected', ['HTTP_HOST' => $domain . "\n", 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['port zero rejected', ['HTTP_HOST' => 'localhost:0'], '', null],
    ['out of range port rejected', ['HTTP_HOST' => 'localhost:65536'], '', null],
    ['non-numeric port rejected', ['HTTP_HOST' => 'localhost:port'], '', null],
    ['empty port rejected', ['HTTP_HOST' => 'localhost:'], '', null],
    ['trailing dot not implicit', ['HTTP_HOST' => $domain . '.', 'HTTP_X_FORWARDED_PROTO' => 'https'], $domain, null],
    ['ambiguous scheme rejected', ['HTTP_HOST' => $domain, 'HTTP_X_FORWARDED_PROTO' => 'https,http'], $domain, null],
    ['unknown scheme rejected', ['HTTP_HOST' => 'localhost', 'HTTP_X_FORWARDED_PROTO' => 'ftp'], '', null],
    ['URL is not a configured domain', ['HTTP_HOST' => $domain, 'HTTP_X_FORWARDED_PROTO' => 'https'], 'https://' . $domain, null],
];

$child = <<<'PHP'
$_SERVER = json_decode($argv[1], true, 16, JSON_THROW_ON_ERROR);
putenv('GOVERN_DOMAIN=' . $argv[2]);
$cfg = [];
register_shutdown_function(static function () use (&$cfg): void {
    echo "\nGOVERN_HOST_RESULT:" . json_encode([
        'status' => http_response_code() ?: 200,
        'uri' => $cfg['PmaAbsoluteUri'] ?? null,
    ], JSON_THROW_ON_ERROR);
});
include $argv[3];
PHP;

foreach ($cases as [$label, $server, $configuredDomain, $expected]) {
    $process = proc_open([PHP_BINARY, '-r', $child, json_encode($server, JSON_THROW_ON_ERROR), $configuredDomain, $configuration],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, []);
    if (!is_resource($process)) throw new RuntimeException('Could not start PHP host fixture.');
    $output = stream_get_contents($pipes[1]);
    $errors = stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    $code = proc_close($process);
    $marker = strrpos($output, "\nGOVERN_HOST_RESULT:");
    if ($code !== 0 || $marker === false || $errors !== '') throw new RuntimeException($label . ': fixture failed: ' . $errors);
    $actual = json_decode(substr($output, $marker + strlen("\nGOVERN_HOST_RESULT:")), true, 16, JSON_THROW_ON_ERROR);
    if ($actual['uri'] !== $expected || $actual['status'] !== ($expected === null ? 400 : 200)) {
        throw new RuntimeException($label . ': unexpected authority outcome ' . json_encode($actual, JSON_THROW_ON_ERROR));
    }
}
echo 'phpMyAdmin authority checks: ' . count($cases) . " passed.\n";
