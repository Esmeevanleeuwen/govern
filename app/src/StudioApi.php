<?php
declare(strict_types=1);
namespace Govern;

/** Domain routes inside the existing authenticated, scoped API. */
final class StudioApi
{
    public const ACTIONS = ['studio-bootstrap', 'studio-board', 'studio-create-board',
        'studio-mutate', 'studio-start-recording', 'studio-stop-recording', 'studio-audio'];

    public static function dispatch(string $action, array $config, string $csrf, array $input, ?array $upload): never
    {
        $enabled = ($config['studio']['enabled'] ?? false) === true;
        $schema = $config['studio']['schema'] ?? 'brainstorm';
        if ($action === 'studio-bootstrap' && !$enabled) {
            Http::json(['csrf' => $csrf, 'enabled' => false, 'ready' => false,
                'schema' => $schema, 'scope_key' => $config['scope_key'], 'generation' => null, 'boards' => [],
                'transcription' => ['enabled' => false, 'provider' => 'whisper', 'language' => 'nl', 'chunk_seconds' => 6]]);
        }
        if (!$enabled) throw ApiException::fromCode('studio_disabled', 503);
        if (($config['engine'] ?? '') !== 'postgres' || ($config['schema'] ?? '') !== $schema) {
            throw ApiException::fromCode('studio_config_invalid', 403);
        }
        $studio = new StudioService(new Database($config), $config);
        if ($action === 'studio-audio') {
            if ($upload === null) throw ApiException::fromCode('studio_audio_invalid', 422);
            Http::json(StudioAudio::process($studio, $config, $upload));
        }
        $lock = new MaintenanceLock($config['maintenance_dir']);
        $ready = $studio->ready();
        if ($action === 'studio-bootstrap') {
            Http::json(['csrf' => $csrf, 'enabled' => true, 'ready' => $ready,
                'schema' => $schema, 'scope_key' => $config['scope_key'],
                'generation' => $ready ? $studio->generation() : null,
                'boards' => $ready ? $studio->boards() : [],
                'transcription' => StudioTranscriber::status(StudioTranscriber::fromEnvironment()),
                'limits' => ['nodes' => 500, 'edges' => 1000, 'operations' => 100,
                    'audio_bytes' => 2097152, 'audio_seconds' => 12]]);
        }
        if (!$ready) throw ApiException::fromCode('studio_schema_unavailable', 503);
        Http::json(match ($action) {
            'studio-board' => $studio->board(Http::text($_GET, 'board')),
            'studio-create-board' => $studio->createBoard($input),
            'studio-mutate' => $studio->mutate($input),
            'studio-start-recording' => $studio->startRecording($input),
            'studio-stop-recording' => $studio->stopRecording($input),
            default => throw ApiException::fromCode('action_missing', 404),
        }, $action === 'studio-create-board' ? 201 : 200);
    }
}
