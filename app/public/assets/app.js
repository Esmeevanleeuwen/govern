import {request, setCsrf, endpoint} from './api.js';
import {el, icon, button, badge, heading, loading, empty, errorPanel, errorText, notice, dataTable, number, fileSize, dateTime, quoteIdentifier, toast, copyText, sqlDisclosure, confirmAction} from './ui.js';
import {DatabaseModal} from './database-modal.js';
import {QueryBuilder} from './query-builder.js';
import {t, getLanguage, setLanguage} from './i18n.js';
import {getPreferences, updatePreferences, resetAppearance, subscribePreferences} from './preferences.js';
import {createDashboardLayout} from './dashboard-layout.js';
import {mountSchemaVisualizer} from './schema-visualizer.js';
import './app-messages.js';
import './workspace-messages.js';
import './navigation-messages.js';

setLanguage(getPreferences().language);

const routes = {
    overzicht: {labelKey: 'app.route.overview', icon: 'grid'},
    gegevens: {labelKey: 'app.route.data', icon: 'table'},
    structuur: {labelKey: 'app.route.structure', icon: 'layers'},
    schema: {labelKey: 'app.route.schema', icon: 'network'},
    onderzoeken: {labelKey: 'app.route.research', icon: 'search'},
    experimenten: {labelKey: 'app.route.experiments', icon: 'flask'},
    instellingen: {labelKey: 'app.route.settings', icon: 'settings'},
};
const state = {
    bootstrap: null,
    table: '',
    queryDraft: '',
    queryName: '',
    queryNotes: '',
    queryId: null,
    queryResult: null,
    queryRevision: 0,
    queryDesign: null,
    builderDraft: null,
    builderOpen: true,
    restoring: false,
    dataViews: new Map(),
    catalogSearch: {},
    snapshotLabel: '',
    savedQueries: null,
    queryDirty: false,
    savingQuery: false,
    creatingSnapshot: false,
    connectionError: null,
    queryError: null,
    querySaveError: null,
    snapshotError: null,
    schemaData: null,
    schemaView: {},
    databaseView: 'gegevens',
    contextOpen: {database: true, research: true, experiments: true},
    structureData: new Map(),
    inspectorExpanded: {},
    explorerScroll: {},
};
const blockRegistry = [
    {id: 'overview.tables', titleKey: 'app.dashboard.tables', defaultSize: 'wide'},
    {id: 'overview.research', titleKey: 'app.dashboard.research', defaultSize: 'small'},
    {id: 'overview.learning', titleKey: 'app.dashboard.learning', defaultSize: 'small'},
    {id: 'overview.restore', titleKey: 'app.dashboard.restore', defaultSize: 'wide'},
];
const dashboard = createDashboardLayout(blockRegistry);
const page = document.getElementById('page');
const globalNotice = document.getElementById('global-notice');
const openDatabase = document.getElementById('open-database');
const refreshButton = document.getElementById('refresh-app');
const navigation = document.getElementById('navigation');
const workspaceContext = document.getElementById('workspace-context');
const contextContent = document.getElementById('workspace-context-content');
const panelToggle = document.getElementById('workspace-panel-toggle');
const databaseViews = ['gegevens', 'structuur', 'schema'];
let currentScope;
let bootstrapController;
let routeVersion = 0;

const databaseModal = new DatabaseModal(() => {
    if (!state.restoring) refreshBootstrap(false).then(() => {
        if (!databaseModal.dialog.open && document.activeElement === document.body) openDatabase.focus();
    }).catch(error => toast(errorText(error), 'error'));
});
for (const [area, key, labelKey, symbol] of [
    ['overview', 'overzicht', 'app.route.overview', 'grid'],
    ['database', 'gegevens', 'app.navigation.database', 'database'],
    ['research', 'onderzoeken', 'app.route.research', 'search'],
    ['experiments', 'experimenten', 'app.route.experiments', 'flask'],
]) {
    navigation.append(el('a', {class: 'nav-link', href: '#' + key, 'data-route': key, 'data-area': area},
        icon(symbol), el('span', {'data-i18n': labelKey}, t(labelKey))));
}
document.getElementById('settings-link').prepend(icon('settings'));
document.getElementById('settings-link').dataset.route = 'instellingen';
document.getElementById('language-icon').append(icon('globe'));
document.getElementById('language-select').addEventListener('change', event => changePreference({language: event.target.value}));
openDatabase.prepend(icon('database'));
openDatabase.addEventListener('click', () => databaseModal.open(state.table, 'browse'));
refreshButton.append(icon('refresh'));
refreshButton.addEventListener('click', () => refreshBootstrap(true));
document.getElementById('context-export').prepend(icon('download'));
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const mobileViewport = window.matchMedia('(max-width: 820px)');
menuToggle.append(icon('menu'));
menuToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    syncSidebar();
    if (open) navigation.querySelector('[aria-current="page"]')?.focus();
});
navigation.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const area = workspaceArea();
    if (link.dataset.area === area && Object.hasOwn(state.contextOpen, area)) {
        event.preventDefault(); toggleWorkspaceContext();
    } else closeSidebar();
});
document.getElementById('settings-link').addEventListener('click', closeSidebar);
mobileViewport.addEventListener('change', () => {
    if (!mobileViewport.matches) document.body.classList.remove('sidebar-open');
    syncSidebar();
});
document.addEventListener('click', event => {
    const fromMenu = event.composedPath().some(node => ['sidebar', 'menu-toggle', 'workspace-explorer-open'].includes(node.id));
    if (document.body.classList.contains('sidebar-open') && !fromMenu) closeSidebar();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSidebar();
});

function closeSidebar() {
    const returnFocus = mobileViewport.matches && sidebar.contains(document.activeElement);
    document.body.classList.remove('sidebar-open');
    syncSidebar();
    if (returnFocus) menuToggle.focus({preventScroll: true});
}

function syncSidebar() {
    const open = document.body.classList.contains('sidebar-open');
    const hidden = mobileViewport.matches && !open;
    sidebar.inert = hidden || state.restoring;
    sidebar.setAttribute('aria-hidden', String(hidden));
    menuToggle.setAttribute('aria-expanded', String(open));
    syncWorkspaceNavigation();
}

function workspaceArea(name = route().name) {
    return databaseViews.includes(name) ? 'database' : ({overzicht: 'overview', onderzoeken: 'research', experimenten: 'experiments', instellingen: 'settings'}[name]);
}

function isExplorerOpen() {
    const area = workspaceArea();
    return Boolean(state.contextOpen[area]) && (!mobileViewport.matches || document.body.classList.contains('sidebar-open'));
}

function syncWorkspaceNavigation() {
    const area = workspaceArea();
    const hasContext = Object.hasOwn(state.contextOpen, area);
    const expanded = hasContext && state.contextOpen[area];
    workspaceContext.hidden = !hasContext || !isExplorerOpen();
    sidebar.classList.toggle('has-context', expanded);
    document.getElementById('workspace-context-title').textContent = t({database: 'app.navigation.tables', research: 'app.navigation.saved', experiments: 'app.navigation.snapshots'}[area] || 'app.shell.workspace');
    panelToggle.setAttribute('aria-expanded', String(expanded));
    panelToggle.setAttribute('aria-label', t('app.navigation.hide'));
    const workspaceOpener = document.getElementById('workspace-explorer-open');
    if (workspaceOpener) {
        workspaceOpener.hidden = isExplorerOpen();
        workspaceOpener.setAttribute('aria-expanded', String(isExplorerOpen()));
    }
    const databaseLink = navigation.querySelector('[data-area="database"]');
    databaseLink.dataset.route = state.databaseView;
    databaseLink.href = databaseHash(state.databaseView);
    for (const link of document.querySelectorAll('#navigation [data-area], #settings-link')) {
        const active = link.dataset.area === area;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        if (Object.hasOwn(state.contextOpen, link.dataset.area)) {
            link.setAttribute('aria-expanded', String(active && isExplorerOpen()));
            link.setAttribute('aria-controls', 'workspace-context');
        }
    }
    document.dispatchEvent(new CustomEvent('govern:explorerchange', {detail: {open: isExplorerOpen()}}));
}

function databaseHash(name) {
    return '#' + name + (state.table ? '?' + new URLSearchParams({table: state.table}) : '');
}

function openWorkspaceContext() {
    const area = workspaceArea();
    if (!Object.hasOwn(state.contextOpen, area)) return;
    state.contextOpen[area] = true;
    if (mobileViewport.matches) document.body.classList.add('sidebar-open');
    syncSidebar();
    contextContent.querySelector('input, button, a')?.focus({preventScroll: true});
}

function toggleWorkspaceContext() {
    const area = workspaceArea();
    if (!Object.hasOwn(state.contextOpen, area)) return;
    if (!isExplorerOpen()) { openWorkspaceContext(); return; }
    state.contextOpen[area] = false;
    if (mobileViewport.matches) closeSidebar(); else syncSidebar();
    (document.getElementById('workspace-explorer-open') || navigation.querySelector('[aria-current="page"]'))?.focus({preventScroll: true});
}
panelToggle.append(icon('chevron'));
panelToggle.addEventListener('click', toggleWorkspaceContext);
syncSidebar();

