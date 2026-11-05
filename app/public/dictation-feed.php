<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
use Govern\{ApiException,Config,ConnectionScope,DictationService,Http,MaintenanceLock};
try {
    $base = Config::fromEnvironment(); Http::start($base); Http::get();
    $expected = getenv('GHOSTSKETCH_READ_TOKEN') ?: '';
    $received = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strlen($expected) < 32 || !hash_equals('Bearer ' . $expected,$received)) {
        throw ApiException::fromCode('dictation_access',401);
    }
    // Token can only read this configured transcript namespace, never arbitrary SQL/audio.
    $pg = $base['postgres'] ?? null;
    if ($pg === null) throw ApiException::fromCode('dictation_setup',503);
    $config = (new ConnectionScope($base))->select($pg['name'],'postgres',$base['studio']['schema']);
    $lock = new MaintenanceLock($config['maintenance_dir']);
    $service = new DictationService($config, true);
    $id = Http::text($_GET,'id',false);
    Http::json($id === '' ? ['recordings'=>$service->recordings()] : $service->recording($id));
} catch (Throwable $error) {
    Http::json($error instanceof ApiException ? $error->getMessage() : Govern\Messages::text('dictation_setup'),
        $error instanceof ApiException ? $error->status : 503,false,$error instanceof ApiException ? $error->errorCode : 'dictation_setup');
}
