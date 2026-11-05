<?php
declare(strict_types=1);
namespace Govern;

/** Bounded live PCM chunks; bytes are temporary and never served publicly. */
final class StudioAudio
{
    public static function upload(string $csrf): array
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw ApiException::fromCode('post_required', 405);
        $received = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($received) || !hash_equals($csrf, $received)) throw ApiException::fromCode('csrf_invalid', 403);
        if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data;')) {
            throw ApiException::fromCode('studio_audio_invalid', 415);
        }
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 2200000) throw ApiException::fromCode('studio_audio_invalid', 413);
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK
            || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) {
            throw ApiException::fromCode('studio_audio_invalid', 422);
        }
        $size = filesize($file['tmp_name']);
        if ($size === false || $size < 44 || $size > 2097152) throw ApiException::fromCode('studio_audio_invalid', 422);
        $bytes = file_get_contents($file['tmp_name']);
        if (!is_string($bytes)) throw ApiException::fromCode('studio_audio_invalid', 422);
        $wave = StudioTranscriber::validateWav($bytes);
        $input = [];
        foreach (['board_id', 'recording_id', 'operation_id', 'generation'] as $key) $input[$key] = Http::text($_POST, $key);
        foreach (['sequence', 'start_ms', 'end_ms'] as $key) {
            if (!isset($_POST[$key])) throw ApiException::fromCode('studio_audio_invalid', 422);
            $input[$key] = Http::integer($_POST, $key, -1);
        }
        if ($input['sequence'] < 0 || $input['sequence'] > 10000 || $input['start_ms'] < 0
            || $input['end_ms'] <= $input['start_ms'] || $input['end_ms'] > 86400000
            || abs(($input['end_ms'] - $input['start_ms']) - $wave['duration_ms']) > 150) {
            throw ApiException::fromCode('studio_audio_invalid', 422);
        }
        $input['sha256'] = hash('sha256', $bytes);
        return ['input' => $input, 'bytes' => $bytes];
    }

    public static function process(StudioService $studio, array $config, array $upload): array
    {
        $input = $upload['input'];
        foreach (['board_id', 'recording_id', 'operation_id'] as $key) {
            if (!is_string($input[$key] ?? null) || !preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/Di', $input[$key])) {
                throw ApiException::fromCode('studio_input_invalid', 422);
            }
            $input[$key] = strtolower($input[$key]);
        }
        $directory = $config['maintenance_dir'];
        $maintenance = new MaintenanceLock($directory);
        if (!$studio->ready()) throw ApiException::fromCode('studio_schema_unavailable', 503);
        $name = hash('sha256', $config['scope_key'] . ':' . $input['recording_id']);
        $path = $directory . '/.studio-audio-' . $name . '.lock';
        $handle = @fopen($path, 'c');
        if ($handle === false) throw ApiException::fromCode('studio_transcription_unavailable', 503);
        @chmod($path, 0600);
        try {
            if (!flock($handle, LOCK_EX | LOCK_NB)) throw ApiException::fromCode('studio_recording_busy', 423);
            $duplicate = $studio->prepareAudio($input);
            if ($duplicate !== null) return $duplicate;
            unset($maintenance);
            $text = (new StudioTranscriber(StudioTranscriber::fromEnvironment()))->transcribe($upload['bytes']);
            $maintenance = new MaintenanceLock($directory);
            // Restore/stop can happen during transcription: the service checks
            // generation and recording again before committing a new card.
            return $studio->appendTranscript([...$input, 'text' => $text, 'provider' => 'whisper']);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
