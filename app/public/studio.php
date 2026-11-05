<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
\Govern\Web::user('studio');
$config = \Govern\Config::fromEnvironment();
$studio = $config['studio'] ?? ['enabled' => false, 'schema' => 'brainstorm'];
$postgres = $config['postgres'] ?? null;
$scope = $postgres === null ? '' : \Govern\ConnectionScope::scopeKey('postgres', $postgres['name'], $studio['schema']);
$escape = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <meta name="robots" content="noindex">
    <meta name="description" content="Govern Studio — van gesproken idee naar whiteboard en schermontwerp.">
    <title>Govern Studio</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/studio.css">
    <script type="module" src="/assets/studio.js"></script>
</head>
<body class="studio-body" data-studio-scope="<?= $escape($scope) ?>" data-studio-enabled="<?= ($studio['enabled'] ?? false) && $postgres !== null ? '1' : '0' ?>">
    <a class="skip-link" href="#studio-canvas" data-studio-text="skip">Ga naar het whiteboard</a>
    <header class="studio-header">
        <a class="studio-brand" href="/studio.php" aria-label="Govern Studio"><span class="brand-mark" aria-hidden="true"></span><strong>govern</strong><span class="studio-brand-divider">/</span><span>studio</span></a>
        <div class="studio-header-center"><span class="studio-live-dot" id="studio-live-dot" aria-hidden="true"></span><span id="studio-connection" role="status" data-studio-text="connecting">Verbinding maken…</span></div>
        <nav class="studio-header-actions" aria-label="Studio">
            <a class="studio-govern-link" href="/workspace.php#studio"><span data-studio-text="govern">Gegevens in Govern</span><span id="studio-govern-external" aria-hidden="true"></span></a>
            <button class="studio-icon-button" id="studio-theme" type="button" aria-label="Thema wisselen"></button>
            <label class="sr-only" for="studio-language" data-studio-text="language">Taal</label><select id="studio-language" class="studio-language"><option value="nl">NL</option><option value="en">EN</option></select>
        </nav>
    </header>
    <main class="studio-layout" id="studio-app">
        <aside class="studio-boards" id="studio-boards" aria-labelledby="studio-boards-title">
            <div class="studio-sidebar-top"><p class="studio-eyebrow" data-studio-text="workspace">Ruimte voor je volgende idee</p><h1 id="studio-boards-title" data-studio-text="boards">Mijn whiteboards</h1><p class="studio-sidebar-description" data-studio-text="boardsHelp">Spreek je ideeën uit. Geef ze samen vorm.</p></div>
            <button class="button button-primary studio-new-board" id="studio-new-board" type="button"><span aria-hidden="true">＋</span><span data-studio-text="newBoard">Nieuw whiteboard</span></button>
            <div class="studio-board-list" id="studio-board-list" role="list"></div>
            <div class="studio-sidebar-bottom"><span class="studio-shared-mark" aria-hidden="true">◎</span><p data-studio-text="shared">Gedeeld met goedgekeurde gebruikers van deze Govern-installatie.</p></div>
        </aside>
        <section class="studio-workspace" aria-labelledby="studio-board-title">
            <div class="studio-board-heading"><div><p class="studio-eyebrow" data-studio-text="whiteboard">Whiteboard</p><h2 id="studio-board-title" data-studio-text="startTitle">Wat wil je maken?</h2></div><div class="studio-board-actions"><button class="studio-icon-button" id="studio-boards-toggle" type="button" aria-controls="studio-boards" aria-expanded="false"></button><button class="button button-secondary" id="studio-share" type="button"><span data-studio-text="openPhone">Open op je iPhone</span></button><button class="studio-icon-button" id="studio-inspector-toggle" type="button" aria-controls="studio-inspector" aria-expanded="true"></button></div></div>
            <div class="studio-notice" id="studio-notice" role="status" hidden></div>
            <div class="studio-stage-layout">
                <div class="studio-canvas" id="studio-canvas" tabindex="0" role="region" aria-label="Whiteboard">
                    <div class="studio-world" id="studio-world"><svg class="studio-lines" id="studio-lines" aria-hidden="true"></svg><div id="studio-nodes"></div></div>
                    <div class="studio-empty" id="studio-empty"><div class="studio-empty-symbol" aria-hidden="true"><span></span><span></span><span></span></div><p class="studio-eyebrow" data-studio-text="emptyEyebrow">Van eerste gedachte naar nieuw platform</p><h3 data-studio-text="emptyTitle">Hier begint iets nieuws.</h3><p data-studio-text="emptyHelp">Maak een whiteboard. Verzamel notities, spreek ideeën uit en schets je eerste scherm.</p><button class="button button-primary" id="studio-empty-action" type="button" data-studio-text="newBoard">Nieuw whiteboard</button></div>
                    <div class="studio-toolbar" id="studio-toolbar" role="toolbar" aria-label="Whiteboardgereedschap"></div>
                    <div class="studio-canvas-bottom"><div class="studio-camera-controls" id="studio-camera-controls"></div><div class="studio-save-state" id="studio-save-state" role="status"></div></div>
                </div>
                <aside class="studio-inspector" id="studio-inspector" aria-labelledby="studio-inspector-title">
                    <div class="studio-inspector-title"><h3 id="studio-inspector-title" data-studio-text="inspector">Je ideeën, verbonden.</h3><button class="studio-icon-button studio-mobile-close" id="studio-inspector-close" type="button" aria-label="Paneel sluiten"></button></div>
                    <section class="studio-recording-panel" aria-labelledby="studio-recording-title"><div class="studio-recording-orb" id="studio-recording-orb" aria-hidden="true"></div><p class="studio-eyebrow" data-studio-text="voiceEyebrow">Zeg het maar</p><h4 id="studio-recording-title" data-studio-text="voiceTitle">Denk hardop.</h4><p class="studio-recording-help" data-studio-text="voiceHelp">Spreek op je iPhone. Afgeronde tekst verschijnt als notitie op dit whiteboard.</p><button class="button button-primary studio-microphone-button" id="studio-microphone" type="button"><span data-studio-text="startRecording">Start microfoon</span></button><button class="button button-secondary" id="studio-microphone-retry" type="button" hidden data-studio-text="retryAudio">Audio opnieuw versturen</button><p class="studio-voice-status" id="studio-voice-status" role="status"></p><p class="studio-privacy" data-studio-text="audioPrivacy">Na jouw start wordt audio in korte fragmenten verwerkt door de ingestelde transcriptieservice. Deze versie bewaart de tekst en tijdstempels, niet de oorspronkelijke audio. Houd dit scherm geopend.</p></section>
                    <section class="studio-editor" id="studio-editor" aria-labelledby="studio-editor-title" hidden></section>
                    <section class="studio-transcripts" aria-labelledby="studio-transcripts-title"><div class="studio-section-heading"><h4 id="studio-transcripts-title" data-studio-text="transcripts">Gesproken notities</h4><span class="studio-count" id="studio-transcript-count">0</span></div><div id="studio-transcripts"></div></section>
                </aside>
            </div>
        </section>
    </main>
    <dialog class="studio-dialog" id="studio-create-dialog"><form id="studio-create-form"><p class="studio-eyebrow" data-studio-text="newBoard">Nieuw whiteboard</p><h2 data-studio-text="nameBoard">Geef je idee een plek.</h2><label for="studio-board-name" data-studio-text="boardName">Naam van het whiteboard</label><input id="studio-board-name" class="input" name="title" maxlength="160" required autocomplete="off"><p id="studio-create-error" class="studio-dialog-error" role="alert" hidden></p><div class="studio-dialog-actions"><button class="button button-secondary" id="studio-create-cancel" type="button" data-studio-text="cancel">Annuleren</button><button class="button button-primary" id="studio-create-submit" type="submit" data-studio-text="create">Aanmaken</button></div></form></dialog>
    <dialog class="studio-dialog" id="studio-share-dialog"><p class="studio-eyebrow" data-studio-text="sameBoard">Eén whiteboard, twee apparaten</p><h2 data-studio-text="openPhone">Open op je iPhone</h2><p data-studio-text="phoneHelp">Open deze link op je iPhone en log in met je Govern-account. Beide apparaten gebruiken hetzelfde whiteboard.</p><label class="sr-only" for="studio-board-link" data-studio-text="boardLink">Whiteboardlink</label><input id="studio-board-link" class="input" readonly><p class="studio-privacy" data-studio-text="phoneSecure">Microfoontoegang op je iPhone vereist een bereikbare HTTPS-installatie met een vertrouwd certificaat. localhost op je computer is niet bereikbaar vanaf je telefoon.</p><div class="studio-dialog-actions"><button class="button button-secondary" id="studio-share-close" type="button" data-studio-text="close">Sluiten</button><button class="button button-primary" id="studio-copy-link" type="button" data-studio-text="copyLink">Link kopiëren</button></div><p id="studio-share-status" role="status"></p></dialog>
    <noscript><p>Schakel JavaScript in om Govern Studio te gebruiken. Enable JavaScript to use Govern Studio.</p></noscript>
</body>
</html>
