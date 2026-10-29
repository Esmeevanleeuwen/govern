<?php
declare(strict_types=1);

namespace Govern;

/** Read-only, on-demand lexical search. No training, disk index or external services. */
final class LocalCodeSearch
{
    public const MAX_SOURCE_BYTES = 5000;
    private const ROOTS = ['app', 'docs'];
    private const MAX_ENTRIES = 2048;
    private const MAX_FILES = 320;
    private const MAX_FILE_BYTES = 262144;
    private const MAX_TOTAL_BYTES = 8388608;
    private const MAX_LINE_BYTES = 900;
    private const MAX_PASSAGE_BYTES = 1250;
    private readonly string $root;

    public function __construct(?string $root = null)
    {
        $configured = getenv('AI_PROJECT_ROOT');
        $this->root = rtrim($root ?? ($configured !== false && $configured !== '' ? $configured : dirname(__DIR__, 2)), '/\\');
    }

    public function status(): array
    {
        $root = $this->safeRoot();
        $ready = false;
        if ($root !== null) foreach (self::ROOTS as $name) {
            $path = $root . DIRECTORY_SEPARATOR . $name;
            if (!is_link($path) && is_dir($path) && is_readable($path)) $ready = true;
        }
        return ['status' => $ready ? 'ready' : 'unavailable', 'roots' => self::ROOTS,
            'sources' => [], 'truncated' => false, 'files_scanned' => 0];
    }

    public function search(string $question): array
    {
        $result = $this->status();
        if ($result['status'] !== 'ready' || strlen($question) > 4000 || preg_match('//u', $question) !== 1
            || str_contains($question, "\0")) return $result;
        $terms = $this->terms($question, true);
        if ($terms === []) return $result;
        $root = $this->safeRoot();
        if ($root === null) return [...$result, 'status' => 'unavailable'];
        $entries = 0;
        $total = 0;
        $files = [];
        foreach (self::ROOTS as $name) $this->collect($root, $name, 0, $entries, $files, $result['truncated']);
        $candidates = [];
        foreach ($files as $relative) {
            if ($result['files_scanned'] >= self::MAX_FILES || $total >= self::MAX_TOTAL_BYTES) {
                $result['truncated'] = true;
                break;
            }
            $raw = $this->readFile($root, $relative);
            if ($raw === null) continue;
            if ($total + strlen($raw) > self::MAX_TOTAL_BYTES) { $result['truncated'] = true; break; }
            $total += strlen($raw);
            $result['files_scanned']++;
            $lines = preg_split('/\r\n|\n|\r/', $raw);
            if ($lines === false) continue;
            $lines = $this->safeLines($lines);
            $pathTerms = $this->terms($relative);
            $pathHits = count(array_intersect($terms, $pathTerms));
            $best = null;
            foreach ($lines as $index => $line) {
                if ($line === null || trim($line) === '') continue;
                $hits = count(array_intersect($terms, $this->terms($line)));
                if ($hits === 0 && $pathHits === 0) continue;
                $score = $hits * 7 + $pathHits * 3;
                if ($hits === count($terms)) $score += 8;
                // Prefer a matching implementation symbol over repeated prose or translations.
                if (preg_match('/\b(?:function|class)\s+[A-Za-z_][A-Za-z0-9_]*/', $line) === 1) $score += $hits * 5;
                if (in_array('database', $terms, true) && in_array('switch', $terms, true)
                    && preg_match('/\b(?:function\s+switchDatabase|class\s+DatabaseScope)\b/i', $line) === 1) $score += 30;
                if (str_starts_with($relative, 'app/')) $score += 1;
                if ($best === null || $score > $best['score']) $best = ['score' => $score, 'line' => $index];
            }
            if ($best === null) continue;
            $passage = $this->passage($lines, $best['line']);
            if ($passage === null) continue;
            $candidates[] = [...$passage, 'path' => $relative, 'score' => $best['score'],
                'sha256' => hash('sha256', implode("\n", array_map(static fn (?string $line): string => $line ?? '[omitted]', $lines)))];
        }
        usort($candidates, static fn (array $a, array $b): int => $b['score'] <=> $a['score'] ?: strcmp($a['path'], $b['path']));
        foreach ($candidates as $candidate) {
            if (count($result['sources']) >= 3) break;
            unset($candidate['score']);
            $source = ['id' => 'S' . (count($result['sources']) + 1), ...$candidate];
            if (strlen(AiContext::json([...$result['sources'], $source])) > self::MAX_SOURCE_BYTES) {
                $result['truncated'] = true;
                continue;
            }
            $result['sources'][] = $source;
        }
        if (count($candidates) > count($result['sources'])) $result['truncated'] = true;
        return $result;
    }

