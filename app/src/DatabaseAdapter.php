<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Engine-specific connections stay behind the shared database boundary. */
interface DatabaseAdapter
{
    public function reader(): PDO;
    public function writer(): PDO;
    public function scriptConnection(): PDO;
    public function discardReader(): void;
    public function databaseNames(): array;
}