function localizeShell() {
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
    document.querySelectorAll('[data-i18n-title]').forEach(node => node.title = t(node.dataset.i18nTitle));
    document.getElementById('language-select').value = getLanguage();
    if (state.connectionError) document.getElementById('connection-state').replaceChildren(el('span', {class: 'status-dot offline'}), el('span', {}, t('app.core.connection.offline')));
    else if (state.bootstrap) document.getElementById('connection-state').replaceChildren(el('span', {class: 'status-dot ' + (state.bootstrap.database.status === 'unavailable' ? 'offline' : '')}), el('span', {}, t(state.bootstrap.database.status === 'unavailable' ? 'app.core.connection.offline' : 'app.navigation.ready')));
    const current = routes[route().name];
    document.getElementById('breadcrumb-current').textContent = t(current.labelKey);
    document.title = t(current.labelKey) + ' — Govern';
    document.querySelector('meta[name="description"]').content = t('app.shell.description');
    syncWorkspaceNavigation();
}

function preferenceFeedback(saved) {
    const status = document.getElementById('preferences-status');
    if (status) status.textContent = t(saved ? 'app.settings.saved' : 'app.settings.storageUnavailable');
    if (!saved) toast(t('app.settings.storageUnavailable'), 'error');
}

function changePreference(patch, options = {}) {
    const result = updatePreferences(patch, options);
    if (options.persist !== false) preferenceFeedback(result.saved);
    return result;
}

