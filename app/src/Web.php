<?php
declare(strict_types=1);

namespace Govern;

/** The same account boundary for HTML pages as for the data API. */
final class Web
{
    public static function user(string $next = 'workspace'): array
    {
        try {
            Http::start(Config::fromEnvironment(), allowPageNavigation: true);
            $user = (new Auth())->currentUser();
            if ($user !== null) return $user;
            header('Location: /auth.php?mode=login' . ($next === 'account' ? '&next=account' : ''), true, 303);
            exit;
        } catch (\Throwable $exception) {
            $code = $exception instanceof ApiException ? $exception->errorCode : 'internal_error';
            error_log('Govern page access unavailable [' . get_class($exception) . ':' . $code . ']');
            http_response_code($exception instanceof ApiException ? $exception->status : 503);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Govern — temporarily unavailable</title><h1>Govern is temporarily unavailable.</h1><p>Check the local Docker services and try again.</p><p>Controleer de lokale Docker-services en probeer opnieuw.</p><a href="/">Back to Govern</a></html>';
            exit;
        }
    }
}
