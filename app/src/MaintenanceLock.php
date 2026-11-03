<?php
declare(strict_types=1);

namespace Govern;

/** Cooperates with BackupService. The file is a lock, not a database backup. */
final class MaintenanceLock
{
    private mixed $handle;

    public function __construct(string $directory, bool $exclusive = false)
    {
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw ApiException::fromCode('backup_directory_unwritable', 503);
        }
        $this->handle = @fopen($directory . '/.maintenance.lock', 'c');
        if ($this->handle === false) {
            throw ApiException::fromCode('maintenance_lock_unavailable', 503);
        }
        if (!flock($this->handle, ($exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
            fclose($this->handle);
            $this->handle = null;
            throw ApiException::fromCode('maintenance_busy', 423);
        }
    }

    public function __destruct()
    {
        if (is_resource($this->handle)) {
            flock($this->handle, LOCK_UN);
            fclose($this->handle);
        }
    }
}
