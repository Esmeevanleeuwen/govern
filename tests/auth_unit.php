<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\Auth;
use Govern\Config;
use Govern\Http;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, int $status, string $message) use ($assert): void {
    try { $action(); }
    catch (ApiException $exception) { $assert($exception->status === $status, $message); return; }
    throw new RuntimeException($message);
};
$directory = sys_get_temp_dir() . '/govern-auth-unit-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
mkdir($directory . '/sessions', 0700);
ini_set('session.save_path', $directory . '/sessions');
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$csrf = Http::start(Config::fromEnvironment());
$auth = new Auth($directory);

try {
    $assert(!$auth->hasOwner() && $auth->currentUser() === null, 'An empty installation has no owner or logged-in user.');
    $reject(fn () => $auth->requireUser(), 401, 'Guests cannot access the workspace.');
    $reject(fn () => $auth->register(['name' => 'Owner', 'email' => 'not email', 'password' => 'valid passphrase here']), 422, 'Registration rejects invalid email.');
    $reject(fn () => $auth->register(['name' => 'Owner', 'email' => 'owner@example.test', 'password' => 'short']), 422, 'Registration rejects a short password.');
    $reject(fn () => $auth->register(['name' => 'Owner', 'email' => 'owner@example.test', 'password' => "a valid passphrase\0"]), 422, 'Registration rejects a NUL password.');
    $reject(fn () => $auth->register(['name' => "bad\nname", 'email' => 'owner@example.test', 'password' => 'a valid passphrase']), 422, 'Names reject control characters.');

    $initialSession = session_id();
    $password = str_repeat('long-secret-', 8) . '👩‍💻';
    $owner = $auth->register(['name' => 'Ésmée', 'email' => 'OWNER@example.test', 'password' => $password]);
    $assert($owner['registration'] === 'active' && $owner['user']['role'] === 'owner', 'Only the initial account becomes an active owner.');
    $assert($auth->hasOwner() && $auth->requireUser()['email'] === 'owner@example.test', 'Successful first registration signs in and normalizes email.');
    $assert(session_id() !== $initialSession && $owner['csrf'] !== $csrf, 'Registration rotates session ID and CSRF token.');
    $assert(!isset($owner['user']['password_hash']), 'Public account data never includes a password hash.');
    $store = new PDO('sqlite:' . $directory . '/accounts.sqlite');
    $hash = $store->query('SELECT password_hash FROM users LIMIT 1')->fetchColumn();
    $assert(str_starts_with($hash, '$argon2id$') && $hash !== $password && password_verify($password, $hash), 'Passwords use verifiable Argon2id hashes.');
    $assert(!password_verify(substr($password, 0, 72) . 'changed', $hash), 'Changes after byte 72 are not silently ignored.');

    $oldSession = session_id();
    $oldCsrf = Auth::csrf();
    $auth->logout();
    $assert($auth->currentUser() === null && session_id() !== $oldSession && Auth::csrf() !== $oldCsrf, 'Logout destroys authentication and rotates session/CSRF.');
    $member = $auth->register(['name' => 'Member', 'email' => 'member@example.test', 'password' => 'another long passphrase', 'role' => 'owner', 'status' => 'active']);
    $assert($member['registration'] === 'pending' && $member['user'] === null && $auth->currentUser() === null, 'Later registrations remain pending and cannot inject a role.');
    $duplicate = $auth->register(['name' => 'Other', 'email' => 'OWNER@example.test', 'password' => 'another long passphrase']);
    $assert($duplicate['registration'] === 'pending' && $duplicate['user'] === null, 'Duplicate emails use the same public response as a pending registration.');
    $reject(fn () => $auth->login(['email' => 'member@example.test', 'password' => 'incorrect secret']), 401, 'An incorrect pending-account password gets a generic login error.');
    $reject(fn () => $auth->login(['email' => 'member@example.test', 'password' => 'another long passphrase']), 403, 'A correct pending account still cannot sign in.');
    $reject(fn () => $auth->requests(), 401, 'Guests cannot list approval requests.');

    $auth->login(['email' => 'owner@example.test', 'password' => $password]);
    $requests = $auth->requests()['users'];
    $assert(count($requests) === 1 && $requests[0]['role'] === 'member', 'Owner sees the real pending request only.');
    $reject(fn () => $auth->approve(['user_id' => (string) $requests[0]['id']]), 422, 'Approval requires an integer account ID.');
    $approved = $auth->approve(['user_id' => $requests[0]['id']]);
    $assert($approved['user']['status'] === 'active' && $approved['user']['role'] === 'member', 'Approval activates the requested member without promoting their role.');
    $auth->logout();
    $memberLogin = $auth->login(['email' => 'member@example.test', 'password' => 'another long passphrase']);
    $assert($memberLogin['user']['role'] === 'member', 'An approved member can sign in.');
    $_SESSION['auth_role'] = 'owner';
    $reject(fn () => $auth->requests(), 403, 'A forged session role cannot grant owner permissions.');
    $reject(fn () => $auth->approve(['user_id' => 1]), 403, 'Members cannot approve users.');
    $_SESSION['auth_issued_at'] = time() - Auth::SESSION_SECONDS;
    $assert($auth->currentUser() === null, 'An expired session cannot retain access.');
    $auth->login(['email' => 'member@example.test', 'password' => 'another long passphrase']);
    $store->exec("UPDATE users SET status = 'pending' WHERE role = 'member'");
    $assert($auth->currentUser() === null, 'Every request checks the current account status in server storage.');
    $auth->logout();

    for ($attempt = 0; $attempt < 10; $attempt++) {
        $reject(fn () => $auth->login(['email' => 'missing@example.test', 'password' => 'incorrect long password']), 401, 'Unknown emails receive the generic login error.');
    }
    $reject(fn () => $auth->login(['email' => 'missing@example.test', 'password' => 'incorrect long password']), 429, 'Repeated login failures are rate limited in persistent storage.');
    $newInstance = new Auth($directory);
    $reject(fn () => $newInstance->login(['email' => 'missing@example.test', 'password' => 'incorrect long password']), 429, 'A new service instance cannot reset the throttle.');
    $assert((int) $store->query("SELECT count(*) FROM users WHERE role = 'owner'")->fetchColumn() === 1, 'The installation retains exactly one owner.');

    // Separate PHP processes and sessions must not both win initial ownership.
    if (function_exists('proc_open')) {
        $raceDirectory = $directory . '/race';
        mkdir($raceDirectory, 0700);
        $worker = <<<'PHP'
require $argv[1];
ini_set('session.save_path', $argv[2]);
$_SERVER['HTTP_HOST'] = 'localhost';
\Govern\Http::start(\Govern\Config::fromEnvironment());
$auth = new \Govern\Auth($argv[3]);
$result = $auth->register(['name' => 'Concurrent owner', 'email' => $argv[4], 'password' => 'isolated concurrency passphrase']);
echo $result['registration'];
PHP;
        $workers = [];
        foreach (['first@example.test', 'second@example.test'] as $email) {
            $pipes = [];
            $process = proc_open([PHP_BINARY, '-r', $worker, dirname(__DIR__) . '/app/src/bootstrap.php', $directory . '/sessions', $raceDirectory, $email], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (!is_resource($process)) throw new RuntimeException('Could not start registration concurrency fixture.');
            fclose($pipes[0]);
            $workers[] = [$process, $pipes];
        }
        $outcomes = [];
        foreach ($workers as [$process, $pipes]) {
            $outcomes[] = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $assert(proc_close($process) === 0, 'Concurrent registration worker succeeded: ' . $errors);
        }
        sort($outcomes);
        $assert($outcomes === ['active', 'pending'], 'Concurrent first registrations produce exactly one active owner.');
        foreach (glob($raceDirectory . '/*') ?: [] as $file) unlink($file);
        rmdir($raceDirectory);
    }
} finally {
    unset($store, $auth, $newInstance);
    foreach (glob($directory . '/sessions/*') ?: [] as $file) unlink($file);
    rmdir($directory . '/sessions');
    foreach (glob($directory . '/*') ?: [] as $file) unlink($file);
    rmdir($directory);
}

echo "Auth unit checks: $passed passed.\n";
