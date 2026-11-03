<?php
declare(strict_types=1);

namespace Govern;

use PDO;

/** Bounded record neighborhoods derived exclusively from the readable catalog. */
final class RecordExplorer
{
    public const LIMITS = ['max_nodes' => 60, 'max_edges' => 120, 'per_relation' => 15,
        'max_relations' => 12, 'candidates' => 25];
    // A percent-encoded GET key must fit ordinary HTTP request-line limits.
    public const KEY_BYTES = 2048;
    private const VALUE_BYTES = 2048;
    private const DISPLAY_COLUMNS = 40;
    private const TIME_MS = 2500;
    private const RESPONSE_BYTES = Preview::RESULT_BYTES - 65536;
    private array $tables = [];
    private array $keys = [];
    private array $nodes = [];
    private array $edges = [];
    private array $omitted = [];
    private int $bytes = 0;
    private float $started = 0;
    private readonly Catalog $catalog;
    private readonly string $scope;

    public function __construct(private readonly Database $database)
    {
        $this->catalog = new Catalog($database);
        $this->scope = ConnectionScope::scopeKey($database->engine(), $database->name(), $database->schemaName());
    }

    public function explore(string $table, ?array $key = null): array
    {
        $this->started = microtime(true);
        $this->tables = $this->keys = $this->nodes = $this->edges = $this->omitted = [];
        $this->bytes = 0;
        $pdo = $this->database->reader();
        $ownTransaction = !$pdo->inTransaction();
        if ($ownTransaction) $pdo->beginTransaction();
        try {
            $this->tables = array_column($this->catalog->schema()['tables'], null, 'name');
            if (!isset($this->tables[$table])) throw ApiException::fromCode('table_missing', 404);
            $relations = $this->relations($table);
            $columns = $this->keyColumns($table);
            $candidates = [];
            $center = null;
            if ($columns === []) {
                if ($key !== null) throw ApiException::fromCode('explore_key_invalid', 422);
                $this->omit('keyless', $table);
            } else {
                $rows = $this->rows($table, [], self::LIMITS['candidates'] + 1);
                if (count($rows) > self::LIMITS['candidates']) $this->omit('candidate_limit', $table);
                $rows = array_slice($rows, 0, self::LIMITS['candidates']);
                foreach ($rows as $row) {
                    if (($identity = $this->identity($table, $row)) === null) { $this->omit('unsupported_key', $table); continue; }
                    $candidate = $this->candidate($table, $row, $identity);
                    $bytes = strlen(json_encode($candidate, JSON_THROW_ON_ERROR));
                    if ($bytes + $this->bytes > self::RESPONSE_BYTES) { $this->omit('preview_limit', $table); break; }
                    $candidates[] = $candidate;
                    $this->bytes += $bytes;
                }
                if ($key !== null) {
                    $key = $this->validateKey($table, $key);
                    try { $selected = $this->rows($table, $key, 1)[0] ?? null; }
                    catch (\PDOException $error) {
                        if (str_starts_with((string) $error->getCode(), '22')) throw ApiException::fromCode('explore_key_invalid', 422);
                        throw $error;
                    }
                    if ($selected === null) throw ApiException::fromCode('explore_record_missing', 404);
                } else $selected = $rows[0] ?? null;
                if ($selected !== null && ($identity = $this->identity($table, $selected)) !== null) {
                    $center = $this->addNode($table, $selected, $identity);
                    if (!in_array($center, array_column($candidates, 'id'), true)) {
                        $candidate = $this->candidate($table, $selected, $identity);
                        $this->bytes += strlen(json_encode($candidate, JSON_THROW_ON_ERROR));
                        array_unshift($candidates, $candidate);
                        $candidates = array_slice($candidates, 0, self::LIMITS['candidates']);
                    }
                    foreach (array_slice($relations, 0, self::LIMITS['max_relations']) as $relation) {
                        if ($this->elapsed() > self::TIME_MS) { $this->omit('time_limit'); break; }
                        if ($relation['source_table'] === $table) $this->neighbors($relation, $selected, true);
                        if ($relation['target_table'] === $table) $this->neighbors($relation, $selected, false);
                    }
                } elseif ($selected !== null) $this->omit('unsupported_key', $table);
            }
            $result = ['scope_key' => $this->scope, 'table' => $table, 'center' => $center,
                'candidates' => $candidates, 'nodes' => array_values($this->nodes), 'edges' => array_values($this->edges),
                'relations' => array_slice($relations, 0, self::LIMITS['max_relations']), 'limits' => self::LIMITS,
                'partial' => $this->omitted !== [], 'omitted' => array_values($this->omitted), 'elapsed_ms' => $this->elapsed()];
            if ($ownTransaction) $pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($ownTransaction && $pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }

    private function relations(string $table): array
    {
        $relations = [];
        foreach ($this->tables as $source => $metadata) {
            $source = (string) $source;
            foreach ($metadata['foreign_keys'] as $foreignKey) {
                if ($source !== $table && $foreignKey['referenced_table'] !== $table) continue;
                $id = hash('sha256', json_encode([$this->scope, $source, $foreignKey], JSON_THROW_ON_ERROR));
                if (($foreignKey['referenced_schema'] ?? $this->database->schemaName()) !== $this->database->schemaName()) {
                    $this->omit('external_scope', $source, $id); continue;
                }
                $target = $foreignKey['referenced_table'];
                if (!isset($this->tables[$target])) { $this->omit('unavailable_target', $source, $id); continue; }
                if (count($foreignKey['columns']) > 16 || $foreignKey['columns'] === []
                    || count($foreignKey['columns']) !== count($foreignKey['referenced_columns'])) {
                    $this->omit('unsupported_relation', $source, $id); continue;
                }
                foreach ([[$source, $foreignKey['columns']], [$target, $foreignKey['referenced_columns']]] as [$name, $fields]) {
                    $map = array_column($this->tables[$name]['columns'], null, 'name');
                    foreach ($fields as $field) {
                        if (!isset($map[$field]) || $this->unsupported($map[$field])) {
                            $this->omit('unsupported_relation', $source, $id); continue 3;
                        }
                    }
                }
                $relations[] = ['id' => $id, 'name' => $foreignKey['name'], 'source_table' => $source,
                    'target_table' => $target, 'columns' => $foreignKey['columns'], 'referenced_columns' => $foreignKey['referenced_columns']];
            }
        }
        if (count($relations) > self::LIMITS['max_relations']) $this->omit('relation_limit', $table);
        return $relations;
    }

    private function keyColumns(string $table): array
    {
        if (array_key_exists($table, $this->keys)) return $this->keys[$table];
        if ($this->tables[$table]['type'] !== 'table') return $this->keys[$table] = [];
        $map = array_column($this->tables[$table]['columns'], null, 'name');
        $indexes = $this->catalog->indexes($table);
        usort($indexes, static fn (array $a, array $b): int =>
            (($a['primary'] ?? $a['name'] === 'PRIMARY') ? 0 : 1) <=> (($b['primary'] ?? $b['name'] === 'PRIMARY') ? 0 : 1)
            ?: count($a['columns']) <=> count($b['columns']) ?: strcmp($a['name'], $b['name']));
        foreach ($indexes as $index) {
            if (!$index['unique'] || ($index['partial'] ?? false) || $index['columns'] === []) continue;
            foreach ($index['columns'] as $position => $name) {
                if (!isset($map[$name]) || $map[$name]['nullable'] || $this->unsupported($map[$name])
                    || ($index['sub_parts'][$position] ?? null) !== null) continue 2;
            }
            return $this->keys[$table] = $index['columns'];
        }
        return $this->keys[$table] = [];
    }

    private function unsupported(array $column): bool
    {
        return RecordIdentity::unsupported($column) || RecordIdentity::binary($column)
            || in_array($column['data_type'], ['bytea', 'json', 'jsonb', 'xml'], true)
            || str_starts_with($column['data_type'], '_');
    }

    private function validateKey(string $table, array $key): array
    {
        $columns = $this->keyColumns($table);
        $metadata = array_column($this->tables[$table]['columns'], null, 'name');
        $received = array_map('strval', array_keys($key));
        $expected = $columns;
        sort($received); sort($expected);
        if ($received !== $expected || strlen(json_encode($key, JSON_THROW_ON_ERROR)) > self::KEY_BYTES) {
            throw ApiException::fromCode('explore_key_invalid', 422);
        }
        $ordered = [];
        foreach ($columns as $column) {
            $value = $key[$column];
            if (!is_string($value) || str_contains($value, "\0") || preg_match('//u', $value) !== 1) {
                throw ApiException::fromCode('explore_key_invalid', 422);
            }
            $type = strtolower($metadata[$column]['data_type']);
            $integer = in_array($type, ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'int2', 'int4', 'int8'], true);
            $numeric = in_array($type, ['decimal', 'numeric', 'float', 'double', 'real', 'float4', 'float8'], true);
            if ($integer && !preg_match('/^[+-]?[0-9]+$/D', $value)
                || $numeric && !preg_match('/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/D', $value)) {
                throw ApiException::fromCode('explore_key_invalid', 422);
            }
            $ordered[$column] = $value;
        }
        return $ordered;
    }

    private function identity(string $table, array $row): ?array
    {
        $key = [];
        foreach ($this->keyColumns($table) as $column) {
            if (!array_key_exists($column, $row) || $row[$column] === null) return null;
            $value = (string) $row[$column];
            if (str_contains($value, "\0") || preg_match('//u', $value) !== 1) return null;
            $key[$column] = $value;
        }
        return $key === [] || strlen(json_encode($key, JSON_THROW_ON_ERROR)) > self::KEY_BYTES ? null : $key;
    }

    private function rows(string $table, array $conditions, int $limit): array
    {
        $map = array_column($this->tables[$table]['columns'], null, 'name');
        $exact = array_fill_keys($this->keyColumns($table), true);
        foreach ($this->tables as $source => $metadata) {
            foreach ($metadata['foreign_keys'] as $foreignKey) {
                if ((string) $source === $table) foreach ($foreignKey['columns'] as $name) $exact[$name] = true;
                if ($foreignKey['referenced_table'] === $table
                    && ($foreignKey['referenced_schema'] ?? $this->database->schemaName()) === $this->database->schemaName()) {
                    foreach ($foreignKey['referenced_columns'] as $name) $exact[$name] = true;
                }
            }
        }
        $projection = [];
        foreach ($map as $name => $column) {
            $quoted = $this->quote((string) $name);
            $projection[] = match (true) {
                $column['data_type'] === 'bytea' => "('0x' || pg_catalog.encode(substring($quoted from 1 for 1025), 'hex')) AS $quoted",
                $column['data_type'] === 'bool' => "CASE WHEN $quoted IS NULL THEN NULL WHEN $quoted THEN 'true' ELSE 'false' END AS $quoted",
                RecordIdentity::binary($column) => "CONCAT('0x', HEX(SUBSTRING($quoted, 1, 1025))) AS $quoted",
                // Native PDO float-to-string conversion can round distinct keys
                // to the same text. Let the engine serialize exact join/key
                // values before they reach PDO; predicates keep indexed fields.
                isset($exact[$name]) && !$this->unsupported($column) =>
                    'CAST(' . $quoted . ' AS ' . ($this->database->engine() === 'postgres' ? 'text' : 'CHAR') . ') AS ' . $quoted,
                default => 'LEFT(CAST(' . $quoted . ' AS ' . ($this->database->engine() === 'postgres' ? 'text' : 'CHAR') . '), 2049) AS ' . $quoted,
            };
        }
        $where = [];
        $params = [];
        foreach ($conditions as $column => $value) {
            if (!isset($map[$column])) throw ApiException::fromCode('explore_key_invalid', 422);
            if ($value === null) return [];
            $parameter = 'value_' . count($params);
            $where[] = $this->quote((string) $column) . ' = :' . $parameter;
            $params[$parameter] = $value;
        }
        $order = array_map($this->quote(...), $this->keyColumns($table));
        $sql = 'SELECT ' . implode(', ', $projection) . ' FROM ' . $this->qualified($table)
            . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where))
            . ($order === [] ? '' : ' ORDER BY ' . implode(', ', $order)) . ' LIMIT ' . $limit;
        $statement = $this->database->reader()->prepare($sql);
        try {
            $statement->execute($params);
            $rows = [];
            $bytes = 0;
            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                $rows[] = $row;
                $bytes += Preview::bytes($row);
                if ($bytes > Preview::RESULT_BYTES) { $this->omit('preview_limit', $table); break; }
            }
            return $rows;
        } finally { $statement->closeCursor(); }
    }

    private function neighbors(array $relation, array $center, bool $outgoing): void
    {
        $neighborTable = $relation[$outgoing ? 'target_table' : 'source_table'];
        if ($this->keyColumns($neighborTable) === []) { $this->omit('keyless', $neighborTable, $relation['id']); return; }
        $from = $relation[$outgoing ? 'columns' : 'referenced_columns'];
        $to = $relation[$outgoing ? 'referenced_columns' : 'columns'];
        $conditions = [];
        foreach ($from as $position => $column) {
            if (($center[$column] ?? null) === null) return;
            $conditions[$to[$position]] = $center[$column];
        }
        $rows = $this->rows($neighborTable, $conditions, self::LIMITS['per_relation'] + 1);
        if (count($rows) > self::LIMITS['per_relation']) $this->omit('neighbor_limit', $neighborTable, $relation['id']);
        foreach (array_slice($rows, 0, self::LIMITS['per_relation']) as $neighbor) {
            $source = $outgoing ? $center : $neighbor;
            $target = $outgoing ? $neighbor : $center;
            $sourceKey = $this->identity($relation['source_table'], $source);
            $targetKey = $this->identity($relation['target_table'], $target);
            if ($sourceKey === null || $targetKey === null) { $this->omit('unsupported_key', $neighborTable, $relation['id']); continue; }
            $sourceId = $this->addNode($relation['source_table'], $source, $sourceKey);
            $targetId = $this->addNode($relation['target_table'], $target, $targetKey);
            if ($sourceId === null || $targetId === null) continue;
            $id = hash('sha256', $relation['id'] . ':' . $sourceId . ':' . $targetId);
            if (isset($this->edges[$id])) continue;
            if (count($this->edges) >= self::LIMITS['max_edges']) { $this->omit('edge_limit'); break; }
            $sourceValues = $targetValues = [];
            foreach ($relation['columns'] as $position => $column) {
                $sourceValues[$column] = $source[$column];
                $reference = $relation['referenced_columns'][$position];
                $targetValues[$reference] = $target[$reference];
            }
            $edge = [...$relation, 'id' => $id, 'relation' => $relation['id'], 'source' => $sourceId, 'target' => $targetId,
                'source_values' => (object) $sourceValues, 'target_values' => (object) $targetValues];
            $bytes = strlen(json_encode($edge, JSON_THROW_ON_ERROR));
            if ($bytes + $this->bytes > self::RESPONSE_BYTES) { $this->omit('preview_limit'); break; }
            $this->edges[$id] = $edge;
            $this->bytes += $bytes;
        }
    }

    private function candidate(string $table, array $row, array $key): array
    {
        return ['id' => $this->nodeId($table, $key), 'label' => $this->label($table, $row, $key), 'key' => (object) $key];
    }

    private function addNode(string $table, array $row, array $key): ?string
    {
        $id = $this->nodeId($table, $key);
        if (isset($this->nodes[$id])) return $id;
        if (count($this->nodes) >= self::LIMITS['max_nodes']) { $this->omit('node_limit'); return null; }
        $truncated = count($row) > self::DISPLAY_COLUMNS;
        $values = array_slice($row, 0, self::DISPLAY_COLUMNS, true);
        $values = Preview::row($values, $truncated);
        foreach ($values as &$value) {
            if (is_string($value) && strlen($value) > self::VALUE_BYTES) {
                $value = $this->shorten($value, self::VALUE_BYTES) . '…';
                $truncated = true;
            }
        }
        unset($value);
        $node = ['id' => $id, 'table' => $table, 'label' => $this->label($table, $row, $key),
            'key' => (object) $key, 'values' => (object) $values, 'truncated' => $truncated];
        $bytes = strlen(json_encode($node, JSON_THROW_ON_ERROR));
        if ($bytes + $this->bytes > self::RESPONSE_BYTES) { $this->omit('preview_limit'); return null; }
        $this->nodes[$id] = $node;
        $this->bytes += $bytes;
        if ($truncated) $this->omit('preview_limit', $table);
        return $id;
    }

    private function label(string $table, array $row, array $key): string
    {
        foreach (['name', 'title', 'label', 'full_name', 'code'] as $column) {
            if (isset($row[$column]) && is_string($row[$column]) && trim($row[$column]) !== ''
                && preg_match('//u', $row[$column]) === 1 && !str_contains($row[$column], "\0")) {
                return $this->shorten($row[$column], 120);
            }
        }
        return $this->shorten($table . ' · ' . implode(' / ', $key), 120);
    }

    private function shorten(string $value, int $bytes): string
    {
        $value = substr($value, 0, $bytes);
        while ($value !== '' && preg_match('//u', $value) !== 1) $value = substr($value, 0, -1);
        return $value;
    }

    private function nodeId(string $table, array $key): string
    {
        return hash('sha256', json_encode([$this->scope, $table, (object) $key], JSON_THROW_ON_ERROR));
    }

    private function omit(string $code, ?string $table = null, ?string $relation = null): void
    {
        $item = array_filter(['code' => $code, 'table' => $table, 'relation' => $relation], static fn ($value): bool => $value !== null);
        $this->omitted[json_encode($item, JSON_THROW_ON_ERROR)] = $item;
    }

    private function qualified(string $table): string { return $this->quote($this->database->schemaName()) . '.' . $this->quote($table); }
    private function quote(string $name): string { return $this->database->quoteIdentifier($name); }
    private function elapsed(): int { return (int) round((microtime(true) - $this->started) * 1000); }
}
