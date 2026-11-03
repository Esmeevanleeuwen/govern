import './homepage-messages.js';
import {getLanguage, setLanguage, t} from './i18n.js';
import {getPreferences, updatePreferences} from './preferences.js';
import {attachDialog} from './modal-shell.js';

// Old bookmarks continue to open their database workspace, including its query.
if (/^#(?:overzicht|gegevens|structuur|schema|verkennen|verbanden|onderzoeken|experimenten|instellingen)(?:\?|$)/.test(location.hash)) {
    location.replace('/workspace.php' + location.search + location.hash);
}

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const message = (key, params) => t('home.' + key, params);
const panel = $('#home-demo-panel');
const schema = panel?.firstElementChild;
let view = 'schema';
let selectedTable = 'users';
let selectedRecord = '1';
let os = /Mac|Linux/i.test(navigator.platform || '') && !/Win/i.test(navigator.platform || '') ? 'unix' : 'windows';
let dialogOpener = null;

// The public sample is deliberately separate from all real database services.
const tables = Object.freeze({
    users: {
        columns: [['id', 'INT', 'primary'], ['name', 'VARCHAR(255)', 'none'], ['created_at', 'DATETIME', 'none']],
        rows: [['1', 'Avery', '2026-01-20 09:00:00'], ['2', 'Sam', '2026-01-21 14:30:00'], ['3', 'Riley', '2026-01-22 11:15:00']],
    },
    orders: {
        columns: [['id', 'INT', 'primary'], ['user_id', 'INT', 'foreign'], ['created_at', 'DATETIME', 'none']],
        rows: [['101', '1', '2026-01-24 10:15:00'], ['102', '2', '2026-01-24 11:00:00'], ['103', '1', '2026-01-25 09:45:00']],
    },
    order_items: {
        columns: [['id', 'INT', 'primary'], ['order_id', 'INT', 'foreign'], ['product_id', 'INT', 'foreign'], ['quantity', 'INT', 'none'], ['price', 'DECIMAL(10,2)', 'none']],
        rows: [['501', '101', '10', '2', '18.00'], ['502', '101', '11', '1', '24.50'], ['503', '102', '12', '1', '12.00']],
    },
    products: {
        columns: [['id', 'INT', 'primary'], ['name', 'VARCHAR(255)', 'none'], ['price', 'DECIMAL(10,2)', 'none'], ['created_at', 'DATETIME', 'none']],
        rows: [['10', 'Notebook', '18.00', '2026-01-18 12:00:00'], ['11', 'Desk lamp', '24.50', '2026-01-19 10:00:00'], ['12', 'Ceramic cup', '12.00', '2026-01-20 16:00:00']],
    },
});

// These are the fictional store's declared column pairs, never inferred links.
const sampleRelations = [
    {child: 'orders', field: 'user_id', parent: 'users'},
    {child: 'order_items', field: 'order_id', parent: 'orders'},
    {child: 'order_items', field: 'product_id', parent: 'products'},
];

