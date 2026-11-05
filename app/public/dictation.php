<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
\Govern\Web::user();
$config = \Govern\Config::fromEnvironment();
$pg = $config['postgres'] ?? null;
$scope = $pg === null ? '' : \Govern\ConnectionScope::scopeKey('postgres',$pg['name'],$config['studio']['schema']);
?>
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Govern · Dictafoon</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/dictation.css"><script type="module" src="/assets/dictation.js"></script></head>
<body data-dictation-scope="<?= htmlspecialchars($scope,ENT_QUOTES,'UTF-8') ?>"><main class="dictation-page"><header><a href="/workspace.php">← Govern</a><select id="dictation-language" aria-label="Language"><option value="nl">NL</option><option value="en">EN</option></select></header><h1 data-copy="title">Dictafoon</h1><p data-copy="help">Bewaar je opname en transcript in Govern. Maak je aantekeningen in GhostSketch.</p><form id="dictation-import"><label for="dictation-file" data-copy="file">Opname uit Dictafoon · M4A, WAV of MP3</label><input id="dictation-file" type="file" accept=".m4a,.wav,.mp3,audio/*" required><button class="button button-primary" data-copy="import">Opname inladen</button></form><p id="dictation-status" role="status" aria-live="polite"></p><div class="dictation-layout"><section><h2 data-copy="recordings">Opnames</h2><button id="dictation-refresh" class="button" data-copy="refresh">Verversen</button><div id="dictation-list"></div></section><section><h2 id="dictation-title" data-copy="transcript">Transcript</h2><button id="dictation-process" class="button button-primary" hidden data-copy="process">Transcriptie starten / hervatten</button><pre id="dictation-transcript"></pre></section></div></main></body></html>
