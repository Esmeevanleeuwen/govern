import {t, getLanguage} from './i18n.js';
import './modal-messages.js';
import './database-messages.js';
import {el, icon, button, badge} from './ui.js';

const routes = {
    browse: {table: '/sql', database: '/database/structure'},
    structure: {table: '/table/structure', database: '/database/structure'},
    sql: {table: '/table/sql', database: '/database/sql'},
};

export function phpMyAdminUrl(database, table, tab = 'browse') {
    const route = routes[tab] || routes.browse;
    const params = new URLSearchParams({route: table ? route.table : route.database, db: database, server: '1', lang: getLanguage()});
    if (table) params.set('table', table);
    return '/phpmyadmin/index.php?' + params.toString();
}

export class DatabaseModal {
    constructor(onClose) {
        this.database = '';
        this.tables = [];
        this.databases = [];
        this.table = '';
        this.tab = 'browse';
        this.currentUrl = '';
        this.onClose = onClose;
        this.dialog = el('dialog', {id: 'database-dialog', class: 'database-dialog', 'aria-labelledby': 'database-title'});
        this.name = el('span', {class: 'database-name sr-only'});
        this.databaseSelect = el('select', {id: 'modal-database', class: 'input select modal-database-select',
            'aria-label': t('app.databases.choose'), 'data-i18n-aria': 'app.databases.choose', on: {change: () => {
                this.database = this.databaseSelect.value; this.tables = []; this.table = '';
                this.configure(this.database, [], this.databases); this.navigate();
            }}});
        this.tableSelect = el('select', {id: 'modal-table', class: 'input select modal-table', on: {
            change: () => { this.table = this.tableSelect.value; this.navigate(); },
        }});
        this.external = el('a', {class: 'icon-button', target: '_blank', rel: 'noopener', title: t('modal.externalTitle'), 'aria-label': t('modal.externalLabel')}, icon('external'));
        this.expand = el('button', {type: 'button', class: 'icon-button', title: t('modal.expand'), 'aria-label': t('modal.expand'), 'aria-pressed': 'false', on: {click: () => this.toggleExpanded()}}, icon('expand'));
        this.tabButtons = {};
        const tablist = el('div', {class: 'database-tabs', role: 'tablist', 'aria-label': t('modal.tools')});
        for (const [key, label, symbol] of [['browse', 'Browse', 'table'], ['structure', 'Structure', 'layers'], ['sql', 'SQL', 'code']]) {
            const tab = el('button', {type: 'button', class: 'database-tab', id: 'database-tab-' + key, role: 'tab', 'aria-controls': 'database-panel', 'aria-selected': 'false', on: {
                click: () => { this.tab = key; this.navigate(); },
                keydown: event => this.tabKeydown(event, key),
            }}, icon(symbol), label);
            this.tabButtons[key] = tab;
            tablist.append(tab);
        }
        this.frame = el('iframe', {id: 'database-frame', title: t('modal.frameTitle'), src: 'about:blank', referrerpolicy: 'same-origin'});
        this.frame.addEventListener('load', () => this.checkLoaded());
        this.frame.addEventListener('error', () => this.showFallback());
        this.frameMessage = el('div', {class: 'frame-message', role: 'status'});
        this.status = el('span', {}, t('modal.ready'));
        this.panel = el('div', {id: 'database-panel', class: 'database-frame-panel', role: 'tabpanel', 'aria-labelledby': 'database-tab-browse'}, this.frame, this.frameMessage);
        this.dialog.append(
            el('div', {class: 'database-dialog-header'},
                el('div', {class: 'database-dialog-title'}, el('span', {class: 'database-dialog-icon'}, icon('database')),
                    el('div', {}, el('h2', {id: 'database-title', 'data-i18n': 'modal.title'}, t('modal.title')), el('p', {'data-i18n': 'modal.description'}, t('modal.description')))),
                el('div', {class: 'modal-tools'}, this.external, this.expand,
                    this.closeButton = button(t('modal.close'), () => this.dialog.close(), {symbol: 'close', className: 'button-small'}))),
            el('div', {class: 'database-toolbar'}, tablist,
                el('div', {class: 'database-context'},
                    el('div', {class: 'modal-database'}, icon('database'), this.name, this.databaseSelect),
                    el('label', {class: 'sr-only', for: 'modal-table', 'data-i18n': 'modal.table'}, t('modal.table')), this.tableSelect)),
            this.panel,
            el('div', {class: 'database-dialog-footer'}, el('span', {class: 'status-dot'}), this.status,
                el('span', {class: 'modal-footer-hint', 'data-i18n': 'modal.footerHint'}, t('modal.footerHint'))));
        this.fallbackVisible = false;
        this.dialog.addEventListener('close', () => {
            clearInterval(this.poll);
            clearTimeout(this.loadTimeout);
            this.onClose?.();
        });
        document.body.append(this.dialog);
    }