function syncSettingControls() {
    const preferences = getPreferences();
    document.querySelectorAll('[data-preference]').forEach(node => {
        const value = preferences[node.dataset.preference];
        if (node.type === 'checkbox') node.checked = value;
        else node.value = value;
    });
    document.querySelectorAll('[data-accent]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.accent === preferences.accent)));
    document.querySelectorAll('[data-sidebar-choice]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.sidebarChoice === preferences.sidebar)));
    const accent = document.getElementById('preference-accent-value');
    if (accent) accent.textContent = preferences.accent.toUpperCase();
}

window.addEventListener('govern:languagechange', () => {
    const active = document.activeElement;
    const focused = active?.id;
    const caret = active && typeof active.selectionStart === 'number' ? {start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection, top: active.scrollTop, left: active.scrollLeft} : null;
    const scroll = {left: window.scrollX, top: window.scrollY};
    localizeShell();
    databaseModal.refreshLanguage();
    render();
    const restored = focused ? document.getElementById(focused) : null;
    restored?.focus({preventScroll: true});
    if (restored && caret && typeof restored.setSelectionRange === 'function') {
        restored.setSelectionRange(caret.start, caret.end, caret.direction);
        restored.scrollTop = caret.top; restored.scrollLeft = caret.left;
    }
    window.scrollTo(scroll);
});
subscribePreferences(preferences => {
    if (preferences.language !== getLanguage()) setLanguage(preferences.language);
    else { localizeShell(); syncSettingControls(); }
});
localizeShell();

function route() {
    const [name, query = ''] = window.location.hash.slice(1).split('?');
    return {name: routes[name] ? name : 'overzicht', params: new URLSearchParams(query)};
}

function go(name, params = {}) {
    const search = new URLSearchParams(params).toString();
    const hash = '#' + name + (search ? '?' + search : '');
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
}

function tables() {
    return state.bootstrap?.tables || [];
}

function activeTable(params) {
    const supplied = params.get('table');
    if (supplied && tables().some(table => table.name === supplied)) state.table = supplied;
    if (!tables().some(table => table.name === state.table)) {
        state.table = (tables().find(table => table.type === 'table' && Number(table.rows_estimate) > 0) || tables()[0])?.name || '';
    }
    return tables().find(table => table.name === state.table);
}

function defaultSql(table = state.table || tables()[0]?.name) {
    return table ? 'SELECT *\nFROM ' + quoteIdentifier(table) + '\nLIMIT 20;' : 'SELECT VERSION() AS databaseversie;';
}

async function openResearch(sql) {
    if (!await mayReplaceResearch()) return;
    state.queryRevision += 1;
    state.queryDraft = sql;
    state.queryId = null;
    state.queryName = '';
    state.queryNotes = '';
    state.queryResult = null;
    state.queryDesign = null;
    state.queryDirty = false;
    state.queryError = null;
    state.querySaveError = null;
    go('onderzoeken');
}

function localized(data, field) {
    return data?.[field + '_i18n']?.[getLanguage()] ?? data?.[field];
}

function renderConnectionNotice() {
    globalNotice.replaceChildren();
    if (state.connectionError && state.bootstrap) globalNotice.append(errorPanel(state.connectionError, () => refreshBootstrap()));
    else if (state.bootstrap?.warning) globalNotice.append(notice(t('app.core.connection.warningRecovery', {warning: localized(state.bootstrap, 'warning')}), 'notice-warning'));
}

function syncRestoreControls() {
    openDatabase.disabled = state.restoring || !state.bootstrap;
    document.getElementById('language-select').disabled = state.restoring;
    menuToggle.disabled = state.restoring;
    refreshButton.disabled = state.restoring;
    syncSnapshotControls();
    syncSidebar();
}

function syncSnapshotControls() {
    const busy = state.restoring || state.creatingSnapshot;
    document.querySelectorAll('[data-snapshot-action]').forEach(control => { control.disabled = busy; });
}

async function refreshBootstrap(notify = false) {
    bootstrapController?.abort();
    bootstrapController = new AbortController();
    refreshButton.disabled = true;
    try {
        const data = await request('bootstrap', {signal: bootstrapController.signal});
        state.bootstrap = data;
        state.connectionError = null;
        state.savedQueries = null;
        state.schemaData = null;
        state.structureData.clear();
        setCsrf(data.csrf);
        databaseModal.configure(data.database.name, data.tables || []);
        openDatabase.disabled = false;
        const ready = data.database.status !== 'unavailable';
        document.getElementById('connection-state').replaceChildren(
            el('span', {class: 'status-dot ' + (ready ? '' : 'offline')}),
            el('span', {title: data.database.name}, t(ready ? 'app.navigation.ready' : 'app.core.connection.offline')));
        document.getElementById('footer-database').textContent = data.database.name + (data.database.version ? ' · ' + data.database.version : '');
        const workspaceName = document.getElementById('workspace-database');
        workspaceName.removeAttribute('data-i18n');
        workspaceName.textContent = data.database.name;
        workspaceName.title = data.database.name;
        renderConnectionNotice();
        render();
        if (notify) toast(t('app.core.connection.updated'));
    } catch (error) {
        if (error.name === 'AbortError') return;
        state.connectionError = error;
        if (!state.bootstrap) {
            page.replaceChildren(heading(t('app.core.connection.eyebrow'), t('app.core.connection.title'), t('app.core.connection.help')),
                errorPanel(error, () => refreshBootstrap()));
        } else globalNotice.replaceChildren(errorPanel(error, () => refreshBootstrap()));
        document.getElementById('connection-state').replaceChildren(el('span', {class: 'status-dot offline'}), el('span', {}, t('app.core.connection.offline')));
    } finally {
        refreshButton.disabled = state.restoring;
    }
}

function render() {
    const location = route();
    if (!state.bootstrap && location.name !== 'instellingen') {
        if (state.connectionError) page.replaceChildren(heading(t('app.core.connection.eyebrow'), t('app.core.connection.title'), t('app.core.connection.help')), errorPanel(state.connectionError, () => refreshBootstrap()));
        return;
    }
    if (currentScope) state.explorerScroll[currentScope.area] = {
        top: contextContent.scrollTop,
        list: contextContent.querySelector('.catalog-list, .schema-index')?.scrollTop || 0,
    };
    currentScope?.controller.abort();
    currentScope?.cleanup.forEach(callback => callback());
    const version = ++routeVersion;
    const controller = new AbortController();
    const scope = {controller, signal: controller.signal, cleanup: [], area: workspaceArea(location.name), live: () => version === routeVersion && !controller.signal.aborted};
    currentScope = scope;
    activeTable(location.params);
    if (databaseViews.includes(location.name)) state.databaseView = location.name;
    syncWorkspaceNavigation();
    refreshButton.hidden = location.name === 'schema';
    document.getElementById('breadcrumb-current').textContent = t(routes[location.name].labelKey);
    document.title = t(routes[location.name].labelKey) + ' — Govern';
    renderConnectionNotice();
    page.replaceChildren();
    contextContent.replaceChildren();
    const views = {overzicht: renderOverview, gegevens: renderData, structuur: renderStructure, schema: renderSchema, onderzoeken: renderResearch, experimenten: renderExperiments, instellingen: renderSettings};
    Promise.resolve(views[location.name](scope)).catch(error => {
        if (error.name !== 'AbortError' && scope.live()) page.append(errorPanel(error, () => render()));
    });
    restoreExplorerScroll(scope.area);
}

function restoreExplorerScroll(area) {
    const scroll = state.explorerScroll[area];
    if (!scroll) return;
    contextContent.scrollTop = scroll.top;
    const list = contextContent.querySelector('.catalog-list, .schema-index');
    if (list) list.scrollTop = scroll.list;
}

function renderOverview(scope) {
    const data = state.bootstrap;
    const edit = button(t('app.layout.edit'), () => { dashboard.begin(); draw(); }, {symbol: 'layout', id: 'edit-layout'});
    page.append(heading(t('app.dashboard.eyebrow'), t('app.dashboard.title'), '', [edit]));
    const toolbar = el('div');
    const heroTitle = el('h2', {id: 'hero-title'});
    t('app.dashboard.heroTitle').split('\n').forEach((part, index) => { if (index) heroTitle.append(el('br')); heroTitle.append(document.createTextNode(part)); });
    page.append(toolbar, el('section', {class: 'hero-card', 'aria-labelledby': 'hero-title'},
        el('div', {}, heroTitle, el('p', {}, t('app.dashboard.heroHelp')),
            el('div', {class: 'hero-actions'},
                button(t('app.dashboard.explore'), () => go('gegevens'), {kind: 'primary', symbol: 'arrow'}),
                button(t('app.dashboard.build'), () => openResearch(defaultSql()), {kind: 'ghost'}))),
        el('div', {class: 'hero-visual', 'aria-hidden': 'true'}, el('div', {class: 'hero-lens'}))));
    page.append(el('div', {class: 'stats-grid'}, [
        ['tablesStat', data.stats.tables], ['viewsStat', data.stats.views], ['rowsStat', data.stats.rows_estimate],
    ].map(([key, value]) => el('div', {class: 'stat-card'},
        el('strong', {class: 'stat-value'}, number(value)), el('p', {}, t('app.dashboard.' + key))))));
    const grid = el('div', {class: 'dashboard-grid'});
    const hidden = el('div', {class: 'layout-hidden'});
    const announcement = el('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'});
    page.append(grid, hidden, announcement);
    let dragged = null;

    function announceMove(id) {
        const blocks = dashboard.getBlocks();
        const block = blocks.find(item => item.id === id);
        if (block) announcement.textContent = t('app.layout.moved', {title: t(block.titleKey), position: blocks.findIndex(item => item.id === id) + 1});
    }

    function draw() {
        const editing = dashboard.isEditing();
        edit.hidden = editing;
        toolbar.replaceChildren();
        if (editing) toolbar.append(el('div', {class: 'layout-toolbar'},
            el('div', {}, el('strong', {}, t('app.layout.title')), el('p', {}, t('app.layout.help'))),
            el('div', {class: 'layout-toolbar-actions'},
                button(t('app.layout.reset'), () => { dashboard.reset(); draw(); }),
                button(t('app.layout.cancel'), () => { dashboard.cancel(); draw(); edit.focus(); toast(t('app.layout.cancelled')); }, {id: 'cancel-layout'}),
                button(t('app.layout.save'), () => {
                    const result = dashboard.commit(); draw(); edit.focus();
                    toast(t(result.saved ? 'app.layout.saved' : 'app.settings.storageUnavailable'), result.saved ? 'success' : 'error');
                }, {kind: 'primary', id: 'save-layout'}))));
        const blocks = dashboard.getBlocks();
        grid.replaceChildren();
        if (!blocks.length) grid.append(el('section', {class: 'card dashboard-block', 'data-size': 'full'},
            empty(t('app.layout.empty'), t('app.layout.emptyHelp'), button(t('app.layout.showAll'), () => {
                if (!dashboard.isEditing()) dashboard.begin();
                dashboard.getBlocks({includeHidden: true}).forEach(block => dashboard.setHidden(block.id, false));
                if (!editing) {
                    const result = dashboard.commit();
                    if (!result.saved) toast(t('app.settings.storageUnavailable'), 'error');
                }
                draw();
            }), 'layout')));
        blocks.forEach((definition, index) => {
            const title = t(definition.titleKey);
            const block = el('section', {class: 'card dashboard-block', 'data-block-id': definition.id, 'data-size': definition.size, 'data-editing': editing ? 'true' : null});
            if (editing) {
                const move = offset => {
                    dashboard.move(definition.id, offset); draw(); announceMove(definition.id);
                    const candidate = grid.querySelector('[data-block-move="' + definition.id + '"][data-direction="' + offset + '"]');
                    if (candidate && !candidate.disabled) candidate.focus();
                    else grid.querySelector('[data-block-size="' + definition.id + '"]')?.focus();
                };
                const grip = button(t('app.layout.move', {title}), () => { announcement.textContent = t('app.layout.help'); }, {symbol: 'grip', className: 'block-drag icon-button', draggable: 'true'});
                grip.querySelector('span').className = 'sr-only';
                grip.addEventListener('keydown', event => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(event.key === 'ArrowUp' ? -1 : 1); }
                });
                grip.addEventListener('dragstart', event => {
                    dragged = definition.id;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', definition.id);
                });
                grip.addEventListener('dragend', () => { dragged = null; grid.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over')); });
                const size = el('select', {class: 'input', 'data-block-size': definition.id, 'aria-label': t('app.layout.width', {title})},
                    definition.allowedSizes.map(value => el('option', {value, selected: value === definition.size}, t('app.layout.' + value))));
                size.addEventListener('change', () => { dashboard.setSize(definition.id, size.value); draw(); grid.querySelector('[data-block-size="' + definition.id + '"]')?.focus(); });
                const earlier = button(t('app.layout.up', {title}), () => move(-1), {symbol: 'up', className: 'icon-button', disabled: index === 0, 'data-block-move': definition.id, 'data-direction': '-1'});
                const later = button(t('app.layout.down', {title}), () => move(1), {symbol: 'down', className: 'icon-button', disabled: index === blocks.length - 1, 'data-block-move': definition.id, 'data-direction': '1'});
                const hide = button(t('app.layout.hide', {title}), () => {
                    dashboard.setHidden(definition.id, true); draw();
                    hidden.querySelector('[data-block-show="' + definition.id + '"]')?.focus();
                }, {symbol: 'eye', className: 'icon-button', 'data-block-hide': definition.id});
                [earlier, later, hide].forEach(node => { node.querySelector('span').className = 'sr-only'; });
                block.append(el('div', {class: 'block-toolbar'}, grip, earlier, later, size, hide));
                block.addEventListener('dragover', event => { if (dragged && dragged !== definition.id) {
                    event.preventDefault(); block.classList.add('drag-over');
                    const bounds = block.getBoundingClientRect();
                    block.dataset.dropPosition = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
                } });
                block.addEventListener('dragleave', event => { if (!block.contains(event.relatedTarget)) { block.classList.remove('drag-over'); delete block.dataset.dropPosition; } });
                block.addEventListener('drop', event => {
                    if (!dragged) return;
                    event.preventDefault(); const id = dragged; dragged = null;
                    const visible = dashboard.getBlocks().filter(item => item.id !== id);
                    const destination = block.dataset.dropPosition === 'after' ? (visible[visible.findIndex(item => item.id === definition.id) + 1]?.id || null) : definition.id;
                    dashboard.moveBefore(id, destination); draw(); announceMove(id);
                    grid.querySelector('[data-block-size="' + id + '"]')?.focus();
                });
            }
            block.append(el('div', {class: 'card-header'}, el('h2', {}, title), icon({
                'overview.tables': 'table', 'overview.research': 'bookmark', 'overview.learning': 'book', 'overview.restore': 'clock',
            }[definition.id])));
            appendDashboardContent(block, definition.id, scope);
            grid.append(block);
        });
        const hiddenBlocks = dashboard.getBlocks({includeHidden: true}).filter(block => block.hidden);
        hidden.replaceChildren();
        hidden.hidden = !hiddenBlocks.length;
        if (hiddenBlocks.length) hidden.append(el('h3', {}, t('app.layout.hidden')), el('div', {class: 'layout-hidden-actions'},
            hiddenBlocks.map(block => button(t('app.layout.show', {title: t(block.titleKey)}), () => {
                const alreadyEditing = dashboard.isEditing();
                if (!alreadyEditing) dashboard.begin();
                dashboard.setHidden(block.id, false);
                if (!alreadyEditing) { const result = dashboard.commit(); if (!result.saved) toast(t('app.settings.storageUnavailable'), 'error'); }
                draw();
            }, {'data-block-show': block.id, symbol: 'plus'}))));
    }
    const unsubscribe = dashboard.subscribe((_layout, info) => { if (info.reason === 'storage' && scope.live()) draw(); });
    scope.cleanup.push(unsubscribe);
    draw();
}

function appendDashboardContent(block, id, scope) {
    if (id === 'overview.tables') {
        const featured = [...tables()].sort((a, b) => Number(b.rows_estimate || 0) - Number(a.rows_estimate || 0)).slice(0, 4);
        const list = el('div', {class: 'home-table-list'});
        featured.forEach(table => list.append(el('button', {class: 'home-table-item', type: 'button', on: {click: () => go('gegevens', {table: table.name})}},
            icon(table.type === 'view' ? 'layers' : 'table'),
            el('span', {}, el('span', {class: 'home-table-name'}, table.name), el('span', {class: 'home-table-detail'},
                t('app.dashboard.tableDetail', {count: number(table.columns), type: t(table.type === 'view' ? 'app.dashboard.view' : 'app.dashboard.table')}))), icon('external', 'row-chevron'))));
        if (!featured.length) list.append(empty(t('app.dashboard.noTables'), t('app.dashboard.noTablesHelp')));
        block.append(list, el('div', {class: 'card-body'}, button(t('app.dashboard.viewAll'), () => go('gegevens'), {kind: 'ghost', symbol: 'arrow'})));
    } else if (id === 'overview.research') {
        const content = el('div', {class: 'card-body'}, loading()); block.append(content);
        const draw = queries => {
            if (!scope.live() || !content.isConnected) return;
            content.replaceChildren();
            if (!queries.length) content.append(el('h3', {}, t('app.dashboard.noResearch')), el('p', {}, t('app.dashboard.noResearchHelp')));
            queries.slice(0, 4).forEach(query => content.append(el('button', {class: 'home-table-item', type: 'button', on: {click: async () => {
                if (!await mayReplaceResearch()) return;
                state.queryRevision += 1; state.queryId = query.id; state.queryDraft = query.sql; state.queryName = query.name; state.queryNotes = query.notes || '';
                state.queryResult = null; state.queryDesign = null; state.queryDirty = false; state.queryError = null; state.querySaveError = null; go('onderzoeken');
            }}}, icon('code'), el('span', {}, query.name))));
            content.append(button(t('app.dashboard.newResearch'), () => openResearch(defaultSql()), {kind: 'ghost', symbol: 'plus'}));
        };
        if (state.savedQueries) queueMicrotask(() => draw(state.savedQueries));
        else request('queries', {signal: scope.signal}).then(queries => { state.savedQueries = queries; draw(queries); }).catch(error => {
            if (error.name !== 'AbortError' && scope.live() && content.isConnected) content.replaceChildren(errorPanel(error));
        });
    } else if (id === 'overview.learning') {
        block.append(el('div', {class: 'card-body'}, [['stepExplore', 'gegevens'], ['stepConnect', 'structuur'], ['stepQuery', 'onderzoeken']].map(([key, target], i) =>
            el('button', {class: 'home-table-item', type: 'button', on: {click: () => go(target)}}, el('span', {class: 'step-number'}, String(i + 1)), el('span', {}, t('app.dashboard.' + key))))));
    } else if (id === 'overview.restore') {
        block.append(el('div', {class: 'card-body'}, el('p', {}, t('app.dashboard.restoreHelp')),
            button(t('app.dashboard.createRestore'), () => go('experimenten'), {symbol: 'plus'})));
    }
}

async function mayReplaceResearch() {
    if (!state.queryDirty) return true;
    return Boolean(await confirmAction({title: t('app.research.discardTitle'), description: t('app.research.discardHelp'), confirmLabel: t('app.research.discard')}));
}

function renderSettings() {
    const preferences = getPreferences();
    page.append(heading(t('app.route.settings'), t('app.settings.title'), t('app.settings.subtitle')));
    const selectPreference = (key, options, label) => {
        const select = el('select', {id: 'preference-' + key, class: 'input select', 'data-preference': key, 'aria-label': label},
            options.map(([value, text]) => el('option', {value, selected: value === preferences[key]}, text)));
        select.addEventListener('change', () => changePreference({[key]: select.value}));
        return select;
    };
    const row = (label, control, help) => el('label', {class: 'setting-row'}, el('span', {}, label, help ? el('small', {}, help) : null), control);
    const section = (key, symbol, ...children) => el('section', {class: 'settings-section'}, el('h2', {}, icon(symbol), t('app.settings.' + key)), children);
    const language = section('language', 'globe',
        row(t('app.settings.interfaceLanguage'), selectPreference('language', [['nl', 'Nederlands'], ['en', 'English']], t('app.settings.interfaceLanguage'))),
        el('p', {}, t('app.settings.languageHelp')));
    const swatches = el('div', {class: 'colour-swatches', role: 'group', 'aria-label': t('app.settings.accent')},
        [['lagoon', '#0b7476'], ['iris', '#6651c6'], ['cobalt', '#315ee8'], ['clay', '#a54e37']].map(([name, colour]) => {
            const swatch = el('button', {class: 'colour-swatch', type: 'button', 'data-accent': colour, 'aria-label': t('app.settings.' + name), 'aria-pressed': String(preferences.accent === colour)});
            swatch.style.setProperty('--swatch', colour);
            swatch.addEventListener('click', () => changePreference({accent: colour}));
            return swatch;
        }));
    const colour = key => {
        const input = el('input', {id: 'preference-' + key, type: 'color', value: preferences[key], 'data-preference': key});
        input.addEventListener('input', () => changePreference({[key]: input.value}, {persist: false}));
        input.addEventListener('change', () => changePreference({[key]: input.value}));
        return input;
    };
    const reduced = el('input', {id: 'preference-reduceTransparency', type: 'checkbox', checked: preferences.reduceTransparency, 'data-preference': 'reduceTransparency'});
    reduced.addEventListener('change', () => changePreference({reduceTransparency: reduced.checked}));
    const appearance = section('appearance', 'palette',
        row(t('app.settings.theme'), selectPreference('theme', ['light', 'dark', 'system'].map(value => [value, t('app.settings.' + value)]), t('app.settings.theme'))),
        el('div', {class: 'field-label'}, t('app.settings.accent'), swatches),
        el('label', {class: 'custom-colour'}, t('app.settings.customAccent'), colour('accent'), el('code', {id: 'preference-accent-value'}, preferences.accent.toUpperCase())),
        el('label', {class: 'custom-colour'}, t('app.settings.background'), colour('backgroundTint')),
        el('p', {}, t('app.settings.backgroundHelp')),
        row(t('app.settings.reduceTransparency'), reduced, t('app.settings.reduceHelp')));
    const side = el('div', {class: 'setting-actions', role: 'group', 'aria-label': t('app.settings.navigationPosition')},
        ['left', 'right'].map(value => button(t('app.settings.' + value), () => changePreference({sidebar: value}), {'data-sidebar-choice': value, 'aria-pressed': String(preferences.sidebar === value)})));
    const layout = section('layout', 'layout',
        el('div', {class: 'setting-row'}, el('span', {}, t('app.settings.navigationPosition')), side),
        button(t('app.settings.arrange'), () => { dashboard.begin(); go('overzicht'); }, {symbol: 'grip'}),
        el('p', {}, t('app.settings.layoutHelp')));
    const brand = el('div', {class: 'card brand-preview'},
        el('div', {class: 'brand'}, el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, el('span'), el('span'), el('span'), el('span')), el('strong', {}, 'govern')),
        el('h2', {}, t('app.settings.brandTitle')), el('p', {}, t('app.settings.brandHelp')));
    const preview = el('section', {class: 'card'}, el('div', {class: 'appearance-preview'},
        el('div', {}, badge(t('app.settings.previewBadge')), el('h2', {}, t('app.dashboard.title')), el('p', {}, t('app.settings.previewHelp')),
            button(t('app.dashboard.explore'), () => go('gegevens'), {kind: 'primary', symbol: 'arrow'}))),
        el('div', {class: 'card-body'}, el('h3', {}, t('app.settings.preview'))));
    page.append(el('div', {class: 'settings-grid'}, el('div', {class: 'card'}, language, appearance, layout),
        el('aside', {class: 'settings-aside'}, preview, brand,
            button(t('app.settings.reset'), () => { const result = resetAppearance(); syncSettingControls(); preferenceFeedback(result.saved); }, {kind: 'ghost', className: 'settings-reset', id: 'reset-appearance'}))),
        el('p', {id: 'preferences-status', class: 'settings-status', role: 'status', 'aria-live': 'polite'}));
}

