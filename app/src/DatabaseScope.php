<?php
declare(strict_types=1);

namespace Govern;

/** Each request names its database explicitly; no shared session selection. */
final class DatabaseScope
{
    private ?array $known = null;
    private const SYSTEM = ['information_schema', 'mysql', 'performance_schema', 'sys'];

    public function __construct(private readonly array $base) {}

    public function databases(): array
    {
        if ($this->known !== null) return $this->known;
        try { $available = (new Database($this->base))->databaseNames(); }
        catch (\PDOException | ApiException) { $available = []; }
        // Configured, now-missing schemas stay selectable for restore access.
        $names = array_values(array_unique([$this->base['name'], ...($this->base['databases'] ?? []), ...$available], SORT_STRING));
        $names = array_values(array_filter($names, static fn (string $name): bool => !in_array(strtolower($name), self::SYSTEM, true)));
        usort($names, fn (string $a, string $b): int => $a === $b ? 0 : ($a === $this->base['name'] ? -1
            : ($b === $this->base['name'] ? 1 : strnatcasecmp($a, $b))));
        return $this->known = array_map(static fn (string $name): array => ['name' => $name,
            'available' => in_array($name, $available, true)], $names);
    }

    public function select(string $name): array
    {
        if (!in_array($name, array_column($this->databases(), 'name'), true)) {
            throw ApiException::fromCode('database_not_available', 403);
        }
        $root = rtrim((string) $this->base['backup_dir'], DIRECTORY_SEPARATOR);
        return [...$this->base, 'name' => $name, 'maintenance_dir' => $root,
            'backup_dir' => $name === $this->base['name'] ? $root : $root . '/databases/' . hash('sha256', $name)];
    }
}
