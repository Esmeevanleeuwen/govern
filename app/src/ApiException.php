<?php
declare(strict_types=1);

namespace Govern;

final class ApiException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly string $errorCode = 'request_failed',
        public readonly array $errorParams = [],
    )
    {
        parent::__construct($message);
    }

    public static function fromCode(string $code, int $status = 400, array $parameters = []): self
    {
        return new self(Messages::text($code, $parameters), $status, $code, $parameters);
    }
}