    /** Translate the shell without reloading an active phpMyAdmin form or SQL draft. */
    refreshLanguage() {
        this.dialog.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        this.external.title = t('modal.externalTitle');
        this.external.setAttribute('aria-label', t('modal.externalLabel'));
        const expandLabel = t(this.dialog.classList.contains('expanded') ? 'modal.collapse' : 'modal.expand');
        this.expand.title = expandLabel;
        this.expand.setAttribute('aria-label', expandLabel);
        this.closeButton.querySelector('span').textContent = t('modal.close');
        this.closeButton.setAttribute('aria-label', t('modal.close'));
        this.dialog.querySelector('[role="tablist"]').setAttribute('aria-label', t('modal.tools'));
        if (this.dialog.open) this.syncLocation();
        this.configure(this.database, this.tables, this.databases);
        this.frame.title = this.currentUrl
            ? this.tabButtons[this.tab].textContent + ' — ' + (this.table || this.database)
            : t('modal.frameTitle');
        if (!this.currentUrl) this.status.textContent = t('modal.ready');
        const url = new URL(this.currentUrl || phpMyAdminUrl(this.database, this.table, this.tab), window.location.origin);
        url.searchParams.set('lang', getLanguage());
        this.external.href = url.pathname + url.search;
        // The frame itself picks up the new language on the next deliberate
        // open, tab/table change or reload. A cross-tab preference event must
        // never discard an unsaved form inside the official application.
        if (this.fallbackVisible) this.showFallback();
    }

    configure(database, tables, databases = this.databases) {
        this.databases = databases;
        this.databaseSelect.replaceChildren(...databases.map(item => el('option', {value: item.name, selected: item.name === database}, item.name)));
        this.databaseSelect.setAttribute('aria-label', t('app.databases.choose'));
        this.database = database;
        this.tables = tables;
        this.name.textContent = database;
        const selected = this.table;
        this.tableSelect.replaceChildren(el('option', {value: ''}, t('modal.overview')));
        tables.forEach(table => this.tableSelect.append(el('option', {value: table.name}, table.name + (table.type === 'view' ? ' · view' : ''))));
        this.table = tables.some(table => table.name === selected) ? selected : '';
        this.tableSelect.value = this.table;
    }

    open(table = '', tab = 'browse') {
        const available = table && this.tables.some(item => item.name === table);
        this.table = available ? table : '';
        this.tab = routes[tab] ? tab : 'browse';
        this.tableSelect.value = this.table;
        const nextUrl = phpMyAdminUrl(this.database, this.table, this.tab);
        if (!this.dialog.open) this.dialog.showModal();
        if (nextUrl !== this.currentUrl || this.frame.getAttribute('src') === 'about:blank') this.navigate();
        else this.updateTabs();
        clearInterval(this.poll);
        this.poll = setInterval(() => this.syncLocation(), 800);
        this.tabButtons[this.tab].focus();
    }

    navigate() {
        this.updateTabs();
        this.currentUrl = phpMyAdminUrl(this.database, this.table, this.tab);
        this.lastObserved = this.currentUrl;
        this.external.href = this.currentUrl;
        this.status.textContent = this.database + (this.table ? ' / ' + this.table : '') + ' · ' + this.tabButtons[this.tab].textContent;
        this.fallbackVisible = false;
        this.frameMessage.hidden = false;
        this.frameMessage.replaceChildren(el('span', {class: 'spinner'}), el('span', {}, t('modal.loading')));
        this.frame.title = this.tabButtons[this.tab].textContent + ' — ' + (this.table || this.database);
        this.frame.src = this.currentUrl;
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
        const keys = Object.keys(this.tabButtons);
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
        try {
            const document = this.frame.contentDocument;
            if (document && this.frame.contentWindow.location.pathname.startsWith('/phpmyadmin/') && document.body) {
                if (/404|502|503|not found|bad gateway|service unavailable/i.test(document.title)) {
                    this.showFallback();
                    return;
                }
                this.frameMessage.hidden = true;
                clearTimeout(this.loadTimeout);
                this.syncLocation();
            }
        } catch {
            this.showFallback();
        }
    }

    showFallback() {
        if (!this.dialog.open) return;
        this.fallbackVisible = true;
        this.frameMessage.hidden = false;
        this.frameMessage.replaceChildren(icon('info'),
            el('div', {}, el('strong', {}, t('modal.unloaded')),
                el('p', {}, t('modal.fallback'))),
            button(t('modal.reload'), () => this.navigate(), {symbol: 'refresh', className: 'button-small'}),
            el('a', {href: this.external.href || this.currentUrl, target: '_blank', rel: 'noopener', class: 'button button-secondary button-small'}, icon('external'), t('modal.openSeparate')));
    }

    syncLocation() {
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
            if (database !== this.database && this.databases.some(item => item.name === database)) {
                this.configure(database, [], this.databases);
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
            if (route === '/table/sql' || route === '/database/sql') this.tab = 'sql';
            else if (route === '/table/structure' || route === '/database/structure') this.tab = 'structure';
            else if (route === '/sql') this.tab = 'browse';
            this.updateTabs();
            this.status.textContent = this.database + (table ? ' / ' + table : '') + ' · ' + this.tabButtons[this.tab].textContent;
        } catch {
            // The fallback link remains usable when a browser blocks frame access.
        }
    }

    toggleExpanded() {
        const expanded = this.dialog.classList.toggle('expanded');
        this.expand.replaceChildren(icon(expanded ? 'collapse' : 'expand'));
        this.expand.setAttribute('aria-pressed', String(expanded));
        this.expand.setAttribute('aria-label', expanded ? t('modal.collapse') : t('modal.expand'));
        this.expand.title = expanded ? t('modal.collapse') : t('modal.expand');
    }
}
