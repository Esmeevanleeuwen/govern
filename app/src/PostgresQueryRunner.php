<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** PostgreSQL scripts run in one throwaway, non-administrative SQL session. */
final class PostgresQueryRunner
{
    public function __construct(private readonly Database $database) {}

    public function executeScript(string $sql, bool $confirm = false): array
    {
        $sql = trim($sql);
        if ($sql === '') throw ApiException::fromCode('sql_required');
        if (strlen($sql) > 262144) throw ApiException::fromCode('query_too_large', 413);
        if (str_contains($sql, "\0") || preg_match('//u', $sql) !== 1) throw ApiException::fromCode('postgres_sql_syntax', 422);
        $preview = PostgresSqlScript::preview($sql);
        if ($preview['statement_count'] === 0) throw ApiException::fromCode('sql_required');
        if (!$confirm && $preview['destructive'] !== []) return ['confirm_required' => true,
            'destructive' => $preview['destructive'], 'statement_count' => $preview['statement_count']];

        $pdo = $this->database->scriptConnection();
        $results = [];
        $failed = null;
        $offset = 0;
        $line = 1;
        $attempted = $executed = 0;
        $finished = $rolledBack = false;
        $standardStrings = true;
        $remaining = Preview::RESULT_BYTES * 4;
        $started = hrtime(true);
        try {
            while (true) {
                $beforeOffset = $offset;
                $statement = null;
                try {
                    $statement = PostgresSqlScript::next($sql, $offset, $standardStrings, $line);
                    if ($statement === null) { $finished = true; break; }
                    $attempted++;
                    $result = $this->runStatement($pdo, $statement['sql'], $remaining);
                    $results[] = $result;
                    $executed++;
                    // Even SELECT can call a function changing this setting.
                    // Read it from the session before lexing the next statement.
                    $setting = $pdo->query('SHOW standard_conforming_strings');
                    try { $standardStrings = $setting->fetchColumn() === 'on'; }
                    finally { $setting->closeCursor(); }
                } catch (PDOException $exception) {
                    $failed = ['index' => $attempted, 'sql' => $statement['sql'], 'detail' => $this->detail($exception)];
                    break;
                } catch (ApiException $exception) {
                    $failed = ['index' => $statement === null ? $attempted + 1 : $attempted,
                        'sql' => $statement['sql'] ?? trim(substr($sql, $beforeOffset)), 'detail' => $exception->getMessage()];
                    break;
                }
            }
        } finally {
            try {
                if ($pdo->inTransaction()) { $pdo->rollBack(); $rolledBack = true; }
            } catch (PDOException) { /* The submitted SQL may close its own connection. */ }
            $pdo = null;
        }
        return ['confirm_required' => false, 'statements' => $results, 'failed' => $failed,
            'statement_count' => $finished ? $attempted : $preview['statement_count'], 'executed' => $executed,
            'transaction_rolled_back' => $rolledBack, 'schema_refresh_needed' => $attempted > 0,
            'duration_ms' => round((hrtime(true) - $started) / 1e6, 2), 'sql' => $sql];
    }

    private function runStatement(PDO $pdo, string $sql, int &$remaining): array
    {
        $started = hrtime(true);
        // PDO_PGSQL converts FLOAT4/FLOAT8 text to PHP doubles even with
        // STRINGIFY_FETCHES. The default precision=14 would silently lose
        // significant digits when PDO converts them back to strings. -1 uses
        // the shortest round-trip representation of the same binary value.
        $previousPrecision = ini_set('precision', '-1');
        if ($previousPrecision === false) throw ApiException::fromCode('query_database_error', 503);
        $statement = null;
        try {
            $statement = $pdo->query($sql);
            $columns = [];
            $floatColumns = [];
            $booleanColumns = [];
            for ($index = 0; $index < $statement->columnCount(); $index++) {
                $metadata = $statement->getColumnMeta($index);
                $columns[] = $metadata['name'] ?? ('column_' . ($index + 1));
                // Native type names can be shadowed by user enums. Builtin
                // PostgreSQL type OIDs identify only actual floats/booleans.
                if (in_array((int) ($metadata['pgsql:oid'] ?? 0), [700, 701], true)) $floatColumns[] = $index;
                if ((int) ($metadata['pgsql:oid'] ?? 0) === 16) $booleanColumns[] = $index;
            }
            $rows = [];
            $bytes = 0;
            $shortened = false;
            while ($columns !== [] && ($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
                if (count($rows) >= QueryRunner::ROW_LIMIT) { $shortened = true; break; }
                // BYTEA is a resource on some versions and needs bounded reading.
                foreach ($row as &$value) if (is_resource($value)) {
                    $value = '0x' . bin2hex((string) stream_get_contents($value, intdiv(Preview::CELL_BYTES, 2) + 1));
                    if (strlen($value) > Preview::CELL_BYTES) $shortened = true;
                }
                unset($value);
                foreach ($floatColumns as $column) if (is_string($row[$column])) $row[$column] = match ($row[$column]) {
                    'INF' => 'Infinity', '-INF' => '-Infinity', 'NAN' => 'NaN', default => $row[$column],
                };
                // PDO's generic stringification may turn FALSE into empty text.
                // Keep boolean values distinct from an actual empty text field.
                foreach ($booleanColumns as $column) if ($row[$column] !== null) {
                    $row[$column] = in_array($row[$column], [true, 1, '1', 't', 'true'], true) ? 'true' : 'false';
                }
                $row = Preview::row($row, $shortened);
                $size = Preview::bytes($row);
                if ($bytes + $size > Preview::RESULT_BYTES || $size > $remaining) { $shortened = true; break; }
                $rows[] = $row;
                $bytes += $size;
                $remaining -= $size;
            }
            $set = ['columns' => $columns, 'rows' => $rows, 'truncated' => $shortened,
                'returned_rows' => count($rows), 'affected_rows' => $columns === [] ? $statement->rowCount() : null];
        } finally {
            try { $statement?->closeCursor(); }
            finally { ini_set('precision', $previousPrecision); }
        }
        return ['sql' => $sql, ...$set, 'result_sets' => [$set], 'completed' => true,
            // PostgreSQL NOTICE messages are not warnings exposed by PDO. Do not
            // fabricate an exact warning count from unavailable driver diagnostics.
            'warning_count' => 0, 'warnings' => [], 'notices_available' => false,
            'duration_ms' => round((hrtime(true) - $started) / 1e6, 2)];
    }

    private function detail(PDOException $exception): string
    {
        if ($exception->getCode() === '57014') return Messages::text('query_timeout');
        // A SQL error may include a complete data row or a supplied value. Keep
        // the first bounded diagnostic line, without DETAIL/CONTEXT record dumps.
        $detail = (string) ($exception->errorInfo[2] ?? Messages::text('query_database_error'));
        return substr(explode("\n", $detail, 2)[0], 0, 2000);
    }
}
