<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
\Govern\Web::user();
$config = \Govern\Config::fromEnvironment();
$pg = $config['postgres'] ?? null;
$scope = $pg === null ? '' : \Govern\ConnectionScope::scopeKey('postgres',$pg['name'],$config['studio']['schema']);
?>
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Govern · Opnamearchief</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/dictation.css"><script type="module" src="/assets/dictation.js"></script></head>
<body data-dictation-scope="<?= htmlspecialchars($scope,ENT_QUOTES,'UTF-8') ?>"><main class="dictation-page"><header><a href="/workspace.php">← Govern</a><select id="dictation-language" aria-label="Language"><option value="nl">NL</option><option value="en">EN</option></select></header><h1 data-copy="title">Opnamearchief</h1><p data-copy="help">Opnemen en transcriberen doe je in GhostSketch. Hier bekijk je de opgeslagen brongegevens.</p><p id="dictation-status" role="status" aria-live="polite"></p><div class="dictation-layout"><section><h2 data-copy="recordings">Opnames</h2><button id="dictation-refresh" class="button" data-copy="refresh">Verversen</button><div id="dictation-list"></div></section><section><h2 id="dictation-title" data-copy="transcript">Transcript</h2><pre id="dictation-transcript"></pre></section></div></main></body></html>
