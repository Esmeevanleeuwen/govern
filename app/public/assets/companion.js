import {el, icon, button, badge, empty, errorText} from './ui.js';
import {parseConnectionScope} from './connection-scope.js';
import {getLanguage, setLanguage, t} from './i18n.js';
import {getPreferences, updatePreferences, subscribePreferences} from './preferences.js';
import {friendlyName, recordLabel} from './explorer-guide.js';
import {valueText} from './record-explorer-model.js';
import {openRecordWindow} from './record-window.js';
import {createCompanionReceiver} from './companion-channel.js';
import {MAX_PINNED_RECORDS, captureRecordContext, recordContextId, loadCompanionRecord,
    comparisonRows, sharedConnections} from './companion-model.js';
import {mountCompanionRadar} from './companion-radar.js';
import './companion-messages.js';

const message = (key, params) => t('app.companion.' + key, params);
setLanguage(getPreferences().language);
let mode = 'compare', status = 'connecting', latestSelection = null, receiver = null;
let sequence = 0, noticeKey = '', authenticationRequired = false, destroyed = false;
const pins = [];
const statusText = el('span');
const connection = el('div', {id: 'companion-connection', class: 'companion-status', role: 'status', 'aria-live': 'polite'},
    el('span', {class: 'status-dot'}), statusText);
const language = el('select', {id: 'companion-language', 'aria-label': message('language')},
    el('option', {value: 'nl'}, 'NL'), el('option', {value: 'en'}, 'EN'));
language.value = getLanguage();
language.addEventListener('change', () => updatePreferences({language: language.value}));
const noticeRoot = el('div', {id: 'companion-notice', class: 'companion-notice', 'aria-live': 'polite'});
const compareRoot = el('section', {id: 'companion-compare', role: 'tabpanel', 'aria-labelledby': 'companion-tab-compare'});
const radarRoot = el('section', {id: 'companion-radar-panel', role: 'tabpanel', 'aria-labelledby': 'companion-tab-radar', hidden: true});
const tabs = [
    button('', () => changeMode('compare'), {id: 'companion-tab-compare', role: 'tab', 'aria-controls': 'companion-compare', symbol: 'layers'}),
    button('', () => changeMode('radar'), {id: 'companion-tab-radar', role: 'tab', 'aria-controls': 'companion-radar-panel', symbol: 'network'}),
];
const title = el('h1', {id: 'companion-title'});
const selectionLabel = el('p', {id: 'companion-selection', class: 'companion-selection'});
const shell = el('div', {class: 'companion-shell'},
    el('header', {class: 'companion-header'}, el('div', {class: 'companion-identity'},
        el('a', {class: 'companion-wordmark', href: '/workspace.php', target: '_blank', rel: 'noopener'}, 'govern'), connection),
        el('div', {class: 'companion-actions'},
            el('span', {class: 'badge badge-blue', 'data-companion-text': 'readOnly'}),
            el('label', {class: 'companion-language'}, icon('globe'), language),
            el('a', {class: 'button button-secondary button-small', href: '/workspace.php', target: '_blank', rel: 'noopener', 'data-companion-text': 'mainWorkspace'}))),
    el('div', {class: 'companion-heading'}, el('p', {class: 'eyebrow', 'data-companion-text': 'eyebrow'}), title,
        el('p', {'data-companion-text': 'instruction'})),
    el('nav', {class: 'companion-tabs', role: 'tablist', 'aria-label': message('views')}, tabs),
    noticeRoot, selectionLabel,
    el('main', {id: 'companion-content', class: 'companion-content'}, compareRoot, radarRoot));
document.getElementById('companion-app').append(shell);

const radar = mountCompanionRadar(radarRoot, {
    onPin: context => pinRecord(context),
    onSelect: context => receiver?.sendSelect(context),
    onFollowingChange: following => { if (following) radar.setContext(latestSelection); },
    onLoaded: () => { if (authenticationRequired) { authenticationRequired = false; showNotice(); } },
});
let onlyDifferences = false, showTechnicalFields = false;

