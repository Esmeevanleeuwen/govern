<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

final class QueryRunner
{
    public const ROW_LIMIT = 200;

    public function __construct(private readonly Database $database) {}

    /**
     * Free SQL as in phpMyAdmin: several statements, any privilege the write
     * account has. Statements run in order on a throwaway session and stop at the
     * first error. Destructive statements need confirm=true first.
     */
    public function executeScript(string $sql, bool $confirm = false): array
    {
        $sql = trim($sql);
        if ($sql === '') {
            throw ApiException::fromCode('sql_required');
        }
        if (strlen($sql) > 262144) {
            throw ApiException::fromCode('query_too_large', 413);
        }
        $pdo = $this->database->scriptConnection();
        $mode = Database::SQL_MODE;
        $preview = SqlScript::preview($sql, $mode);
        if ($preview['statement_count'] === 0) throw ApiException::fromCode('sql_required');
        if ($preview['destructive'] !== [] && !$confirm) {
            return ['confirm_required' => true, 'destructive' => $preview['destructive'],
                'statement_count' => $preview['statement_count']];
        }
        $results = [];
        $failed = null;
        $offset = 0;
        $delimiter = ';';
        $attempted = $executed = 0;
        $finished = false;
        $rolledBack = false;
        // This bounds displayed data across the whole script, not rows affected in the database.
        $remainingBytes = Preview::RESULT_BYTES * 4;
        $started = hrtime(true);
        try {
            while (true) {
                try {
                    $statement = SqlScript::next($sql, $offset, $delimiter, $mode);
                    if ($statement === null) { $finished = true; break; }
                    $attempted++;
                    $result = $this->runStatement($pdo, $statement['sql'], $remainingBytes);
                    $exception = $result['_error'];
                    unset($result['_error']);
                    if ($result['result_sets'] !== []) $results[] = $result;
                    if ($exception !== null) {
                        $failed = $this->scriptFailure($exception, $attempted, $statement['sql']);
                        break;
                    }
                    $executed++;
                    if (trim(substr($sql, $offset)) === '') { $finished = true; break; }
                    // Ordinary user statements stay adjacent: hidden SELECT/SHOW
                    // queries would overwrite ROW_COUNT() and FOUND_ROWS().
                    $literalMode = SqlScript::literalSqlMode($statement['sql'], $mode);
                    if ($literalMode !== null) $mode = $literalMode;
                    elseif (SqlScript::changesSqlMode($statement['clean'])
                        && preg_match('/\A\s*EXECUTE\b/i', $statement['clean']) !== 1) $mode = $this->sessionMode($pdo);
                    $mode = $this->nativeEscapingMode($pdo, $mode);
                } catch (PDOException $exception) {
                    $failed = $this->scriptFailure($exception, $attempted + 1, substr($sql, $offset));
                    break;
                } catch (ApiException $exception) {
                    $failed = ['index' => $attempted + 1, 'sql' => substr($sql, $offset), 'detail' => $exception->getMessage()];
                    break;
                }
            }
        } finally {
            // Read diagnostic text only after the last user statement. Native
            // warning counts above do not disturb the next statement's state.
            if ($results !== [] && count($results) === $attempted) {
                $last = array_key_last($results);
                if ($results[$last]['warning_count'] > 0) $results[$last]['warnings'] = $this->warningMessages($pdo);
            }
            // Explicit SQL transactions share this one run. Never silently claim
            // that an unfinished transaction was committed when its session ends.
            try {
                if ($pdo->inTransaction()) { $pdo->rollBack(); $rolledBack = true; }
            } catch (PDOException) {
                // A submitted statement may have closed its own connection.
            }
            $pdo = null;
        }
        return ['confirm_required' => false, 'statements' => $results, 'failed' => $failed,
            'statement_count' => $finished ? $attempted : $preview['statement_count'], 'executed' => $executed,
            'transaction_rolled_back' => $rolledBack, 'schema_refresh_needed' => $attempted > 0,
            'duration_ms' => round((hrtime(true) - $started) / 1e6, 2), 'sql' => $sql];
    }

    private function sessionMode(PDO $pdo): string
    {
        $statement = $pdo->query('SELECT @@SESSION.sql_mode');
        try { return (string) $statement->fetchColumn(); }
        finally { $statement->closeCursor(); }
    }

    private function nativeEscapingMode(PDO $pdo, string $mode): string
    {
        $modes = array_filter(array_map('trim', explode(',', strtoupper($mode))),
            static fn (string $flag): bool => $flag !== 'NO_BACKSLASH_ESCAPES');
        // mysqlnd's native quoting follows the server status packet, without
        // another SQL query, even after EXECUTE changes escape behavior.
        if ($pdo->quote('\\') === "'\\'") $modes[] = 'NO_BACKSLASH_ESCAPES';
        return implode(',', $modes);
    }

    private function scriptFailure(PDOException $exception, int $index, string $sql): array
    {
        $driver = (int) ($exception->errorInfo[1] ?? 0);
        $message = in_array($driver, [1205, 1317, 1969, 3024], true)
            ? Messages::text('query_timeout')
            : (string) ($exception->errorInfo[2] ?? Messages::text('query_database_error'));
        return ['index' => $index, 'sql' => $sql, 'detail' => substr($message, 0, 2000)];
    }

