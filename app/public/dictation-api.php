<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
use Govern\{ApiException,Auth,Config,ConnectionScope,DictationService,Http,MaintenanceLock};
try {
    $base = Config::fromEnvironment(); $csrf = Http::start($base);
    (new Auth())->requireUser();
    $config = (new ConnectionScope($base))->selectRequest(Http::text($_GET,'database'));
    $service = new DictationService($config);
    $action = Http::text($_GET,'action');
    Http::get(); $lock = new MaintenanceLock($config['maintenance_dir']);
    if ($action === 'list') Http::json(['csrf'=>$csrf,'recordings'=>$service->recordings()]);
    if ($action === 'recording') Http::json($service->recording(Http::text($_GET,'id')));
    throw ApiException::fromCode('action_missing',404);
} catch (Throwable $error) {
    if (!$error instanceof ApiException) error_log('Govern dictation: ' . get_class($error));
    Http::json($error instanceof ApiException ? $error->getMessage() : Govern\Messages::text('dictation_setup'),
        $error instanceof ApiException ? $error->status : 503,false,$error instanceof ApiException ? $error->errorCode : 'dictation_setup');
}
