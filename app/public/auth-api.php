<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Govern\ApiException;
use Govern\Auth;
use Govern\Config;
use Govern\Http;
use Govern\Messages;

try {
    $csrf = Http::start(Config::fromEnvironment());
    $action = Http::text($_GET, 'action');
    $input = in_array($action, ['register', 'login', 'logout', 'approve'], true) ? Http::post($csrf) : [];
    if (!in_array($action, ['register', 'login', 'logout', 'approve'], true)) Http::get();
    $auth = new Auth();
    switch ($action) {
        case 'status':
            Http::json(['csrf' => $csrf, 'user' => $auth->currentUser(), 'has_owner' => $auth->hasOwner()]);
        case 'register':
            Http::json($auth->register($input), 201);
        case 'login':
            Http::json($auth->login($input));
        case 'logout':
            Http::json($auth->logout());
        case 'requests':
            Http::json($auth->requests());
        case 'approve':
            Http::json($auth->approve($input));
        default:
            throw ApiException::fromCode('action_missing', 404);
    }
} catch (ApiException $exception) {
    Http::json($exception->getMessage(), $exception->status, false, $exception->errorCode, $exception->errorParams);
} catch (Throwable $exception) {
    error_log('Govern account error [' . get_class($exception) . ']');
    Http::json(Messages::text('auth_unavailable'), 503, false, 'auth_unavailable');
}
