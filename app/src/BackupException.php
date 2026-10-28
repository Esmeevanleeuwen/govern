<?php
declare(strict_types=1);

namespace Govern;

/** Operational backup failures retain RuntimeException compatibility. */
final class BackupException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        public readonly array $errorParams = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct(Messages::text($errorCode, $errorParams), 0, $previous);
    }
}