    private function safeRoot(): ?string
    {
        clearstatcache(true, $this->root);
        if ($this->root === '' || is_link($this->root) || !is_dir($this->root) || !is_readable($this->root)) return null;
        $root = realpath($this->root);
        return $root === false ? null : $root;
    }

    private function collect(string $root, string $relative, int $depth, int &$entries, array &$files, bool &$truncated): void
    {
        if ($depth > 8 || $entries >= self::MAX_ENTRIES) { $truncated = true; return; }
        $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        clearstatcache(true, $path);
        if (is_link($path) || !is_dir($path) || !$this->inside($root, $path)) return;
        $directory = @opendir($path);
        if ($directory === false) return;
        $names = [];
        try {
            while (($name = readdir($directory)) !== false) {
                if (++$entries > self::MAX_ENTRIES) { $truncated = true; break; }
                if ($name[0] === '.' || preg_match('//u', $name) !== 1 || preg_match('/[\x00-\x1f\x7f]/', $name)) continue;
                $names[] = $name;
            }
        } finally { closedir($directory); }
        sort($names, SORT_STRING);
        foreach ($names as $name) {
            if ($this->excluded($name)) continue;
            $child = $path . DIRECTORY_SEPARATOR . $name;
            clearstatcache(true, $child);
            if (is_link($child)) continue;
            $childRelative = $relative . '/' . $name;
            if (is_dir($child)) $this->collect($root, $childRelative, $depth + 1, $entries, $files, $truncated);
            elseif (is_file($child) && preg_match('/\.(?:php|js|css|md)$/iD', $name) === 1) $files[] = $childRelative;
        }
    }

    private function excluded(string $name): bool
    {
        if (in_array(strtolower($name), ['vendor', 'node_modules', 'tests', 'test', 'cache', 'caches', 'uploads', 'backups',
            'storage', 'logs', 'dist', 'build', 'tmp', 'temp'], true)) return true;
        return preg_match('/config|credential|secret|password|passwd|private.?key|certificate|(?:^|[._-])(?:env|keys?|certs?|tokens?)(?:[._-]|$)/i', $name) === 1;
    }

    private function inside(string $root, string $path): bool
    {
        $resolved = realpath($path);
        return $resolved !== false && str_starts_with($resolved, $root . DIRECTORY_SEPARATOR);
    }

