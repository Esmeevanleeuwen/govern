<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/src/bootstrap.php';

use Govern\AiContext;
use Govern\LocalCodeSearch;

$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message);
    $passed++;
};
$root = sys_get_temp_dir() . '/govern-code-search-' . bin2hex(random_bytes(8));
$outside = $root . '-outside';
$write = static function (string $relative, string $content) use ($root): void {
    $path = $root . '/' . $relative;
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0700, true);
    file_put_contents($path, $content);
};
$remove = static function (string $path) use (&$remove): void {
    if (is_link($path) || is_file($path)) { unlink($path); return; }
    if (!is_dir($path)) return;
    foreach (new DirectoryIterator($path) as $entry) if (!$entry->isDot()) $remove($entry->getPathname());
    rmdir($path);
};

try {
    mkdir($root, 0700);
    mkdir($outside, 0700);
    $search = new LocalCodeSearch($root);
    $assert($search->status()['status'] === 'unavailable', 'Missing approved roots are unavailable.');
    $write('app/src/DatabaseScope.php', "<?php\nnamespace Govern;\n/** A database selection scope. */\nfinal class DatabaseScope\n{\n    public function select(string \$database): string\n    {\n        return \$database;\n    }\n}\n");
    $write('app/public/assets/app.js', "const cached = new Map();\n// Keep each database draft while switching.\nasync function switchDatabase(database) {\n    cached.set(database, 'draft');\n    return database;\n}\n");
    $write('docs/guide.md', "# Guide\nSwitching databases keeps the current draft.\nChoose another database from the menu.\n");
    $assert($search->status()['status'] === 'ready' && $search->status()['roots'] === ['app', 'docs'], 'Only app and docs are approved.');
    $assert($search->search('')['sources'] === [] && $search->search('')['files_scanned'] === 0, 'Empty previews describe availability without scanning.');
    $english = $search->search('How does switching databases work?');
    $paths = array_column($english['sources'], 'path');
    $assert(in_array('app/src/DatabaseScope.php', $paths, true), 'English switching question finds DatabaseScope.');
    $assert(in_array('app/public/assets/app.js', $paths, true), 'English switching question finds switchDatabase.');
    $assert(count($english['sources']) <= 3 && $english['files_scanned'] === 3, 'Search returns bounded passages and real scanned file count.');
    $assert($english === $search->search('How does switching databases work?'), 'Identical local state yields deterministic source identities.');
    foreach ($english['sources'] as $index => $source) {
        $lines = preg_split('/\r\n|\n|\r/', file_get_contents($root . '/' . $source['path']));
        $actual = implode("\n", array_slice($lines, $source['start_line'] - 1, $source['end_line'] - $source['start_line'] + 1));
        $assert($source['content'] === $actual, 'Every snippet contains exact complete original lines.');
        $assert($source['id'] === 'S' . ($index + 1) && preg_match('/^[a-f0-9]{64}$/D', $source['sha256']) === 1,
            'Each bounded source has a snapshot digest and stable local identifier.');
    }
    $dutch = $search->search('Hoe werkt het wisselen van databases?');
    $assert(array_column($dutch['sources'], 'path') === $paths, 'Dutch and English switching questions share the same relevant sources.');
    $assert($search->search('astronaut flamingo quasars')['sources'] === [], 'Unrelated terms do not invent local evidence.');
    $assert($search->search("\xff")['sources'] === [] && $search->search("database\0")['sources'] === [], 'Malformed text does not become search input.');
    $assert($search->search(str_repeat('x', 4001))['sources'] === [], 'Oversized questions are bounded before scanning.');
    $write('app/src/DatabaseScope.php', "<?php\nfinal class DatabaseScope\n{\n    // UPDATED database selection\n}\n");
    $changed = $search->search('switching databases');
    $old = array_values(array_filter($english['sources'], static fn (array $source): bool => $source['path'] === 'app/src/DatabaseScope.php'))[0];
    $new = array_values(array_filter($changed['sources'], static fn (array $source): bool => $source['path'] === 'app/src/DatabaseScope.php'))[0];
    $assert($old['sha256'] !== $new['sha256'] && str_contains($new['content'], 'UPDATED'), 'Every search refreshes source content after edits.');

    foreach (['app/.hidden.php', 'app/.git/hidden.php', 'app/vendor/package.php', 'app/node_modules/package.js',
        'app/tests/test.php', 'app/cache/cache.php', 'app/uploads/upload.md', 'app/backups/backup.md',
        'app/src/Config.php', 'app/src/credentials.php', 'docs/secrets.md', 'docs/private-key.md', 'docs/token.md',
        'outside.md', 'tests/fixture.php', 'app/src/file.txt'] as $excluded) $write($excluded, 'uniqueexcludedmarker');
    $assert($search->search('uniqueexcludedmarker')['sources'] === [], 'Hidden, dependency, config, secret, unrelated and unsupported files are excluded.');
    $write('app/src/nul.php', "<?php\0uniquebinarymarker");
    $write('app/src/binary.php', "\x01uniquebinarymarker");
    $write('app/src/invalid.php', "\xffuniquebinarymarker");
    $write("app/src/invalid-\xff.php", 'uniquebinarymarker');
    $write('app/src/oversize.php', str_repeat('uniquebinarymarker ', 16000));
    $assert($search->search('uniquebinarymarker')['sources'] === [], 'Binary, malformed UTF-8 and oversized files are never passages.');

    file_put_contents($outside . '/external.php', 'uniqueoutsideescape');
    symlink($outside . '/external.php', $root . '/app/link.php');
    symlink($outside, $root . '/docs/outside');
    symlink($root . '/app', $root . '/docs/inside');
    $assert($search->search('uniqueoutsideescape')['sources'] === [], 'File and directory symlinks cannot escape approved roots.');
    $assert(!in_array('docs/inside/src/DatabaseScope.php', array_column($search->search('database')['sources'], 'path'), true),
        'Even symlinks pointing inside the project are excluded.');
    symlink($root, $root . '-link');
    $assert((new LocalCodeSearch($root . '-link'))->status()['status'] === 'unavailable', 'A symlinked configured project root is rejected.');
    unlink($root . '-link');

    $write('app/src/Example.php', <<<'PHP'
<?php
// secretlineprobe is public code context.
$password = 'PRIVATE_LITERAL';
$credentials['password'] = 'PRIVATE_ARRAY_LITERAL';
const API_KEY = 'PRIVATE_API_KEY';
// Another secretlineprobe remains visible.
// https://user:PRIVATE_URL_PASSWORD@localhost/path
// -----BEGIN RSA PRIVATE KEY-----
PRIVATE_MULTILINE_KEY
// -----END RSA PRIVATE KEY-----
// secretlineprobe final public line.
PHP);
    $secret = $search->search('secretlineprobe');
    $encoded = AiContext::json($secret);
    $assert($secret['sources'] !== [] && !str_contains($encoded, 'PRIVATE_'), 'Literal credentials and private key blocks are omitted, including adjacent context.');
    foreach ($secret['sources'] as $source) {
        $lines = preg_split('/\r\n|\n|\r/', file_get_contents($root . '/' . $source['path']));
        $assert($source['content'] === implode("\n", array_slice($lines, $source['start_line'] - 1,
            $source['end_line'] - $source['start_line'] + 1)), 'Omitting a sensitive line preserves exact safe source ranges.');
    }
    $write('docs/unicode.md', "# Unicode\naccentmarker café naïef 😀 日本語\n" . str_repeat('😀', 230) . "\naccentmarker vervolg\n");
    $unicode = $search->search('accentmarker');
    $assert($unicode['sources'] !== [] && preg_match('//u', AiContext::json($unicode)) === 1, 'Multibyte passages stay valid UTF-8.');
    $assert(!str_contains(AiContext::json($unicode), str_repeat('😀', 230)), 'Very long lines are omitted whole rather than cutting Unicode or inventing a line.');

    for ($index = 0; $index < 5; $index++) $write('docs/bound-' . $index . '.md', str_repeat(str_repeat('quote" slash\\ ', 6) . 'boundedmarker café' . "\n", 20));
    $bounded = $search->search('boundedmarker');
    $assert(strlen(AiContext::json($bounded['sources'])) <= LocalCodeSearch::MAX_SOURCE_BYTES && count($bounded['sources']) <= 3,
        'The serialized source budget includes Unicode, JSON quoting and metadata.');
    $assert($bounded['truncated'], 'Limited source search explicitly reports omitted matches.');
    $write('docs/line-endings.md', "crlfmarker first\r\nsecond\r\nthird\r\n");
    $crlf = $search->search('crlfmarker')['sources'][0];
    $assert($crlf['start_line'] === 1 && str_starts_with($crlf['content'], "crlfmarker first\nsecond\nthird"),
        'Windows line endings retain line numbers and use LF in source previews.');

    $repository = new LocalCodeSearch(dirname(__DIR__));
    $actual = $repository->search('How does switching databases work?');
    $actualPaths = array_column($actual['sources'], 'path');
    $assert(in_array('app/src/DatabaseScope.php', $actualPaths, true)
        && in_array('app/public/assets/app.js', $actualPaths, true), 'Real Govern retrieval finds both server scope and frontend switching implementation.');
    $assert($repository->search('Hoe werkt het wisselen van databases?')['sources'] === $actual['sources'],
        'Real Govern Dutch retrieval has the same source evidence.');
    $assert(!str_contains(AiContext::json($actual), dirname(__DIR__)), 'API search output never exposes absolute filesystem paths.');

    for ($index = 0; $index < 325; $index++) $write('docs/many/file-' . $index . '.md', 'filecapmarker');
    $limited = $search->search('filecapmarker');
    $assert($limited['files_scanned'] === 320 && $limited['truncated'], 'A large allowed tree stops at the fixed file-read budget.');
    $write('app/deep/a/b/c/d/e/f/g/h/i/file.php', 'depthcapmarker');
    $deep = $search->search('depthcapmarker');
    $assert($deep['sources'] === [] && $deep['truncated'], 'Over-deep directories stop traversal and report the limit.');

    putenv('AI_PROJECT_ROOT=' . $root);
    $assert((new LocalCodeSearch())->status()['status'] === 'ready', 'Server-owned root configuration is supported.');
    putenv('AI_PROJECT_ROOT');
    echo "Local code search: {$passed} checks passed.\n";
} finally {
    putenv('AI_PROJECT_ROOT');
    $remove($root);
    $remove($outside);
    if (is_link($root . '-link')) unlink($root . '-link');
}
