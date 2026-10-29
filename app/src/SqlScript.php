<?php
declare(strict_types=1);

namespace Govern;

/** Client-side boundaries, not a second SQL grammar or permission system. */
final class SqlScript
{
    /** @return array{sql:string,clean:string,line:int}|null */
    public static function next(string $sql, int &$offset, string &$delimiter, string $sqlMode = ''): ?array
    {
        self::validateDelimiter($delimiter);
        $length = strlen($sql);
        $offset = max(0, min($offset, $length));
        $start = $offset;
        $clean = '';
        $line = self::lineAt($sql, $offset);
        $statementLine = null;
        [$ansiQuotes, $noBackslashes] = self::quoteModes($sqlMode);
        for ($i = $offset; $i < $length;) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';
            // DELIMITER is a client command on its own line, outside SQL tokens.
            if ($statementLine === null && self::delimiterDirectiveAt($sql, $i)) {
                $end = $i + strcspn($sql, "\r\n", $i);
                $token = trim(substr($sql, $i + 9, $end - $i - 9));
                self::validateDelimiter($token);
                $delimiter = $token;
                if ($end < $length) {
                    $end += $sql[$end] === "\r" && ($sql[$end + 1] ?? '') === "\n" ? 2 : 1;
                    $line++;
                }
                $start = $i = $offset = $end;
                $clean = '';
                continue;
            }
            if (substr_compare($sql, $delimiter, $i, strlen($delimiter)) === 0) {
                $offset = $i + strlen($delimiter);
                if (trim($clean) !== '') return self::statement($sql, $start, $i, $clean, $statementLine ?? $line);
                $start = $i = $offset;
                $statementLine = null;
                $clean = '';
                continue;
            }
            if ($char === "'" || $char === '"' || $char === '`') {
                $statementLine ??= $line;
                $identifier = $char === '`' || ($char === '"' && $ansiQuotes);
                $end = self::quoteEnd($sql, $i, $char, !$identifier && !$noBackslashes);
                $raw = substr($sql, $i, $end - $i);
                $clean .= $identifier ? $raw : "''";
                $line += self::lineBreaks($raw);
                $i = $end;
                continue;
            }
            if ($char === '#' || ($char === '-' && $next === '-' && (!isset($sql[$i + 2]) || ord($sql[$i + 2]) <= 32))) {
                $end = $i + strcspn($sql, "\r\n", $i);
                $clean .= ' ';
                $i = $end;
                continue;
            }
            if ($char === '/' && $next === '*') {
                $close = strpos($sql, '*/', $i + 2);
                $end = $close === false ? $length : $close + 2;
                $raw = substr($sql, $i, $end - $i);
                $body = self::executableBody($raw);
                if ($body !== null) {
                    $bodyClean = self::fragmentClean($body, $ansiQuotes, $noBackslashes);
                    if (trim($bodyClean) !== '') $statementLine ??= $line;
                    $clean .= ' ' . $bodyClean . ' ';
                } else $clean .= ' ';
                $line += self::lineBreaks($raw);
                $i = $end;
                continue;
            }
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
        return trim($clean) !== '' ? self::statement($sql, $start, $length, $clean, $statementLine ?? $line) : null;
    }

    /** @return list<array{sql:string,clean:string,line:int}> */
    public static function split(string $sql, string $sqlMode = ''): array
    {
        $offset = 0;
        $delimiter = ';';
        $statements = [];
        while (($statement = self::next($sql, $offset, $delimiter, $sqlMode)) !== null) $statements[] = $statement;
        return $statements;
    }