    private function readFile(string $root, string $relative): ?string
    {
        $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        // Recheck every component so a replaced directory cannot introduce a symlink.
        $component = $root;
        foreach (explode('/', $relative) as $part) {
            $component .= DIRECTORY_SEPARATOR . $part;
            clearstatcache(true, $component);
            if (is_link($component)) return null;
        }
        if (!$this->inside($root, $path)) return null;
        $before = @lstat($path);
        if ($before === false || $before['size'] > self::MAX_FILE_BYTES) return null;
        $stream = @fopen($path, 'rb');
        if ($stream === false) return null;
        try {
            $opened = fstat($stream);
            $raw = stream_get_contents($stream, self::MAX_FILE_BYTES + 1);
        } finally { fclose($stream); }
        clearstatcache(true, $path);
        $after = @lstat($path);
        if ($raw === false || strlen($raw) > self::MAX_FILE_BYTES || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $raw)
            || preg_match('//u', $raw) !== 1
            || $opened === false || $after === false || is_link($path) || !$this->inside($root, $path)
            || $before['ino'] !== $opened['ino'] || $after['ino'] !== $opened['ino']
            || $before['dev'] !== $opened['dev'] || $after['dev'] !== $opened['dev']) return null;
        return $raw;
    }

    /** Sensitive or long lines break passages; returned snippets always retain original text. */
    private function safeLines(array $lines): array
    {
        $privateKey = false;
        foreach ($lines as $index => $line) {
            if (preg_match('/-----BEGIN .*PRIVATE KEY-----/', $line)) $privateKey = true;
            $sensitive = $privateKey || preg_match('~https?://[^\s/:]+:[^\s/@]+@~i', $line)
                || preg_match('/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/', $line)
                || preg_match('/(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_-]*[\x22\x27\]\s]{0,6}(?:=>|=|:)\s*[\x22\x27][^\x22\x27]+/i', $line)
                || preg_match('/\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY)\s*=\s*[^\s\x22\x27$]+/', $line);
            if ($sensitive || strlen($line) > self::MAX_LINE_BYTES) $lines[$index] = null;
            if ($privateKey && preg_match('/-----END .*PRIVATE KEY-----/', $line)) $privateKey = false;
        }
        return $lines;
    }

    private function passage(array $lines, int $focus): ?array
    {
        $start = $focus;
        $end = $focus;
        $bytes = strlen($lines[$focus]);
        for ($distance = 1; $distance <= 7; $distance++) {
            foreach ([-1, 1] as $direction) {
                $index = $direction < 0 ? $start - 1 : $end + 1;
                if (!array_key_exists($index, $lines) || $lines[$index] === null
                    || $bytes + strlen($lines[$index]) + 1 > self::MAX_PASSAGE_BYTES) continue;
                $bytes += strlen($lines[$index]) + 1;
                if ($direction < 0) $start = $index; else $end = $index;
            }
        }
        $content = implode("\n", array_slice($lines, $start, $end - $start + 1));
        return trim($content) === '' ? null : ['start_line' => $start + 1, 'end_line' => $end + 1, 'content' => $content];
    }

    /** Small, auditable NL/EN vocabulary; no embedding model or automatic downloads. */
    private function terms(string $text, bool $question = false): array
    {
        $text = preg_replace('/(?<=[a-z0-9])(?=[A-Z])/', ' ', $text) ?? $text;
        $tokens = preg_split('/[^\pL\pN]+/u', strtolower($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $map = ['databases' => 'database', 'databank' => 'database', 'databanken' => 'database',
            'switching' => 'switch', 'switches' => 'switch', 'wissel' => 'switch', 'wisselen' => 'switch',
            'overschakelen' => 'switch', 'veranderen' => 'switch', 'changing' => 'switch', 'change' => 'switch',
            'tables' => 'table', 'tabel' => 'table', 'tabellen' => 'table', 'columns' => 'column', 'kolom' => 'column', 'kolommen' => 'column',
            'queries' => 'query', 'querys' => 'query', 'zoekopdracht' => 'query', 'onderzoeken' => 'query',
            'relations' => 'relationship', 'relationships' => 'relationship', 'relatie' => 'relationship', 'relaties' => 'relationship',
            'selectie' => 'selection', 'selecteren' => 'selection', 'selected' => 'selection', 'selecting' => 'selection',
            'paneel' => 'panel', 'zijbalk' => 'sidebar', 'instellingen' => 'settings', 'taal' => 'language',
            'vertalingen' => 'translation', 'vertaling' => 'translation', 'translations' => 'translation',
            'opslaan' => 'save', 'opgeslagen' => 'saved', 'verwijderen' => 'delete', 'herstellen' => 'restore',
            'herstelpunt' => 'snapshot', 'herstelpunten' => 'snapshot', 'snapshots' => 'snapshot', 'backups' => 'backup',
            'inzoomen' => 'zoom', 'uitzoomen' => 'zoom', 'verbinding' => 'connection', 'verbinden' => 'connection',
            'uitvoeren' => 'execute', 'uitvoering' => 'execute'];
        $stop = ['how', 'does', 'do', 'the', 'a', 'an', 'is', 'it', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'my', 'your', 'this', 'that',
            'work', 'works', 'working', 'please', 'explain', 'show', 'me', 'can', 'you', 'what', 'where', 'which', 'about',
            'hoe', 'werkt', 'werken', 'de', 'het', 'een', 'en', 'of', 'van', 'voor', 'in', 'op', 'mijn', 'jouw', 'deze', 'dit', 'die',
            'leg', 'uit', 'toon', 'mij', 'kan', 'kun', 'je', 'wat', 'waar', 'welke', 'over', 'code', 'project', 'govern', 'local', 'lokale'];
        $terms = [];
        foreach ($tokens as $token) {
            if (strlen($token) < 2 || $question && in_array($token, $stop, true)) continue;
            $terms[$map[$token] ?? $token] = true;
            if ($question && count($terms) >= 20) break;
        }
        return array_keys($terms);
    }
}
