<!doctype html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="description" content="Govern — je persoonlijke werkplek voor gegevens, structuur en onderzoek.">
    <title>Govern — persoonlijke datawerkplek</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <script type="module" src="/assets/app.js"></script>
</head>
<body>
    <a class="skip-link" href="#main-content" data-i18n="app.shell.skip">Ga naar de inhoud</a>
    <div class="app-shell">
        <aside id="sidebar" class="sidebar" aria-label="Hoofdnavigatie" data-i18n-aria="app.shell.navigation">
            <a class="brand" href="#overzicht" aria-label="Govern overzicht" data-i18n-aria="app.shell.brand">
                <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
                <span><strong>govern</strong><small data-i18n="app.shell.tagline">Jouw datawerkplek</small></span>
            </a>
            <div class="workspace-label"><span class="workspace-avatar" aria-hidden="true">G</span><span><strong id="workspace-database" data-i18n="app.shell.personal">Persoonlijke werkplek</strong><small data-i18n="app.shell.localComputer">Lokaal op je computer</small></span></div>
            <p class="nav-label" data-i18n="app.shell.workspace">WERKPLEK</p>
            <nav id="navigation"></nav>
            <div class="sidebar-footer">
                <div id="connection-state" class="connection-card"><span class="status-dot waiting"></span><span data-i18n="app.shell.connecting">Verbinding maken…</span></div>
                <a class="nav-link settings-link" id="settings-link" href="#instellingen"><span data-i18n="app.route.settings">Instellingen</span></a>
                <a class="sidebar-export" href="/api.php?action=context" id="context-export"><span data-i18n="app.shell.export">Context exporteren</span></a>
                <p class="sidebar-note" data-i18n="app.shell.exportHelp">Neem je schema en opgeslagen queries mee in ons gesprek.</p>
                <span class="sidebar-version" data-i18n="app.shell.localPrivate">PERSOONLIJK &amp; LOKAAL</span>
            </div>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <div class="topbar-location">
                    <button id="menu-toggle" class="icon-button mobile-menu" type="button" aria-label="Navigatie openen" data-i18n-aria="app.shell.openNavigation" aria-expanded="false"></button>
                    <span class="breadcrumb-root" data-i18n="app.shell.myWorkspace">Mijn werkplek</span><span class="breadcrumb-separator">/</span><strong id="breadcrumb-current">Overzicht</strong>
                </div>
                <div class="topbar-actions">
                    <label class="language-picker"><span id="language-icon" aria-hidden="true"></span><select id="language-select" aria-label="Taal" data-i18n-aria="app.settings.language"><option value="nl">NL</option><option value="en">EN</option></select></label>
                    <button id="settings-shortcut" class="icon-button" type="button" aria-label="Instellingen" data-i18n-aria="app.route.settings"></button>
                    <button id="refresh-app" class="icon-button" type="button" aria-label="Werkplek verversen" data-i18n-aria="app.shell.refresh" data-i18n-title="app.shell.refresh" title="Werkplek verversen"></button>
                    <button id="open-database" class="button button-secondary" type="button" disabled><span data-i18n="app.shell.openDatabase">Database openen</span></button>
                </div>
            </header>
            <main id="main-content" tabindex="-1">
                <div id="global-notice"></div>
                <div id="page"><div class="loading-state" role="status"><span class="spinner"></span><span data-i18n="app.shell.loading">Je werkplek wordt geladen…</span></div></div>
            </main>
            <footer class="workspace-footer"><span data-i18n="app.shell.footer">Meer structuur. Meer inzicht.</span><span id="footer-database"></span></footer>
        </div>
    </div>
    <div id="toasts" class="toasts" aria-live="polite" aria-atomic="false"></div>
    <noscript><p class="noscript-notice">Schakel JavaScript in om deze werkplek te gebruiken. Enable JavaScript to use Govern. <a href="/phpmyadmin/">phpMyAdmin</a></p></noscript>
</body>
</html>