function catalog(routeName) {
    const list = el('div', {class: 'catalog-list'});
    const search = el('input', {id: 'catalog-search', type: 'search', class: 'input', value: state.catalogSearch.database || '', placeholder: t('app.core.catalog.searchPlaceholder'), 'aria-label': t('app.core.catalog.searchLabel'), autocomplete: 'off'});
    const draw = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const matching = tables().filter(table => table.name.toLocaleLowerCase().includes(query));
        list.replaceChildren(...matching.map(table => el('button', {
            class: 'catalog-item' + (table.name === state.table ? ' active' : ''),
            type: 'button', title: table.name + (table.comment ? ' — ' + table.comment : ''),
            'aria-current': table.name === state.table ? 'true' : null,
            on: {click: () => selectWorkspaceTable(table.name, routeName)},
        }, icon(table.type === 'view' ? 'layers' : 'table'), el('span', {class: 'catalog-item-name'}, table.name),
        el('span', {class: 'catalog-item-count'}, number(table.columns)))));
        if (!matching.length) list.append(el('p', {class: 'catalog-empty'}, t('app.core.catalog.noMatches')));
    };
    search.addEventListener('input', () => { state.catalogSearch.database = search.value; draw(); });
    draw();
    return el('section', {class: 'catalog', 'aria-label': t('app.core.catalog.aria')},
        el('div', {class: 'catalog-head'},
            el('div', {class: 'search-field'}, icon('search'), search)), list);
}

function selectWorkspaceTable(name, view = state.databaseView) {
    state.table = name;
    // Object changes stay inside the open explorer, including on mobile.
    history.replaceState(null, '', databaseHash(view));
    render();
    contextContent.querySelector('.catalog-item.active')?.focus({preventScroll: true});
}

