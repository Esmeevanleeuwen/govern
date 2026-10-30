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
    private const BESTUURSATLAS_FOREIGN_KEYS = [
        'datasets' => ['fk_datasets_evidence_id'],
        'dataset_responsibilities' => ['fk_dataset_responsibilities_dataset_id', 'fk_dataset_responsibilities_evidence_id', 'fk_dataset_responsibilities_organization_id'],
        'data_flows' => ['fk_data_flows_evidence_id', 'fk_data_flows_from_system_id', 'fk_data_flows_technology_id', 'fk_data_flows_to_system_id'],
        'data_flow_datasets' => ['fk_data_flow_datasets_dataset_id', 'fk_data_flow_datasets_data_flow_id', 'fk_data_flow_datasets_evidence_id'],
        'digital_systems' => ['fk_digital_systems_evidence_id'],
        'event_subjects' => ['fk_event_subjects_dataset_id', 'fk_event_subjects_event_id', 'fk_event_subjects_evidence_id', 'fk_event_subjects_organization_id', 'fk_event_subjects_programme_id', 'fk_event_subjects_public_function_id', 'fk_event_subjects_source_id', 'fk_event_subjects_system_id', 'fk_event_subjects_technology_id', 'fk_event_subjects_territory_id'],
        'evidence_sources' => ['fk_evidence_sources_evidence_id', 'fk_evidence_sources_source_id'],
        'historical_events' => ['fk_historical_events_evidence_id'],
        'mandates' => ['fk_mandates_evidence_id', 'fk_mandates_organization_id', 'fk_mandates_public_function_id', 'fk_mandates_territory_id'],
        'organizations' => ['fk_organizations_evidence_id'],
        'organization_relations' => ['fk_organization_relations_evidence_id', 'fk_organization_relations_from_organization_id', 'fk_organization_relations_to_organization_id'],
        'programmes' => ['fk_programmes_evidence_id'],
        'programme_targets' => ['fk_programme_targets_dataset_id', 'fk_programme_targets_evidence_id', 'fk_programme_targets_programme_id', 'fk_programme_targets_system_id'],
        'public_functions' => ['fk_public_functions_evidence_id', 'fk_public_functions_parent_function_id'],
        'system_dataset_usage' => ['fk_system_dataset_usage_dataset_id', 'fk_system_dataset_usage_evidence_id', 'fk_system_dataset_usage_system_id'],
        'system_functions' => ['fk_system_functions_evidence_id', 'fk_system_functions_function_id', 'fk_system_functions_system_id'],
        'system_responsibilities' => ['fk_system_responsibilities_evidence_id', 'fk_system_responsibilities_organization_id', 'fk_system_responsibilities_system_id'],
        'system_technologies' => ['fk_system_technologies_evidence_id', 'fk_system_technologies_system_id', 'fk_system_technologies_technology_id'],
        'technologies' => ['fk_technologies_evidence_id'],
        'territories' => ['fk_territories_evidence_id'],
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
        $foreignKeysByTable = [];
        foreach ($schema['tables'] as $table) {
            if ($table['type'] === 'table') {
                $foreignKeys += count($table['foreign_keys']);
                $foreignKeysByTable[$table['name']] = array_column($table['foreign_keys'], 'name');
            }
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
        $missingForeignKeys = [];
        if ($recognized) {
            foreach (self::BESTUURSATLAS_SECTIONS as $key => $expected) {
                $missing = array_values(array_filter($expected, static fn (string $name): bool => !isset($names[$name])));
                array_push($missingTables, ...$missing);
                $present = array_values(array_diff($expected, $missing));
                $empty = array_values(array_filter($present, static fn (string $name): bool => ($rowCounts[$name] ?? -1) === 0));
                $notCounted = array_diff($present, array_keys($rowCounts));
                $groupRows = array_sum(array_intersect_key($rowCounts, array_fill_keys($present, true)));
                $sections[] = ['key' => $key, 'expected' => count($expected), 'present' => count($present),
                    'missing' => $missing, 'empty' => $empty, 'records' => count($notCounted) ? null : $groupRows];
            }
            foreach (self::BESTUURSATLAS_FOREIGN_KEYS as $table => $required) {
                if (!isset($names[$table])) continue;
                foreach ($required as $key) {
                    if (!in_array($key, $foreignKeysByTable[$table] ?? [], true)) {
                        $missingForeignKeys[] = $table . '.' . $key;
                    }
                }
            }
            $missingViews = array_values(array_filter(self::BESTUURSATLAS_VIEWS,
                static fn (string $name): bool => !in_array($name, $viewNames, true)));
        }

        return [
            'database' => $this->database->name(),
            'tables' => $tableNames, 'views' => $viewNames,
            'foreign_keys' => $foreignKeys, 'row_counts' => (object) $rowCounts,
            'unchecked_rows' => $unchecked,
            'total_records' => count($unchecked) === 0 ? array_sum($rowCounts) : null,
            'template' => $recognized ? 'bestuursatlas' : null,
            'expected_foreign_keys' => $recognized ? 54 : null,
            'missing_tables' => $missingTables, 'missing_views' => $missingViews,
            'missing_foreign_keys' => $missingForeignKeys,
            'sections' => $sections,
        ];
    }
}