    /**
     * Side-effect-free advice. Arbitrary SQL-mode expressions cannot be
     * evaluated here to predict future quoting or exact statement counts.
     * @return array{destructive:list<array{index:?int,line:int,sql:string,reason:string}>,statement_count:?int}
     */
    public static function preview(string $sql, string $initialMode = ''): array
    {
        $offset = 0;
        $delimiter = ';';
        $count = 0;
        $destructive = [];
        while (true) {
            $before = $offset;
            $statement = self::next($sql, $offset, $delimiter, $initialMode);
            if ($statement === null) break;
            $count++;
            $reason = self::destructiveReason($statement['clean']);
            if ($reason !== null) $destructive[] = ['index' => $count, 'line' => $statement['line'], 'sql' => $statement['sql'], 'reason' => $reason];
            if (self::mayChangeQuoting($statement['clean'])) {
                // Include PREPARE/SET itself: executable SQL may be a string.
                $tail = substr($sql, $before);
                if (preg_match('/\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i', $tail, $match, PREG_OFFSET_CAPTURE) === 1) {
                    $position = $before + $match[0][1];
                    $lineStart = $position;
                    while ($lineStart > 0 && $sql[$lineStart - 1] !== "\r" && $sql[$lineStart - 1] !== "\n") $lineStart--;
                    $lineEnd = $position + strcspn($sql, "\r\n", $position);
                    $destructive[] = ['index' => null, 'line' => self::lineAt($sql, $position),
                        'sql' => trim(substr($sql, $lineStart, $lineEnd - $lineStart)), 'reason' => 'dynamic'];
                }
                return ['destructive' => $destructive, 'statement_count' => null];
            }
        }
        return ['destructive' => $destructive, 'statement_count' => $count];
    }

    /** Advisory only: quoted identifiers and literals are not WHERE clauses. */
    public static function destructiveReason(string $clean): ?string
    {
        $words = self::words($clean);
        $first = $words[0] ?? '';
        return match (true) {
            $first === 'DROP' => 'drop',
            $first === 'TRUNCATE' => 'truncate',
            $first === 'DELETE' && !in_array('WHERE', $words, true) => 'delete_no_where',
            $first === 'UPDATE' && !in_array('WHERE', $words, true) => 'update_no_where',
            $first === 'ALTER' && in_array('DROP', $words, true) => 'alter_drop',
            default => null,
        };
    }

    /** Commands that may change the live client's quoting, not stored definitions. */
    public static function changesSqlMode(string $clean): bool
    {
        $head = preg_replace('/\A\s*[A-Za-z_][A-Za-z0-9_$]*\s*:\s*/', '', $clean, 1);
        $words = self::words($head);
        $first = $words[0] ?? '';
        if ($first === 'EXECUTE') return true;
        $compound = in_array($first, ['BEGIN', 'IF', 'CASE', 'WHILE', 'LOOP', 'REPEAT', 'FOR'], true);
        if ($first !== 'SET' && !$compound) return false;
        if ($compound && in_array('EXECUTE', $words, true)) return true;
        return in_array('SET', $words, true) && self::hasSqlModeAssignment($head);
    }

    /** Only a single ordinary literal assignment; never evaluate expressions. */
    public static function literalSqlMode(string $raw, string $currentMode): ?string
    {
        $pattern = '~\ASET\s+(?:(?:SESSION|LOCAL)\s+|@@\s*(?:(?:SESSION|LOCAL)\s*\.\s*)?)?'
            . '(?:SQL_MODE|`SQL_MODE`|"SQL_MODE")\s*=\s*([\'\"])([A-Z0-9_, ]*)\1\s*;?\s*\z~i';
        if (preg_match($pattern, trim($raw), $match) !== 1) return null;
        [$ansiQuotes] = self::quoteModes($currentMode);
        if ($match[1] === '"' && $ansiQuotes) return null;
        return strtoupper(trim($match[2]));
    }

    private static function validateDelimiter(string $delimiter): void
    {
        if ($delimiter === '' || strlen($delimiter) > 32 || preg_match('/[\x00-\x20\x7f]/', $delimiter) === 1
            || strpbrk($delimiter, "'\"`\\") !== false) throw ApiException::fromCode('sql_delimiter_invalid');
    }

    private static function delimiterDirectiveAt(string $sql, int $position): bool
    {
        if (strncasecmp(substr($sql, $position, 9), 'DELIMITER', 9) !== 0) return false;
        $after = $sql[$position + 9] ?? '';
        if ($after !== '' && ord($after) > 32) return false;
        for ($i = $position - 1; $i >= 0 && $sql[$i] !== "\r" && $sql[$i] !== "\n"; $i--) {
            if ($sql[$i] !== ' ' && $sql[$i] !== "\t") return false;
        }
        return true;
    }

