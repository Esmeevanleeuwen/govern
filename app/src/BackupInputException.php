<?php
declare(strict_types=1);

namespace Govern;

/** Invalid backup input retains InvalidArgumentException compatibility. */
final class BackupInputException extends \InvalidArgumentException
{
    public function __construct(
        public readonly string $errorCode,
        public readonly array $errorParams = [],
    ) {
        parent::__construct(Messages::text($errorCode, $errorParams));
    }
}
