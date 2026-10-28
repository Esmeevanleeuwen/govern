<?php
declare(strict_types=1);

namespace Govern;

/** Display limits affect previews only. Original values remain in the database. */
final class Preview
{
    public const CELL_BYTES = 32768;
    public const RESULT_BYTES = 2097152;

    public static function row(array $row, bool &$shortened): array
    {
        foreach ($row as $key => $value) {
            if (!is_string($value)) {
                continue;
            }
            if (preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
                $value = '0x' . bin2hex(substr($value, 0, intdiv(self::CELL_BYTES, 2)));
                if (strlen($row[$key]) > intdiv(self::CELL_BYTES, 2)) {
                    $value .= Messages::text('preview_binary_shortened');
                    $shortened = true;
                }
            } elseif (strlen($value) > self::CELL_BYTES) {
                $value = substr($value, 0, self::CELL_BYTES);
                while ($value !== '' && preg_match('//u', $value) !== 1) {
                    $value = substr($value, 0, -1);
                }
                $value .= Messages::text('preview_shortened');
                $shortened = true;
            }
            $row[$key] = $value;
        }
        return $row;
    }

    public static function bytes(array $row): int
    {
        return array_sum(array_map(static fn ($value): int => is_string($value) ? strlen($value) : 16, $row));
    }
}
