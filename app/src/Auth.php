<?php
declare(strict_types=1);

namespace Govern;

/** Accounts belong to this installation, independently of its work databases. */
final class Auth
{
    public const SESSION_SECONDS = 43200;
    private \PDO $store;

    public function __construct(?string $directory = null)
    {
        $directory ??= getenv('AUTH_DIR') ?: '/var/lib/govern/auth';
        if ((!is_dir($directory) && !@mkdir($directory, 0700, true)) || !is_writable($directory)) {
            throw ApiException::fromCode('auth_unavailable', 503);
        }
        $mask = umask(0077);
        try {
            $this->store = new \PDO('sqlite:' . $directory . '/accounts.sqlite', null, null, [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->store->exec('PRAGMA busy_timeout = 5000');
            $this->store->exec('CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN (\'owner\', \'member\')),
                status TEXT NOT NULL CHECK (status IN (\'active\', \'pending\')),
                created_at TEXT NOT NULL,
                approved_at TEXT
            )');
            $this->store->exec("CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(role) WHERE role = 'owner'");
            $this->store->exec('CREATE TABLE IF NOT EXISTS attempts (
                bucket TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )');
        } catch (\PDOException) {
            throw ApiException::fromCode('auth_unavailable', 503);
        } finally {
            umask($mask);
        }
    }

    public function hasOwner(): bool
    {
        return (bool) $this->store->query("SELECT 1 FROM users WHERE role = 'owner' AND status = 'active' LIMIT 1")->fetchColumn();
    }

    /** Read the database on every request; a session never grants its own role. */
    public function currentUser(): ?array
    {
        $id = $_SESSION['auth_user_id'] ?? null;
        $issued = $_SESSION['auth_issued_at'] ?? null;
        if (!is_int($id) || !is_int($issued) || $issued > time() || time() - $issued >= self::SESSION_SECONDS) {
            return null;
        }
        $query = $this->store->prepare("SELECT id, name, email, role, status, created_at FROM users WHERE id = ? AND status = 'active'");
        $query->execute([$id]);
        $user = $query->fetch();
        return $user === false ? null : $this->publicUser($user);
    }

    public function requireUser(): array
    {
        $user = $this->currentUser();
        if ($user === null) throw ApiException::fromCode('auth_required', 401);
        return $user;
    }

    public function requireOwner(): array
    {
        $user = $this->requireUser();
        if ($user['role'] !== 'owner') throw ApiException::fromCode('auth_owner_required', 403);
        return $user;
    }

    public function register(array $input): array
    {
        $this->consume('register:ip:' . $this->address(), 15, 3600);
        $name = Http::text($input, 'name');
        $email = $this->email($input);
        $password = $this->password($input);
        if (strlen($name) > 160 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            throw ApiException::fromCode('auth_name_invalid', 422);
        }
        // Argon2id avoids bcrypt's silent truncation after 72 bytes.
        if (!defined('PASSWORD_ARGON2ID')) throw ApiException::fromCode('auth_unavailable', 503);
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $this->store->exec('BEGIN IMMEDIATE');
        try {
            $first = !$this->hasOwner();
            $query = $this->store->prepare('SELECT id FROM users WHERE email = ?');
            $query->execute([$email]);
            if ($query->fetchColumn() !== false) {
                // Existing email and a new pending request have the same response.
                $this->store->exec('COMMIT');
                return ['registration' => 'pending', 'user' => null, 'csrf' => self::csrf()];
            }
            $insert = $this->store->prepare('INSERT INTO users (name, email, password_hash, role, status, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $insert->execute([$name, $email, $hash, $first ? 'owner' : 'member', $first ? 'active' : 'pending', gmdate('c'), $first ? gmdate('c') : null]);
            $id = (int) $this->store->lastInsertId();
            $this->store->exec('COMMIT');
        } catch (\Throwable $exception) {
            $this->store->exec('ROLLBACK');
            throw $exception;
        }
        if ($first) $this->signIn($id);
        return ['registration' => $first ? 'active' : 'pending', 'user' => $first ? $this->currentUser() : null, 'csrf' => self::csrf()];
    }

    public function login(array $input): array
    {
        // Both limits are consumed, independently of whether the account exists.
        $this->consume('login:ip:' . $this->address(), 60, 900);
        $email = $this->email($input, false);
        $this->consume('login:email:' . $email, 10, 900);
        $password = $input['password'] ?? null;
        if (!is_string($password) || strlen($password) > 512 || str_contains($password, "\0")) {
            throw ApiException::fromCode('auth_credentials_invalid', 401);
        }
        $query = $this->store->prepare('SELECT * FROM users WHERE email = ?');
        $query->execute([$email]);
        $user = $query->fetch();
        // A fixed Argon2id hash keeps unknown accounts on the same expensive path.
        $dummy = '$argon2id$v=19$m=65536,t=4,p=1$dGVzdGluZ3NhbHQxMjM0NQ$SXqCiS5zS91KZHE9gVhmDb0htBg+DTBnvQzTknh3G0k';
        $valid = password_verify($password, $user === false ? $dummy : $user['password_hash']);
        if (!$valid || $user === false) throw ApiException::fromCode('auth_credentials_invalid', 401);
        if ($user['status'] !== 'active') throw ApiException::fromCode('auth_pending', 403);
        $this->signIn((int) $user['id']);
        $clear = $this->store->prepare('DELETE FROM attempts WHERE bucket = ?');
        $clear->execute([hash('sha256', 'login:email:' . $email)]);
        return ['user' => $this->currentUser(), 'csrf' => self::csrf()];
    }

    public function logout(): array
    {
        self::openSession();
        $_SESSION = [];
        if (!session_regenerate_id(true)) throw ApiException::fromCode('session_unavailable', 503);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        session_write_close();
        return ['user' => null, 'csrf' => self::csrf()];
    }

    public function requests(): array
    {
        $this->requireOwner();
        $users = $this->store->query("SELECT id, name, email, role, status, created_at FROM users WHERE status = 'pending' ORDER BY id LIMIT 100")->fetchAll();
        return ['users' => array_map($this->publicUser(...), $users)];
    }

    public function approve(array $input): array
    {
        $this->requireOwner();
        $id = $input['user_id'] ?? null;
        if (!is_int($id) || $id < 1) throw ApiException::fromCode('auth_user_invalid', 422);
        $query = $this->store->prepare("UPDATE users SET status = 'active', approved_at = ? WHERE id = ? AND role = 'member' AND status = 'pending'");
        $query->execute([gmdate('c'), $id]);
        if ($query->rowCount() !== 1) throw ApiException::fromCode('auth_request_missing', 404);
        $read = $this->store->prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?');
        $read->execute([$id]);
        return ['user' => $this->publicUser($read->fetch())];
    }

    public static function csrf(): string
    {
        return (string) ($_SESSION['csrf'] ?? '');
    }

    private function signIn(int $id): void
    {
        self::openSession();
        if (!session_regenerate_id(true)) throw ApiException::fromCode('session_unavailable', 503);
        $_SESSION['auth_user_id'] = $id;
        $_SESSION['auth_issued_at'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        session_write_close();
    }

    private static function openSession(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE && !session_start()) throw ApiException::fromCode('session_unavailable', 503);
    }

    private function publicUser(array $user): array
    {
        return ['id' => (int) $user['id'], 'name' => $user['name'], 'email' => $user['email'],
            'role' => $user['role'], 'status' => $user['status'], 'created_at' => $user['created_at']];
    }

    private function email(array $input, bool $registration = true): string
    {
        $email = $input['email'] ?? null;
        if (!is_string($email) || strlen($email) > 254 || !filter_var(trim($email), FILTER_VALIDATE_EMAIL)) {
            throw ApiException::fromCode($registration ? 'auth_email_invalid' : 'auth_credentials_invalid', $registration ? 422 : 401);
        }
        return strtolower(trim($email));
    }

    private function password(array $input): string
    {
        $password = $input['password'] ?? null;
        if (!is_string($password) || strlen($password) > 512 || str_contains($password, "\0") || preg_match('//u', $password) !== 1) {
            throw ApiException::fromCode('auth_password_invalid', 422);
        }
        $length = preg_match_all('/./us', $password);
        if ($length === false || $length < 12 || $length > 128) throw ApiException::fromCode('auth_password_invalid', 422);
        return $password;
    }

    private function address(): string
    {
        // Use the actual peer, never a browser-controlled forwarding header.
        return (string) ($_SERVER['REMOTE_ADDR'] ?? 'local');
    }

    private function consume(string $bucket, int $limit, int $seconds): void
    {
        $bucket = hash('sha256', $bucket);
        $now = time();
        $this->store->exec('BEGIN IMMEDIATE');
        try {
            $this->store->prepare('DELETE FROM attempts WHERE expires_at <= ?')->execute([$now]);
            $read = $this->store->prepare('SELECT count, expires_at FROM attempts WHERE bucket = ?');
            $read->execute([$bucket]);
            $previous = $read->fetch();
            if ($previous !== false && (int) $previous['count'] >= $limit) {
                $this->store->exec('COMMIT');
                header('Retry-After: ' . max(1, (int) $previous['expires_at'] - $now));
                throw ApiException::fromCode('auth_rate_limited', 429);
            }
            $write = $this->store->prepare('INSERT INTO attempts (bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1');
            $write->execute([$bucket, $now + $seconds]);
            $this->store->exec('COMMIT');
        } catch (ApiException $exception) {
            throw $exception;
        } catch (\Throwable $exception) {
            $this->store->exec('ROLLBACK');
            throw $exception;
        }
    }
}
