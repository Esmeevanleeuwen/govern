<?php
declare(strict_types=1);

namespace Govern;

/** Keep one catalog contract for the existing table and schema screens. */
final class Catalog implements CatalogAdapter
{
    private CatalogAdapter $adapter;

    public function __construct(Database $database)
    {
        $this->adapter = $database->engine() === 'postgres' ? new PostgresCatalog($database) : new MariaDbCatalog($database);
    }

    public function schema(): array { return $this->adapter->schema(); }
    public function tables(): array { return $this->adapter->tables(); }
    public function columns(string $table): array { return $this->adapter->columns($table); }
    public function foreignKeys(string $table): array { return $this->adapter->foreignKeys($table); }
    public function structure(string $table): array { return $this->adapter->structure($table); }
    public function indexes(string $table): array { return $this->adapter->indexes($table); }
    public function browse(string $table, int $page, int $pageSize, string $search): array
    {
        return $this->adapter->browse($table, $page, $pageSize, $search);
    }
}
