<?php
declare(strict_types=1);

namespace Govern;

/** Small PostgreSQL SQL imports reuse the native parser, runner and snapshots. */
final class PostgresNativeImport
{
    public const MAX_BYTES = NativeImport::MAX_BYTES;

    public function __construct(
        private readonly Database $database,
        private readonly Catalog $catalog,
        private readonly array $config,
    ) {}

    public static function validate(string $sql): string
    {
        if (strlen($sql) > self::MAX_BYTES) throw ApiException::fromCode('postgres_import_sql_too_large', 413);
        return NativeImport::validate($sql);
    }

    public static function token(string $scope, string $sql, array $states): string
    {
        return hash('sha256', serialize([$scope, hash('sha256', $sql), $states]));
    }

    public function preview(string $sql): array
    {
        $sql = self::validate($sql);
        $parsed = PostgresSqlScript::preview($sql);
        if ($parsed['statement_count'] === 0) throw ApiException::fromCode('import_sql_required', 422);
        $states = $this->states();
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(),
            'scope_key' => $this->scope(), 'confirmation' => $this->confirmation(),
            'max_bytes' => self::MAX_BYTES, 'bytes' => strlen($sql), 'sha256' => hash('sha256', $sql),
            'statement_count' => $parsed['statement_count'],
            'destructive' => array_map(static fn (array $item): array => [
                'line' => $item['line'], 'reason' => $item['reason'], 'sql' => substr($item['sql'], 0, 180),
            ], array_slice($parsed['destructive'], 0, 20)),
            'destructive_truncated' => count($parsed['destructive']) > 20,
            'before' => $states[$this->database->schemaName()], 'safety_schemas' => array_map('strval', array_keys($states)),
            'preview_token' => self::token($this->scope(), $sql, $states)];
    }

    public function execute(string $sql, string $previewToken, string $confirmation): array
    {
        $sql = self::validate($sql);
        // Parse before any snapshot or execution; client commands are not SQL.
        $parsed = PostgresSqlScript::preview($sql);
        if ($parsed['statement_count'] === 0) throw ApiException::fromCode('import_sql_required', 422);
        if ($confirmation !== $this->confirmation()) throw ApiException::fromCode('postgres_import_confirm', 422);
        if (!preg_match('/\A[a-f0-9]{64}\z/D', $previewToken)) throw ApiException::fromCode('import_preview_invalid', 422);
        // API holds the root exclusive lock. External clients do not participate;
        // these observable-state checks are not a database sandbox.
        $states = $this->states();
        if (!hash_equals(self::token($this->scope(), $sql, $states), $previewToken)) {
            throw ApiException::fromCode('import_preview_stale', 409);
        }
        $snapshots = [];
        foreach (array_keys($states) as $schema) {
            // Qualified SQL can write any schema granted to the SQL role. Take
            // all configured schemas' copies first; one failure aborts import.
            $backup = new PostgresBackupService($this->schemaConfig((string) $schema));
            $snapshot = $backup->createLocked('Automatisch vóór SQL-import ' . gmdate('Y-m-d H:i:s'));
            $snapshots[] = ['schema' => (string) $schema, 'id' => $snapshot['id'],
                'restore_available' => ($snapshot['restore_available'] ?? false) === true];
        }
        $before = $states[$this->database->schemaName()];
        $result = (new QueryRunner($this->database))->executeScript($sql, true);
        $afterError = null;
        try {
            $after = (new PostgresImportInspection($this->database, new Catalog($this->database)))->inspect();
        } catch (\PDOException | ApiException) {
            $afterError = Messages::text('postgres_import_inspection_failed');
            $after = [...$before, 'row_counts' => (object) [], 'unchecked_rows' => ['*'],
                'total_records' => null, 'inspection_available' => false, 'schema_version' => null];
        }
        $failed = $result['failed'];
        $safety = null;
        foreach ($snapshots as $snapshot) if ($snapshot['schema'] === $this->database->schemaName())
            $safety = ['id' => $snapshot['id'], 'restore_available' => $snapshot['restore_available']];
        return ['database' => $this->database->name(), 'schema' => $this->database->schemaName(), 'scope_key' => $this->scope(),
            'completed' => $failed === null && $result['executed'] > 0 && !$result['transaction_rolled_back'],
            'executed' => $result['executed'], 'statement_count' => $result['statement_count'],
            'transaction_rolled_back' => $result['transaction_rolled_back'], 'safety_snapshot' => $safety,
            'safety_snapshots' => $snapshots, 'failed' => $failed === null ? null : [
                'index' => $failed['index'] ?? null, 'detail' => substr((string) ($failed['detail'] ?? ''), 0, 500)],
            'before' => $before, 'after' => $after, 'inspection_error' => $afterError,
            'added_tables' => $after['inspection_available'] ? array_values(array_diff($after['tables'], $before['tables'])) : [],
            'removed_tables' => $after['inspection_available'] ? array_values(array_diff($before['tables'], $after['tables'])) : [],
            'added_views' => $after['inspection_available'] ? array_values(array_diff($after['views'], $before['views'])) : [],
            'removed_views' => $after['inspection_available'] ? array_values(array_diff($before['views'], $after['views'])) : [],
            'unchecked_rows' => array_values(array_unique([...$before['unchecked_rows'], ...$after['unchecked_rows']]))];
    }

    private function states(): array
    {
        $states = [];
        foreach ($this->config['schemas'] as $schema) {
            $schema = (string) $schema;
            $statement = $this->database->reader()->prepare('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=:schema');
            $statement->execute(['schema' => $schema]);
            if ($statement->fetchColumn() === false) continue;
            $database = new Database($this->schemaConfig($schema));
            $states[$schema] = (new PostgresImportInspection($database, new Catalog($database)))->inspect();
        }
        if (!isset($states[$this->database->schemaName()])) throw ApiException::fromCode('postgres_schema_unavailable', 503);
        return $states;
    }

    private function schemaConfig(string $schema): array
    {
        $scope = ConnectionScope::scopeKey('postgres', $this->database->name(), $schema);
        return [...$this->config, 'schema' => $schema, 'scope_key' => $scope,
            'backup_dir' => rtrim($this->config['maintenance_dir'], DIRECTORY_SEPARATOR) . '/connections/' . hash('sha256', $scope)];
    }

    private function scope(): string { return ConnectionScope::scopeKey('postgres', $this->database->name(), $this->database->schemaName()); }
    private function confirmation(): string { return $this->database->name() . '.' . $this->database->schemaName(); }
}
