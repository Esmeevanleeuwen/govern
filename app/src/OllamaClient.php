<?php
declare(strict_types=1);

namespace Govern;

/** A bounded local HTTP adapter. It has no database or tool execution access. */
final class OllamaClient
{
    private const RESPONSE_BYTES = 131072;
    private readonly array $config;
    private readonly ?\Closure $transport;

    /** Test transport: (method, path, JSON body or null, timeout seconds) => decoded JSON object. */
    public function __construct(array $config, ?callable $transport = null)
    {
        $this->config = AiConfig::validate($config);
        $this->transport = $transport === null ? null : \Closure::fromCallable($transport);
    }

    public function models(): array
    {
        $data = $this->request('GET', '/api/tags', null, 2);
        if (!isset($data['models']) || !is_array($data['models']) || !array_is_list($data['models']) || count($data['models']) > 512)
            throw ApiException::fromCode('ai_response_invalid', 502);
        $models = [];
        foreach ($data['models'] as $item) {
            $name = is_array($item) ? ($item['name'] ?? null) : null;
            if (!is_string($name) || $name === '' || strlen($name) > 160 || preg_match('//u', $name) !== 1 || str_contains($name, "\0"))
                throw ApiException::fromCode('ai_response_invalid', 502);
            // Cloud aliases are never offered as local choices.
            if (preg_match('/(?:^|[:\/-])cloud(?:$|[:\/-])/i', $name) !== 1) $models[] = $name;
        }
        return array_values(array_unique($models, SORT_STRING));
    }

    public function complete(array $messages): array
    {
        $data = $this->request('POST', '/api/chat', [
            'model' => $this->config['model'], 'messages' => $messages, 'stream' => false,
            'format' => ['type' => 'object', 'properties' => ['answer' => ['type' => 'string'],
                'sql' => ['type' => ['string', 'null']]], 'required' => ['answer', 'sql'], 'additionalProperties' => false],
            'options' => ['num_ctx' => 4096, 'num_predict' => 768, 'temperature' => 0.2],
            'keep_alive' => '1m',
        ], $this->config['timeout_seconds']);
        $message = $data['message'] ?? null;
        if (($data['done'] ?? null) !== true || !is_array($message) || ($message['role'] ?? null) !== 'assistant'
            || !empty($message['tool_calls']) || !is_string($message['content'] ?? null)
            || ($data['done_reason'] ?? 'stop') !== 'stop') throw ApiException::fromCode('ai_response_invalid', 502);
        try { $result = json_decode($message['content'], true, 8, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw ApiException::fromCode('ai_response_invalid', 502); }
        if (!is_array($result) || array_diff(array_keys($result), ['answer', 'sql']) !== []
            || !is_string($result['answer'] ?? null) || trim($result['answer']) === ''
            || !array_key_exists('sql', $result) || $result['sql'] !== null && !is_string($result['sql']))
            throw ApiException::fromCode('ai_response_invalid', 502);
        foreach ([$result['answer'], $result['sql']] as $value) {
            if ($value !== null && (strlen($value) > 16000 || preg_match('//u', $value) !== 1 || str_contains($value, "\0")))
                throw ApiException::fromCode('ai_response_invalid', 502);
        }
        return ['answer' => $result['answer'], 'sql' => $result['sql'] === '' ? null : $result['sql']];
    }

    private function request(string $method, string $path, ?array $body, int $timeout): array
    {
        if ($this->transport !== null) {
            $data = ($this->transport)($method, $path, $body, $timeout);
            if (!is_array($data) || strlen(self::json($data)) > self::RESPONSE_BYTES)
                throw ApiException::fromCode('ai_response_invalid', 502);
            return $data;
        }
        $headers = "Accept: application/json\r\nConnection: close\r\n";
        if ($body !== null) $headers .= "Content-Type: application/json\r\n";
        $options = ['method' => $method, 'header' => $headers, 'timeout' => $timeout,
            'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0, 'protocol_version' => 1.1];
        if ($body !== null) $options['content'] = self::json($body);
        $started = microtime(true);
        $stream = @fopen($this->config['base_url'] . $path, 'rb', false, stream_context_create(['http' => $options]));
        if ($stream === false) {
            throw ApiException::fromCode(microtime(true) - $started >= $timeout - 0.1 ? 'ai_timeout' : 'ai_unavailable',
                microtime(true) - $started >= $timeout - 0.1 ? 504 : 503);
        }
        try {
            $metadata = stream_get_meta_data($stream);
            $header = $metadata['wrapper_data'][0] ?? '';
            if (preg_match('/\AHTTP\/\S+\s+([0-9]{3})\b/', $header, $match) !== 1 || (int) $match[1] < 200 || (int) $match[1] >= 300)
                throw ApiException::fromCode('ai_unavailable', 503);
            $raw = '';
            while (!feof($stream)) {
                $remaining = $timeout - (microtime(true) - $started);
                if ($remaining <= 0) throw ApiException::fromCode('ai_timeout', 504);
                stream_set_timeout($stream, (int) $remaining, (int) (($remaining - (int) $remaining) * 1000000));
                $part = @fread($stream, min(8192, self::RESPONSE_BYTES + 1 - strlen($raw)));
                $metadata = stream_get_meta_data($stream);
                if ($metadata['timed_out'] ?? false) throw ApiException::fromCode('ai_timeout', 504);
                if ($part === false) throw ApiException::fromCode('ai_unavailable', 503);
                $raw .= $part;
                if (strlen($raw) > self::RESPONSE_BYTES) throw ApiException::fromCode('ai_response_invalid', 502);
            }
        } finally { fclose($stream); }
        try { $decoded = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw ApiException::fromCode('ai_response_invalid', 502); }
        if (!is_array($decoded) || array_is_list($decoded)) throw ApiException::fromCode('ai_response_invalid', 502);
        return $decoded;
    }

    private static function json(array $data): string
    {
        try { return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
        catch (\JsonException) { throw ApiException::fromCode('ai_response_invalid', 502); }
    }
}
