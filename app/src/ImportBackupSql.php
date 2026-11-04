<?php
declare(strict_types=1);
namespace Govern;

/** Supported plain exports. Database grants, not inspection, confine execution. */
final class ImportBackupSql
{
    public const MAX_BYTES = 262144;
    public const MAX_STATEMENTS = 4096;

    public static function inspect(string $sql): array
    {
        if (str_starts_with($sql, 'PGDMP')) return ['engine' => 'postgres', 'requires_engine' => false,
            'blocked' => true, 'blocked_code' => 'workflow_backup_unsupported', 'format' => 'postgres_custom'];
        self::text($sql);
        $pg = preg_match('/--\s*PostgreSQL|\bpg_catalog\b|\bstandard_conforming_strings\b|\bCREATE\s+SEQUENCE\b|\bCOPY\b[\s\S]*?\bFROM\s+stdin\b/i', $sql) === 1;
        $maria = preg_match('/--\s*(?:MariaDB|MySQL)|\bENGINE\s*=|\bAUTO_INCREMENT\b|\/\*!\d|\bDELIMITER\b|\bUNSIGNED\b|\bLOCK\s+TABLES\b/i', $sql) === 1;
        $engine = $pg === $maria ? null : ($pg ? 'postgres' : 'mariadb');
        return ['engine' => $engine, 'requires_engine' => $engine === null, 'blocked' => $pg && $maria,
            'blocked_code' => $pg && $maria ? 'workflow_backup_unsupported' : null, 'format' => 'plain_sql'];
    }

    public static function analyze(string $sql, string $engine): array
    {
        $sql = self::text($sql);
        if (!in_array($engine, ['mariadb', 'postgres'], true)) throw ApiException::fromCode('workflow_invalid', 422);
        $statements = $engine === 'postgres' ? PostgresSqlScript::split($sql) : SqlScript::split($sql, Database::SQL_MODE);
        if ($statements === [] || count($statements) > self::MAX_STATEMENTS) throw ApiException::fromCode('workflow_backup_unsupported', 422);
        $tables = [];
        foreach ($statements as $statement) {
            $clean = trim($statement['clean']);
            if (preg_match('/\A(?:USE\b|(?:CREATE|ALTER|DROP)\s+(?:DATABASE|SCHEMA|ROLE|USER|FUNCTION|PROCEDURE|TRIGGER|EVENT)\b|GRANT\b|REVOKE\b|LOAD\b|COPY\b|DO\b|CALL\b|EXECUTE\b|PREPARE\b)/i', $clean)) {
                throw ApiException::fromCode(preg_match('/\A(?:USE|(?:CREATE|ALTER|DROP)\s+DATABASE)\b/i', $clean)
                    ? 'workflow_backup_qualified' : 'workflow_backup_unsupported', 422);
            }
            if (!preg_match('/\A(?:CREATE\s+(?:(?:UNIQUE\s+)?INDEX|(?:OR\s+REPLACE\s+)?VIEW|TABLE|SEQUENCE)|ALTER\s+(?:TABLE|SEQUENCE)|DROP\s+(?:TABLE|VIEW|INDEX|SEQUENCE)|INSERT\b|REPLACE\b|UPDATE\b|DELETE\b|TRUNCATE\b|SET\b|LOCK\s+TABLES\b|UNLOCK\s+TABLES\b|START\s+TRANSACTION\b|BEGIN\b|COMMIT\b|ROLLBACK\b|SELECT\b)/i', $clean)) {
                throw ApiException::fromCode('workflow_backup_unsupported', 422);
            }
            if ($engine === 'mariadb' && preg_match('/(?:`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*)/', $clean)) {
                throw ApiException::fromCode('workflow_backup_qualified', 422);
            }
            if ($engine === 'postgres') {
                preg_match_all('/\b([A-Za-z_][A-Za-z0-9_$]*)\s*\./', $clean, $qualifiers);
                foreach ($qualifiers[1] as $qualifier) if (!in_array(strtolower($qualifier), ['public','pg_catalog'], true)) throw ApiException::fromCode('workflow_backup_qualified',422);
                preg_match_all('/"([^"\\r\\n]+)"\s*\./', $statement['sql'], $quoted);
                foreach ($quoted[1] as $qualifier) if (!in_array($qualifier, ['public','pg_catalog'], true)) throw ApiException::fromCode('workflow_backup_qualified',422);
            }
            if (preg_match('/\ASELECT\b/i', $clean)
                && ($engine !== 'postgres' || !preg_match('/\ASELECT\s+(?:pg_catalog\.)?(?:set_config|setval)\s*\(/i', $clean))) {
                throw ApiException::fromCode('workflow_backup_unsupported', 422);
            }
            if (preg_match('/\ASET\b/i', $clean) && preg_match('/\b(?:SELECT|EXECUTE|CALL|PREPARE)\b/i', $clean)) {
                throw ApiException::fromCode('workflow_backup_unsupported', 422);
            }
            if ($engine === 'mariadb' && SqlScript::changesSqlMode($clean)
                && SqlScript::literalSqlMode($statement['sql'], Database::SQL_MODE) === null) {
                throw ApiException::fromCode('workflow_backup_unsupported', 422);
            }
            if (preg_match('/\ACREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i', trim($statement['sql']), $match)) $tables[] = trim($match[1], '`"');
        }
        return ['statement_count' => count($statements), 'tables' => array_values(array_unique($tables)), 'rows' => null, 'format' => 'plain_sql'];
    }

    public static function text(string $sql): string
    {
        if (strlen($sql) > self::MAX_BYTES || trim($sql) === '' || str_contains($sql, "\0") || preg_match('//u', $sql) !== 1) throw ApiException::fromCode('workflow_backup_unsupported', 422);
        return str_starts_with($sql, "\xef\xbb\xbf") ? substr($sql, 3) : $sql;
    }
}
