<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\ApiException;
use Govern\DatasetMapping;

$checks = 0;
$assert = static function (bool $ok) use (&$checks): void { ++$checks; if (!$ok) throw new RuntimeException('Dataset mapping assertion failed'); };
$parsed = ['sha256' => str_repeat('a', 64), 'datasets' => [['columns' => [['name' => 'postal'], ['name' => 'name'], ['name' => 'note']],
    'rows' => [['00123', 'Zoë', ''], ['00234', '', null]], 'count' => 2]]];
$map = [['source' => 'note', 'target' => null, 'empty_as_null' => false],
    ['source' => 'name', 'target' => 'full_name', 'empty_as_null' => true],
    ['source' => 'postal', 'target' => 'postal_code', 'empty_as_null' => false]];
$plan = ['dataset' => 0, 'table' => 'contacts', 'mode' => 'create', 'mapping' => $map];
$normalized = DatasetMapping::normalize($parsed, [$plan]);
$assert($normalized[0]['mapping'] === $map);
$assert($parsed['datasets'][0]['rows'][0][0] === '00123');
$assert(DatasetMapping::normalize($parsed, [['dataset' => 0, 'table' => 'contacts']])[0]['mapping'][0]['target'] === 'postal');
$append = [...$plan, 'mode' => 'append', 'table' => 'A quoted table', 'version' => str_repeat('b', 64)];
$assert(DatasetMapping::normalize($parsed, [$append])[0]['table'] === 'A quoted table');
$reject = static function (array $tables, ?array $input = null) use ($parsed, $assert): void {
    try { DatasetMapping::normalize($input ?? $parsed, $tables); $assert(false); }
    catch (ApiException $error) { $assert($error->errorCode === 'dataset_mapping_invalid'); }
};
$reject([[...$plan, 'mapping' => array_slice($map, 0, 2)]]); // Silent column omission.
$reject([[...$plan, 'mapping' => [$map[0], $map[1], $map[1]]]]); // Repeated source.
$reject([[...$plan, 'mapping' => [$map[0], $map[1], [...$map[2], 'target' => 'full_name']]]]);
$reject([[...$plan, 'mapping' => array_map(static fn ($m) => [...$m, 'target' => null], $map)]]);
$reject([[...$plan, 'table' => 'contacts;DROP TABLE x']]);
$reject([[...$plan, 'mapping' => [$map[0], $map[1], [...$map[2], 'target' => '_govern_id']]]]);
$reject([[...$append, 'version' => 'stale']]);
$reject([$plan, $plan]);
$reject([[...$plan, 'replace' => true]]);
$bad = $parsed;
$bad['datasets'][0]['rows'][1][2] = "bad\0value";
$reject([$plan], $bad); // Validation includes later/skipped values, not only the preview.
echo "Dataset mapping unit checks: $checks passed.\n";
