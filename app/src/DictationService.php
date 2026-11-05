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
    public function transcribe(string $id): array
    {
        $id = self::id($id);
        $path = $this->config['maintenance_dir'] . '/.dictation-' . hash('sha256',$this->config['scope_key'] . $id) . '.lock';
        $handle = fopen($path, 'c');
        if ($handle === false) throw ApiException::fromCode('dictation_busy', 503);
        $tmp = false;
        try {
            if (!flock($handle, LOCK_EX | LOCK_NB)) throw ApiException::fromCode('dictation_busy', 423);
            $maintenance = new MaintenanceLock($this->config['maintenance_dir']);
            $row = $this->recording($id, true);
            if ($row['status'] === 'ready') { unset($row['audio']); return $row; }
            $tmp = tempnam(sys_get_temp_dir(), 'dictation-');
            if ($tmp === false) throw ApiException::fromCode('dictation_decode', 503);
            chmod($tmp,0600);
            file_put_contents($tmp,base64_decode($row['audio'],true));
            unset($row['audio'], $maintenance);
            $start = (int) $row['next_ms'];
            $text = (new StudioTranscriber(StudioTranscriber::fromEnvironment()))->transcribe(DictationAudio::chunk($tmp,$start));
            $end = min($start + 6000,(int) $row['duration_ms']);
            $maintenance = new MaintenanceLock($this->config['maintenance_dir']);
            $this->db->beginTransaction();
            // Restore/other writers may have changed the source while the model ran.
            $stmt = $this->db->prepare('SELECT sha256,next_ms FROM ' . $this->prefix . '_govern_dictation_recordings WHERE id=? FOR UPDATE');
            $stmt->execute([$id]); $current = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!$current || $current['sha256'] !== $row['sha256'] || (int) $current['next_ms'] !== $start) {
                throw ApiException::fromCode('dictation_changed',409);
            }
            $stmt = $this->db->prepare('INSERT INTO ' . $this->prefix . '_govern_dictation_segments(recording_id,sequence,start_ms,end_ms,text) VALUES(?,?,?,?,?)');
            $stmt->execute([$id,(int) ($start / 6000),$start,$end,$text]);
            $stmt = $this->db->prepare('UPDATE ' . $this->prefix . '_govern_dictation_recordings SET next_ms=?,status=? WHERE id=?');
            $stmt->execute([$end,$end === (int) $row['duration_ms'] ? 'ready' : 'pending',$id]);
            $this->db->commit();
            return $this->recording($id);
        } finally {
            if ($this->db->inTransaction()) $this->db->rollBack();
            if (is_string($tmp)) @unlink($tmp);
            flock($handle, LOCK_UN); fclose($handle);
        }
    }
}
