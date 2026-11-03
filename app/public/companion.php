<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
\Govern\Web::user();
?>
<!doctype html>
<html lang="nl" class="companion-document">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="description" content="Govern — vergelijk records en volg hun verbindingen op je tweede scherm.">
    <title>Govern — tweede scherm</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/auth.css">
    <link rel="stylesheet" href="/assets/record-explorer.css">
    <link rel="stylesheet" href="/assets/explorer-guide.css">
    <link rel="stylesheet" href="/assets/modal-shell.css">
    <link rel="stylesheet" href="/assets/record-window.css">
    <link rel="stylesheet" href="/assets/companion.css">
    <link rel="stylesheet" href="/assets/companion-radar.css">
    <script type="module" src="/assets/companion.js"></script>
</head>
<body class="companion-page">
    <a class="skip-link" href="#companion-content" data-companion-text="skip">Ga naar de inhoud</a>
    <div id="companion-app"></div>
    <noscript><p class="noscript-notice">Schakel JavaScript in om het tweede scherm te gebruiken. Enable JavaScript to use the companion screen. <a href="/workspace.php">Govern</a></p></noscript>
</body>
</html>
