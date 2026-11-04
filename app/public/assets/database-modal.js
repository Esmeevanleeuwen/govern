import {t, getLanguage} from './i18n.js';
import './modal-messages.js';
import './database-messages.js';
import {el, icon, button, badge} from './ui.js';
import {DatasetImportPanel} from './dataset-import.js';
import {ImportInspectionPanel} from './import-inspection.js';
import {parseConnectionScope} from './connection-scope.js';
import './postgres-messages.js';
import {attachDialog} from './modal-shell.js';

const routes = {
    dataset: {table: '/table/import', database: '/database/import'},
    browse: {table: '/sql', database: '/database/structure'},
    structure: {table: '/table/structure', database: '/database/structure'},
    sql: {table: '/table/sql', database: '/database/sql'},
    import: {table: '/table/import', database: '/database/import'},
    export: {table: '/table/export', database: '/database/export'},
};

export function phpMyAdminUrl(database, table, tab = 'browse') {
    if (database.startsWith('postgres:')) throw new Error('phpMyAdmin requires a MariaDB database.');
    const route = routes[tab] || routes.browse;
    const params = new URLSearchParams({route: table ? route.table : route.database, db: database, server: '1', lang: getLanguage()});
    if (table) params.set('table', table);
    return '/phpmyadmin/index.php?' + params.toString();
}

export class DatabaseModal {
    constructor(onClose, onOpenChange) {
        this.database = '';
        this.tables = [];
        this.databases = [];
        this.table = '';
        this.tab = 'browse';
        this.currentUrl = '';
        this.onClose = onClose;
        this.onOpenChange = onOpenChange;
        this.importInspection = new ImportInspectionPanel(busy => this.setBusy(busy));
        // Ordinary imports use the unified wizard. This panel only reports
        // before/after observations for the advanced official application.
        this.importInspection.ownPanel.remove();
        this.datasetImport = new DatasetImportPanel(busy => {
            this.setBusy(busy);
        });
        this.dialog = el('dialog', {id: 'database-dialog', class: 'database-dialog', 'aria-labelledby': 'database-title'});
        this.name = el('span', {class: 'database-name sr-only'});
        this.databaseSelect = el('select', {id: 'modal-database', class: 'input select modal-database-select',
            'aria-label': t('modal.chooseSource'), 'aria-describedby': 'modal-source-hint', on: {change: () => {
                const next = this.databaseSelect.value;
                if (this.isBusy() || next === this.database || !this.databases.some(item => (item.scope_key || item.name) === next)) {
                    this.databaseSelect.value = this.database;
                    return;
                }
                this.table = '';
                this.configure(next, [], this.databases); this.navigate();
            }}});
        this.tableSelect = el('select', {id: 'modal-table', class: 'input select modal-table', on: {
            change: () => { if (this.isBusy()) return; this.table = this.tableSelect.value; this.navigate(); },
        }});
        this.external = el('a', {class: 'icon-button', target: '_blank', rel: 'noopener', title: t('modal.externalTitle'), 'aria-label': t('modal.externalLabel')}, icon('external'));
        this.expand = el('button', {type: 'button', class: 'icon-button', title: t('modal.expand'), 'aria-label': t('modal.expand'), 'aria-pressed': 'false', on: {click: () => this.toggleExpanded()}}, icon('expand'));
        this.tabButtons = {};
        const tablist = el('div', {class: 'database-tabs', role: 'tablist', 'aria-label': t('modal.tools')});
        for (const [key, label, symbol] of [['browse', 'Browse', 'table'], ['structure', 'Structure', 'layers'], ['sql', 'SQL', 'code'], ['import', t('modal.import'), 'download'], ['export', t('modal.export'), 'external'], ['dataset', t('dataset.title'), 'plus']]) {
            const tab = el('button', {type: 'button', class: 'database-tab', id: 'database-tab-' + key, role: 'tab', 'aria-controls': key === 'dataset' ? 'dataset-import-panel' : 'database-panel', 'aria-selected': 'false', on: {
                click: () => { if (this.isBusy()) return; this.tab = key; this.navigate(); },
                keydown: event => this.tabKeydown(event, key),
            }}, icon(symbol), label);
            this.tabButtons[key] = tab;
            tablist.append(tab);
        }
        this.frame = el('iframe', {id: 'database-frame', title: t('modal.frameTitle'), src: 'about:blank', referrerpolicy: 'same-origin'});
        this.frame.addEventListener('load', () => this.checkLoaded());
        this.frame.addEventListener('error', () => this.showFallback(true));
        this.frameMessage = el('div', {class: 'frame-message', role: 'status'});
        this.status = el('span', {}, t('modal.ready'));
        this.panel = el('div', {id: 'database-panel', class: 'database-frame-panel', role: 'tabpanel', 'aria-labelledby': 'database-tab-browse'}, this.frame, this.frameMessage);
        this.dialog.append(
            el('div', {class: 'database-dialog-header'},
                el('div', {class: 'database-dialog-title'}, el('span', {class: 'database-dialog-icon'}, icon('database')),
                    el('div', {}, el('h2', {id: 'database-title', 'data-i18n': 'modal.title'}, t('modal.title')), el('p', {'data-i18n': 'modal.description'}, t('modal.description')))),
                el('div', {class: 'modal-tools'}, this.external, this.expand,
                    this.closeButton = button(t('modal.close'), () => this.isBusy() ? null : this.dialog.close(), {symbol: 'close', className: 'button-small'}))),
            el('div', {class: 'database-toolbar'}, tablist,
                el('div', {class: 'database-context'},
                    el('div', {class: 'modal-database'}, icon('database'), this.name, this.databaseSelect),
                    el('label', {class: 'sr-only', for: 'modal-table', 'data-i18n': 'modal.table'}, t('modal.table')), this.tableSelect)),
            this.sourceHint = el('p', {id: 'modal-source-hint', class: 'modal-source-hint small muted', 'data-i18n': 'modal.sourceHint'}, t('modal.sourceHint')),
            this.importInspection.panel,
            this.panel,
            el('div', {class: 'database-dialog-footer'}, el('span', {class: 'status-dot'}), this.status,
                el('span', {class: 'modal-footer-hint', 'data-i18n': 'modal.footerHint'}, t('modal.footerHint'))));
        this.fallbackVisible = false;
        this.importUncertain = false;
        this.dialog.addEventListener('cancel', event => { if (this.isBusy()) event.preventDefault(); });
        this.dialog.addEventListener('close', () => {
            clearInterval(this.poll);
            clearTimeout(this.loadTimeout);
            this.importInspection.close();
            this.onOpenChange?.(false);
            this.onClose?.();
        });
        document.body.append(this.dialog);
        this.shell = attachDialog(this.dialog, {handle: this.dialog.querySelector('.database-dialog-header')});
    }

