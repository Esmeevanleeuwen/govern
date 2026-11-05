<?php
declare(strict_types=1);
namespace Govern;

/** Decode only a private local upload; never accept media URLs or shell text. */
final class DictationAudio
{
    public static function run(array $args, int $timeout = 20): string
    {
        $process = proc_open($args, [0 => ['pipe','r'], 1 => ['pipe','w'], 2 => ['file','/dev/null','a']], $pipes);
        if (!is_resource($process)) throw ApiException::fromCode('dictation_decode', 503);
        fclose($pipes[0]); stream_set_blocking($pipes[1], false);
        $result = ''; $started = microtime(true);
        try {
            do {
                $result .= stream_get_contents($pipes[1]);
                $status = proc_get_status($process);
                if (strlen($result) > 2097152 || microtime(true) - $started > $timeout) {
                    proc_terminate($process, 9);
                    throw ApiException::fromCode('dictation_decode', 422);
                }
                if ($status['running']) usleep(10000);
            } while ($status['running']);
            if ($status['exitcode'] !== 0) throw ApiException::fromCode('dictation_decode', 422);
            return $result;
        } finally { fclose($pipes[1]); proc_close($process); }
    }

    public static function duration(string $path): int
    {
        $value = self::run(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,mp3,wav',
            '-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',$path]);
        if (!is_numeric(trim($value))) throw ApiException::fromCode('dictation_decode', 422);
        $ms = (int) round((float) trim($value) * 1000);
        if ($ms < 1 || $ms > 1800000) throw ApiException::fromCode('dictation_limit', 422);
        return $ms;
    }

    public static function chunk(string $path, int $start): string
    {
        $pcm = self::run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,mp3,wav',
            '-ss',(string) ($start / 1000),'-i',$path,'-t','6','-vn','-ac','1','-ar','16000','-f','s16le','pipe:1']);
        if (strlen($pcm) < 2 || strlen($pcm) > 192000 || strlen($pcm) % 2 !== 0) {
            throw ApiException::fromCode('dictation_decode', 422);
        }
        return 'RIFF' . pack('V',36 + strlen($pcm)) . 'WAVEfmt ' . pack('VvvVVvv',16,1,1,16000,32000,2,16)
            . 'data' . pack('V',strlen($pcm)) . $pcm;
    }
}