function sourceLabel(context) {
    const scope = parseConnectionScope(context.database);
    return message(scope.connection === 'postgres' ? 'postgresSource' : 'source', scope);
}
function labelFor(pin) {
    return pin.result ? pin.context.guided ? recordLabel(pin.result.node, pin.context.table) : pin.result.node.label
        : pin.context.guided ? friendlyName(pin.context.table) : pin.context.table;
}
function showNotice() {
    noticeRoot.replaceChildren();
    if (authenticationRequired) noticeRoot.append(el('div', {class: 'notice notice-error', role: 'alert'}, icon('info'),
        el('div', {}, el('p', {}, message('expired')),
            el('a', {class: 'button button-secondary button-small companion-auth-link', href: '/auth.php?mode=login', target: '_blank', rel: 'noopener'}, message('signIn')))));
    else if (noticeKey) noticeRoot.append(el('div', {class: 'notice', role: 'status'}, icon('info'),
        el('p', {}, message(noticeKey, {maximum: MAX_PINNED_RECORDS}))));
}
function updateStatus() {
    connection.dataset.status = status;
    statusText.textContent = message(['idle', 'connecting', 'connected', 'disconnected', 'blocked', 'unsupported', 'invalid'].includes(status) ? status : 'disconnected');
    selectionLabel.textContent = latestSelection ? message('selectHelp', {table: latestSelection.guided ? friendlyName(latestSelection.table) : latestSelection.table}) : '';
}
function changeMode(next, focus = false) {
    if (!['compare', 'radar'].includes(next)) return;
    mode = next;
    receiver?.setMode(next);
    compareRoot.hidden = mode !== 'compare'; radarRoot.hidden = mode !== 'radar';
    title.textContent = message(mode);
    tabs.forEach((tab, index) => {
        const selected = mode === (index ? 'radar' : 'compare');
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    if (mode === 'radar') radar.setContext(latestSelection);
    if (focus) tabs[mode === 'radar' ? 1 : 0].focus({preventScroll: true});
}
tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? 1
        : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 1 - index : null;
    if (target === null) return;
    event.preventDefault(); changeMode(target ? 'radar' : 'compare', true);
}));