    isBusy() { return this.importInspection.ownWorking || this.importInspection.submitted || this.datasetImport.busy === true; }

    isPostgres() { return this.database.startsWith('postgres:'); }

    setBusy() {
        const busy = this.isBusy();
        this.databaseSelect.disabled = busy;
        this.tableSelect.disabled = busy; this.closeButton.disabled = busy;
        Object.values(this.tabButtons).forEach(tab => {tab.disabled = busy;});
    }

    pollFrame() {
        clearInterval(this.poll);
        if (this.dialog.open && !this.isPostgres() && this.tab !== 'dataset')
            this.poll = setInterval(() => { this.syncLocation(); this.watchNativeImport(); }, 800);
    }

    /** Translate the shell without reloading an active phpMyAdmin form or SQL draft. */
    refreshLanguage() {
        this.tabButtons.dataset.replaceChildren(icon('plus'), t('dataset.title'));
        this.datasetImport.render();
        this.dialog.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        this.external.title = t('modal.externalTitle');
        this.external.setAttribute('aria-label', t('modal.externalLabel'));
        const expandLabel = t(this.dialog.classList.contains('expanded') ? 'modal.collapse' : 'modal.expand');
        this.expand.title = expandLabel;
        this.expand.setAttribute('aria-label', expandLabel);
        this.closeButton.querySelector('span').textContent = t('modal.close');
        this.closeButton.setAttribute('aria-label', t('modal.close'));
        this.dialog.querySelector('[role="tablist"]').setAttribute('aria-label', t('modal.tools'));
        this.tabButtons.import.lastChild.textContent = t('modal.import');
        this.tabButtons.export.lastChild.textContent = t('modal.export');
        this.dialog.querySelector('[data-i18n="modal.description"]').textContent = t(this.isPostgres() ? 'app.postgres.importDescription' : 'modal.description');
        if (this.dialog.open) this.syncLocation();
        this.importInspection.translate();
        this.configure(this.database, this.tables, this.databases);
        this.frame.title = this.currentUrl
            ? this.tabButtons[this.tab].textContent + ' — ' + (this.table || this.database)
            : t('modal.frameTitle');
        if (!this.currentUrl) this.status.textContent = t('modal.ready');
        const url = new URL(this.isPostgres() ? '/workspace.php' : this.currentUrl || phpMyAdminUrl(this.database, this.table, this.tab), window.location.origin);
        url.searchParams.set('lang', getLanguage());
        this.external.href = url.pathname + url.search;
        // The frame itself picks up the new language on the next deliberate
        // open, tab/table change or reload. A cross-tab preference event must
        // never discard an unsaved form inside the official application.
        if (this.fallbackVisible) this.showFallback();
    }

