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
    if ($action === 'import') {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST'
            || !hash_equals($csrf,(string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) throw ApiException::fromCode('csrf_invalid',403);
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) {
            throw ApiException::fromCode('dictation_limit',422);
        }
        $lock = new MaintenanceLock($config['maintenance_dir']);
        Http::json($service->import($file['tmp_name'],(string) ($file['name'] ?? 'opname')),201);
    }
    if ($action === 'transcribe') {
        $input = Http::post($csrf);
        Http::json($service->transcribe(Http::text($input,'id')));
    }
    Http::get(); $lock = new MaintenanceLock($config['maintenance_dir']);
    if ($action === 'list') Http::json(['csrf'=>$csrf,'recordings'=>$service->recordings()]);
    if ($action === 'recording') Http::json($service->recording(Http::text($_GET,'id')));
    throw ApiException::fromCode('action_missing',404);
} catch (Throwable $error) {
    if (!$error instanceof ApiException) error_log('Govern dictation: ' . get_class($error));
    Http::json($error instanceof ApiException ? $error->getMessage() : Govern\Messages::text('dictation_setup'),
        $error instanceof ApiException ? $error->status : 503,false,$error instanceof ApiException ? $error->errorCode : 'dictation_setup');
}