function databaseHeading(view) {
    const modeLinks = el('nav', {class: 'database-views', 'aria-label': t('app.navigation.views')}, databaseViews.map(name =>
        el('a', {class: 'database-view' + (name === view ? ' active' : ''), href: databaseHash(name), 'data-database-view': name,
            'aria-current': name === view ? 'page' : null}, t(routes[name].labelKey))));
    const explorer = button(t('app.navigation.tables'), openWorkspaceContext, {id: 'workspace-explorer-open', symbol: 'table',
        'aria-label': t('app.navigation.open'), 'aria-controls': 'workspace-context', 'aria-expanded': String(isExplorerOpen())});
    explorer.hidden = isExplorerOpen();
    return el('header', {class: 'page-heading database-heading'},
        el('div', {class: 'database-heading-main'}, el('h1', {}, t('app.navigation.database')), explorer),
        el('div', {class: 'database-viewbar'}, modeLinks,
            el('p', {class: 'database-selection'}, el('span', {}, t('app.navigation.selected')),
                el('code', {class: 'database-selected-table', id: 'database-selected-table'}, state.table || t('app.navigation.emptySelection')))));
}

function databaseContext(view, scope) {
    const inspector = el('section', {class: 'workspace-selected', id: 'workspace-selected', 'aria-label': t('app.navigation.inspector')});
    contextContent.append(catalog(view), inspector);
    return inspector;
}

async function tableStructure(name, scope) {
    if (state.structureData.has(name)) return state.structureData.get(name);
    const data = await request('structure', {params: {table: name}, signal: scope.signal});
    if (scope.live()) state.structureData.set(name, data);
    return data;
}

function drawTableInspector(inspector, table, data) {
    const details = (name, label, content) => {
        const disclosure = el('details', {class: 'workspace-detail', open: Boolean(state.inspectorExpanded[name])},
            el('summary', {}, label), content);
        disclosure.addEventListener('toggle', () => { state.inspectorExpanded[name] = disclosure.open; });
        return disclosure;
    };
    inspector.replaceChildren(el('p', {class: 'eyebrow'}, t('app.navigation.selected')), el('h3', {}, table.name),
        el('p', {class: 'small muted'}, t('app.dashboard.tableDetail', {count: number(table.columns), type: t(table.type === 'view' ? 'app.dashboard.view' : 'app.dashboard.table')})));
    if (table.comment) inspector.append(el('p', {class: 'small muted'}, table.comment));
    if (!data) return;
    inspector.append(details('columns', t('app.navigation.columns'), el('div', {class: 'workspace-column-list'}, data.columns.map(column =>
        el('div', {}, el('code', {}, column.name), el('small', {}, column.type))))));
    const keys = data.foreign_keys || [];
    inspector.append(details('connections', t('app.navigation.connections'), keys.length ? el('div', {class: 'workspace-connection-list'}, keys.map(key => {
        const external = key.referenced_schema && key.referenced_schema !== state.bootstrap.database.name;
        const available = !external && tables().some(item => item.name === key.referenced_table);
        const content = [icon('link'), el('span', {}, el('code', {}, (external ? key.referenced_schema + '.' : '') + key.referenced_table),
            el('small', {}, key.columns.join(', ') + ' → ' + key.referenced_columns.join(', ')),
            available ? null : el('small', {}, t(external ? 'app.schema.outside' : 'app.schema.unavailable')))];
        return available ? el('button', {class: 'workspace-related', type: 'button', on: {click: () => selectWorkspaceTable(key.referenced_table)}}, content)
            : el('div', {class: 'workspace-related'}, content);
    }))
        : el('p', {class: 'small muted'}, t('app.navigation.noConnections'))));
}

function tableHeader(table, tab) {
    return el('div', {class: 'table-heading'},
        el('div', {}, el('div', {class: 'table-heading-title'}, el('h2', {}, table.name), badge(table.type === 'view' ? t('app.core.table.viewBadge') : t('app.core.table.tableBadge'), table.type === 'view' ? 'badge-blue' : 'badge-green'))),
        el('div', {class: 'table-heading-actions'},
            button(tab === 'structure' ? t('app.core.table.openStructure') : t('app.core.table.openBrowse'), () => databaseModal.open(table.name, tab), {className: 'button-small', symbol: 'database'})));
}

function noTables() {
    return empty(t('app.core.table.emptyTitle'), t('app.core.table.emptyHelp'),
        button(t('app.core.table.openDatabase'), () => databaseModal.open('', 'sql'), {kind: 'primary', symbol: 'database'}));
}

async function renderData(scope) {
    page.append(databaseHeading('gegevens'));
    const inspector = databaseContext('gegevens', scope);
    if (!tables().length) { page.append(noTables()); return; }
    const table = tables().find(item => item.name === state.table);
    drawTableInspector(inspector, table);
    tableStructure(table.name, scope).then(data => {
        if (scope.live()) drawTableInspector(inspector, table, data);
    }).catch(error => { if (error.name !== 'AbortError' && scope.live()) inspector.append(errorPanel(error)); });
    if (!state.dataViews.has(table.name)) state.dataViews.set(table.name, {search: '', page: 1, pageSize: 25});
    const viewState = state.dataViews.get(table.name);
    const workspace = el('section', {class: 'table-workspace'});
    const card = el('div', {class: 'card'}, tableHeader(table, 'browse'));
    const search = el('input', {id: 'data-search', type: 'search', class: 'input', value: viewState.search, placeholder: t('app.core.data.searchPlaceholder'), 'aria-label': t('app.core.data.searchLabel'), autocomplete: 'off'});
    const size = el('select', {id: 'data-page-size', class: 'input select', 'aria-label': t('app.core.data.pageSize')},
        [25, 50, 100].map(value => el('option', {value, selected: value === viewState.pageSize}, String(value))));
    const result = el('div');
    const pagination = el('div', {class: 'table-pagination'});
    const sql = el('div');
    let currentPage = viewState.page;
    let timer;
    let requestId = 0;
    let rowController;
    scope.cleanup.push(() => { clearTimeout(timer); rowController?.abort(); });
    const load = async () => {
        rowController?.abort();
        rowController = new AbortController();
        const id = ++requestId;
        result.replaceChildren(loading());
        pagination.replaceChildren();
        sql.replaceChildren();
        try {
            const data = await request('browse', {params: {table: table.name, page: currentPage, page_size: size.value, q: search.value.trim()}, signal: rowController.signal});
            if (!scope.live() || id !== requestId) return;
            result.replaceChildren(dataTable(data.columns.map(column => ({key: column.name, label: column.name})), data.rows, {
                emptyMessage: search.value ? t('app.core.data.filteredEmpty') : t('app.core.data.empty'),
                caption: t('app.core.data.caption', {table: table.name}),
            }));
            if (localized(data, 'notice')) result.append(notice(localized(data, 'notice')));
            const pages = Math.max(1, Math.ceil(Number(data.total) / Number(data.page_size)));
            currentPage = Number(data.page);
            viewState.page = currentPage;
            const start = data.total ? (currentPage - 1) * Number(data.page_size) + 1 : 0;
            const end = Math.min(currentPage * Number(data.page_size), Number(data.total));
            pagination.replaceChildren(el('span', {}, t('app.core.data.range', {start: number(start), end: number(end), total: number(data.total)})),
                el('div', {class: 'pagination-buttons'},
                    button(t('app.core.data.previous'), () => { currentPage -= 1; load(); }, {disabled: currentPage <= 1}),
                    el('span', {}, currentPage + ' / ' + pages),
                    button(t('app.core.data.next'), () => { currentPage += 1; load(); }, {disabled: currentPage >= pages})));
            sql.append(sqlDisclosure(data.sql, data.params));
        } catch (error) {
            if (error.name !== 'AbortError' && scope.live() && id === requestId) result.replaceChildren(errorPanel(error, load));
        }
    };
    search.addEventListener('input', () => {
        viewState.search = search.value;
        viewState.page = 1;
        clearTimeout(timer);
        timer = setTimeout(() => { currentPage = 1; load(); }, 300);
    });
    size.addEventListener('change', () => { currentPage = 1; viewState.page = 1; viewState.pageSize = Number(size.value); load(); });
    card.append(el('div', {class: 'table-toolbar'},
        el('div', {class: 'search-field'}, icon('search'), search),
        el('div', {class: 'table-toolbar-right'}, el('span', {class: 'small muted'}, t('app.core.data.rows')), size)),
        result, pagination);
    workspace.append(card, el('p', {class: 'table-caption'}, t('app.core.data.readOnlyHelp')), sql);
    page.append(workspace);
    await load();
}

