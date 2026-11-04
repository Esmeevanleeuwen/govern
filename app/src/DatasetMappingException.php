<?php
declare(strict_types=1);
namespace Govern;

/** Only confirmed published units are included; a lost commit is not replayable. */
final class DatasetMappingException extends \RuntimeException
{
    public function __construct(public readonly array $completedTables, public readonly bool $uncertain, \Throwable $previous)
    {
        parent::__construct('Dataset publication did not complete.', 0, $previous);
    }
}