    /** @return array{bool,bool} */
    private static function quoteModes(string $sqlMode): array
    {
        $modes = array_map('trim', explode(',', strtoupper($sqlMode)));
        // Literal assignments can use server aliases before normalization.
        $ansi = array_intersect(['ANSI_QUOTES', 'ANSI', 'DB2', 'MAXDB', 'MSSQL', 'ORACLE', 'POSTGRESQL'], $modes) !== [];
        return [$ansi, in_array('NO_BACKSLASH_ESCAPES', $modes, true)];
    }

    private static function quoteEnd(string $sql, int $start, string $quote, bool $backslashes): int
    {
        $length = strlen($sql);
        for ($i = $start + 1; $i < $length; $i++) {
            if ($sql[$i] === '\\' && $backslashes) $i++;
            elseif ($sql[$i] === $quote) {
                if (($sql[$i + 1] ?? '') === $quote) $i++;
                else return $i + 1;
            }
        }
        return $length;
    }

    private static function executableBody(string $comment): ?string
    {
        $prefix = str_starts_with($comment, '/*!') ? 3 : (str_starts_with($comment, '/*M!') ? 4 : null);
        if ($prefix === null) return null;
        $body = substr($comment, $prefix, str_ends_with($comment, '*/') ? -2 : null);
        return preg_replace('/\A[0-9]{5,6}(?![0-9])\s*/', '', ltrim($body));
    }

    private static function fragmentClean(string $sql, bool $ansiQuotes, bool $noBackslashes): string
    {
        $clean = '';
        for ($i = 0, $length = strlen($sql); $i < $length;) {
            $char = $sql[$i];
            if ($char === "'" || $char === '"' || $char === '`') {
                $identifier = $char === '`' || ($char === '"' && $ansiQuotes);
                $end = self::quoteEnd($sql, $i, $char, !$identifier && !$noBackslashes);
                $clean .= $identifier ? substr($sql, $i, $end - $i) : "''";
                $i = $end;
            } else {
                $clean .= $char;
                $i++;
            }
        }
        return $clean;
    }

    /** @return list<string> */
    private static function words(string $sql): array
    {
        $unquoted = '';
        for ($i = 0, $length = strlen($sql); $i < $length;) {
            $char = $sql[$i];
            if ($char === "'" || $char === '"' || $char === '`') {
                $i = self::quoteEnd($sql, $i, $char, $char === "'");
                $unquoted .= ' ';
            } else {
                $unquoted .= $char;
                $i++;
            }
        }
        return preg_split('/[^A-Za-z_]+/', strtoupper($unquoted), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    private static function mayChangeQuoting(string $clean): bool
    {
        $words = self::words($clean);
        // A compound statement can execute a SET or dynamic SQL internally.
        // This is conservative metadata, not an attempt to execute its grammar.
        if (in_array('PREPARE', $words, true) || in_array('EXECUTE', $words, true)) return true;
        if (!in_array('SET', $words, true)) return false;
        return self::hasSqlModeAssignment($clean);
    }

    private static function hasSqlModeAssignment(string $clean): bool
    {
        return preg_match('/(?:@@\s*(?:(?:SESSION|LOCAL)\s*\.\s*)?|(?<![@A-Za-z0-9_]))(?:SQL_MODE|`SQL_MODE`|"SQL_MODE")\s*=/i', $clean) === 1;
    }

    /** @return array{sql:string,clean:string,line:int} */
    private static function statement(string $sql, int $start, int $end, string $clean, int $line): array
    {
        return ['sql' => trim(substr($sql, $start, $end - $start)), 'clean' => trim(preg_replace('/\s+/', ' ', $clean)), 'line' => $line];
    }

    private static function lineAt(string $sql, int $position): int
    {
        return 1 + self::lineBreaks(substr($sql, 0, $position));
    }

    private static function lineBreaks(string $sql): int
    {
        return preg_match_all('/\r\n|\r|\n/', $sql);
    }
}
