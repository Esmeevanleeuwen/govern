<?php
declare(strict_types=1);
namespace Govern;

/** Govern owns recordings/transcripts. GhostSketch owns notebook content. */
final class DictationService
{
    private readonly \PDO $db;
    private readonly string $prefix;
    public function __construct(private readonly array $config, bool $readOnly = false)
    {
        if (!($config['studio']['enabled'] ?? false) || ($config['engine'] ?? '') !== 'postgres'
            || ($config['schema'] ?? '') !== ($config['studio']['schema'] ?? 'brainstorm')) {
            throw ApiException::fromCode('studio_config_invalid', 403);
        }
        $database = new Database($config);
        $this->db = $readOnly ? $database->reader() : $database->writer();
        $this->prefix = $database->quoteIdentifier($config['schema']) . '.';
    }
    public static function id(string $value): string
    {
        if (!preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/Di', $value)) {
            throw ApiException::fromCode('dictation_input', 422);
        }
        return strtolower($value);
    }
    public function recordings(): array
    {
        return $this->db->query('SELECT id,filename,sha256,duration_ms,next_ms,status,created_at FROM '
            . $this->prefix . 'dictation_recordings ORDER BY created_at DESC LIMIT 500')->fetchAll(\PDO::FETCH_ASSOC);
    }
    public function recording(string $id, bool $audio = false): array
    {
        $stmt = $this->db->prepare('SELECT id,filename,sha256,duration_ms,next_ms,status,created_at'
            . ($audio ? ",encode(audio,'base64') AS audio" : '') . ' FROM ' . $this->prefix . ($audio ? '_govern_dictation_recordings' : 'dictation_recordings') . ' WHERE id=?');
        $stmt->execute([self::id($id)]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$row) throw ApiException::fromCode('dictation_missing', 404);
        $stmt = $this->db->prepare('SELECT id,sequence,start_ms,end_ms,text,provider FROM '
            . $this->prefix . 'dictation_transcripts WHERE recording_id=? ORDER BY sequence');
        $stmt->execute([$id]); $row['segments'] = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        return $row;
    }
    public function import(string $path, string $filename): array
    {
        $size = filesize($path);
        if ($size === false || $size < 1 || $size > 16777216) throw ApiException::fromCode('dictation_limit', 413);
        $filename = basename(str_replace('\\','/', $filename));
        if (trim($filename) === '' || strlen($filename) > 500 || preg_match('//u', $filename) !== 1 || preg_match('/[\x00-\x1f\x7f]/', $filename)) {
            throw ApiException::fromCode('dictation_input', 422);
        }
        $duration = DictationAudio::duration($path);
        // Decode an actual audio stream as well as checking the container metadata.
        DictationAudio::chunk($path, 0);
        $bytes = file_get_contents($path);
        if (!is_string($bytes)) throw ApiException::fromCode('dictation_decode', 422);
        $stmt = $this->db->prepare('INSERT INTO ' . $this->prefix
            . "_govern_dictation_recordings(filename,sha256,audio,duration_ms) VALUES(?,?,decode(?,'base64'),?)"
            . ' ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id');
        $stmt->execute([$filename,hash('sha256',$bytes),base64_encode($bytes),$duration]);
        return $this->recording($stmt->fetchColumn());
    }
    /** Accept a complete transcript computed by GhostSketch, never invoke a model here. */
    public function complete(array $input): array
    {
        $id = self::id(Http::text($input,'id'));
        $sha = Http::text($input,'sha256');
        Http::text($input,'text',false); // Validate UTF-8; retain the exact source text below.
        $text = $input['text'] ?? '';
        if (!preg_match('/\A[a-f0-9]{64}\z/D',$sha) || strlen($text)>524288) {
            throw ApiException::fromCode('dictation_input',422);
        }
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare('SELECT sha256,status FROM ' . $this->prefix . '_govern_dictation_recordings WHERE id=? FOR UPDATE');
            $stmt->execute([$id]); $current = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$current || $current['sha256'] !== $sha) throw ApiException::fromCode('dictation_changed',409);
            $row = $this->recording($id);
            if ($row['status'] === 'ready') {
                if (count($row['segments'])!==1 || $row['segments'][0]['text']!==$text) {
                    throw ApiException::fromCode('dictation_changed',409);
                }
                $this->db->commit(); return $row;
            }
            // Previous-version partial transcripts remain intact; never replace a source.
            if ($row['segments']!==[]) throw ApiException::fromCode('dictation_changed',409);
            $stmt = $this->db->prepare('INSERT INTO ' . $this->prefix . '_govern_dictation_segments(recording_id,sequence,start_ms,end_ms,text,provider) VALUES(?,0,0,?,?,?)');
            $stmt->execute([$id,$row['duration_ms'],$text,'ghostsketch-whisper']);
            $stmt = $this->db->prepare('UPDATE ' . $this->prefix . "_govern_dictation_recordings SET next_ms=duration_ms,status='ready' WHERE id=?");
            $stmt->execute([$id]); $this->db->commit();
            return $this->recording($id);
        } finally { if ($this->db->inTransaction()) $this->db->rollBack(); }
    }
}
