<?php
declare(strict_types=1);

/** Schema-only AI context against an explicitly confirmed disposable database. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\AiConfig;
use Govern\AiContext;
use Govern\AiService;
use Govern\ApiException;
use Govern\Config;
use Govern\Database;
use Govern\DatabaseScope;

$config = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
if (($options['confirm-database'] ?? '') !== $config['name']) {
    fwrite(STDERR, "Use a disposable database and confirm its exact name with --confirm-database.\n");
    exit(2);
}
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$reject = static function (callable $action, string $message) use ($assert): void {
    try { $action(); }
    catch (ApiException $error) {
        $assert(in_array($error->status, [400, 404, 413, 422], true), $message . ' (status ' . $error->status . ')');
        return;
    }
    throw new RuntimeException($message);
};
$encode = static fn (mixed $value): string => json_encode($value,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$database = new Database($config);
$pdo = $database->writer();
$context = new AiContext($database);
$suffix = bin2hex(random_bytes(6));
$parent = 'zz_govern_ai_' . $suffix;
$child = $parent . '_child';
$wide = $parent . '_wide';
$foreignKey = $parent . '_fk';
$rowSecret = 'ROW_PRIVATE_' . $suffix;
$clientSecret = 'CLIENT_PRIVATE_' . $suffix;
$defaultSecret = 'DEFAULT_PRIVATE_' . $suffix;
$expressionSecret = 'EXPRESSION_PRIVATE_' . $suffix;
$quote = Database::identifier(...);

try {
    $pdo->exec('CREATE TABLE ' . $quote($parent) . ' (`id` BIGINT UNSIGNED PRIMARY KEY, `name` VARCHAR(80)) ENGINE=InnoDB');
    $pdo->exec('CREATE TABLE ' . $quote($child) . " (
        `0` BIGINT UNSIGNED PRIMARY KEY,
        `parent_id` BIGINT UNSIGNED NOT NULL,
        `secret` VARCHAR(80),
        `default_text` VARCHAR(80) DEFAULT '" . $defaultSecret . "',
        `generated_text` VARCHAR(160) GENERATED ALWAYS AS (CONCAT('" . $expressionSecret . "', `secret`)) STORED,
        CONSTRAINT " . $quote($foreignKey) . ' FOREIGN KEY (`parent_id`) REFERENCES ' . $quote($parent) . ' (`id`)
    ) ENGINE=InnoDB COMMENT=\'AI source café\'');
    $insert = $pdo->prepare('INSERT INTO ' . $quote($parent) . ' VALUES (?, ?)');
    $insert->execute(['9007199254740993', $rowSecret]);
    $insert = $pdo->prepare('INSERT INTO ' . $quote($child) . ' (`0`, `parent_id`, `secret`) VALUES (?, ?, ?)');
    $insert->execute(['9007199254740994', '9007199254740993', $rowSecret]);

    $preview = $context->build(['route' => 'gegevens', 'database' => 'a different database',
        'targets' => [['kind' => 'row', 'table' => $child, 'label' => $clientSecret,
            'record' => ['secret' => $clientSecret], 'key' => ['0' => $clientSecret], 'value' => $clientSecret]],
        'rows' => [['secret' => $clientSecret]], 'password' => $clientSecret,
        'sql' => 'SELECT ' . $clientSecret, 'saved_queries' => [['notes' => $clientSecret]]]);
    $json = $encode($preview);
    $assert($preview['database'] === $config['name'], 'The server connection fixes the context database.');
    $assert($preview['records_included'] === false, 'The context truthfully reports that it contains no table records.');
    $assert(is_array($preview['sources']) && count($preview['sources']) >= 1, 'A selected live table becomes a context source.');
    $assert(str_contains($json, $child) && str_contains($json, 'parent_id'), 'The context includes actual selected table and column identifiers.');
    $assert(str_contains($json, $foreignKey) && str_contains($json, $parent), 'The real foreign-key connection is retained.');
    $assert(str_contains($json, '"0"'), 'A numeric column name survives as an exact identifier.');
    $assert(!str_contains($json, $rowSecret), 'Stored record values are never read into schema context.');
    $assert(!str_contains($json, $clientSecret), 'Client-supplied row labels, values, keys and unrelated fields cannot smuggle records into context.');
    $assert(!str_contains($json, $defaultSecret) && !str_contains($json, $expressionSecret), 'Default literals and generated expressions are excluded.');
    $assert(!str_contains($json, 'CREATE TABLE') && !str_contains($json, 'saved_queries'), 'Raw DDL and saved SQL are not context sources.');
    $assert(is_string($preview['context_id']) && $preview['context_id'] !== '', 'The response identifies the exact context snapshot.');

    $column = $context->build(['route' => 'structuur', 'targets' => [['kind' => 'column', 'table' => $child, 'column' => '0']]]);
    $assert($column['targets'][0]['column'] === '0', 'A numeric selected column is validated against live metadata.');
    $assert($column['targets'][0]['table'] === $child, 'The selected column keeps its table context.');
    $ui = $context->build(['route' => 'instellingen', 'targets' => [['kind' => 'control', 'label' => 'Taal kiezen', 'tag' => 'select',
        'value' => $clientSecret, 'record' => [$clientSecret]]]]);
    $uiJson = $encode($ui);
    $assert($ui['sources'] === [], 'A UI control does not implicitly send the entire database schema.');
    $assert(str_contains($uiJson, 'Taal kiezen') && str_contains($uiJson, 'select'), 'A UI target retains its visible label and HTML tag.');
    $assert(!str_contains($uiJson, $clientSecret), 'A UI control value is not included with its label.');
    $empty = $context->build(['route' => 'overzicht', 'targets' => []]);
    $assert($empty['sources'] === [] && $empty['targets'] === [], 'An empty selection remains an explicit empty context.');

    $reject(static fn () => $context->build(['targets' => [['kind' => 'table', 'table' => $parent . '_missing']]]),
        'An unknown table is rejected instead of inventing metadata.');
    $reject(static fn () => $context->build(['targets' => [['kind' => 'column', 'table' => $child, 'column' => 'missing_column']]]),
        'An unknown column is rejected instead of inventing metadata.');
    $reject(static fn () => $context->build(['targets' => [['kind' => 'cell', 'table' => $child]]]),
        'A cell target requires a validated column.');
    $reject(static fn () => $context->build(['targets' => [['kind' => 'unknown', 'table' => $child]]]),
        'Unknown target kinds are rejected.');
    $reject(static fn () => $context->build(['targets' => array_fill(0, 9, ['kind' => 'table', 'table' => $child])]),
        'Excessive target counts are bounded.');
    $reject(static fn () => $context->build(['route' => 'not-a-route', 'targets' => []]),
        'Only supported workspace routes can be described.');

    $definitions = [];
    for ($i = 0; $i < 50; $i++) $definitions[] = $quote('column_' . $i) . " INT COMMENT '" . str_repeat('metadata ', 110) . "'";
    $pdo->exec('CREATE TABLE ' . $quote($wide) . ' (' . implode(', ', $definitions) . ') ENGINE=InnoDB');
    $bounded = $context->build(['targets' => [['kind' => 'table', 'table' => $wide]]]);
    $assert($bounded['truncated'] === true, 'A large live schema explicitly reports omitted context.');
    $assert(strlen($encode($bounded)) <= AiContext::MAX_BYTES, 'The live context remains bounded for the small local model.');
    $assert(preg_match('//u', $encode($bounded)) === 1, 'Bounded context remains valid UTF-8 JSON.');

    $pdo->exec('ALTER TABLE ' . $quote($child) . ' ADD `added_later` INT');
    $updated = $context->build(['targets' => [['kind' => 'table', 'table' => $child]]]);
    $assert(str_contains($encode($updated), 'added_later'), 'A later request rereads changed live metadata.');
    $assert($updated['context_id'] !== $preview['context_id'], 'A changed schema or selection produces a different context snapshot.');

    $second = getenv('GOVERN_TEST_SECOND_DATABASE') ?: '';
    if ($second !== '' && $second !== $config['name']) {
        $secondConfig = (new DatabaseScope($config))->select($second);
        $otherContext = new AiContext(new Database($secondConfig));
        $reject(static fn () => $otherContext->build(['targets' => [['kind' => 'table', 'table' => $child]]]),
            'A table from the first database is not silently described in a different database.');
        $assert($otherContext->build(['targets' => []])['database'] === $second,
            'An independent context builder keeps its explicit second database.');
    }

    $disabledConfig = AiConfig::validate(['enabled' => false, 'base_url' => 'http://127.0.0.1:1',
        'model' => 'qwen3:4b-instruct', 'timeout_seconds' => 5]);
    $service = new AiService($database, $disabledConfig);
    $status = $service->status();
    $assert($status['status'] === 'disabled' && $status['ready'] === false, 'Disabled AI remains usable without contacting an inference server.');
    $assert($status['capabilities']['records'] === false && $status['capabilities']['execution'] === false,
        'The service does not advertise row access or SQL execution.');
    $assert($service->previewContext(['targets' => [['kind' => 'table', 'table' => $child]]])['database'] === $config['name'],
        'Schema preview is available before a model is connected.');
    $assert($pdo->query('SELECT `secret` FROM ' . $quote($child))->fetchColumn() === $rowSecret,
        'Building AI context never changes stored records.');
} finally {
    $pdo->exec('DROP TABLE IF EXISTS ' . $quote($wide));
    $pdo->exec('DROP TABLE IF EXISTS ' . $quote($child));
    $pdo->exec('DROP TABLE IF EXISTS ' . $quote($parent));
}

echo 'AI schema context integration checks: ' . $passed . " passed.\n";