function renderRecordSample() {
    const source = tables[selectedTable];
    const record = source.rows.find(row => row[0] === selectedRecord) || source.rows[0];
    selectedRecord = record[0];
    const wrap = element('div', undefined, 'home-record-preview');
    wrap.append(element('h3', message('recordPreviewTitle')), element('p', message('recordPreviewHint'), 'home-demo-table-note'));
    const root = element('article', undefined, 'home-record-root');
    root.append(element('small', message('currentRecord')), element('h4', selectedTable + ' #' + selectedRecord));
    const fields = element('dl');
    source.columns.forEach(([field], index) => fields.append(element('dt', field), element('dd', record[index])));
    root.append(fields);
    const links = [], evidence = [];
    for (const relation of sampleRelations) {
        if (relation.child !== selectedTable && relation.parent !== selectedTable) continue;
        const outgoing = relation.child === selectedTable;
        const relatedTable = outgoing ? relation.parent : relation.child;
        const value = record[outgoing ? source.columns.findIndex(column => column[0] === relation.field) : 0];
        const index = outgoing ? 0 : tables[relatedTable].columns.findIndex(column => column[0] === relation.field);
        for (const row of tables[relatedTable].rows.filter(row => row[index] === value)) {
            const button = element('button', undefined, 'home-record-link');
            button.type = 'button';
            button.dataset.homeRecordTable = relatedTable;
            button.dataset.homeRecordId = row[0];
            const nameIndex = tables[relatedTable].columns.findIndex(column => column[0] === 'name');
            const caption = nameIndex >= 0 ? row[nameIndex] : tables[relatedTable].columns[1][0] + ' = ' + row[1];
            button.append(element('strong', relatedTable + ' #' + row[0]), element('span', caption));
            button.addEventListener('click', () => {
                selectedTable = relatedTable;
                selectedRecord = row[0];
                renderSample({announce: true});
                panel.focus({preventScroll: true});
            });
            links.push(button);
            evidence.push(relation.child + '.' + relation.field + ' = ' + relation.parent + '.id · ' + value + ' = ' + value);
        }
    }
    const neighbors = element('div', undefined, 'home-record-neighbors');
    neighbors.append(element('h4', message('linkedRecords')), ...links);
    if (!links.length) neighbors.append(element('p', message('noSampleLinks')));
    const graph = element('div', undefined, 'home-record-graph');
    graph.append(root, neighbors);
    const details = element('details', undefined, 'home-record-evidence');
    details.append(element('summary', message('connectionEvidence')));
    const list = element('ul');
    for (const match of new Set(evidence)) list.append(element('li', match));
    details.append(list);
    wrap.append(graph, details, element('p', message('dataNote'), 'home-demo-table-note'));
    return wrap;
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function renderSample({announce = false} = {}) {
    if (!panel || !schema) return;
    $$('[data-home-view]').forEach(button => {
        const selected = button.dataset.homeView === view;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
    });
    $$('[data-home-table]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.homeTable === selectedTable)));
    $('#home-sample-table').value = selectedTable;
    panel.setAttribute('aria-labelledby', 'home-tab-' + view);
    if (view === 'schema') {
        panel.replaceChildren(schema);
        $$('[data-schema-table]').forEach(card => card.dataset.selected = String(card.dataset.schemaTable === selectedTable));
    } else if (view === 'explore') {
        panel.replaceChildren(renderRecordSample());
    } else {
        const source = tables[selectedTable];
        const wrap = element('div', undefined, 'home-demo-table-wrap');
        const heading = element('h3', selectedTable);
        const table = element('table', undefined, 'home-demo-table');
        const caption = element('caption', message(view) + ' — ' + selectedTable, 'home-sr-only');
        const head = element('thead');
        const headRow = element('tr');
        const columns = view === 'data' ? source.columns.map(column => column[0]) : [message('field'), message('type'), message('key')];
        for (const label of columns) {
            const th = element('th', label);
            th.scope = 'col';
            headRow.append(th);
        }
        head.append(headRow);
        const body = element('tbody');
        const rows = view === 'data' ? source.rows : source.columns.map(([name, type, key]) => [name, type, message(key)]);
        for (const row of rows) {
            const tr = element('tr');
            for (const value of row) tr.append(element('td', value));
            body.append(tr);
        }
        table.append(caption, head, body);
        wrap.append(heading, table, element('p', message(view === 'data' ? 'dataNote' : 'structureNote'), 'home-demo-table-note'));
        panel.replaceChildren(wrap);
    }
    if (announce) $('#home-live').textContent = message('viewAnnouncement', {view: message(view), table: selectedTable});
}

function translate() {
    document.documentElement.lang = getLanguage();
    $$('[data-home-i18n]').forEach(node => node.textContent = message(node.dataset.homeI18n));
    $$('[data-home-aria]').forEach(node => node.setAttribute('aria-label', message(node.dataset.homeAria)));
    document.title = message('title');
    $('meta[name="description"]')?.setAttribute('content', message('meta'));
    $('#home-language').value = getLanguage();
    $('#home-language').setAttribute('aria-label', message('language'));
    renderSample();
}

function setOperatingSystem(next) {
    os = next;
    $$('[data-home-os]').forEach(button => {
        const selected = button.dataset.homeOs === os;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
    });
    $('#home-command-panel').setAttribute('aria-labelledby', 'home-os-' + os);
    $('#home-terminal-name').textContent = os === 'windows' ? 'PowerShell' : 'Terminal';
    const existing = $('#home-install-kind').value === 'existing';
    $('#home-setup-existing').hidden = !existing;
    const branch = 'integrate/all-govern-updates';
    const commands = existing
        ? 'git fetch origin\ngit switch ' + branch + '\ngit pull --ff-only origin ' + branch + '\n'
        : 'git clone --branch ' + branch + ' https://github.com/Esmeevanleeuwen/govern.git\ncd govern\n';
    $('#home-commands').textContent = commands + (os === 'windows' ? '.\\start.cmd' : 'sh start.sh');
    $('#home-copy-status').textContent = '';
}

function tabNavigation(event, selector, callback) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const items = $$(selector);
    const index = items.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    callback(items[next]);
    items[next].focus();
}

$$('[data-home-view]').forEach(button => {
    button.addEventListener('click', () => {view = button.dataset.homeView; renderSample({announce: true});});
    button.addEventListener('keydown', event => tabNavigation(event, '[data-home-view]', next => {view = next.dataset.homeView; renderSample({announce: true});}));
});
$$('[data-home-table]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.homeTable;
    if (!Object.hasOwn(tables, next)) return;
    selectedTable = next;
    selectedRecord = tables[next].rows[0][0];
    renderSample({announce: true});
}));
$('#home-sample-table')?.addEventListener('change', event => {
    if (!Object.hasOwn(tables, event.target.value)) return;
    selectedTable = event.target.value;
    selectedRecord = tables[selectedTable].rows[0][0];
    renderSample({announce: true});
});

