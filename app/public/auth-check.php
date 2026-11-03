<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Govern\ApiException;
use Govern\Auth;
use Govern\Config;
use Govern\Http;

// Nginx asks this endpoint before forwarding any official phpMyAdmin request.
try {
    Http::start(Config::fromEnvironment());
    (new Auth())->requireUser();
    http_response_code(204);
} catch (ApiException $exception) {
    http_response_code($exception->status === 401 ? 401 : 403);
} catch (Throwable) {
    http_response_code(403);
}