async function renderStructure(scope) {
    page.append(databaseHeading('structuur'));
    const inspector = databaseContext('structuur', scope);
    if (!tables().length) { page.append(noTables()); return; }
    const table = tables().find(item => item.name === state.table);
    const workspace = el('section', {class: 'table-workspace'}, loading(t('app.core.structure.loading')));
    page.append(workspace);
    drawTableInspector(inspector, table);
    let data;
    try {
        data = await tableStructure(table.name, scope);
    } catch (error) {
        if (error.name !== 'AbortError' && scope.live()) workspace.replaceChildren(errorPanel(error, () => render()));
        return;
    }
    if (!scope.live()) return;
    drawTableInspector(inspector, table, data);
    const columns = [
        {key: 'name', label: t('app.core.structure.field'), render: (value, row) => el('span', {class: 'column-name'}, row.primary ? icon('key') : null, value)},
        {key: 'type', label: t('app.core.structure.type')},
        {key: 'nullable', label: t('app.core.structure.nullable'), render: value => el('span', {}, value ? t('app.core.structure.yes') : t('app.core.structure.no'))},
        {key: 'default', label: t('app.core.structure.default')},
        {key: 'generated', label: t('app.core.structure.input'), render: value => value ? badge(t('app.core.structure.generated'), 'badge-blue') : el('span', {class: 'muted'}, t('app.core.structure.ordinary'))},
        {key: 'comment', label: t('app.core.structure.meaning'), className: 'cell-wrap', render: value => el('span', {class: 'cell-value'}, value || '—')},
    ];
    const card = el('div', {class: 'card'}, tableHeader(table, 'structure'), dataTable(columns, data.columns, {caption: t('app.core.structure.caption', {table: table.name})}));
    workspace.replaceChildren(card, el('p', {class: 'table-caption'}, t('app.core.structure.keyHelp')));
    const relations = el('section', {class: 'structure-section'}, el('h3', {}, t('app.core.structure.relationships')));
    const keys = data.foreign_keys || [];
    if (!keys.length) relations.append(notice(t('app.core.structure.noRelationships')));
    keys.forEach(foreignKey => {
        const target = foreignKey.referenced_table;
        const join = foreignKey.columns.map((column, index) => 'a.' + quoteIdentifier(column) + ' = b.' + quoteIdentifier(foreignKey.referenced_columns[index])).join('\n  AND ');
        const query = 'SELECT a.*, b.*\nFROM ' + quoteIdentifier(table.name) + ' AS a\nJOIN ' + quoteIdentifier(target) + ' AS b\n  ON ' + join + '\nLIMIT 20;';
        relations.append(el('div', {class: 'relation-card'}, icon('link'),
            el('div', {class: 'relation-content'}, el('p', {}, foreignKey.columns.join(', ') + ' → ' + target + '.' + foreignKey.referenced_columns.join(', ')),
                el('small', {}, foreignKey.name)),
            button(t('app.core.structure.view'), () => go('structuur', {table: target}), {kind: 'ghost', className: 'button-small'}),
            button(t('app.core.structure.researchJoin'), () => openResearch(query), {className: 'button-small', symbol: 'code'})));
    });
    workspace.append(relations);
    const indexes = el('section', {class: 'structure-section'}, el('h3', {}, t('app.core.structure.indexes')));
    if (data.indexes?.length) {
        indexes.append(el('div', {class: 'index-list'}, data.indexes.map(index => el('div', {class: 'index-item'},
            el('strong', {}, index.name), el('small', {}, index.unique ? t('app.core.structure.uniqueIndex', {columns: index.columns.join(', ')}) : index.columns.join(', '))))));
    } else indexes.append(el('p', {class: 'small muted'}, t('app.core.structure.noIndexes')));
    workspace.append(indexes);
    const ddl = el('details', {class: 'sql-disclosure'},
        el('summary', {}, icon('code'), t('app.core.structure.showDefinition')),
        el('p', {}, t('app.core.structure.definitionHelp')),
        el('pre', {class: 'code-block'}, el('code', {}, data.create_sql)),
        button(t('app.core.structure.copyDefinition'), () => copyText(data.create_sql), {kind: 'ghost', className: 'button-small', symbol: 'copy'}));
    workspace.append(ddl);
}

async function renderSchema(scope) {
    page.append(databaseHeading('schema'));
    contextContent.append(loading(t('app.schema.loading')));
    const workspace = el('section', {id: 'schema-workspace'}, loading(t('app.schema.loading')));
    page.append(workspace);
    try {
        if (!state.schemaData) {
            const data = await request('schema', {signal: scope.signal});
            if (!scope.live()) return;
            state.schemaData = data;
        }
        state.schemaView.selected = state.table;
        const visualizer = mountSchemaVisualizer(workspace, {
            data: state.schemaData,
            state: state.schemaView,
            onRefresh: () => refreshBootstrap(true),
            contextRoot: contextContent,
            initialSearch: state.catalogSearch.database || '',
            onSearch: value => { state.catalogSearch.database = value; },
            onSelect: name => {
                state.table = name;
                history.replaceState(null, '', databaseHash('schema'));
                document.getElementById('database-selected-table').textContent = name;
                document.querySelectorAll('[data-database-view]').forEach(link => { link.href = databaseHash(link.dataset.databaseView); });
                syncWorkspaceNavigation();
            },
        });
        scope.cleanup.push(() => visualizer.destroy());
        restoreExplorerScroll('database');
    } catch (error) {
        if (error.name !== 'AbortError' && scope.live()) {
            workspace.replaceChildren(errorPanel(error, () => render()));
            contextContent.replaceChildren(errorPanel(error, () => render()));
        }
    }
}