async function loadPin(pin) {
    pin.controller?.abort();
    const controller = new AbortController(); pin.controller = controller;
    const revision = ++pin.revision;
    pin.loading = true; pin.error = null; renderCompare();
    try {
        const result = await loadCompanionRecord(pin.context, {signal: controller.signal});
        if (destroyed || controller.signal.aborted || revision !== pin.revision || !pins.includes(pin)) return;
        pin.result = result;
        if (authenticationRequired) { authenticationRequired = false; showNotice(); }
    } catch (error) {
        if (destroyed || controller.signal.aborted || revision !== pin.revision || error.name === 'AbortError' || !pins.includes(pin)) return;
        pin.error = error;
    } finally {
        if (!destroyed && pins.includes(pin) && revision === pin.revision) {
            pin.loading = false; renderCompare();
        }
    }
}
function pinRecord(value) {
    const context = captureRecordContext(value);
    if (!context || destroyed) return;
    const id = recordContextId(context);
    const existing = pins.find(pin => pin.id === id);
    if (existing) {
        noticeKey = 'alreadyPinned'; showNotice();
        document.getElementById(existing.domId + '-refresh')?.focus({preventScroll: true});
        return;
    }
    if (pins.length >= MAX_PINNED_RECORDS) { noticeKey = 'maximum'; showNotice(); return; }
    noticeKey = ''; showNotice();
    const pin = {id, domId: 'companion-pin-' + ++sequence, context, result: null, error: null, loading: false, revision: 0, controller: null, technicalOpen: false};
    pins.push(pin); loadPin(pin);
}
function removePin(pin) {
    const index = pins.indexOf(pin);
    if (index < 0) return;
    pin.controller?.abort(); ++pin.revision; pins.splice(index, 1);
    noticeKey = ''; showNotice(); renderCompare();
    const next = pins[Math.min(index, pins.length - 1)];
    (next ? document.getElementById(next.domId + '-remove') : tabs[0])?.focus({preventScroll: true});
}
function pinHeader(pin) {
    const name = labelFor(pin);
    const key = el('details', {class: 'companion-pin-key', 'data-companion-key': pin.domId, ...(pin.technicalOpen ? {open: true} : {})},
        el('summary', {id: pin.domId + '-technical'}, message('technical')),
        el('code', {}, pin.context.table),
        el('dl', {}, Object.entries(pin.context.key).map(([column, value]) => el('div', {}, el('dt', {}, column), el('dd', {}, value)))));
    key.addEventListener('toggle', () => { if (key.isConnected) pin.technicalOpen = key.open; });
    const header = el('th', {scope: 'col', 'data-companion-record': pin.id, 'data-record-scope': pin.context.database,
        'data-record-table': pin.context.table, 'data-record-key': JSON.stringify(pin.context.key), 'data-loading': String(pin.loading)},
        el('div', {class: 'companion-pin-heading'}, el('div', {class: 'companion-pin-title'}, icon('pin'), el('h3', {}, name)),
            el('div', {class: 'companion-pin-tools'},
                button(message('refresh'), () => loadPin(pin), {id: pin.domId + '-refresh', className: 'icon-button', symbol: 'refresh', disabled: pin.loading, 'data-companion-refresh': pin.id}),
                button(message('remove'), () => removePin(pin), {id: pin.domId + '-remove', className: 'icon-button', symbol: 'close', 'data-companion-remove': pin.id}))),
        el('p', {class: 'companion-pin-source'}, sourceLabel(pin.context)),
        el('span', {class: 'companion-pin-table'}, pin.context.guided ? friendlyName(pin.context.table) : pin.context.table), key);
    header.querySelectorAll('.icon-button > span').forEach(span => { span.className = 'sr-only'; });
    if (pin.loading) header.append(el('div', {class: 'companion-pin-loading', role: 'status'}, el('span', {class: 'spinner'}), message(pin.result ? 'refreshing' : 'loading')));
    if (pin.error) header.append(el('div', {class: 'companion-pin-error', 'data-companion-error': '', role: 'alert'},
        el('p', {}, errorText(pin.error)), pin.result ? el('p', {}, message('previous')) : null,
        button(message('retry'), () => loadPin(pin), {className: 'button-small', symbol: 'refresh'})));
    return header;
}
function cellContent(cell) {
    if (!cell.present) return el('span', {class: 'companion-value-note', 'data-cell-value': 'missing'}, message(cell.truncated ? 'notLoaded' : 'missing'));
    if (cell.value === null) return el('span', {class: 'null-value', 'data-cell-value': 'null'}, 'NULL');
    if (cell.value === '') return el('span', {class: 'companion-value-note', 'data-cell-value': 'empty'}, message('emptyValue'));
    return el('span', {'data-cell-value': 'present'}, valueText(cell.value));
}
function renderCompare() {
    const activeId = document.activeElement?.id;
    for (const details of compareRoot.querySelectorAll('[data-companion-key]')) {
        const pin = pins.find(item => item.domId === details.dataset.companionKey);
        if (pin) pin.technicalOpen = details.open;
    }
    const scroller = compareRoot.querySelector('.companion-compare-scroll');
    const scroll = {left: scroller?.scrollLeft || 0, top: scroller?.scrollTop || 0};
    const toggle = el('input', {id: 'companion-differences', type: 'checkbox', checked: onlyDifferences, title: message('differencesHelp')});
    toggle.addEventListener('change', () => { onlyDifferences = toggle.checked; renderCompare(); });
    const friendly = pins.every(pin => pin.context.guided);
    const technicalVisible = !friendly || showTechnicalFields;
    const technicalToggle = el('input', {id: 'companion-technical', type: 'checkbox', checked: technicalVisible,
        disabled: !friendly, title: message('technicalFieldsHelp')});
    technicalToggle.addEventListener('change', () => { showTechnicalFields = technicalToggle.checked; renderCompare(); });
    const toolbar = el('div', {class: 'companion-desk-toolbar'},
        el('strong', {id: 'companion-pin-count', role: 'status'}, message('pinCount', {count: pins.length, maximum: MAX_PINNED_RECORDS})),
        el('label', {class: 'companion-differences'}, technicalToggle, el('span', {}, message('technicalFields'))),
        el('label', {class: 'companion-differences'}, toggle, el('span', {}, message('differences'))));
    const desk = el('section', {class: 'companion-desk'}, toolbar);
    if (!pins.length) {
        desk.append(empty(message('emptyTitle'), message('emptyHelp'), null, 'layers'));
        compareRoot.replaceChildren(desk); return;
    }
    const loaded = pins.filter(pin => pin.result);
    const records = loaded.map(pin => pin.result);
    const rows = comparisonRows(records);
    const canCompare = pins.length > 1 && pins.every(pin => pin.result && !pin.loading && !pin.error);
    const technicalNames = records.map(record => {
        const names = new Set(Object.keys(record.node.key).filter(name => /(^id$|_id$|^uuid$)/i.test(name)));
        for (const edge of record.data.edges) {
            if (edge.source === record.node.id) edge.columns.forEach(name => names.add(name));
            if (edge.target === record.node.id) edge.referenced_columns.forEach(name => names.add(name));
        }
        return names;
    });
    const visibleRows = rows.filter(row => technicalVisible || !records.every((record, index) =>
        !Object.hasOwn(record.node.values, row.name) || technicalNames[index].has(row.name)));
    const shownRows = visibleRows.filter(row => !onlyDifferences || !canCompare || row.different || row.unknown);
    const table = el('table', {class: 'companion-comparison-table', style: 'min-width:' + (180 + pins.length * 250) + 'px'},
        el('caption', {class: 'sr-only'}, message('compare')),
        el('thead', {}, el('tr', {}, el('th', {scope: 'col'}, message('field')), pins.map(pinHeader))));
    const body = el('tbody');
    for (const row of shownRows) {
        const displayName = friendly ? friendlyName(row.name) : row.name;
        const heading = el('th', {scope: 'row', title: message(row.unknown ? 'unknown' : row.different ? 'different' : 'field')}, displayName,
            friendly && technicalVisible && displayName !== row.name ? el('code', {}, row.name) : null);
        body.append(el('tr', {'data-comparison-field': row.name, 'data-different': String(row.different), 'data-unknown': String(row.unknown)},
            heading, pins.map(pin => {
                const index = loaded.indexOf(pin);
                return el('td', {}, index < 0 ? el('span', {class: 'companion-value-note'}, message(pin.loading ? 'loading' : 'noFields')) : cellContent(row.cells[index]));
            })));
    }
    if (!shownRows.length) body.append(el('tr', {}, el('td', {colspan: pins.length + 1, class: 'companion-value-note'},
        message(visibleRows.length && onlyDifferences && canCompare ? 'noDifferences' : rows.length && !technicalVisible ? 'noVisibleFields' : 'noFields'))));
    table.append(body);
    desk.append(el('div', {class: 'companion-compare-scroll', tabindex: '0', 'aria-label': message('compare')}, table),
        el('p', {class: 'companion-desk-note'}, message('snapshot')));
    if (onlyDifferences && !canCompare) desk.append(el('p', {class: 'companion-desk-note', role: 'status'}, message('incomplete')));
    if (new Set(pins.map(pin => pin.context.table)).size > 1) desk.append(el('p', {class: 'companion-desk-note'}, message('mixedTables')));
    if (rows.some(row => row.unknown)) desk.append(el('p', {class: 'companion-desk-note'}, message('previewHelp')));
    const contents = [desk];
    const shared = records.length === pins.length ? sharedConnections(records) : [];
    if (shared.length) contents.push(el('section', {class: 'companion-common'}, el('h3', {}, message('sharedTitle')), el('p', {}, message('sharedHelp')),
        el('div', {class: 'companion-common-list'}, shared.map(item =>
            button(item.context.guided ? recordLabel(item.node, item.context.table) : item.node.label,
                () => openRecordWindow(item.context), {symbol: 'link', className: 'button-small', 'data-companion-shared': item.id})))));
    compareRoot.replaceChildren(...contents);
    const nextScroller = compareRoot.querySelector('.companion-compare-scroll');
    if (nextScroller) { nextScroller.scrollLeft = scroll.left; nextScroller.scrollTop = scroll.top; }
    if (activeId) document.getElementById(activeId)?.focus({preventScroll: true});
}
function translate() {
    document.title = 'Govern — ' + message('title');
    document.querySelectorAll('[data-companion-text]').forEach(node => { node.textContent = message(node.dataset.companionText); });
    language.value = getLanguage(); language.setAttribute('aria-label', message('language'));
    shell.querySelector('[role="tablist"]').setAttribute('aria-label', message('views'));
    tabs.forEach((tab, index) => { const text = message(index ? 'radar' : 'compare'); tab.querySelector('span').textContent = text; tab.setAttribute('aria-label', text); });
    updateStatus(); showNotice(); renderCompare(); changeMode(mode); radar.refreshLanguage();
}
window.addEventListener('govern:languagechange', translate);
window.addEventListener('govern:authrequired', () => { authenticationRequired = true; showNotice(); });
const unsubscribe = subscribePreferences(preferences => {
    if (preferences.language !== getLanguage()) setLanguage(preferences.language);
});
receiver = createCompanionReceiver({
    onSelection: context => {
        latestSelection = context ? captureRecordContext(context) : null;
        updateStatus(); if (mode === 'radar') radar.setContext(latestSelection);
    },
    onPin: pinRecord,
    onMode: next => changeMode(next),
    onStatus: next => { status = next; updateStatus(); },
});
translate();
window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    destroyed = true; pins.forEach(pin => pin.controller?.abort()); receiver.destroy(); radar.destroy(); unsubscribe();
    window.removeEventListener('govern:languagechange', translate);
});