    configure(database, tables, databases = this.databases) {
        if (this.isBusy() && database !== this.database) return;
        const changed = database !== this.database;
        if (changed) {
            this.importInspection.close();
            if (this.datasetImport.draft) {
                this.datasetImport.draft.preview = null;
                this.datasetImport.draft.confirmation = '';
            }
        }
        this.databases = databases.filter(item => item.connection !== 'postgres');
        this.sourceHint.dataset.i18n = 'modal.sourceHint';
        this.sourceHint.textContent = t(this.sourceHint.dataset.i18n);
        this.databaseSelect.replaceChildren(...['mariadb', 'postgres'].map(engine => {
            const items = this.databases.filter(item => (item.connection === 'postgres' ? 'postgres' : 'mariadb') === engine);
            if (!items.length) return null;
            const label = engine === 'postgres' ? 'PostgreSQL' : 'MariaDB';
            return el('optgroup', {label}, ...items.map(item => {
                const name = engine === 'postgres' ? item.label || item.name + ' · ' + item.schema + ' · PostgreSQL' : item.name + ' · MariaDB';
                return el('option', {value: item.scope_key || item.name, selected: (item.scope_key || item.name) === database},
                    item.available === false ? t('app.databases.unavailable', {name}) : name);
            }));
        }).filter(Boolean));
        this.databaseSelect.setAttribute('aria-label', t('modal.chooseSource'));
        this.database = database;
        this.dialog.classList.toggle('postgres-import', this.isPostgres());
        if (!this.databaseSelect.options.length) this.databaseSelect.append(el('option', {value: database}, database));
        this.databaseSelect.disabled = this.isBusy();
        if (this.isPostgres() && !['import', 'dataset'].includes(this.tab)) this.tab = 'import';
        if (changed && this.isPostgres()) {
            clearInterval(this.poll);
            clearTimeout(this.loadTimeout);
            this.currentUrl = this.lastObserved = '';
            this.fallbackVisible = false;
            this.frame.src = 'about:blank';
            this.external.removeAttribute('href');
        }
        for (const [key, tab] of Object.entries(this.tabButtons)) tab.hidden = key === 'dataset' || this.isPostgres();
        this.tabButtons.import.setAttribute('aria-controls', this.isPostgres() ? 'import-inspection' : 'database-panel');
        this.importInspection.panel.setAttribute('role', this.isPostgres() ? 'tabpanel' : 'region');
        this.importInspection.panel.setAttribute('aria-labelledby', this.isPostgres() ? 'database-tab-import' : 'import-inspection-title');
        this.dialog.querySelector('[data-i18n="modal.description"]').textContent = t(this.isPostgres() ? 'app.postgres.importDescription' : 'modal.description');
        this.datasetImport.configure(database);
        this.tables = tables;
        const scope = parseConnectionScope(database);
        this.name.textContent = scope.connection === 'postgres' ? scope.database + '.' + scope.schema : database;
        const selected = this.table;
        this.tableSelect.replaceChildren(el('option', {value: ''}, t('modal.overview')));
        tables.forEach(table => this.tableSelect.append(el('option', {value: table.name}, table.name + (table.type === 'view' ? ' · view' : ''))));
        this.table = tables.some(table => table.name === selected) ? selected : '';
        this.tableSelect.value = this.table;
    }

    open(table = '', tab = 'browse') {
        if (this.isBusy() || this.isPostgres() || tab === 'dataset') return;
        const available = table && this.tables.some(item => item.name === table);
        this.table = available ? table : '';
        this.tab = this.isPostgres() ? (tab === 'dataset' ? 'dataset' : 'import') : routes[tab] ? tab : 'browse';
        this.tableSelect.value = this.table;
        const nextUrl = this.isPostgres() ? '' : phpMyAdminUrl(this.database, this.table, this.tab);
        if (!this.dialog.open) { this.dialog.showModal(); this.onOpenChange?.(true); }
        // A completed native import can keep the same URL while showing its result.
        // An explicit Import action must open a fresh file form each time.
        if (this.panel.hidden || this.tab === 'dataset' || this.tab === 'import' || nextUrl !== this.currentUrl || this.frame.getAttribute('src') === 'about:blank') this.navigate();
        else this.updateTabs();
        this.pollFrame();
        this.tabButtons[this.tab].focus();
    }

