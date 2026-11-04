<?php
declare(strict_types=1);

namespace Govern;

/** Only the private worker may add PostgreSQL databases to the workspace. */
final class PostgresDatabaseRegistry
{
    public const MAX_BYTES = 65536;
    private readonly string $path;

    public function __construct(?string $path = null)
    {
        $this->path = $path ?? (getenv('PG_DATABASE_REGISTRY') ?: '/run/govern-postgres/databases.json');
    }

    /** null means unavailable or untrusted; an empty trusted registry is valid. */
    public function names(): ?array
    {
        if (!str_starts_with($this->path, '/') || preg_match('/[\x00-\x1f\x7f]/', $this->path)) return null;
        clearstatcache();
        $parent = @lstat(dirname($this->path));
        $before = @lstat($this->path);
        if (!$this->trusted($parent, 0040000) || !$this->trusted($before, 0100000)
            || $before['size'] < 1 || $before['size'] > self::MAX_BYTES) return null;
        $stream = @fopen($this->path, 'rb');
        if ($stream === false) return null;
        try {
            $opened = fstat($stream);
            if (!$this->trusted($opened, 0100000) || $opened['dev'] !== $before['dev']
                || $opened['ino'] !== $before['ino']) return null;
            $raw = stream_get_contents($stream, self::MAX_BYTES + 1);
        } finally { fclose($stream); }
        if ($raw === false || strlen($raw) > self::MAX_BYTES) return null;
        try { $data = json_decode($raw, false, 4, JSON_THROW_ON_ERROR); }
        catch (\JsonException) { return null; }
        if (!$data instanceof \stdClass) return null;
        $fields = get_object_vars($data);
        if (count($fields) !== 2 || ($fields['version'] ?? null) !== 1
            || !is_array($fields['databases'] ?? null) || !array_is_list($fields['databases'])) return null;
        $names = $fields['databases'];
        foreach ($names as $name) {
            try { PostgresDatabaseProvisioner::validateName($name); }
            catch (ApiException) { return null; }
        }
        return count(array_unique($names, SORT_STRING)) === count($names) ? $names : null;
    }

    private function trusted(array|false $stat, int $type): bool
    {
        return $stat !== false && $stat['uid'] === 0 && ($stat['mode'] & 0170000) === $type
            && ($stat['mode'] & 0022) === 0;
    }
}
