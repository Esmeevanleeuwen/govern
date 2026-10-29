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
    <link rel="stylesheet" href="/assets/schema-help.css">
    <link rel="stylesheet" href="/assets/workspace-navigation.css">
    <link rel="stylesheet" href="/assets/schema-workspace.css">
    <link rel="stylesheet" href="/assets/selection-pointer.css">
    <link rel="stylesheet" href="/assets/database-workspace.css">
    <link rel="stylesheet" href="/assets/row-editor.css">
    <link rel="stylesheet" href="/assets/database-manager.css">
    <link rel="stylesheet" href="/assets/ai-workspace.css">
    <script type="module" src="/assets/app.js"></script>
</head>
<body>
    <a class="skip-link" href="#main-content" data-i18n="app.shell.skip">Ga naar de inhoud</a>
    <div class="app-shell">
        <aside id="sidebar" class="sidebar unified-sidebar" aria-label="Hoofdnavigatie" data-i18n-aria="app.shell.navigation">
            <div class="navigation-rail">
                <a class="brand rail-brand" href="#overzicht" aria-label="Govern overzicht" data-i18n-aria="app.shell.brand"><span class="brand-mark" aria-hidden="true"></span><span class="sr-only">govern</span></a>
                <nav id="navigation" aria-label="Werkplek" data-i18n-aria="app.shell.workspace"></nav>
                <div class="rail-bottom"><a class="nav-link settings-link" id="settings-link" href="#instellingen" data-area="settings"><span data-i18n="app.route.settings">Instellingen</span></a></div>
            </div>
            <section id="workspace-context" class="workspace-context" aria-labelledby="workspace-context-title" hidden>
                <header class="workspace-context-heading"><h2 id="workspace-context-title"></h2><button id="workspace-panel-toggle" class="icon-button" type="button" aria-controls="workspace-context" aria-expanded="true"></button></header>
                <div id="workspace-context-content" class="workspace-context-content"></div>
                <p class="workspace-context-foot" data-i18n="app.shell.localComputer">Lokaal op je computer</p>
            </section>
        </aside>
        <div class="workspace">
            <header class="topbar">
                <div class="topbar-location">
                    <button id="menu-toggle" class="icon-button mobile-menu" type="button" aria-label="Navigatie openen" data-i18n-aria="app.shell.openNavigation" aria-expanded="false"></button>
                    <span class="topbar-brand">govern</span><div class="topbar-project"><strong id="workspace-database" class="sr-only" data-i18n="app.shell.personal">Persoonlijke werkplek</strong><div class="database-picker-group"><label class="database-picker"><span id="database-picker-icon" aria-hidden="true"></span><select id="database-select" aria-label="Database kiezen" data-i18n-aria="app.databases.choose" disabled><option value="">Database…</option></select></label><button id="manage-databases" class="icon-button database-manager-toggle" type="button" aria-label="Database toevoegen of importeren" data-i18n-aria="app.databases.manage" title="Database toevoegen of importeren" data-i18n-title="app.databases.manage" aria-haspopup="dialog" aria-controls="database-manager-dialog" disabled></button></div><div id="connection-state" class="connection-card"><span class="status-dot waiting"></span><span data-i18n="app.shell.connecting">Verbinding maken…</span></div></div><strong id="breadcrumb-current" class="sr-only">Overzicht</strong>
                </div>
                <div class="topbar-actions">
                    <button id="ai-toggle" class="button button-secondary button-small" type="button" data-selection-ui="" aria-controls="ai-workspace-panel" aria-expanded="false" aria-label="AI-assistent" data-i18n-aria="app.ai.toggle" title="AI-assistent" data-i18n-title="app.ai.toggle"><span class="ai-toggle-label" data-i18n="app.ai.toggle">AI-assistent</span></button>
                    <label class="language-picker"><span id="language-icon" aria-hidden="true"></span><select id="language-select" aria-label="Taal" data-i18n-aria="app.settings.language"><option value="nl">NL</option><option value="en">EN</option></select></label>
                    <a class="icon-button" href="/api.php?action=context" id="context-export" aria-label="Context exporteren" data-i18n-aria="app.shell.export" title="Context exporteren" data-i18n-title="app.shell.export"><span class="sr-only" data-i18n="app.shell.export">Context exporteren</span></a>
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
