<?php
declare(strict_types=1);

namespace Govern;

/**
 * First-party import for small, user-selected UTF-8 SQL files.
 * Uses the existing SQL executor and catalog instead of a second SQL parser.
 * This is intentionally not a sandbox: import SQL runs with the writer's grants.
 */
final class NativeImport
{
    public const MAX_BYTES = 262144;

    public function __construct(
        private readonly Database $database,
        private readonly Catalog $catalog,
    ) {}

    public static function validate(string $sql): string
    {
        if ($sql === '' || trim($sql) === '') throw ApiException::fromCode('import_sql_required', 422);
        if (strlen($sql) > self::MAX_BYTES) throw ApiException::fromCode('import_sql_too_large', 413);
        if (str_contains($sql, "\0") || preg_match('//u', $sql) !== 1) {
            throw ApiException::fromCode('import_sql_invalid', 422);
        }
        return $sql;
    }

    private function inspection(): array
    {
        return (new ImportInspection($this->database, $this->catalog))->inspect();
    }

    public static function token(string $database, string $sql, array $inspection): string
    {
        return hash('sha256', json_encode([$database, hash('sha256', $sql), $inspection],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    public function preview(string $sql): array
    {
        $sql = self::validate($sql);
        $parsed = SqlScript::preview($sql, Database::SQL_MODE);
        if ($parsed['statement_count'] === 0) throw ApiException::fromCode('import_sql_required', 422);
        $before = $this->inspection();
        return [
            'database' => $this->database->name(),
            'max_bytes' => self::MAX_BYTES,
            'bytes' => strlen($sql),
            'sha256' => hash('sha256', $sql),
            'statement_count' => $parsed['statement_count'],
            'destructive' => array_map(static fn (array $item): array => [
                'line' => $item['line'], 'reason' => $item['reason'],
                'sql' => substr($item['sql'], 0, 180),
            ], array_slice($parsed['destructive'], 0, 20)),
            'destructive_truncated' => count($parsed['destructive']) > 20,
            'before' => $before,
            'preview_token' => self::token($this->database->name(), $sql, $before),
        ];
    }

    public function execute(string $sql, string $previewToken, string $confirmation): array
    {
        $sql = self::validate($sql);
        if ($confirmation !== $this->database->name()) {
            throw ApiException::fromCode('import_confirm_database', 422);
        }
        if (!preg_match('/\A[a-f0-9]{64}\z/D', $previewToken)) {
            throw ApiException::fromCode('import_preview_invalid', 422);
        }
        // The caller holds the shared maintenance lock through both inspections
        // and execution. A separate phpMyAdmin session does not honor this lock.
        $before = $this->inspection();
        if (!hash_equals(self::token($this->database->name(), $sql, $before), $previewToken)) {
            throw ApiException::fromCode('import_preview_stale', 409);
        }
        $result = (new QueryRunner($this->database))->executeScript($sql, true);
        $after = $this->inspection();
        $failed = $result['failed'];
        return [
            'database' => $this->database->name(),
            'completed' => $failed === null && $result['executed'] > 0 && !$result['transaction_rolled_back'],
            'executed' => $result['executed'],
            'statement_count' => $result['statement_count'],
            'transaction_rolled_back' => $result['transaction_rolled_back'],
            'failed' => $failed === null ? null : [
                'index' => $failed['index'] ?? null,
                'detail' => substr((string) ($failed['detail'] ?? ''), 0, 500),
            ],
            'before' => $before,
            'after' => $after,
            'added_tables' => array_values(array_diff($after['tables'], $before['tables'])),
            'removed_tables' => array_values(array_diff($before['tables'], $after['tables'])),
            'added_views' => array_values(array_diff($after['views'], $before['views'])),
            'removed_views' => array_values(array_diff($before['views'], $after['views'])),
            'unchecked_rows' => array_values(array_unique(array_merge($before['unchecked_rows'], $after['unchecked_rows']))),
            // These checks compare observable database state. They do not prove
            // that the entire source file was logically consistent or reversible.
        ];
    }
}