    navigate() {
        if (this.isBusy()) return;
        clearInterval(this.poll);
        this.datasetImport.panel.hidden = this.tab !== 'dataset';
        this.panel.hidden = this.isPostgres() || this.tab === 'dataset';
        this.external.hidden = this.isPostgres() || this.tab === 'dataset';
        this.tableSelect.hidden = this.isPostgres() || this.tab === 'dataset';
        if (this.tab === 'dataset') {
            this.importInspection.close(); this.updateTabs(); clearTimeout(this.loadTimeout);
            this.frameMessage.hidden = true; this.status.textContent = this.database + ' · ' + t('dataset.title');
            return;
        }
        if (this.tab === 'import') this.importInspection.open(this.database);
        else this.importInspection.close();
        this.updateTabs();
        if (this.isPostgres()) {
            clearTimeout(this.loadTimeout);
            this.frameMessage.hidden = true;
            this.status.textContent = this.name.textContent + ' · ' + t('modal.import');
            return;
        }
        this.currentUrl = phpMyAdminUrl(this.database, this.table, this.tab);
        this.lastObserved = this.currentUrl;
        this.external.href = this.currentUrl;
        this.status.textContent = this.database + (this.table ? ' / ' + this.table : '') + ' · ' + this.tabButtons[this.tab].textContent;
        this.fallbackVisible = false;
        this.importUncertain = false;
        this.frameMessage.hidden = false;
        this.frameMessage.replaceChildren(el('span', {class: 'spinner'}), el('span', {}, t('modal.loading')));
        this.frame.title = this.tabButtons[this.tab].textContent + ' — ' + (this.table || this.database);
        this.frame.src = this.currentUrl;
        this.pollFrame();
        clearTimeout(this.loadTimeout);
        this.loadTimeout = setTimeout(() => this.showFallback(), 12000);
    }

    updateTabs() {
        for (const [key, tab] of Object.entries(this.tabButtons)) {
            tab.classList.toggle('active', key === this.tab);
            tab.setAttribute('aria-selected', String(key === this.tab));
            tab.tabIndex = key === this.tab ? 0 : -1;
        }
        this.panel.setAttribute('aria-labelledby', 'database-tab-' + this.tab);
    }

    tabKeydown(event, current) {
        if (this.isBusy()) return;
        const keys = Object.keys(this.tabButtons).filter(key => !this.tabButtons[key].hidden);
        let next = keys.indexOf(current);
        if (event.key === 'ArrowRight') next = (next + 1) % keys.length;
        else if (event.key === 'ArrowLeft') next = (next - 1 + keys.length) % keys.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = keys.length - 1;
        else return;
        event.preventDefault();
        this.tab = keys[next];
        this.navigate();
        this.tabButtons[this.tab].focus();
    }

    checkLoaded() {
        if (this.isPostgres() || this.tab === 'dataset') return;
        try {
            const document = this.frame.contentDocument;
            if (document && this.frame.contentWindow.location.pathname.startsWith('/phpmyadmin/') && document.body) {
                if (/404|500|502|503|504|not found|internal server error|bad gateway|service unavailable|gateway timeout/i.test(document.title)) {
                    this.showFallback(true);
                    return;
                }
                this.frameMessage.hidden = true;
                clearTimeout(this.loadTimeout);
                this.syncLocation();
                this.watchNativeImport();
            }
        } catch {
            this.showFallback(true);
        }
    }

