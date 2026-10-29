<?php
declare(strict_types=1);

namespace Govern;

/** Splits SQL text into statements and flags statements that destroy data or structure. */
final class SqlScript
{
    /** @return list<array{sql: string, clean: string}> */
    public static function split(string $sql): array
    {
        $statements = [];
        $raw = '';
        $clean = '';
        $length = strlen($sql);
        $flush = static function () use (&$statements, &$raw, &$clean): void {
            if (trim($clean) !== '') {
                $statements[] = ['sql' => trim($raw), 'clean' => trim(preg_replace('/\s+/', ' ', $clean))];
            }
            $raw = '';
            $clean = '';
        };
        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';
            if ($char === ';') {
                $flush();
            } elseif ($char === "'" || $char === '"' || $char === '`') {
                $end = self::quoteEnd($sql, $i, $char);
                $raw .= substr($sql, $i, $end - $i);
                $clean .= $char === '`' ? substr($sql, $i, $end - $i) : "''";
                $i = $end - 1;
            } elseif ($char === '#' || ($char === '-' && $next === '-' && ($sql[$i + 2] ?? ' ') <= ' ')) {
                $end = strcspn($sql, "\n", $i);
                $raw .= substr($sql, $i, $end);
                $clean .= ' ';
                $i += $end - 1;
            } elseif ($char === '/' && $next === '*') {
                $close = strpos($sql, '*/', $i + 2);
                $end = $close === false ? $length : $close + 2;
                $raw .= substr($sql, $i, $end - $i);
                $clean .= ' ';
                $i = $end - 1;
            } else {
                $raw .= $char;
                $clean .= $char;
            }
        }
        $flush();
        return $statements;
    }

    /** Returns a reason key when the statement needs explicit confirmation. */
    public static function destructiveReason(string $clean): ?string
    {
        $words = preg_split('/[^A-Za-z_]+/', strtoupper($clean), -1, PREG_SPLIT_NO_EMPTY) ?: [];
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

    private static function quoteEnd(string $sql, int $start, string $quote): int
    {
        $length = strlen($sql);
        for ($i = $start + 1; $i < $length; $i++) {
            if ($sql[$i] === '\\' && $quote !== '`') {
                $i++;
            } elseif ($sql[$i] === $quote) {
                if (($sql[$i + 1] ?? '') === $quote) {
                    $i++;
                    continue;
                }
                return $i + 1;
            }
        }
        return $length;
    }
}