    private function resultSet(\PDOStatement $statement, int &$remainingBytes): array
    {
        $columns = [];
        $rows = [];
        $shortened = false;
        for ($index = 0; $index < $statement->columnCount(); $index++) {
            $metadata = $statement->getColumnMeta($index);
            $columns[] = $metadata['name'] ?? ('kolom_' . ($index + 1));
        }
        $bytes = 0;
        while ($columns !== [] && ($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
            if (count($rows) >= self::ROW_LIMIT) { $shortened = true; break; }
            $row = Preview::row($row, $shortened);
            $size = Preview::bytes($row);
            if ($bytes + $size > Preview::RESULT_BYTES || $size > $remainingBytes) { $shortened = true; break; }
            $rows[] = $row;
            $bytes += $size;
            $remainingBytes -= $size;
        }
        return ['columns' => $columns, 'rows' => $rows, 'truncated' => $shortened,
            'returned_rows' => count($rows), 'affected_rows' => $columns === [] ? $statement->rowCount() : null];
    }

    private function runStatement(PDO $pdo, string $sql, int &$remainingBytes): array
    {
        $started = hrtime(true);
        $statement = null;
        $sets = [];
        $failure = null;
        try {
            $statement = $pdo->query($sql);
            do { $sets[] = $this->resultSet($statement, $remainingBytes); }
            while ($statement->nextRowset());
        } catch (PDOException $exception) {
            $failure = $exception;
        } finally {
            if ($statement !== null) {
                try { $statement->closeCursor(); }
                catch (PDOException $exception) { $failure ??= $exception; }
            }
        }
        $warningCount = $pdo instanceof \Pdo\Mysql ? $pdo->getWarningCount() : 0;
        $first = $sets[0] ?? ['columns' => [], 'rows' => [], 'truncated' => false, 'returned_rows' => 0, 'affected_rows' => null];
        return ['sql' => $sql, ...$first, 'result_sets' => $sets, 'completed' => $failure === null,
            'warning_count' => $warningCount, 'warnings' => [], '_error' => $failure,
            'duration_ms' => round((hrtime(true) - $started) / 1e6, 2)];
    }

    private function warningMessages(PDO $pdo): array
    {
        try {
            $statement = $pdo->query('SHOW WARNINGS LIMIT 20');
            try {
                $warnings = array_map(static fn (array $row): array => ['level' => (string) $row[0],
                    'code' => (int) $row[1], 'message' => substr((string) $row[2], 0, 2000)], $statement->fetchAll(PDO::FETCH_NUM));
            } finally { $statement->closeCursor(); }
            return $warnings;
        } catch (PDOException) {
            return [];
        }
    }

    public function execute(string $sql, array $parameters = []): array
    {
        $sql = trim($sql);
        if ($sql === '') {
            throw ApiException::fromCode('sql_required');
        }
        if (strlen($sql) > 262144) {
            throw ApiException::fromCode('query_too_large', 413);
        }
        $pdo = $this->database->reader();
        // Database grants and a READ ONLY transaction enforce the read boundary;
        // text matching cannot establish whether arbitrary SQL has side effects.
        $pdo->exec('SET SESSION sql_select_limit = ' . (self::ROW_LIMIT + 1));
        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $started = hrtime(true);
        $statement = null;
        try {
            $pdo->exec('START TRANSACTION READ ONLY');
            $statement = $pdo->prepare($sql);
            foreach ($parameters as $name => $value) {
                $type = $value === null ? PDO::PARAM_NULL : (is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
                $statement->bindValue(':' . $name, $value, $type);
            }
            $statement->execute();
            $columns = [];
            for ($index = 0; $index < $statement->columnCount(); $index++) {
                $metadata = $statement->getColumnMeta($index);
                $columns[] = $metadata['name'] ?? ('kolom_' . ($index + 1));
            }
            $rows = [];
            $shortened = false;
            $bytes = 0;
            while ($row = $statement->fetch(PDO::FETCH_NUM)) {
                if (count($rows) >= self::ROW_LIMIT) {
                    $shortened = true;
                    break;
                }
                $row = Preview::row($row, $shortened);
                $rows[] = $row;
                $bytes += Preview::bytes($row);
                if ($bytes > Preview::RESULT_BYTES) {
                    $shortened = true;
                    break;
                }
            }
            $statement->closeCursor();
            return ['columns' => $columns, 'rows' => $rows, 'truncated' => $shortened,
                'duration_ms' => round((hrtime(true) - $started) / 1e6, 2),
                'returned_rows' => count($rows), 'sql' => $sql,
                'notice' => $shortened ? Messages::text('query_shortened') : null,
                'notice_i18n' => $shortened ? Messages::translations('query_shortened') : null];
        } catch (PDOException $exception) {
            $driver = (int) ($exception->errorInfo[1] ?? 0);
            if (in_array($driver, [1044, 1142, 1143, 1227, 1370, 1792], true)) {
                throw ApiException::fromCode('query_read_only', 403);
            }
            if (in_array($driver, [1205, 1317, 1969, 3024], true)) {
                throw ApiException::fromCode('query_timeout', 408);
            }
            $message = (string) ($exception->errorInfo[2] ?? Messages::text('query_database_error'));
            // Driver diagnostics are preserved exactly, apart from the existing display bound.
            throw ApiException::fromCode('sql_error', 422, ['detail' => substr($message, 0, 2000)]);
        } finally {
            if ($statement !== null) {
                try {
                    $statement->closeCursor();
                } catch (PDOException) {
                    // Preserve the original timeout or syntax error.
                }
            }
            try {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
            } catch (PDOException) {
                // The connection can already be closed by the submitted SQL.
                // It is discarded below and never reused for another request.
            }
            $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
            $this->database->discardReader();
        }
    }
}