    /** phpMyAdmin may finish its import through AJAX without reloading the iframe. */
    watchNativeImport() {
        if (this.isPostgres() || !this.dialog.open || this.tab !== 'import' || !this.importInspection.database) return;
        try {
            const document = this.frame.contentDocument;
            if (!document?.body || !this.frame.contentWindow.location.pathname.startsWith('/phpmyadmin/')) return;
            const form = document.querySelector('#input_import_file')?.closest('form');
            if (form && !form.dataset.governImportWatch) {
                form.dataset.governImportWatch = '1';
                const observeAccepted = () => {
                    const database = this.database;
                    const previous = new Map([...document.querySelectorAll('.alert-danger, .alert-error, #error_message, .alert-success')]
                        .map(node => [node, {text: node.textContent, child: node.firstChild}]));
                    // Delegated phpMyAdmin handlers run later in this event.
                    // A new task observes their accepted state; a microtask can
                    // run between native listeners before validation has finished.
                    setTimeout(() => {
                        if (this.database !== database || this.isPostgres() || this.tab !== 'import' || !this.dialog.open
                            || document !== this.frame.contentDocument || this.importInspection.submitted) return;
                        if (document.querySelector('#upload_form_status')?.style.display === 'inline') {
                            this.nativeMessagesBefore = previous;
                            this.importInspection.submittedFile();
                        }
                    }, 0);
                };
                form.addEventListener('submit', observeAccepted);
                document.querySelector('#buttonGo')?.addEventListener('click', observeAccepted);
            }
            if (!this.importInspection.submitted) return;
            const changed = node => {
                const before = this.nativeMessagesBefore?.get(node);
                return !before || before.text !== node.textContent || before.child !== node.firstChild;
            };
            const error = [...document.querySelectorAll('.alert-danger, .alert-error, #error_message')].find(changed);
            const success = [...document.querySelectorAll('.alert-success')].find(changed);
            if (error || success) this.importInspection.finishedFile(error?.textContent?.trim() || '');
        } catch {
            this.showFallback(true);
        }
    }

    showFallback(definiteError = false) {
        if (this.isPostgres() || !this.dialog.open) return;
        if (definiteError && this.importInspection.submitted) {
            this.importUncertain = true;
            this.importInspection.finishedFile();
        }
        this.fallbackVisible = true;
        this.frameMessage.hidden = false;
        this.frameMessage.replaceChildren(icon('info'),
            el('div', {}, el('strong', {}, t('modal.unloaded')),
                el('p', {}, t('modal.fallback')),
                this.importUncertain ? el('p', {role: 'alert'}, t('modal.importUncertain')) : null),
            button(t('modal.reload'), () => this.navigate(), {symbol: 'refresh', className: 'button-small'}),
            el('a', {href: this.external.href || this.currentUrl, target: '_blank', rel: 'noopener', class: 'button button-secondary button-small'}, icon('external'), t('modal.openSeparate')));
    }

    syncLocation() {
        if (this.isBusy()) return;
        if (this.isPostgres() || this.tab === 'dataset') return;
        if (!this.dialog.open) return;
        try {
            const location = new URL(this.frame.contentWindow.location.href);
            if (location.origin !== window.location.origin || !location.pathname.startsWith('/phpmyadmin/')) return;
            const next = location.pathname + location.search;
            if (next === this.lastObserved) return;
            this.lastObserved = next;
            this.currentUrl = next;
            this.external.href = next;
            const table = location.searchParams.get('table') || '';
            const database = location.searchParams.get('db') || this.database;
            if (database !== this.database && this.databases.some(item => item.connection !== 'postgres' && item.name === database)) {
                this.configure(database, [], this.databases);
                if (this.tab === 'import') this.importInspection.open(database);
            }
            if (database !== this.database) {
                this.status.textContent = database + (table ? ' / ' + table : '') + ' · phpMyAdmin';
                return;
            }
            // A table may have been created inside phpMyAdmin since the last
            // catalog refresh. Preserve that current context for the outer tabs.
            if (table && !this.tables.some(item => item.name === table)) {
                this.tables = [...this.tables, {name: table, type: 'table'}];
                this.tableSelect.append(el('option', {value: table}, table));
            }
            this.table = table;
            this.tableSelect.value = table;
            const route = location.searchParams.get('route') || '';
            if (route === '/table/import' || route === '/database/import' || route === '/import') this.tab = 'import';
            else if (route === '/table/export' || route === '/database/export' || route === '/export') this.tab = 'export';
            else if (route === '/table/sql' || route === '/database/sql') this.tab = 'sql';
            else if (route === '/table/structure' || route === '/database/structure') this.tab = 'structure';
            else if (route === '/sql') this.tab = 'browse';
            this.updateTabs();
            this.status.textContent = this.database + (table ? ' / ' + table : '') + ' · ' + this.tabButtons[this.tab].textContent;
        } catch {
            // The fallback link remains usable when a browser blocks frame access.
        }
    }

    toggleExpanded() {
        this.shell.resetPosition();
        const expanded = this.dialog.classList.toggle('expanded');
        this.expand.replaceChildren(icon(expanded ? 'collapse' : 'expand'));
        this.expand.setAttribute('aria-pressed', String(expanded));
        this.expand.setAttribute('aria-label', expanded ? t('modal.collapse') : t('modal.expand'));
        this.expand.title = expanded ? t('modal.collapse') : t('modal.expand');
    }
}
