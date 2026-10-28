<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

final class QueryRunner
{
    public const ROW_LIMIT = 200;

    public function __construct(private readonly Database $database) {}

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