async function renderResearch(scope) {
    page.append(heading(t('app.core.research.eyebrow'), t('app.core.research.title'), t('app.core.research.help'),
        [button(t('app.core.research.fullEditor'), () => databaseModal.open(state.table, 'sql'), {symbol: 'external'})]));
    if (!state.queryDraft) state.queryDraft = defaultSql();
    const result = el('div', {class: 'query-result'});
    const editor = el('textarea', {id: 'sql-editor', class: 'sql-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': t('app.core.research.sqlLabel')}, state.queryDraft);
    editor.value = state.queryDraft;
    editor.addEventListener('input', () => {
        state.queryRevision += 1;
        state.queryDraft = editor.value;
        state.queryDesign = null;
        state.queryDirty = true;
        state.queryError = null;
    });
    const explanation = el('div', {class: 'query-explanation'});
    const drawExplanation = () => {
        const binding = state.queryDesign;
        explanation.replaceChildren();
        if (binding && binding.sql === editor.value) {
            explanation.append(el('h3', {}, icon('book'), t('app.core.research.explanationTitle')),
                el('ul', {}, (localized(binding, 'explanation') || []).map(text => el('li', {}, text))),
                el('p', {}, t('app.core.research.explanationHelp')));
        }
    };
    const runButton = button(t('app.core.research.run'), () => run(), {kind: 'primary', symbol: 'play'});
    const name = el('input', {id: 'query-name', class: 'input', type: 'text', maxlength: '160', value: state.queryName, placeholder: t('app.core.research.namePlaceholder'), required: true});
    const notes = el('textarea', {id: 'query-notes', class: 'input', rows: '3', placeholder: t('app.core.research.notesPlaceholder'), maxlength: '10000'}, state.queryNotes);
    notes.value = state.queryNotes;
    name.addEventListener('input', () => { state.queryName = name.value; state.queryDirty = true; });
    notes.addEventListener('input', () => { state.queryNotes = notes.value; state.queryDirty = true; });
    const saveLabel = el('span', {}, state.queryId ? t('app.core.research.saveChanges') : t('app.core.research.save'));
    const saveButton = el('button', {id: 'save-research', class: 'button button-primary', type: 'submit', disabled: state.savingQuery}, icon('bookmark'), saveLabel);
    const savedList = el('div', {class: 'saved-list'}, loading(t('app.core.research.loadingSaved')));
    contextContent.append(savedList);
    const saveError = el('div');
    if (state.querySaveError) saveError.append(errorPanel(state.querySaveError));
    const form = el('form', {class: 'save-query-form', novalidate: true},
        el('label', {class: 'field-label'}, t('app.core.research.name'), name),
        el('label', {class: 'field-label'}, t('app.core.research.note'), notes), saveButton,
        button(t('app.core.research.saveNew'), () => {
            if (saveButton.disabled) return;
            state.queryRevision += 1;
            state.queryId = null;
            saveLabel.textContent = t('app.core.research.save');
            form.requestSubmit();
        }, {kind: 'ghost', className: 'button-small'}), saveError);
    const updateSavedList = async () => {
        let queries;
        try { queries = await request('queries', {signal: scope.signal}); }
        catch (error) {
            if (error.name !== 'AbortError' && scope.live()) savedList.replaceChildren(errorPanel(error, updateSavedList));
            return;
        }
        if (!scope.live()) return;
        state.savedQueries = queries;
        savedList.replaceChildren();
        if (!queries.length) {
            savedList.append(el('p', {class: 'catalog-empty'}, t('app.core.research.noSaved')));
            return;
        }
        queries.forEach(query => {
            const remove = button(t('app.core.research.remove'), async () => {
                const confirmed = await confirmAction({title: t('app.core.research.removeTitle'), description: t('app.core.research.removeDescription'), confirmLabel: t('app.core.research.removeConfirm'), danger: true});
                if (!confirmed) return;
                remove.disabled = true;
                try {
                    await request('delete-query', {body: {id: query.id}});
                    state.savedQueries = null;
                    if (String(state.queryId) === String(query.id)) {
                        state.queryId = null;
                        saveLabel.textContent = t('app.core.research.save');
                    }
                    toast(t('app.core.research.removed'));
                    await updateSavedList();
                } catch (error) { toast(errorText(error), 'error'); remove.disabled = false; }
            }, {kind: 'ghost', symbol: 'trash', className: 'icon-button', 'aria-label': t('app.core.research.removeLabel', {name: query.name})});
            remove.querySelector('span').className = 'sr-only';
            savedList.append(el('div', {class: 'saved-item'},
                el('button', {class: 'saved-item-open', type: 'button', on: {click: async () => {
                    if (!await mayReplaceResearch() || !scope.live()) return;
                    state.queryRevision += 1;
                    state.queryId = query.id;
                    state.queryDraft = query.sql;
                    state.queryName = query.name;
                    state.queryNotes = query.notes || '';
                    state.queryResult = null;
                    state.queryDesign = null;
                    state.queryDirty = false;
                    state.queryError = null;
                    state.querySaveError = null;
                    saveError.replaceChildren();
                    editor.value = query.sql;
                    name.value = query.name;
                    notes.value = query.notes || '';
                    saveLabel.textContent = t('app.core.research.saveChanges');
                    drawResult();
                    drawExplanation();
                    editor.focus();
                }}}, el('strong', {}, query.name), el('small', {}, dateTime(query.updated_at))), remove));
        });
    };
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (state.savingQuery) return;
        if (!name.value.trim()) {
            name.setAttribute('aria-invalid', 'true');
            state.querySaveError = Object.assign(new Error(t('app.research.nameRequired')), {translationKey: 'app.research.nameRequired'});
            saveError.replaceChildren(errorPanel(state.querySaveError));
            name.focus(); return;
        }
        name.removeAttribute('aria-invalid');
        saveButton.disabled = true;
        state.savingQuery = true;
        saveError.replaceChildren();
        state.querySaveError = null;
        const revision = state.queryRevision;
        const submission = {id: state.queryId || undefined, name: name.value.trim(), sql: editor.value, notes: notes.value};
        try {
            const saved = await request('save-query', {body: submission});
            if (state.queryRevision === revision) state.queryId = saved.id;
            if (state.queryDraft === submission.sql && state.queryName.trim() === submission.name && state.queryNotes === submission.notes) state.queryDirty = false;
            state.savedQueries = null;
            if (scope.live()) {
                saveLabel.textContent = state.queryId ? t('app.core.research.saveChanges') : t('app.core.research.save');
                toast(t('app.core.research.saved'));
                await updateSavedList();
            }
        } catch (error) {
            state.querySaveError = error;
            if (scope.live()) saveError.replaceChildren(errorPanel(error));
            else toast(errorText(error), 'error');
        } finally {
            state.savingQuery = false;
            saveButton.disabled = false;
            if (!scope.live() && route().name === 'onderzoeken') render();
        }
    });
    const drawResult = () => {
        result.replaceChildren();
        if (state.queryError) {
            result.append(errorPanel(state.queryError));
            return;
        }
        const data = state.queryResult;
        if (!data) {
            result.append(el('div', {class: 'card query-placeholder'},
                empty(t('app.core.research.resultPlaceholder'), t('app.core.research.resultHelp'), null, 'search')));
            return;
        }
        if (data.statements) {
            data.statements.forEach((item, index) => {
                const rowsResult = item.columns.length > 0;
                const metrics = el('div', {class: 'query-metrics'},
                    badge(rowsResult ? t('app.core.research.rowCount', {count: number(item.returned_rows)}) : t('app.core.research.affectedCount', {count: number(item.affected_rows)}), 'badge-green'),
                    el('span', {}, number(item.duration_ms) + ' ms'));
                const card = el('section', {class: 'card'},
                    el('div', {class: 'card-header'}, el('h2', {}, t('app.core.research.statementTitle', {number: index + 1})), metrics),
                    el('pre', {class: 'sql-preview'}, item.sql));
                if (rowsResult) card.append(dataTable(item.columns, item.rows, {caption: t('app.core.research.resultCaption'), emptyMessage: t('app.core.research.noRows')}));
                result.append(card);
                if (item.truncated) result.append(notice(t('app.core.research.truncated')));
            });
            if (data.failed) {
                result.append(errorPanel(Object.assign(new Error(t('app.core.research.statementFailed', {number: data.failed.index}) + ' ' + data.failed.detail), {})));
            }
            return;
        }
        const metrics = el('div', {class: 'query-metrics'}, badge(t('app.core.research.rowCount', {count: number(data.returned_rows)}), 'badge-green'),
            el('span', {}, number(data.duration_ms) + ' ms'));
        const card = el('section', {class: 'card'},
            el('div', {class: 'card-header'}, el('h2', {}, t('app.core.research.resultTitle')), metrics),
            dataTable(data.columns, data.rows, {caption: t('app.core.research.resultCaption'), emptyMessage: t('app.core.research.noRows')}));
        result.append(card);
        if (data.truncated) result.append(notice(t('app.core.research.truncated')));
        if (localized(data, 'notice')) result.append(notice(localized(data, 'notice')));
        if (data.structureChanged) result.append(notice(t('app.core.research.schemaChanged')));
    };
    const run = async () => {
        if (runButton.disabled || !editor.value.trim()) {
            if (!editor.value.trim()) toast(t('app.research.sqlRequired'), 'error');
            editor.focus(); return;
        }
        state.queryDraft = editor.value;
        state.queryResult = null;
        state.queryError = null;
        const sql = editor.value;
        const binding = state.queryDesign;
        const body = binding?.sql === sql ? {design: structuredClone(binding.design)} : {sql};
        const revision = state.queryRevision;
        runButton.disabled = true;
        result.replaceChildren(loading(t('app.core.research.running')));
        try {
            let data = await request('query', {body, signal: scope.signal});
            if (data.confirm_required) {
                const list = el('ul', {class: 'confirm-list'}, ...data.destructive.map(item =>
                    el('li', {}, el('strong', {}, t('app.core.research.destructive.' + item.reason)), ' ', el('code', {}, item.sql.slice(0, 200)))));
                const confirmed = await confirmAction({title: t('app.core.research.confirmTitle'),
                    description: el('div', {}, el('p', {}, t('app.core.research.confirmHelp')), list),
                    confirmLabel: t('app.core.research.confirmRun'), danger: true});
                if (!confirmed) { result.replaceChildren(); drawResult(); return; }
                data = await request('query', {body: {sql, confirm: true}, signal: scope.signal});
            }
            if (!scope.live() || revision !== state.queryRevision || editor.value !== sql) return;
            if (body.design) {
                if (data.sql !== sql) {
                    state.queryRevision += 1;
                    data.structureChanged = true;
                }
                state.queryDraft = data.sql;
                editor.value = data.sql;
                state.queryDesign = {design: structuredClone(body.design), sql: data.sql, explanation: [...data.explanation], explanation_i18n: data.explanation_i18n};
                drawExplanation();
            }
            state.queryResult = data;
            drawResult();
            if (data.statements?.some(item => item.affected_rows !== null)) refreshBootstrap();
            if (error.name !== 'AbortError' && scope.live() && revision === state.queryRevision && editor.value === sql) {
                state.queryError = error;
                drawResult();
            }
        } finally { runButton.disabled = false; }
    };
    editor.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); }
    });
    editor.addEventListener('input', () => {
        state.queryResult = null;
        drawResult();
        drawExplanation();
    });
    const newQuery = async () => {
        if (!await mayReplaceResearch() || !scope.live()) return;
        state.queryRevision += 1;
        state.queryDraft = defaultSql();
        state.queryName = '';
        state.queryNotes = '';
        state.queryId = null;
        state.queryResult = null;
        state.queryDesign = null;
        state.queryDirty = false;
        state.queryError = null;
        state.querySaveError = null;
        saveError.replaceChildren();
        editor.value = state.queryDraft;
        name.value = '';
        notes.value = '';
        saveLabel.textContent = t('app.core.research.save');
        drawResult();
        drawExplanation();
        editor.focus();
    };
    const editorCard = el('section', {class: 'card'},
        el('div', {class: 'editor-topbar'}, el('h2', {}, t('app.core.research.editorTitle'))),
        el('div', {class: 'editor-wrap'}, editor),
        el('div', {class: 'editor-actions'}, el('div', {class: 'editor-action-buttons'}, runButton,
            button(t('app.core.research.new'), newQuery, {kind: 'ghost', symbol: 'plus'}),
            button(t('app.core.research.copy'), () => copyText(editor.value), {kind: 'ghost', symbol: 'copy'})),
            el('span', {class: 'keyboard-hint'}, 'Ctrl / ⌘ + Enter')),
        el('p', {class: 'query-hint'}, t('app.core.research.limits')), explanation);
    const help = el('section', {class: 'learning-help'},
        el('h3', {}, icon('book'), t('app.core.research.learnTitle')),
        el('details', {}, el('summary', {}, t('app.core.research.selectQuestion')),
            el('p', {}, t('app.core.research.selectHelp')),
            button(t('app.core.research.useExample'), async () => {
                if (!await mayReplaceResearch() || !scope.live()) return;
                state.queryRevision += 1;
                state.queryDesign = null;
                state.queryResult = null;
                editor.value = defaultSql(); state.queryDraft = editor.value;
                state.queryDirty = true;
                state.queryError = null;
                drawResult(); drawExplanation(); editor.focus();
            }, {className: 'button-small'})),
        el('details', {}, el('summary', {}, t('app.core.research.whereQuestion')),
            el('p', {}, t('app.core.research.whereHelp'))),
        el('details', {}, el('summary', {}, t('app.core.research.joinQuestion')),
            el('p', {}, t('app.core.research.joinHelp')),
            button(t('app.core.research.viewStructure'), () => go('structuur', {table: state.table}), {className: 'button-small'})));
    const builder = new QueryBuilder({
        tables: tables(), database: state.bootstrap.database.name, initialTable: state.table,
        draft: state.builderDraft, open: state.builderOpen, scope,
        onDraft: draft => { state.builderDraft = structuredClone(draft); },
        onToggle: open => { state.builderOpen = open; },
        getRevision: () => state.queryRevision,
        onApply: (built, design) => {
            state.queryRevision += 1;
            state.queryDraft = built.sql;
            state.queryDesign = {design: structuredClone(design), sql: built.sql, explanation: [...built.explanation], explanation_i18n: built.explanation_i18n};
            state.queryResult = null;
            state.queryDirty = true;
            state.queryError = null;
            editor.value = built.sql;
            drawResult(); drawExplanation();
        },
    });
    page.append(el('div', {class: 'research-layout unified-research'},
        builder.element, editorCard, result,
        el('section', {class: 'card research-save'}, el('div', {class: 'card-header'}, el('h2', {}, t('app.core.research.save')), icon('bookmark')), form),
        help));
    drawResult();
    drawExplanation();
    try { await updateSavedList(); } catch (error) {
        if (error.name !== 'AbortError' && scope.live()) savedList.replaceChildren(errorPanel(error));
    }
}

