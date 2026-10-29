<?php
declare(strict_types=1);

namespace Govern;

/** Build fresh schema context. Client record snapshots are never model input. */
final class AiContext
{
    public const MAX_BYTES = 6000;
    private readonly \Closure $schemaReader;
    private const KINDS = ['table', 'column', 'row', 'cell', 'relationship', 'control', 'element', 'workspace'];
    private const ROUTES = ['overzicht', 'gegevens', 'structuur', 'schema', 'onderzoeken', 'experimenten', 'instellingen'];

    public function __construct(private readonly Database $database, ?callable $schemaReader = null)
    {
        $this->schemaReader = $schemaReader === null ? (new Catalog($database))->schema(...) : \Closure::fromCallable($schemaReader);
    }

    public function build(array $input): array
    {
        $route = $input['route'] ?? 'overzicht';
        $targets = $input['targets'] ?? [];
        if (!is_string($route) || !in_array($route, self::ROUTES, true)
            || !is_array($targets) || !array_is_list($targets) || count($targets) > 8) {
            throw ApiException::fromCode('ai_context_invalid', 422);
        }
        $clean = [];
        $requested = [];
        $truncated = false;
        foreach ($targets as $target) {
            if (!is_array($target) || !isset($target['kind']) || !is_string($target['kind'])
                || !in_array($target['kind'], self::KINDS, true)) throw ApiException::fromCode('ai_context_invalid', 422);
            $kind = $target['kind'];
            $item = ['kind' => $kind];
            $table = isset($target['table']) ? $this->identifier($target['table']) : null;
            $column = isset($target['column']) ? $this->identifier($target['column']) : null;
            if (in_array($kind, ['table', 'column', 'row', 'cell', 'relationship'], true) && $table === null)
                throw ApiException::fromCode('ai_context_invalid', 422);
            if (in_array($kind, ['column', 'cell'], true) && $column === null)
                throw ApiException::fromCode('ai_context_invalid', 422);
            if ($column !== null && $table === null) throw ApiException::fromCode('ai_context_invalid', 422);
            if ($table !== null) {
                $item['table'] = $table;
                if ($column !== null) $item['column'] = $column;
                // Row/cell labels can contain real values; derive every data label from identifiers.
                $item['label'] = $table . ($column === null ? '' : '.' . $column);
                $requested[$table] ??= [];
                if ($column !== null) $requested[$table][] = $column;
            } else {
                $item['label'] = self::shortText($target['label'] ?? $kind, 240);
                if ($item['label'] !== ($target['label'] ?? $kind)) $truncated = true;
                if (isset($target['tag'])) {
                    $item['tag'] = self::shortText($target['tag'], 64);
                    if ($item['tag'] !== $target['tag']) $truncated = true;
                }
            }
            $clean[json_encode($item, JSON_THROW_ON_ERROR)] = $item;
        }
        $schema = $requested === [] ? [] : ($this->schemaReader)();
        if ($requested !== [] && ($schema['database'] ?? null) !== $this->database->name())
            throw ApiException::fromCode('ai_context_invalid', 422);
        $map = array_column($schema['tables'] ?? [], null, 'name');
        $sources = [];
        $definitions = [];
        foreach ($requested as $name => $focused) {
            $name = (string) $name;
            if (!isset($map[$name]) || str_starts_with($name, '_govern_')) throw ApiException::fromCode('table_missing', 404);
            $table = $map[$name];
            $columnMap = array_column($table['columns'], null, 'name');
            foreach ($focused as $column) if (!isset($columnMap[$column])) throw ApiException::fromCode('column_missing', 422);
            $comment = self::shortText($table['comment'] ?? '', 300);
            if ($comment !== ($table['comment'] ?? '')) $truncated = true;
            $sources[] = ['table' => $name, 'type' => $table['type'], 'comment' => $comment,
                'column_count' => count($table['columns']), 'foreign_key_count' => count($table['foreign_keys']),
                'columns' => [], 'foreign_keys' => [], 'columns_omitted' => count($table['columns']),
                'foreign_keys_omitted' => count($table['foreign_keys'])];
            $ordered = [];
            foreach ($focused as $column) $ordered[$column] = $columnMap[$column];
            foreach ($table['columns'] as $column) $ordered[$column['name']] = $column;
            $definitions[] = ['columns' => array_values($ordered), 'foreign_keys' => $table['foreign_keys']];
        }
        $context = ['database' => $this->database->name(), 'route' => $route, 'targets' => array_values($clean),
            'sources' => $sources, 'records_included' => false, 'truncated' => $truncated,
            'context_id' => str_repeat('0', 64)];
        if (strlen(self::json($context)) > self::MAX_BYTES) throw ApiException::fromCode('ai_context_too_large', 413);
        // Keep every selected source visible, adding only metadata that fits the shared budget.
        foreach ($definitions as $index => $definition) {
            foreach ($definition['columns'] as $column) {
                $entry = ['name' => $column['name'], 'type' => $column['type'], 'nullable' => (bool) $column['nullable'],
                    'primary' => (bool) $column['primary'], 'generated' => (bool) $column['generated'],
                    'comment' => self::shortText($column['comment'] ?? '', 240)];
                if ($entry['comment'] !== ($column['comment'] ?? '')) $context['truncated'] = true;
                $candidate = $context;
                $candidate['sources'][$index]['columns'][] = $entry;
                $candidate['sources'][$index]['columns_omitted']--;
                if (strlen(self::json($candidate)) <= self::MAX_BYTES) $context = $candidate;
                else $context['truncated'] = true;
            }
            foreach ($definition['foreign_keys'] as $key) {
                $entry = array_intersect_key($key, array_flip(['name', 'columns', 'referenced_schema', 'referenced_table', 'referenced_columns']));
                $candidate = $context;
                $candidate['sources'][$index]['foreign_keys'][] = $entry;
                $candidate['sources'][$index]['foreign_keys_omitted']--;
                if (strlen(self::json($candidate)) <= self::MAX_BYTES) $context = $candidate;
                else $context['truncated'] = true;
            }
        }
        $context['context_id'] = hash('sha256', self::json($context));
        return $context;
    }

    private function identifier(mixed $value): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 192 || preg_match('//u', $value) !== 1
            || preg_match('/[\x00-\x1f\x7f]/', $value)) throw ApiException::fromCode('ai_context_invalid', 422);
        return $value;
    }

    public static function shortText(mixed $value, int $limit): string
    {
        if (!is_string($value) || preg_match('//u', $value) !== 1 || str_contains($value, "\0"))
            throw ApiException::fromCode('ai_context_invalid', 422);
        $text = substr($value, 0, $limit);
        while ($text !== '' && preg_match('//u', $text) !== 1) $text = substr($text, 0, -1);
        return $text;
    }

    public static function json(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
