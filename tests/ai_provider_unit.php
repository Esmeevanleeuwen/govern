<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\AiConfig;
use Govern\ApiException;
use Govern\OllamaClient;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, string $code, int $status) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) {
        $assert($exception->errorCode === $code && $exception->status === $status, 'Expected ' . $code . ', got ' . $exception->errorCode);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$base = ['enabled' => true, 'base_url' => 'http://127.0.0.1:11434', 'model' => 'qwen3:4b-instruct', 'timeout_seconds' => 60];
$oldEnvironment = [];
foreach (['AI_ENABLED', 'AI_BASE_URL', 'AI_MODEL', 'AI_TIMEOUT_SECONDS'] as $name) {
    $oldEnvironment[$name] = getenv($name);
    putenv($name);
}
try {
    $default = AiConfig::fromEnvironment();
    $assert(!$default['enabled'] && $default['model'] === 'qwen3:4b-instruct' && $default['timeout_seconds'] === 60,
        'Local inference is disabled by default with a bounded laptop-sized request.');
    putenv('AI_ENABLED=yes');
    $reject(AiConfig::fromEnvironment(...), 'ai_config_invalid', 503);
} finally {
    foreach ($oldEnvironment as $name => $value) $value === false ? putenv($name) : putenv($name . '=' . $value);
}

foreach (['http://localhost:11434/', 'http://[::1]:11434', 'http://host.docker.internal:11434', 'http://ollama:11434'] as $url) {
    $assert(AiConfig::validate([...$base, 'base_url' => $url])['base_url'] === rtrim($url, '/'), 'Supported local destination remains local.');
}
foreach (['https://localhost:11434', 'http://example.com', 'http://127.0.0.1.evil.invalid', 'http://user@localhost:11434',
    'http://localhost:11434/api', 'http://localhost:11434?key=secret', 'http://localhost:11434#fragment',
    'http://localhost:0', 'http://localhost:65536', "http://localhost\n"] as $url) {
    $reject(static fn () => AiConfig::validate([...$base, 'base_url' => $url]), 'ai_config_invalid', 503);
}
foreach (['qwen3:cloud', 'qwen3:4b-cloud', 'cloud', "qwen3\n", '../model', 'name:tag:other', str_repeat('a', 161)] as $model) {
    $reject(static fn () => AiConfig::validate([...$base, 'model' => $model]), 'ai_config_invalid', 503);
}
foreach ([0, 4, 121, '60;evil', false] as $timeout) {
    $reject(static fn () => AiConfig::validate([...$base, 'timeout_seconds' => $timeout]), 'ai_config_invalid', 503);
}

$requests = [];
$reply = static fn (array $output): array => ['model' => 'qwen3:4b-instruct', 'done' => true, 'done_reason' => 'stop',
    'message' => ['role' => 'assistant', 'content' => json_encode($output, JSON_THROW_ON_ERROR)]];
$response = ['models' => [['name' => 'qwen3:4b-instruct'], ['name' => 'qwen3:cloud'], ['name' => 'qwen3:4b-instruct']]];
$client = new OllamaClient($base, static function (string $method, string $path, ?array $body, int $timeout) use (&$requests, &$response): array {
    $requests[] = compact('method', 'path', 'body', 'timeout');
    return $response;
});
$assert($client->models() === ['qwen3:4b-instruct'], 'Local model discovery removes duplicate and cloud aliases.');
$assert($requests[0] === ['method' => 'GET', 'path' => '/api/tags', 'body' => null, 'timeout' => 2],
    'Status discovery has a short bounded request and no prompt.');
$response = $reply(['answer' => 'Nederlandse uitleg <script>tekst</script>', 'sql' => 'SELECT 1;']);
$messages = [['role' => 'system', 'content' => 'Explain schema only.'], ['role' => 'user', 'content' => 'Wat is deze tabel?']];
$assert($client->complete($messages) === ['answer' => 'Nederlandse uitleg <script>tekst</script>', 'sql' => 'SELECT 1;'],
    'Provider preserves plain answer and SQL proposal text without executing it.');
$request = $requests[1];
$assert($request['path'] === '/api/chat' && $request['timeout'] === 60 && $request['body']['messages'] === $messages
    && $request['body']['stream'] === false && $request['body']['options']['num_ctx'] === 4096
    && $request['body']['options']['num_predict'] === 768 && !isset($request['body']['tools']),
    'Model request has bounded context and output, with no tool access.');
$assert($request['body']['format']['required'] === ['answer', 'sql'] && $request['body']['format']['additionalProperties'] === false,
    'The requested result has an explicit JSON schema.');

foreach ([
    ['answer' => 'ok'], ['answer' => '', 'sql' => null], ['answer' => 'ok', 'sql' => []],
    ['answer' => 'ok', 'sql' => null, 'execute' => true], ['answer' => str_repeat('a', 16001), 'sql' => null],
    ['answer' => 'ok', 'sql' => str_repeat('a', 16001)], ['answer' => "bad\0value", 'sql' => null],
] as $invalid) {
    $response = $reply($invalid);
    $reject(static fn () => $client->complete($messages), 'ai_response_invalid', 502);
}
$response = $reply(['answer' => 'ok', 'sql' => null]);
$response['message']['tool_calls'] = [['function' => ['name' => 'execute_sql']]];
$reject(static fn () => $client->complete($messages), 'ai_response_invalid', 502);
$response = $reply(['answer' => 'ok', 'sql' => null]);
$response['done'] = false;
$reject(static fn () => $client->complete($messages), 'ai_response_invalid', 502);
$response = $reply(['answer' => 'ok', 'sql' => null]);
$response['done_reason'] = 'length';
$reject(static fn () => $client->complete($messages), 'ai_response_invalid', 502);
$response = $reply(['answer' => 'ok', 'sql' => null]);
$response['message']['content'] = 'plain text without JSON';
$reject(static fn () => $client->complete($messages), 'ai_response_invalid', 502);
$response = ['models' => [null]];
$reject($client->models(...), 'ai_response_invalid', 502);
$response = ['models' => [], 'large' => str_repeat('a', 131073)];
$reject($client->models(...), 'ai_response_invalid', 502);

// The native adapter is exercised against an isolated loopback fixture, never a real model.
$directory = sys_get_temp_dir() . '/govern-ai-provider-' . bin2hex(random_bytes(6));
mkdir($directory, 0700);
$socket = stream_socket_server('tcp://127.0.0.1:0', $errorNumber, $errorText);
if ($socket === false) throw new RuntimeException('Cannot allocate isolated provider fixture port.');
$address = stream_socket_get_name($socket, false);
fclose($socket);
$port = (int) substr((string) $address, strrpos((string) $address, ':') + 1);
$modeFile = $directory . '/mode';
$router = $directory . '/router.php';
file_put_contents($modeFile, 'normal');
file_put_contents($router, '<?php $mode = trim(file_get_contents(' . var_export($modeFile, true) . ')); '
    . 'if ($mode === "redirect") { header("Location: http://example.invalid"); exit; } '
    . 'if ($mode === "error") { http_response_code(500); echo "provider private diagnostic"; exit; } '
    . 'if ($mode === "timeout") { usleep(2300000); } '
    . 'header("Content-Type: application/json"); '
    . 'if ($mode === "huge") { echo str_repeat("a", 131073); exit; } '
    . 'if ($mode === "invalid") { echo "not JSON"; exit; } '
    . 'if ($_SERVER["REQUEST_URI"] === "/api/tags") { echo json_encode(["models" => [["name" => "qwen3:4b-instruct"]]]); } '
    . 'else { echo json_encode(["done" => true, "done_reason" => "stop", "message" => ["role" => "assistant", "content" => json_encode(["answer" => "Native transport", "sql" => null])]]); }');
$process = proc_open([PHP_BINARY, '-n', '-S', '127.0.0.1:' . $port, $router],
    [0 => ['pipe', 'r'], 1 => ['file', $directory . '/server.log', 'a'], 2 => ['file', $directory . '/server.log', 'a']], $pipes);
if (!is_resource($process)) throw new RuntimeException('Cannot start isolated provider fixture.');
fclose($pipes[0]);
try {
    $ready = false;
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $connection = @stream_socket_client('tcp://127.0.0.1:' . $port, $number, $text, .05);
        if ($connection !== false) { fclose($connection); $ready = true; break; }
        usleep(20000);
    }
    $assert($ready, 'The isolated native HTTP fixture starts.');
    $native = new OllamaClient([...$base, 'base_url' => 'http://127.0.0.1:' . $port]);
    $assert($native->models() === ['qwen3:4b-instruct'], 'Native GET decodes real HTTP JSON.');
    $assert($native->complete($messages)['answer'] === 'Native transport', 'Native POST decodes structured model output.');
    foreach (['redirect' => 'ai_unavailable', 'error' => 'ai_unavailable', 'invalid' => 'ai_response_invalid', 'huge' => 'ai_response_invalid'] as $mode => $code) {
        file_put_contents($modeFile, $mode);
        $reject($native->models(...), $code, $code === 'ai_unavailable' ? 503 : 502);
    }
    file_put_contents($modeFile, 'timeout');
    $started = microtime(true);
    $reject($native->models(...), 'ai_timeout', 504);
    $assert(microtime(true) - $started < 2.8, 'The status timeout is bounded even before response headers.');
} finally {
    proc_terminate($process);
    proc_close($process);
    foreach ([$modeFile, $router, $directory . '/server.log'] as $file) if (is_file($file)) unlink($file);
    rmdir($directory);
}

echo "Local AI provider checks: $passed passed.\n";
