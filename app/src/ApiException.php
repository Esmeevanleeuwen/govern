<?php
declare(strict_types=1);

namespace Govern;

final class ApiException extends \RuntimeException
{
    public function __construct(string $message, public readonly int $status = 400)
    {
        parent::__construct($message);
    }
}
