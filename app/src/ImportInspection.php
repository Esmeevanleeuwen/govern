<?php
declare(strict_types=1);

namespace Govern;

use PDOException;

/**
 * Read-only snapshot for the official phpMyAdmin import workflow.
 * Counts are exact for bounded tables; expensive/failed counts are reported
 * as unchecked rather than silently presented as precise figures.
 */
final class ImportInspection
{
    private const MAX_COUNTED_TABLES = 40;
    private const MAX_ESTIMATED_ROWS = 250000;
    private const BESTUURSATLAS_SECTIONS = [
        'geography' => ['organizations', 'territories', 'public_functions', 'mandates', 'organization_relations'],
        'digital' => ['digital_systems', 'datasets', 'technologies', 'system_dataset_usage', 'system_technologies', 'system_functions'],
        'responsibility' => ['system_responsibilities', 'dataset_responsibilities', 'data_flows', 'data_flow_datasets'],
        'history' => ['programmes', 'programme_targets', 'historical_events', 'event_subjects'],
        'evidence' => ['sources', 'evidence', 'evidence_sources', 'audit_log'],
    ];
    private const BESTUURSATLAS_VIEWS = ['v_quality_issues', 'v_system_catalog', 'v_timeline'];

    public function __construct(private readonly Database $database, private readonly Catalog $catalog) {}

    public function inspect(): array
    {
        $objects = $this->catalog->tables();
        $schema = $this->catalog->schema();
        $names = array_fill_keys(array_column($objects, 'name'), true);
        $tableNames = [];
        $viewNames = [];
        $rowCounts = [];
        $unchecked = [];
        $foreignKeys = 0;
        foreach ($schema['tables'] as $table) {
            if ($table['type'] === 'table') $foreignKeys += count($table['foreign_keys']);
        }
        foreach ($objects as $object) {
            if ($object['type'] === 'view') $viewNames[] = $object['name'];
            else $tableNames[] = $object['name'];
        }
        $counted = 0;
        foreach ($objects as $object) {
            if ($object['type'] !== 'table') continue;
            $name = $object['name'];
            if ($counted >= self::MAX_COUNTED_TABLES || $object['rows_estimate'] > self::MAX_ESTIMATED_ROWS) {
                $unchecked[] = $name;
                continue;
            }
            $counted++;
            try {
                // Identifier originates in the current catalog, never from a request.
                $rowCounts[$name] = (int) $this->database->reader()->query(
                    'SELECT COUNT(*) FROM ' . Database::identifier($name)
                )->fetchColumn();
            } catch (PDOException) {
                $unchecked[] = $name;
            }
        }

        $templateNames = array_merge(...array_values(self::BESTUURSATLAS_SECTIONS));
        $recognized = str_starts_with(strtolower($this->database->name()), 'bestuursatlas')
            || count(array_intersect($templateNames, $tableNames)) >= 3;
        $sections = [];
        $missingTables = [];
        $missingViews = [];
        if ($recognized) {
            foreach (self::BESTUURSATLAS_SECTIONS as $key => $expected) {
                $missing = array_values(array_filter($expected, static fn (string $name): bool => !isset($names[$name])));
                array_push($missingTables, ...$missing);
                $present = array_values(array_diff($expected, $missing));
                $empty = array_values(array_filter($present, static fn (string $name): bool => ($rowCounts[$name] ?? -1) === 0));
                $sections[] = ['key' => $key, 'expected' => count($expected), 'present' => count($present),
                    'missing' => $missing, 'empty' => $empty];
            }
            $missingViews = array_values(array_filter(self::BESTUURSATLAS_VIEWS,
                static fn (string $name): bool => !in_array($name, $viewNames, true)));
        }

        return [
            'database' => $this->database->name(),
            'tables' => $tableNames, 'views' => $viewNames,
            'foreign_keys' => $foreignKeys, 'row_counts' => $rowCounts,
            'unchecked_rows' => $unchecked,
            'total_records' => count($unchecked) === 0 ? array_sum($rowCounts) : null,
            'template' => $recognized ? 'bestuursatlas' : null,
            'expected_foreign_keys' => $recognized ? 54 : null,
            'missing_tables' => $missingTables, 'missing_views' => $missingViews,
            'sections' => $sections,
        ];
    }
}
