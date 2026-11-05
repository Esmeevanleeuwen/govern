<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\StudioTranscriber;

$checks = 0;
$assert = static function (bool $value, string $description) use (&$checks): void {
    $checks++;
    if (!$value) throw new RuntimeException($description);
};
$reject = static function (callable $call, string $code, ?int $status = null) use ($assert): void {
    try { $call(); } catch (ApiException $error) {
        $assert($error->errorCode === $code && ($status === null || $error->status === $status), 'Stable rejection: ' . $code);
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$wav = static function (int $rate = 16000, int $frames = 16000): string {
    $data = str_repeat("\0\0", $frames);
    return 'RIFF' . pack('V', 36 + strlen($data)) . 'WAVEfmt ' . pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16)
        . 'data' . pack('V', strlen($data)) . $data;
};
$base = ['enabled' => true, 'url' => 'http://transcriber:8080/v1/audio/transcriptions', 'model' => 'whisper-1',
    'timeout_seconds' => 30, 'allow_remote' => false, 'api_key' => ''];

$assert(StudioTranscriber::validateWav($wav()) === ['sample_rate' => 16000, 'duration_ms' => 1000, 'size' => 32044],
    'WAV metadata is computed from validated PCM frames.');
foreach ([8000, 44100, 48000] as $rate) {
    $assert(StudioTranscriber::validateWav($wav($rate, $rate * 6))['duration_ms'] === 6000, 'Browser sample rate remains exact.');
}
$invalidWavs = ['', 'not audio', substr($wav(), 0, -2), $wav() . 'extra', $wav(16000, 0), $wav(7999), $wav(48001), $wav(16000, 192001)];
foreach (['channels' => [22, pack('v', 2)], 'float' => [20, pack('v', 3)], 'depth' => [34, pack('v', 24)],
    'align' => [32, pack('v', 4)], 'byte-rate' => [28, pack('V', 12345)], 'RIFF' => [4, pack('V', 1)],
    'fmt-size' => [16, pack('V', 17)], 'data-size' => [40, pack('V', 99999999)]] as [$offset, $replacement]) {
    $invalidWavs[] = substr_replace($wav(), $replacement, $offset, strlen($replacement));
}
foreach ($invalidWavs as $bytes) $reject(static fn () => StudioTranscriber::validateWav($bytes), 'studio_audio_invalid', 422);

foreach (['http://evil.example/v1/audio/transcriptions', 'https://evil.example/v1/audio/transcriptions',
    'file:///tmp/audio', 'http://name:password@localhost/v1/audio/transcriptions', 'http://localhost/v1/audio/transcriptions?key=secret',
    "http://localhost/v1/audio/transcriptions\r\n", 'http://localhost:65536/v1/audio/transcriptions',
    'http://localhost', 'http://localhost/v1/%0a', 'http://localhost/v1/audio#fragment'] as $url) {
    $reject(static fn () => StudioTranscriber::validate([...$base, 'url' => $url]), 'studio_transcription_config', 503);
}
foreach ([0, 4, 91, false, '30x'] as $timeout) {
    $reject(static fn () => StudioTranscriber::validate([...$base, 'timeout_seconds' => $timeout]), 'studio_transcription_config', 503);
}
$reject(static fn () => StudioTranscriber::validate([...$base, 'api_key' => "secret\nHeader: injected"]), 'studio_transcription_config', 503);
$reject(static fn () => StudioTranscriber::validate([...$base, 'model' => "model\r\n"]), 'studio_transcription_config', 503);
$assert(StudioTranscriber::validate([...$base, 'url' => 'http://192.168.1.8:8080/inference'])['remote'] === false,
    'A server-configured private numeric address is local.');
$remote = StudioTranscriber::validate([...$base, 'url' => 'https://speech.example/v1/audio/transcriptions', 'allow_remote' => true, 'api_key' => 'explicit-key']);
$assert($remote['remote'] === true, 'Remote transcription requires explicit opt-in and HTTPS.');
$reject(static fn () => StudioTranscriber::validate([...$remote, 'url' => 'http://speech.example/v1/audio/transcriptions']), 'studio_transcription_config', 503);
$status = StudioTranscriber::status($remote);
$assert($status === ['enabled' => true, 'provider' => 'whisper', 'language' => 'nl', 'chunk_seconds' => 6, 'remote' => true]
    && !str_contains(json_encode($status), 'explicit-key') && !str_contains(json_encode($status), 'speech.example'),
    'Public status exposes configuration state without secrets or destinations.');

$requests = [];
$response = ['status' => 200, 'body' => '{"text":"Een agenda voor coaches."}'];
$provider = new StudioTranscriber($remote, static function (string $url, array $headers, string $body, int $timeout) use (&$requests, &$response): array {
    $requests[] = compact('url', 'headers', 'body', 'timeout');
    return $response;
});
$assert($provider->transcribe($wav()) === 'Een agenda voor coaches.', 'Dutch provider text is returned without generation or execution.');
$sent = $requests[0];
$assert($sent['url'] === $remote['url'] && $sent['timeout'] === 30
    && in_array('Authorization: Bearer explicit-key', $sent['headers'], true)
    && str_contains($sent['body'], "name=\"language\"\r\n\r\nnl\r\n")
    && str_contains($sent['body'], $wav()) && str_contains($sent['body'], 'filename="capture.wav"'),
    'Explicit provider request includes the original WAV and Dutch language.');
$response = ['status' => 200, 'body' => '{"text":""}'];
$assert($provider->transcribe($wav()) === '', 'A no-speech response creates no invented transcript.');
foreach ([['status' => 302, 'body' => '{"text":"redirect"}'], ['status' => 500, 'body' => 'provider details'],
    ['status' => 200, 'body' => '{"text":123}'], ['status' => 200, 'body' => '{"text":null}'],
    ['status' => 200, 'body' => '{"text":"bad\\u0000value"}'], ['status' => 200, 'body' => 'not json'],
    ['status' => 200, 'body' => json_encode(['text' => str_repeat('a', 8001)])],
    ['status' => 200, 'body' => str_repeat(' ', 65537)]] as $response) {
    $reject(static fn () => $provider->transcribe($wav()), 'studio_transcription_response', 502);
}
$disabledCalls = 0;
$disabled = new StudioTranscriber([...$base, 'enabled' => false], static function () use (&$disabledCalls): array { $disabledCalls++; return []; });
$reject(static fn () => $disabled->transcribe($wav()), 'studio_transcription_disabled', 503);
$assert($disabledCalls === 0, 'A disabled provider makes no network call.');
echo "Studio transcription: $checks checks passed.\n";
