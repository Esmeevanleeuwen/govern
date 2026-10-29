import {request} from './api.js';
import {t} from './i18n.js';
import {el, button, errorText} from './ui.js';
import './database-messages.js';

const text = (key, params) => t('app.databases.' + key, params);

/** Prepare one named database, then use the official phpMyAdmin import flow. */
export function createDatabaseManager({getDatabase, getDatabases, canCreate, isBusy, onPrepared, onSelect, onImport, onBusy = () => {}}) {
    let saving = false;
    let failure = null;
    let opener = null;
    let openerId = '';
    let restoreFocus = true;
    let inputError = false;
    const labels = [];
    const dialog = el('dialog', {id: 'database-manager-dialog', class: 'database-manager-dialog',
        'aria-labelledby': 'database-manager-title', 'aria-describedby': 'database-manager-description', 'data-selection-ui': ''});
    const label = (tag, key, attributes = {}) => {
        const node = el(tag, attributes);
        labels.push(() => { node.textContent = text(key); });
        return node;
    };
    const action = (key, handler, options) => {
        const node = button('', handler, options);
        labels.push(() => {
            const value = text(key);
            node.setAttribute('aria-label', value);
            node.querySelector('span').textContent = value;
        });
        return node;
    };
    const close = action('closeManager', () => dismiss(), {id: 'database-manager-close', symbol: 'close', className: 'icon-button database-manager-close'});
    const cancel = action('closeManager', () => dismiss(), {id: 'database-manager-cancel', className: 'button-small'});
    const existing = el('select', {id: 'database-manager-existing', class: 'input select', 'aria-describedby': 'database-manager-existing-help'});
    const name = el('input', {id: 'database-manager-name', class: 'input', type: 'text', maxlength: 64, autocomplete: 'off',
        autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'database-manager-name-help database-manager-error'});
    const switchButton = action('openWorkspace', () => choose(false), {id: 'database-manager-switch', symbol: 'arrow', className: 'button-small'});
    const importExisting = action('importSelected', () => choose(true), {id: 'database-manager-import-existing', symbol: 'download', className: 'button-small'});
    const createButton = action('createDatabase', () => prepare(false), {id: 'database-manager-create', symbol: 'plus', className: 'button-small'});
    const createImport = action('createAndImport', () => prepare(true), {id: 'database-manager-create-import', symbol: 'download', kind: 'primary', className: 'button-small'});
    const unavailable = label('p', 'managerUnavailable', {id: 'database-manager-unavailable', class: 'notice', hidden: true});
    const error = el('p', {id: 'database-manager-error', class: 'notice notice-error', role: 'alert', tabindex: '-1', hidden: true});
    const status = el('p', {id: 'database-manager-status', class: 'small muted', role: 'status', 'aria-live': 'polite', hidden: true});
    const form = el('form', {novalidate: '', on: {submit: event => { event.preventDefault(); if (document.activeElement === name) prepare(true); }}},
        el('header', {class: 'database-manager-heading'}, el('div', {},
            label('h2', 'managerTitle', {id: 'database-manager-title'}),
            label('p', 'managerDescription', {id: 'database-manager-description', class: 'small muted'})), close),
        el('section', {class: 'database-manager-section'},
            label('h3', 'existingDatabases'),
            el('label', {class: 'field-label', for: 'database-manager-existing'}, label('span', 'choose'), existing),
            label('p', 'existingHelp', {id: 'database-manager-existing-help', class: 'field-hint'}),
            el('div', {class: 'database-manager-actions'}, switchButton, importExisting)),
        el('section', {class: 'database-manager-section'},
            label('h3', 'newDatabase'),
            el('label', {class: 'field-label', for: 'database-manager-name'}, label('span', 'databaseName'), name),
            label('p', 'nameHelp', {id: 'database-manager-name-help', class: 'field-hint'}),
            label('p', 'importHelp', {class: 'small muted database-manager-import-help'}),
            unavailable, error, status,
            el('div', {class: 'database-manager-actions'}, createButton, createImport)),
        label('p', 'serverScope', {class: 'small muted database-manager-footnote'}),
        el('footer', {class: 'database-manager-footer'}, cancel));
    dialog.append(form);
    document.body.append(dialog);

    function updateControls() {
        const selected = getDatabases().find(item => item.name === existing.value);
        dialog.setAttribute('aria-busy', String(saving));
        existing.disabled = saving || !getDatabases().length;
        name.disabled = saving || !canCreate();
        switchButton.disabled = saving || !selected;
        importExisting.disabled = saving || !selected || selected.available === false;
        createButton.disabled = createImport.disabled = saving || !canCreate() || !name.value.trim();
        close.disabled = cancel.disabled = saving;
        unavailable.hidden = canCreate();
        status.hidden = !saving;
        status.textContent = saving ? text('preparingDatabase') : '';
        error.hidden = !failure && !inputError;
        error.textContent = inputError ? text('invalidDatabaseName') : failure ? errorText(failure) : '';
        name.setAttribute('aria-invalid', String(inputError));
    }

    function refreshChoices() {
        const selected = existing.value || getDatabase();
        const items = getDatabases();
        existing.replaceChildren(...items.map(item => el('option', {value: item.name, selected: item.name === selected},
            item.available === false ? text('unavailable', {name: item.name}) : item.name)));
        if (!items.some(item => item.name === selected)) existing.value = getDatabase();
        updateControls();
    }

    function translate() {
        for (const update of labels) update();
        refreshChoices();
    }

    function dismiss() {
        if (saving) return;
        dialog.close();
    }

    async function transition(work) {
        restoreFocus = false;
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
        dialog.close();
        await closed;
        try { await work(); }
        catch (caught) {
            failure = caught;
            open();
            error.focus({preventScroll: true});
        }
    }

    async function choose(importSql) {
        if (saving || isBusy()) return;
        const database = existing.value;
        const selected = getDatabases().find(item => item.name === database);
        if (!selected || importSql && selected.available === false) return;
        await transition(() => importSql ? onImport(database) : onSelect(database));
    }

    async function prepare(importSql) {
        if (saving || isBusy() || !canCreate()) return;
        const value = name.value.trim();
        failure = null;
        inputError = !/^[A-Za-z0-9_]{1,64}$/.test(value) || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(value.toLowerCase())
            || value.replaceAll('_', '\\_').length > 64;
        if (inputError) { updateControls(); name.focus(); return; }
        saving = true; updateControls();
        try {
            const result = await request('prepare-database', {params: {database: getDatabase()}, body: {name: value}});
            if (result.database !== value || !Array.isArray(result.databases)) throw new Error(text('managerResponseInvalid'));
            saving = false; updateControls();
            await transition(() => onPrepared(result, {importSql}));
        } catch (caught) {
            failure = caught;
            saving = false; updateControls();
            error.focus({preventScroll: true});
        }
    }

    function open() {
        if (isBusy() || dialog.open) return false;
        opener = document.activeElement; openerId = opener?.id || '';
        restoreFocus = true;
        existing.value = getDatabase();
        translate();
        dialog.showModal(); onBusy(true);
        (canCreate() ? name : existing).focus({preventScroll: true});
        return true;
    }

    existing.addEventListener('change', updateControls);
    name.addEventListener('input', () => { failure = null; inputError = false; updateControls(); });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        onBusy(false);
        if (restoreFocus) {
            const node = opener?.isConnected ? opener : document.getElementById(openerId);
            if (node && !node.disabled) node.focus({preventScroll: true});
        }
    });
    window.addEventListener('govern:languagechange', translate);
    translate();
    return {open, refresh: refreshChoices, get isOpen() { return dialog.open; }};
}