$$('[data-home-open]').forEach(button => button.addEventListener('click', () => {
    const dialog = button.dataset.homeOpen === 'setup' ? $('#home-setup-dialog') : $('#home-preview-help-dialog');
    if (!dialog || dialog.open) return;
    dialogOpener = button;
    dialog.showModal();
}));
$$('.home-dialog').forEach(dialog => {
    attachDialog(dialog, {handle: dialog.querySelector('.home-dialog-header') || dialog.querySelector('h2')});
    dialog.addEventListener('close', () => {dialogOpener?.focus(); dialogOpener = null;});
});

$$('[data-home-os]').forEach(button => {
    button.addEventListener('click', () => setOperatingSystem(button.dataset.homeOs));
    button.addEventListener('keydown', event => tabNavigation(event, '[data-home-os]', next => setOperatingSystem(next.dataset.homeOs)));
});
$('#home-install-kind')?.addEventListener('change', () => setOperatingSystem(os));
const previewTools = $('.home-preview-tools');
previewTools?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {previewTools.open = false;}));
document.addEventListener('click', event => {
    if (previewTools?.open && !previewTools.contains(event.target)) previewTools.open = false;
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !previewTools?.open) return;
    previewTools.open = false;
    previewTools.querySelector('summary').focus();
    event.preventDefault();
});
$('#home-copy-commands')?.addEventListener('click', async () => {
    const commands = $('#home-commands');
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(commands.textContent);
        $('#home-copy-status').textContent = message('copied');
    } catch {
        const range = document.createRange();
        range.selectNodeContents(commands);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        $('#home-copy-status').textContent = message('copyManual');
    }
});

$('#home-language')?.addEventListener('change', event => {
    const next = event.target.value;
    if (!['en', 'nl'].includes(next)) return;
    const {saved} = updatePreferences({language: next});
    setLanguage(next);
    translate();
    if (!saved) $('#home-live').textContent = message('languageSession');
});
window.addEventListener('govern:languagechange', translate);
setLanguage(getPreferences().language);
translate();
setOperatingSystem(os);
