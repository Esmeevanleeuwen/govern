<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
use Govern\{ApiException,Config,ConnectionScope,DictationService,Http,MaintenanceLock};
try {
    $base = Config::fromEnvironment(); $csrf = Http::start($base);
    $expected = getenv('GHOSTSKETCH_STORAGE_TOKEN') ?: '';
    $received = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (strlen($expected)<32 || !hash_equals('Bearer ' . $expected,$received)) {
        throw ApiException::fromCode('dictation_access',401);
    }
    $pg = $base['postgres'] ?? null;
    if ($pg === null) throw ApiException::fromCode('dictation_setup',503);
    $config = (new ConnectionScope($base))->select($pg['name'],'postgres',$base['studio']['schema']);
    $lock = new MaintenanceLock($config['maintenance_dir']);
    $service = new DictationService($config);
    $action = Http::text($_GET,'action');
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($action==='upload' || $action==='complete') {
        if ($method!=='POST') throw ApiException::fromCode('post_required',405);
        if ($action==='upload') {
            if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0)>17825792) throw ApiException::fromCode('dictation_limit',413);
            $file = $_FILES['file'] ?? null;
            if (!is_array($file) || ($file['error'] ?? -1)!==UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) {
                throw ApiException::fromCode('dictation_limit',422);
            }
            Http::json($service->import($file['tmp_name'],(string) ($file['name'] ?? 'opname')),201);
        }
        Http::json($service->complete(Http::jsonInput()));
    }
    Http::get();
    if ($action==='list') Http::json(['recordings'=>$service->recordings()]);
    if ($action==='recording') Http::json($service->recording(Http::text($_GET,'id')));
    if ($action==='audio') {
        $row = $service->recording(Http::text($_GET,'id'),true);
        $bytes = base64_decode($row['audio'],true);
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . strlen($bytes));
        echo $bytes; exit;
    }
    throw ApiException::fromCode('action_missing',404);
} catch (Throwable $error) {
    Http::json($error instanceof ApiException ? $error->getMessage() : Govern\Messages::text('dictation_setup'),
        $error instanceof ApiException ? $error->status : 503,false,$error instanceof ApiException ? $error->errorCode : 'dictation_setup');
}
