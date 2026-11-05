<?php
declare(strict_types=1);
require_once __DIR__ . '/../app/src/bootstrap.php';
use Govern\{ApiException,DictationAudio,StudioTranscriber};
function check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
$path = tempnam(sys_get_temp_dir(),'dictation-test-');
$m4a = $path . '.m4a'; $mp3 = $path . '.mp3';
try {
    $pcm = str_repeat(pack('v',0),16000 * 7);
    $wav = 'RIFF' . pack('V',36 + strlen($pcm)) . 'WAVEfmt ' . pack('VvvVVvv',16,1,1,16000,32000,2,16) . 'data' . pack('V',strlen($pcm)) . $pcm;
    file_put_contents($path,$wav);
    check(DictationAudio::duration($path) === 7000,'WAV duration');
    foreach ([0=>6000,6000=>1000] as $start=>$duration) {
        $chunk = DictationAudio::chunk($path,$start);
        check(StudioTranscriber::validateWav($chunk)['duration_ms'] === $duration,'Independent bounded WAV chunk');
    }
    DictationAudio::run(['ffmpeg','-nostdin','-v','error','-i',$path,'-c:a','aac','-y',$m4a]);
    DictationAudio::run(['ffmpeg','-nostdin','-v','error','-i',$path,'-y',$mp3]);
    foreach ([$m4a,$mp3] as $file) {
        check(abs(DictationAudio::duration($file)-7000)<200,'Compressed duration');
        check(StudioTranscriber::validateWav(DictationAudio::chunk($file,0))['duration_ms']===6000,'Compressed audio decoded');
    }
    file_put_contents($path,'not audio');
    try { DictationAudio::duration($path); throw new RuntimeException('Invalid audio accepted'); }
    catch (ApiException $error) { check($error->errorCode==='dictation_decode','Invalid audio error'); }
    file_put_contents($path,"#EXTM3U\nfile:///etc/passwd\n");
    try { DictationAudio::duration($path); throw new RuntimeException('Playlist accepted'); }
    catch (ApiException $error) { check($error->errorCode==='dictation_decode','Playlist rejected'); }
    echo "Dictation audio: WAV/M4A/MP3, chunk timing, invalid input and playlist rejection passed.\n";
} finally { @unlink($path); @unlink($m4a); @unlink($mp3); }
