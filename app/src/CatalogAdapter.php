<?php
declare(strict_types=1);

namespace Govern;

/** Both catalogs return the metadata consumed by Govern's existing screens. */
interface CatalogAdapter
{
    public function schema(): array;
    public function tables(): array;
    public function columns(string $table): array;
    public function foreignKeys(string $table): array;
    public function structure(string $table): array;
    public function indexes(string $table): array;
    public function browse(string $table, int $page, int $pageSize, string $search): array;
}
