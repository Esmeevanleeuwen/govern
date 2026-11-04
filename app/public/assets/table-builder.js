import {request} from './api.js';
import {parseConnectionScope} from './connection-scope.js';
import {t} from './i18n.js';
import {el, button, dataTable, errorText} from './ui.js';
import {attachDialog} from './modal-shell.js';
import './table-builder-messages.js';

const text = (key, params) => t('app.tableBuilder.' + key, params);
const typeLabels = {text: 'typeText', whole: 'typeWhole', decimal: 'typeDecimal', boolean: 'typeBoolean', date: 'typeDate', datetime: 'typeDatetime'};
let serial = 0;
const newColumn = () => ({uid: ++serial, name: '', type: 'text', nullable: true, primary: false, generated: false,
    defaultMode: 'none', defaultValue: '', precision: 18, scale: 2});

/** A fixed-scope new-table draft. No raw SQL or edit-existing mode is accepted. */
export function createTableBuilder({getDatabase, isBusy = () => false, onBusy = () => {}, onCreated = () => {}}) {
    const drafts = new Map();
    let captured = '', state = null, saving = false, opener = null, openerId = '';
    const lifetime = new AbortController();
    const dialog = el('dialog', {id: 'table-builder-dialog', class: 'table-builder-dialog',
        'aria-labelledby': 'table-builder-title', 'aria-describedby': 'table-builder-description', 'data-selection-ui': ''});
    const form = el('form', {class: 'table-builder-form', on: {submit: event => {
        event.preventDefault(); if (state?.stage === 'edit') review();
    }}});
    dialog.append(form); document.body.append(dialog);
    const shell = attachDialog(dialog, {handle: form, draggable: false});

    function invalidated() { state.preview = null; state.failure = null; state.uncertain = false; }
    function field(key, control, hint = null) {
        const label = el('label', {class: 'field-label', for: control.id}, el('span', {}, text(key)), control);
        if (hint) {
            const id = control.id + '-hint';
            control.setAttribute('aria-describedby', id);
            label.append(el('span', {id, class: 'field-hint'}, text(hint)));
        }
        return label;
    }
    function input(id, value, handler, attributes = {}) {
        return el('input', {id, class: 'input', value, ...attributes, on: {input: event => {
            handler(event.target.value); invalidated();
        }}});
    }
    function select(id, value, choices, handler) {
        return el('select', {id, class: 'input select', value, on: {change: event => {
            handler(event.target.value); invalidated(); render(id);
        }}}, choices.map(([choice, label, disabled]) => el('option', {value: choice, selected: choice === value, disabled}, label)));
    }
    function check(id, key, checked, handler, disabled = false) {
        return el('label', {for: id}, el('input', {id, type: 'checkbox', checked, disabled, on: {change: event => {
            handler(event.target.checked); invalidated(); render(id);
        }}}), el('span', {}, text(key)));
    }
    function scopeSummary() {
        const scope = parseConnectionScope(captured), postgres = scope.connection === 'postgres';
        return el('dl', {class: 'table-builder-scope', 'aria-label': text('scope')},
            el('div', {}, el('dt', {}, text('engine')), el('dd', {}, postgres ? 'PostgreSQL' : 'MariaDB')),
            el('div', {}, el('dt', {}, text('database')), el('dd', {}, scope.database)),
            postgres ? el('div', {}, el('dt', {}, text('schema')), el('dd', {}, scope.schema)) : null);
    }
    function columnCard(column, index) {
        const id = 'table-builder-column-' + column.uid;
        const name = input(id + '-name', column.name, value => { column.name = value; },
            {type: 'text', required: true, pattern: '[a-z][a-z0-9_]{0,62}', maxlength: 63, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false'});
        const type = select(id + '-type', column.type, Object.entries(typeLabels).map(([value, key]) => [value, text(key)]), value => {
            column.type = value;
            if (value !== 'whole') column.generated = false;
            if (value === 'text') column.primary = false;
        });
        const defaults = select(id + '-default', column.defaultMode,
            [['none', text('defaultNone')], ['null', text('defaultNull'), !column.nullable], ['literal', text('defaultLiteral')]], value => { column.defaultMode = value; });
        defaults.disabled = column.generated;
        const controls = el('div', {class: 'table-builder-column-fields'}, field('columnName', name), field('type', type), field('default', defaults));
        controls.append(el('div', {class: 'table-builder-checks'},
            check(id + '-primary', 'primary', column.primary, value => {
                if (value) {
                    for (const other of state.columns) if (other !== column) { other.primary = false; other.generated = false; }
                    column.nullable = false;
                    if (column.defaultMode === 'null') column.defaultMode = 'none';
                }
                column.primary = value;
                if (!value) column.generated = false;
            }, column.type === 'text'),
            check(id + '-nullable', 'nullable', column.nullable, value => {
                column.nullable = value;
                if (!value && column.defaultMode === 'null') column.defaultMode = 'none';
            }, column.primary || column.generated),
            column.type === 'whole' ? check(id + '-generated', 'generated', column.generated, value => {
                column.generated = value;
                if (value) {
                    for (const other of state.columns) if (other !== column) { other.primary = false; other.generated = false; }
                    column.primary = true; column.nullable = false; column.defaultMode = 'none';
                }
            }) : null));
        if (column.type === 'decimal') {
            controls.append(el('div', {class: 'table-builder-column-extra'},
                field('precision', input(id + '-precision', String(column.precision), value => { column.precision = value; },
                    {type: 'number', min: 1, max: 65, step: 1, required: true})),
                field('scale', input(id + '-scale', String(column.scale), value => { column.scale = value; },
                    {type: 'number', min: 0, max: 30, step: 1, required: true}))),
            el('p', {class: 'field-hint'}, text('decimalHelp')));
        }
        if (column.defaultMode === 'literal') {
            controls.append(field('defaultValue', input(id + '-literal', column.defaultValue, value => { column.defaultValue = value; },
                {type: 'text', maxlength: 4096, required: column.type !== 'text', autocomplete: 'off', spellcheck: 'false'}), 'literalHelp'));
        }
        const hint = column.generated ? 'generatedHelp' : ['date', 'datetime'].includes(column.type) ? 'dateHelp' : null;
        return el('section', {class: 'table-builder-column', 'aria-labelledby': id + '-title'},
            el('header', {class: 'table-builder-column-heading'}, el('h3', {id: id + '-title'}, text('column', {number: index + 1})),
                button(text('removeColumn', {number: index + 1}), () => {
                    if (saving || state.columns.length === 1) return;
                    state.columns.splice(index, 1); invalidated(); state.announcement = text('removed');
                    render('table-builder-column-' + state.columns[Math.min(index, state.columns.length - 1)].uid + '-name', null, true);
                }, {symbol: 'close', className: 'button-small', disabled: state.columns.length === 1, 'data-table-builder-remove': column.uid})),
            controls, hint ? el('p', {class: 'field-hint'}, text(hint)) : null);
    }
    function definition() {
        return {name: state.name, columns: state.columns.map(column => ({name: column.name, type: column.type,
            nullable: column.nullable, primary: column.primary, generated: column.generated,
            default: {mode: column.defaultMode, ...(column.defaultMode === 'literal' ? {value: column.defaultValue} : {})},
            ...(column.type === 'decimal' ? {precision: Number(column.precision), scale: Number(column.scale)} : {})}))};
    }
    function focus(id, selection = null) {
        const node = id ? document.getElementById(id) : null;
        if (node && dialog.contains(node)) {
            node.focus({preventScroll: true});
            if (selection && typeof node.setSelectionRange === 'function' && node.type === 'text') {
                node.setSelectionRange(selection[0], selection[1]);
            }
        }
    }
    function render(focusId = null, selection = null, revealFocus = false) {
        if (!state) return;
        dialog.setAttribute('aria-busy', String(saving));
        const content = el('div', {class: 'table-builder-content'}, scopeSummary());
        if (state.failure) content.append(el('div', {id: 'table-builder-error', class: 'notice notice-error', role: 'alert', tabindex: '-1'},
            state.navigationFailure ? text('navigationFailed') : errorText(state.failure)));
        if (state.uncertain) content.append(el('p', {class: 'notice', role: 'alert'}, text('uncertain')));
        if (state.stage === 'edit') {
            content.append(field('name', input('table-builder-name', state.name, value => { state.name = value; },
                {type: 'text', class: 'input table-builder-name', required: true, pattern: '[a-z][a-z0-9_]{0,62}', maxlength: 63,
                    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false'}), 'nameHelp'),
            el('h3', {}, text('columns')), ...state.columns.map(columnCard),
            el('div', {class: 'table-builder-toolbar'},
                button(text('addColumn'), () => {
                    if (state.columns.length >= 256 || saving) return;
                    const column = newColumn(); state.columns.push(column); invalidated();
                    render('table-builder-column-' + column.uid + '-name', null, true);
                }, {id: 'table-builder-add-column', symbol: 'plus', className: 'button-small', disabled: state.columns.length >= 256}),
                button(text('addIdentifier'), () => {
                    if (saving || state.columns.length >= 256) return;
                    if (state.columns.some(column => column.name === 'id')) return showFailure(new Error(text('identifierExists')));
                    if (state.columns.some(column => column.primary)) return showFailure(new Error(text('primaryExists')));
                    const column = {...newColumn(), name: 'id', type: 'whole', nullable: false, primary: true, generated: true};
                    state.columns.unshift(column); invalidated(); render('table-builder-column-' + column.uid + '-name', null, true);
                }, {id: 'table-builder-add-identifier', symbol: 'plus', className: 'button-small', disabled: state.columns.length >= 256})),
            el('details', {class: 'table-builder-help'}, el('summary', {}, text('help')), el('p', {class: 'small muted'}, text('basics'))));
        } else if (state.stage === 'review') {
            const preview = state.preview;
            content.append(el('h3', {tabindex: '-1', id: 'table-builder-review-title'}, text('reviewTitle', {name: preview.table})),
                el('p', {}, text('reviewHelp')),
                dataTable([
                    {label: text('columnName'), key: 'name'}, {label: text('type'), key: 'type', render: (value, row) =>
                        text(typeLabels[value]) + (value === 'decimal' ? ` (${row.precision}, ${row.scale})` : '')},
                    {label: text('nullable'), key: 'nullable', render: value => text(value ? 'yes' : 'no')},
                    {label: text('primary'), key: 'primary', render: value => text(value ? 'yes' : 'no')},
                    {label: text('default'), key: 'default', render: (value, row) => row.generated ? text('generatedValue')
                        : value.mode === 'none' ? text('defaultNone') : value.mode === 'null' ? 'NULL' : value.value},
                ], preview.definition.columns, {caption: text('columns')}),
                el('details', {}, el('summary', {}, text('sql')), el('pre', {}, el('code', {}, preview.sql))));
        } else if (state.stage === 'result') {
            content.append(el('h3', {role: 'status'}, text('success', {name: state.result.table})),
                el('p', {}, text('successHelp')),
                state.result.verified === false ? el('p', {class: 'notice'}, text('verifyPending')) : null);
        }
        const close = button(text('close'), dismiss, {id: 'table-builder-close', symbol: 'close', className: 'icon-button'});
        const footer = el('footer', {class: 'table-builder-footer'},
            button(text(state.stage === 'review' ? 'edit' : state.stage === 'result' ? 'close' : 'cancel'), () => {
                if (state.stage === 'review') { state.stage = 'edit'; state.failure = null; render('table-builder-name'); }
                else dismiss();
            }, {id: 'table-builder-back', className: 'button-small'}),
            state.stage === 'edit' ? button(text(saving ? 'reviewing' : 'review'), review,
                {id: 'table-builder-review', kind: 'primary', symbol: 'arrow'})
                : state.stage === 'review' ? button(text(saving ? 'creating' : 'create', {name: state.preview.table}), create,
                    {id: 'table-builder-create', kind: 'primary', symbol: 'plus'})
                : state.stage === 'result' ? button(text('openTable'), () => openCreated(),
                    {id: 'table-builder-open', kind: 'primary', symbol: 'arrow'}) : null);
        form.replaceChildren(el('header', {class: 'table-builder-header'},
            el('div', {}, el('h2', {id: 'table-builder-title'}, text('title')),
                el('p', {id: 'table-builder-description', class: 'small muted'}, text('description'))), close), content,
        el('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'}, state.announcement || ''), footer);
        if (saving) for (const control of form.querySelectorAll('input,select,button')) control.disabled = true;
        focus(focusId, selection);
        if (revealFocus && focusId) document.getElementById(focusId)?.scrollIntoView({block: 'nearest'});
    }
    function ensureScope() {
        if (getDatabase() !== captured) throw new Error(text('scopeChanged'));
    }
    function showFailure(error) {
        state.failure = error; render('table-builder-error', null, true);
    }
    async function review() {
        if (saving || !state || state.stage !== 'edit' || !form.reportValidity()) return;
        try { ensureScope(); } catch (error) { showFailure(error); return; }
        saving = true; state.failure = null; state.uncertain = false; render();
        try {
            state.preview = await request('table-definition-preview', {params: {database: captured}, body: definition()});
            ensureScope(); state.stage = 'review';
        } catch (error) { state.failure = error; }
        finally { saving = false; render(state.failure ? 'table-builder-error' : 'table-builder-review-title', null, true); }
    }
    function createdContext() {
        return {scope: captured, draft: state, dialogs: new Set([...document.querySelectorAll('dialog[open]')].filter(node => node !== dialog))};
    }
    async function create() {
        if (saving || state?.stage !== 'review' || !state.preview) return;
        try { ensureScope(); } catch (error) { showFailure(error); return; }
        const context = createdContext();
        saving = true; state.failure = null; render();
        let result;
        try {
            result = await request('table-definition-create', {params: {database: captured},
                body: {definition: state.preview.definition, definition_token: state.preview.definition_token}});
            state.result = result; state.stage = 'result'; state.preview = null;
        } catch (error) {
            state.failure = error;
            state.uncertain = error.error_code === 'table_definition_uncertain' || !error.status;
            state.preview = null; state.stage = 'edit';
        } finally { saving = false; render(state.failure ? 'table-builder-error' : null, null, true); }
        if (result) await openCreated(context);
    }
    async function openCreated(context = createdContext()) {
        if (saving || state?.stage !== 'result' || !state.result) return;
        if (state !== context.draft || captured !== context.scope) return;
        try { ensureScope(); } catch (error) { showFailure(error); return; }
        const operationScope = context.scope, operationState = context.draft, priorDialogs = context.dialogs;
        const stillCurrent = () => !lifetime.signal.aborted && captured === operationScope && state === operationState
            && getDatabase() === operationScope && ![...document.querySelectorAll('dialog[open]')].some(node => !priorDialogs.has(node));
        operationState.navigationFailure = false; operationState.failure = null;
        // Creation already succeeded. This action only refreshes the workspace;
        // it never calls the create endpoint again, including after a failed read.
        if (dialog.open) {
            const closed = new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
            dismiss();
            await closed;
        }
        if (!stillCurrent()) return;
        try { await onCreated(operationState.result); }
        catch (error) {
            operationState.navigationFailure = true; operationState.failure = error;
            // A late workspace failure must never overwrite or reopen a newer draft.
            if (!stillCurrent()) return;
            render(); dialog.showModal(); onBusy(true); focus('table-builder-error');
        }
    }
    function dismiss() {
        if (saving || !dialog.open) return false;
        drafts.set(captured, state); dialog.close(); onBusy(false); return true;
    }
    function open(options = {}) {
        if (saving || dialog.open || isBusy()) return false;
        captured = typeof options.database === 'string' ? options.database : getDatabase();
        if (!captured || captured !== getDatabase()) return false;
        opener = document.activeElement; openerId = opener?.id || '';
        state = drafts.get(captured);
        if (!state || state.result) state = {name: '', columns: [newColumn()], stage: 'edit', preview: null, failure: null, uncertain: false, announcement: ''};
        state.navigationFailure = false;
        render(); dialog.scrollTop = 0; dialog.showModal(); onBusy(true); focus('table-builder-name'); return true;
    }
    function translate() {
        if (!dialog.open) return;
        const active = document.activeElement;
        const selection = active?.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
        const scroll = {top: dialog.scrollTop, left: dialog.scrollLeft};
        render(active?.id, selection);
        dialog.scrollTop = scroll.top; dialog.scrollLeft = scroll.left;
    }
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); }, {signal: lifetime.signal});
    dialog.addEventListener('close', () => {
        // Native close events are queued; an older event cannot release a reopened dialog.
        if (dialog.open) return;
        onBusy(false);
        if (state) drafts.set(captured, state);
        const target = opener?.isConnected ? opener : document.getElementById(openerId);
        if (target && !target.disabled && !document.querySelector('dialog[open]')) target.focus({preventScroll: true});
    }, {signal: lifetime.signal});
    window.addEventListener('govern:languagechange', translate, {signal: lifetime.signal});
    return {open, close: dismiss, translate, isOpen: () => dialog.open, get busy() { return saving; },
        destroy() { if (saving) return false; lifetime.abort(); if (dialog.open) dialog.close(); shell.destroy(); dialog.remove(); onBusy(false); return true; }};
}
