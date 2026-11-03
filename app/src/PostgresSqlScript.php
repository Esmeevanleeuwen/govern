<?php
declare(strict_types=1);

namespace Govern;

/** PostgreSQL client boundaries and confirmation advice, never an SQL permission layer. */
final class PostgresSqlScript
{
    /** @return array{sql:string,clean:string,line:int}|null */
    public static function next(string $sql, int &$offset, bool $standardStrings = true, ?int &$line = null): ?array
    {
        $length = strlen($sql);
        $offset = max(0, min($offset, $length));
        $line ??= self::lineAt($sql, $offset);
        $start = $offset;
        $clean = '';
        $statementLine = null;
        for ($i = $offset; $i < $length;) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';
            if ($char === ';') {
                $offset = $i + 1;
                if (trim($clean) !== '') return self::statement($sql, $start, $i, $clean, $statementLine ?? $line);
                $start = $i = $offset;
                $clean = '';
                $statementLine = null;
                continue;
            }
            if ($char === '-' && $next === '-') {
                $i += strcspn($sql, "\r\n", $i);
                $clean .= ' ';
                continue;
            }
            if ($char === '/' && $next === '*') {
                $begin = $i;
                $i += 2;
                $depth = 1;
                while ($i < $length && $depth > 0) {
                    if (substr_compare($sql, '/*', $i, 2) === 0) { $depth++; $i += 2; }
                    elseif (substr_compare($sql, '*/', $i, 2) === 0) { $depth--; $i += 2; }
                    else $i++;
                }
                if ($depth !== 0) throw ApiException::fromCode('postgres_sql_syntax', 422);
                $line += self::lineBreaks(substr($sql, $begin, $i - $begin));
                $clean .= ' ';
                continue;
            }
            if ($char === "'" || $char === '"') {
                $statementLine ??= $line;
                $escapePrefix = $char === "'" && $i > 0 && ($sql[$i - 1] === 'E' || $sql[$i - 1] === 'e')
                    && ($i < 2 || !self::identifierByte($sql[$i - 2]));
                $end = self::quoteEnd($sql, $i, $char, $char === "'" && ($escapePrefix || !$standardStrings));
                $line += self::lineBreaks(substr($sql, $i, $end - $i));
                $clean .= $char === '"' ? '""' : "''";
                $i = $end;
                continue;
            }
            if ($char === '$' && ($i === 0 || !self::identifierByte($sql[$i - 1]))
                && preg_match('/\G\$(?:[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)?\$/', $sql, $match, 0, $i) === 1) {
                $statementLine ??= $line;
                $end = strpos($sql, $match[0], $i + strlen($match[0]));
                if ($end === false) throw ApiException::fromCode('postgres_sql_syntax', 422);
                $end += strlen($match[0]);
                $line += self::lineBreaks(substr($sql, $i, $end - $i));
                $clean .= "''";
                $i = $end;
                continue;
            }
            if ($char === '\\') throw ApiException::fromCode('postgres_sql_client_command', 422);
            if ($char === "\r" || $char === "\n") {
                $line++;
                if ($char === "\r" && $next === "\n") $i++;
                $clean .= ' ';
            } else {
                if (ord($char) > 32) $statementLine ??= $line;
                $clean .= $char;
            }
            $i++;
        }
        $offset = $length;
        return trim($clean) === '' ? null : self::statement($sql, $start, $length, $clean, $statementLine ?? $line);
    }

    /** @return list<array{sql:string,clean:string,line:int}> */
    public static function split(string $sql, bool $standardStrings = true): array
    {
        $offset = 0;
        $line = 1;
        $statements = [];
        while (($statement = self::next($sql, $offset, $standardStrings, $line)) !== null) $statements[] = $statement;
        return $statements;
    }

    /** A preview never executes SQL or assumes it can evaluate dynamic settings. */
    public static function preview(string $sql, bool $standardStrings = true): array
    {
        $offset = 0;
        $line = 1;
        $count = 0;
        $destructive = [];
        while (($statement = self::next($sql, $offset, $standardStrings, $line)) !== null) {
            $count++;
            $reason = self::destructiveReason($statement['clean']);
            if ($reason !== null) $destructive[] = ['index' => $count, 'line' => $statement['line'],
                'sql' => $statement['sql'], 'reason' => $reason];
            if (self::mayChangeStrings($statement)) {
                // A subsequent lexer must use the actual server setting. Dynamic
                // SQL is not evaluated just to calculate a confirmation preview.
                $tail = substr($sql, $offset);
                if (preg_match('/\b(?:DROP|TRUNCATE|DELETE|UPDATE|DO|CALL|EXECUTE)\b/i', $tail) === 1) {
                    $destructive[] = ['index' => null, 'line' => $line, 'sql' => trim($tail), 'reason' => 'dynamic'];
                }
                return ['destructive' => $destructive, 'statement_count' => null];
            }
        }
        return ['destructive' => $destructive, 'statement_count' => $count];
    }

    public static function destructiveReason(string $clean): ?string
    {
        preg_match_all('/[A-Za-z_][A-Za-z0-9_$]*|[()]/', $clean, $matches);
        $tokens = array_map('strtoupper', $matches[0]);
        $words = array_values(array_filter($tokens, static fn (string $word): bool => $word !== '(' && $word !== ')'));
        $first = $words[0] ?? '';
        if ($first === 'DROP') return 'drop';
        if ($first === 'TRUNCATE') return 'truncate';
        if ($first === 'ALTER' && in_array('DROP', $words, true)) return 'alter_drop';
        if (in_array($first, ['DO', 'CALL', 'EXECUTE'], true)) return 'dynamic';
        if (in_array($first, ['WITH', 'EXPLAIN', 'MERGE'], true)
            && array_intersect($words, ['DELETE', 'UPDATE', 'DROP', 'TRUNCATE']) !== []) return 'dynamic';
        if (in_array($first, ['DELETE', 'UPDATE'], true)) {
            $depth = 0;
            foreach ($tokens as $token) {
                if ($token === '(') $depth++;
                elseif ($token === ')') $depth--;
                elseif ($token === 'WHERE' && $depth === 0) return null;
            }
            return $first === 'DELETE' ? 'delete_no_where' : 'update_no_where';
        }
        return null;
    }

    public static function mayChangeStrings(array $statement): bool
    {
        return preg_match('/\b(?:standard_conforming_strings|set_config)\b/i', $statement['sql']) === 1
            || preg_match('/\A\s*(?:RESET\s+ALL|DISCARD\s+ALL|DO\b|CALL\b|EXECUTE\b)/i', $statement['clean']) === 1;
    }

    private static function statement(string $sql, int $start, int $end, string $clean, int $line): array
    {
        $clean = trim($clean);
        if (preg_match('/\ACOPY\b[\s\S]*\b(?:STDIN|STDOUT)\b/i', $clean) === 1)
            throw ApiException::fromCode('postgres_sql_copy_unsupported', 422);
        return ['sql' => trim(substr($sql, $start, $end - $start)), 'clean' => $clean, 'line' => $line];
    }

    private static function quoteEnd(string $sql, int $start, string $quote, bool $backslash): int
    {
        $length = strlen($sql);
        for ($i = $start + 1; $i < $length; $i++) {
            if ($backslash && $sql[$i] === '\\') { $i++; continue; }
            if ($sql[$i] !== $quote) continue;
            if (($sql[$i + 1] ?? '') === $quote) { $i++; continue; }
            return $i + 1;
        }
        throw ApiException::fromCode('postgres_sql_syntax', 422);
    }

    private static function identifierByte(string $char): bool
    {
        return ctype_alnum($char) || $char === '_' || $char === '$' || ord($char) >= 128;
    }

    private static function lineAt(string $sql, int $offset): int { return 1 + self::lineBreaks(substr($sql, 0, $offset)); }
    private static function lineBreaks(string $text): int { return substr_count($text, "\n") + preg_match_all('/\r(?!\n)/', $text); }
}