async function renderExperiments(scope) {
    page.append(heading(t('app.core.experiments.eyebrow'), t('app.core.experiments.title'), t('app.core.experiments.help'),
        [button(t('app.core.experiments.openWindow'), () => databaseModal.open(state.table, 'sql'), {symbol: 'database'})]));
    const list = el('div', {class: 'snapshot-list'});
    const snapshotIndex = el('nav', {class: 'snapshot-index', 'aria-label': t('app.navigation.snapshots')});
    contextContent.append(snapshotIndex);
    const counter = el('span');
    const label = el('input', {id: 'snapshot-label', class: 'input', maxlength: '160', value: state.snapshotLabel, placeholder: t('app.core.experiments.namePlaceholder'), 'aria-label': t('app.core.experiments.nameLabel')});
    label.addEventListener('input', () => { state.snapshotLabel = label.value; });
    const createButton = button(t('app.core.experiments.create'), () => createSnapshot(), {id: 'create-snapshot', kind: 'primary', symbol: 'plus', disabled: state.creatingSnapshot || state.restoring, 'data-snapshot-action': 'create'});
    const status = el('div');
    if (state.restoring) status.append(notice(t('app.core.experiments.restoring')));
    else if (state.creatingSnapshot) status.append(notice(t('app.core.experiments.creating')));
    else if (state.snapshotError) status.append(errorPanel(state.snapshotError));
    const create = el('section', {class: 'card snapshot-create'},
        el('div', {class: 'card-header'}, el('h2', {}, t('app.core.experiments.saveState')), icon('shield')),
        el('div', {class: 'card-body'},
            el('p', {}, t('app.core.experiments.includes', {database: state.bootstrap.database.name})),
            el('label', {class: 'field-label'}, t('app.core.experiments.recognisableName'), label), createButton, status));
    const load = async () => {
        list.replaceChildren(loading(t('app.core.experiments.loading')));
        snapshotIndex.replaceChildren(loading(t('app.core.experiments.loading')));
        try {
            const snapshots = await request('snapshots', {signal: scope.signal});
            if (!scope.live()) return;
            counter.textContent = number(snapshots.length);
            list.replaceChildren();
            snapshotIndex.replaceChildren();
            if (!snapshots.length) {
                list.append(el('div', {class: 'card'}, empty(t('app.core.experiments.emptyTitle'), t('app.core.experiments.emptyHelp'), null, 'clock')));
                snapshotIndex.append(el('p', {class: 'catalog-empty'}, t('app.core.experiments.emptyTitle')));
            }
            snapshots.forEach(snapshot => {
                const restore = button(t('app.core.experiments.restore'), () => restoreSnapshot(snapshot, restore), {className: 'button-small', symbol: 'refresh', 'data-snapshot-action': 'restore', disabled: state.restoring || state.creatingSnapshot});
                const snapshotCard = el('article', {class: 'snapshot-card', id: 'snapshot-' + snapshot.id, tabindex: '-1'},
                    el('div', {class: 'snapshot-top'}, el('span', {class: 'snapshot-symbol'}, icon('clock')),
                        el('div', {class: 'snapshot-info'}, el('h3', {}, snapshot.label || t('app.core.experiments.restorePoint')),
                            el('p', {}, dateTime(snapshot.created_at) + ' · ' + fileSize(snapshot.size_bytes))), badge(t('app.core.experiments.sqlExport'))),
                    el('div', {class: 'snapshot-actions'},
                        el('a', {class: 'button button-secondary button-small', href: endpoint('download-snapshot', {id: snapshot.id})}, icon('download'), t('app.core.experiments.download')),
                        restore, el('code', {title: snapshot.sha256}, (snapshot.sha256 || '').slice(0, 12))));
                list.append(snapshotCard);
                snapshotIndex.append(el('button', {type: 'button', class: 'snapshot-index-item', on: {click: () => {
                    closeSidebar(); snapshotCard.focus({preventScroll: true}); snapshotCard.scrollIntoView({block: 'nearest'});
                }}}, icon('clock'), el('span', {}, el('strong', {}, snapshot.label || t('app.core.experiments.restorePoint')), el('small', {}, dateTime(snapshot.created_at)))));
            });
        } catch (error) {
            if (error.name !== 'AbortError' && scope.live()) {
                list.replaceChildren(errorPanel(error, load));
                snapshotIndex.replaceChildren(el('p', {class: 'small muted'}, errorText(error)));
            }
        }
    };
    const createSnapshot = async () => {
        if (state.creatingSnapshot || state.restoring) return;
        state.creatingSnapshot = true;
        state.snapshotError = null;
        syncSnapshotControls();
        status.replaceChildren(notice(t('app.core.experiments.creating')));
        try {
            const submittedLabel = label.value;
            await request('create-snapshot', {body: {label: submittedLabel.trim()}});
            if (state.snapshotLabel === submittedLabel) state.snapshotLabel = '';
            if (!scope.live()) return;
            label.value = '';
            status.replaceChildren();
            toast(t('app.core.experiments.created'));
            await load();
        } catch (error) {
            state.snapshotError = error;
            if (scope.live()) status.replaceChildren(errorPanel(error));
            else toast(errorText(error), 'error');
        } finally {
            state.creatingSnapshot = false;
            syncSnapshotControls();
            if (!scope.live() && route().name === 'experimenten') render();
        }
    };
    const restoreSnapshot = async (snapshot, restoreButton) => {
        if (state.restoring || state.creatingSnapshot) return;
        const database = state.bootstrap.database.name;
        const confirmation = await confirmAction({
            title: t('app.core.experiments.restoreTitle'),
            description: t('app.core.experiments.restoreDescription', {database, label: snapshot.label || t('app.core.experiments.restorePoint')}),
            requiredText: database, confirmLabel: t('app.core.experiments.restoreConfirm'), danger: true,
        });
        if (confirmation === null || state.restoring || state.creatingSnapshot) return;
        restoreButton.disabled = true;
        createButton.disabled = true;
        state.restoring = true;
        state.snapshotError = null;
        syncRestoreControls();
        if (databaseModal.dialog.open) databaseModal.dialog.close();
        status.replaceChildren(notice(t('app.core.experiments.restoring')));
        try {
            const result = await request('restore-snapshot', {body: {id: snapshot.id, confirmation}});
            toast(localized(result, 'message') || t('app.core.experiments.restored'));
            await refreshBootstrap(false);
        } catch (error) {
            state.snapshotError = error;
            if (scope.live()) status.replaceChildren(errorPanel(error));
            toast(t('app.core.experiments.restoreFailed'), 'error');
        } finally {
            state.restoring = false;
            syncRestoreControls();
            createButton.disabled = false;
            restoreButton.disabled = false;
        }
    };
    page.append(el('div', {class: 'snapshot-layout'},
        el('div', {}, create, el('p', {class: 'snapshot-help'},
            el('strong', {}, t('app.core.experiments.copyIntro')),
            t('app.core.experiments.copyHelp'))),
        el('section', {}, el('div', {class: 'section-title'}, el('h2', {}, t('app.core.experiments.yourPoints')), counter), list)));
    await load();
}

window.addEventListener('hashchange', () => {
    closeSidebar();
    render();
    document.getElementById('main-content').focus({preventScroll: true});
});
refreshBootstrap();
