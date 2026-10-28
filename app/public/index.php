<!doctype html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="description" content="Govern — je persoonlijke werkplek voor gegevens, structuur en onderzoek.">
    <title>Govern — persoonlijke datawerkplek</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <script type="module" src="/assets/app.js"></script>
</head>
<body>
    <a class="skip-link" href="#main-content">Ga naar de inhoud</a>
    <div class="app-shell">
        <aside id="sidebar" class="sidebar" aria-label="Hoofdnavigatie">
            <a class="brand" href="#overzicht" aria-label="Govern overzicht">
                <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
                <span><strong>govern<span class="brand-period">.</span></strong><small>JOUW DATAWERKPLEK</small></span>
            </a>
            <div class="workspace-label"><span class="workspace-avatar">G</span><span>Persoonlijke werkplek<small>Lokaal op je computer</small></span></div>
            <p class="nav-label">WERKPLEK</p>
            <nav id="navigation"></nav>
            <div class="sidebar-footer">
                <div id="connection-state" class="connection-card"><span class="status-dot waiting"></span><span>Verbinding maken…</span></div>
                <a class="sidebar-export" href="/api.php?action=context" id="context-export"><span>Context exporteren</span></a>
                <p class="sidebar-note">Neem je schema en opgeslagen queries mee in ons gesprek.</p>
                <span class="sidebar-version">GOVERN · PERSOONLIJK &amp; LOKAAL</span>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <div class="topbar-location">
                    <button id="menu-toggle" class="icon-button mobile-menu" type="button" aria-label="Navigatie openen" aria-expanded="false"></button>
                    <span class="breadcrumb-root">Mijn werkplek</span><span class="breadcrumb-separator">/</span><strong id="breadcrumb-current">Overzicht</strong>
                </div>
                <div class="topbar-actions">
                    <span class="local-pill"><span class="status-dot"></span>Lokaal</span>
                    <button id="refresh-app" class="icon-button" type="button" aria-label="Werkplek verversen" title="Werkplek verversen"></button>
                    <button id="open-database" class="button button-primary" type="button" disabled><span>Database openen</span></button>
                </div>
            </header>
            <main id="main-content" tabindex="-1">
                <div id="global-notice"></div>
                <div id="page"><div class="loading-state" role="status"><span class="spinner"></span>Je werkplek wordt geladen…</div></div>
            </main>
            <footer class="workspace-footer"><span>Een plek om te onderzoeken, te begrijpen en te bouwen.</span><span id="footer-database"></span></footer>
        </div>
    </div>
    <div id="toasts" class="toasts" aria-live="polite" aria-atomic="false"></div>
    <noscript><p class="noscript-notice">Schakel JavaScript in om deze werkplek te gebruiken. phpMyAdmin is ook rechtstreeks beschikbaar via <a href="/phpmyadmin/">de databaseomgeving</a>.</p></noscript>
</body>
</html>
