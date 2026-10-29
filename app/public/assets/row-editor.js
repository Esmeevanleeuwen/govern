import {request} from './api.js';
import {t, getLanguage} from './i18n.js';
import {el, button, icon, errorText, confirmAction} from './ui.js';
import './row-editor-messages.js';

const message = (key, params) => t('app.rowEditor.' + key, params);

/** A row editor always owns the database, key and version captured when opened. */
export function createRowEditor({getDatabase, onBusy = () => {}, onSaved = () => {}, onPhpMyAdmin = () => {}}) {
    let current = null;

    function translate(state) {
        for (const update of state.labels) update();
        updateControls(state);
        if (state.error) state.errorMessage.textContent = state.conflict ? message('conflict') : errorText(state.error);
    }

    function text(state, tag, key, attributes = {}, params) {
        const node = el(tag, attributes);
        state.labels.push(() => { node.textContent = message(key, params); });
        return node;
    }

    function action(state, key, handler, options = {}) {
        const node = button('', handler, options);
        state.labels.push(() => {
            const label = message(key);
            node.setAttribute('aria-label', label);
            node.querySelector('span').textContent = label;
        });
        return node;
    }

    function isDirty(state) {
        if (!state.data || state.mode === 'delete' || !state.supported) return false;
        return [...state.fields.values()].some(field => field.mode.value !== field.original.mode ||
            (field.mode.value === 'value' && field.input.value !== field.original.value));
    }

    function updateField(field, state) {
        field.input.disabled = state.saving || (field.editable && field.mode.value !== 'value');
        if (field.mode) field.mode.disabled = state.saving;
        if (field.help) {
            const mode = field.mode.value;
            field.help.textContent = mode === 'null' ? message('nullHelp') : mode === 'default'
                ? message(field.column.auto_increment ? 'autoHelp' : 'defaultHelp') : '';
            field.help.hidden = !field.help.textContent;
        }
    }

    function updateControls(state) {
        if (!state.dialog.isConnected) return;
        state.dialog.setAttribute('aria-busy', String(state.loading || state.saving));
        state.cancel.disabled = state.saving;
        state.close.disabled = state.saving;
        state.save.hidden = !state.supported;
        state.save.disabled = state.loading || state.saving || !state.supported ||
            (state.mode === 'edit' && !isDirty(state));
        const saveKey = state.saving ? (state.mode === 'delete' ? 'deleting' : 'saving') :
            state.mode === 'insert' ? 'insert' : state.mode === 'delete' ? 'delete' : 'save';
        state.save.querySelector('span').textContent = message(saveKey);
        state.save.setAttribute('aria-label', message(saveKey));
        state.cancel.querySelector('span').textContent = message(state.supported ? 'cancel' : 'close');
        state.cancel.setAttribute('aria-label', message(state.supported ? 'cancel' : 'close'));
        state.reload.disabled = state.loading || state.saving;
        state.retry.disabled = state.loading || state.saving;
        state.fallback.disabled = state.saving;
        for (const field of state.fields.values()) updateField(field, state);
    }

    function dispose(state) {
        if (current !== state) return;
        state.controller?.abort();
        window.removeEventListener('govern:languagechange', state.languageChange);
        current = null;
        if (state.dialog.open) state.dialog.close();
        state.dialog.remove();
        onBusy(false);
        const opener = state.opener?.isConnected ? state.opener : document.getElementById(state.openerId);
        if (opener && !opener.disabled) opener.focus({preventScroll: true});
    }

    async function askDiscard(state) {
        if (!isDirty(state)) return true;
        if (state.confirming) return false;
        state.confirming = true;
        try {
            return Boolean(await confirmAction({
                title: message('discardTitle'),
                description: message('discardDescription', {table: state.table}),
                confirmLabel: message('discard'), danger: true,
            }));
        } finally { state.confirming = false; }
    }

    async function close() {
        const state = current;
        if (!state || state.saving || state.confirming) return false;
        if (!await askDiscard(state) || current !== state) return false;
        dispose(state);
        return true;
    }

    function showError(state, error) {
        state.error = error;
        state.conflict = error.status === 409 || /conflict|stale|changed/i.test(error.error_code || '');
        state.errorBox.hidden = false;
        state.errorMessage.textContent = state.conflict ? message('conflict') : errorText(error);
        state.reload.hidden = !state.conflict || state.mode === 'insert';
        state.retry.hidden = Boolean(state.data) || state.conflict;
        state.errorBox.focus({preventScroll: true});
    }

    function clearError(state) {
        state.error = null;
        state.conflict = false;
        state.errorBox.hidden = true;
    }

    function createField(state, column, index) {
        const name = column.name;
        const value = state.data.row?.[name];
        const editable = column.editable !== false && !column.generated && !column.large && state.mode !== 'delete';
        const wrapper = el('div', {class: 'row-editor-field'});
        const inputId = 'row-editor-field-' + index;
        const hintId = inputId + '-hint';
        const longText = column.encoding === 'hex' || /text|json|blob|binary|geometry/i.test(column.data_type || column.type || '') || String(value ?? '').includes('\n');
        const input = el(longText ? 'textarea' : 'input', {
            id: inputId, class: 'input row-editor-value',
            ...(longText ? {rows: 3} : {type: 'text'}),
            autocomplete: 'off', spellcheck: 'false', 'data-row-field': name,
            'aria-describedby': hintId,
        });
        // Keep exact strings, including BIGINT, DECIMAL, whitespace and empty values.
        input.value = value === null || value === undefined ? '' : String(value);
        if (!editable) {
            input.readOnly = true;
            input.value = column.large ? '' : input.value;
        }
        const label = el('label', {for: inputId, class: 'row-editor-label'}, el('code', {}, name));
        const type = el('span', {class: 'row-editor-type'}, column.type || column.data_type || '');
        const header = el('div', {class: 'row-editor-field-header'}, label, type);
        wrapper.append(header);
        const hint = el('div', {id: hintId, class: 'row-editor-hint'});
        let mode = null;
        let help = null;
        if (editable) {
            mode = el('select', {class: 'input row-editor-mode', 'data-row-mode': name});
            state.labels.push(() => mode.setAttribute('aria-label', message('fieldMode', {column: name})));
            for (const choice of ['value', ...(column.nullable ? ['null'] : []),
                ...((column.default !== null && column.default !== undefined) || column.nullable || column.auto_increment ? ['default'] : [])]) {
                mode.append(text(state, 'option', choice, {value: choice}));
            }
            mode.value = state.mode === 'insert'
                ? column.auto_increment || column.default !== null && column.default !== undefined ? 'default' : column.nullable ? 'null' : 'value'
                : value === null ? 'null' : 'value';
            help = el('p', {class: 'small muted row-editor-mode-help'});
            const field = {column, input, mode, help, editable, original: {mode: mode.value, value: input.value}};
            state.fields.set(name, field);
            mode.addEventListener('change', () => updateControls(state));
            input.addEventListener('input', () => updateControls(state));
            wrapper.append(el('div', {class: 'row-editor-field-controls'}, mode, input));
            hint.append(help);
            if (!column.nullable && !column.auto_increment && column.default === null) hint.append(text(state, 'span', 'required', {class: 'small muted'}));
            if (column.encoding === 'hex') hint.append(text(state, 'span', 'hex', {class: 'small muted'}));
        } else {
            wrapper.append(input);
            hint.append(text(state, 'span', column.large ? 'large' : column.generated ? 'generated' : 'readOnly', {class: 'small muted'}));
            if (value === null && !column.large) {
                state.labels.push(() => { input.placeholder = message('null'); });
            }
        }
        if (column.default !== null && column.default !== undefined && !column.generated) {
            hint.append(text(state, 'span', 'defaultValue', {class: 'small muted'}, {value: String(column.default)}));
        }
        wrapper.append(hint);
        return wrapper;
    }

    function showData(state, data) {
        state.data = data;
        state.supported = state.mode === 'insert' ? data.can_insert === true : data.editable === true;
        state.fields.clear();
        // Remove old field translation callbacks while retaining the dialog labels.
        state.labels.splice(state.baseLabelCount);
        state.content.replaceChildren();
        state.fallback.hidden = state.supported;
        if (!state.supported) {
            const reason = el('div', {class: 'notice notice-warning'});
            state.labels.push(() => { reason.textContent = data.reason_i18n?.[getLanguage()] || data.reason || message('unsupported'); });
            state.content.append(reason);
            return;
        }
        if (state.mode !== 'insert' && data.key) {
            state.content.append(el('div', {class: 'row-editor-key'},
                text(state, 'span', 'key', {class: 'small muted'}),
                el('code', {}, Object.entries(data.key).map(([name, value]) => name + ' = ' + (value === null ? 'NULL' : String(value))).join(', '))));
        }
        const fields = el('div', {class: 'row-editor-fields'});
        (data.columns || []).forEach((column, index) => fields.append(createField(state, column, index)));
        state.content.append(fields);
    }

    async function load(state) {
        if (current !== state || state.saving) return;
        state.controller?.abort();
        state.controller = new AbortController();
        const controller = state.controller;
        state.loading = true;
        clearError(state);
        state.status.hidden = false;
        updateControls(state);
        try {
            const data = await request('row-editor', {params: {
                database: state.database, table: state.table,
                ...(state.mode === 'insert' ? {} : {key: JSON.stringify(state.key)}),
            }, signal: controller.signal});
            if (current !== state || controller !== state.controller) return;
            showData(state, data);
        } catch (error) {
            if (error.name !== 'AbortError' && current === state && controller === state.controller) showError(state, error);
        } finally {
            if (current === state && controller === state.controller) {
                state.loading = false;
                state.status.hidden = true;
                translate(state);
            }
        }
    }

    async function reload(state) {
        if (state.saving || state.loading || !await askDiscard(state) || current !== state) return;
        await load(state);
    }

    function valuesFor(state) {
        const values = Object.create(null);
        for (const [name, field] of state.fields) {
            const mode = field.mode.value;
            if (state.mode === 'edit' && mode === field.original.mode && (mode !== 'value' || field.input.value === field.original.value)) continue;
            values[name] = mode === 'value' ? {mode, value: field.input.value} : {mode};
        }
        return values;
    }

    async function save(state) {
        if (current !== state || !state.supported || state.saving || state.loading || state.confirming) return;
        if (state.mode === 'edit' && !isDirty(state)) return;
        if (state.mode === 'delete') {
            state.confirming = true;
            let confirmed;
            try {
                confirmed = await confirmAction({
                    title: message('deleteTitle'),
                    description: message('deleteDescription', {database: state.database, table: state.table,
                        key: JSON.stringify(state.data.key)}),
                    confirmLabel: message('delete'), danger: true,
                });
            } finally { state.confirming = false; }
            if (!confirmed || current !== state) return;
        }
        state.saving = true;
        clearError(state);
        updateControls(state);
        try {
            const body = {table: state.table};
            if (state.mode !== 'insert') Object.assign(body, {key: state.data.key, version: state.data.version});
            if (state.mode !== 'delete') body.values = valuesFor(state);
            const result = await request((state.mode === 'edit' ? 'update' : state.mode) + '-row', {params: {database: state.database}, body});
            if (current !== state) return;
            const saved = {database: state.database, table: state.table, mode: state.mode, result};
            dispose(state);
            await onSaved(saved);
        } catch (error) {
            if (current === state) showError(state, error);
        } finally {
            if (current === state) {
                state.saving = false;
                updateControls(state);
            }
        }
    }

    async function open({table, key = null, mode = 'edit', focusColumn} = {}) {
        if (current || !table || !['edit', 'insert', 'delete'].includes(mode)) return false;
        const state = {
            database: String(getDatabase() || ''), table: String(table), key, mode,
            opener: document.activeElement, openerId: document.activeElement?.id, labels: [], fields: new Map(), data: null,
            loading: true, saving: false, confirming: false, supported: false,
            error: null, conflict: false,
        };
        const dialog = el('dialog', {id: 'row-editor-dialog', class: 'row-editor-dialog',
            'aria-labelledby': 'row-editor-title', 'aria-describedby': 'row-editor-intro', 'data-selection-ui': ''});
        state.dialog = dialog;
        const title = text(state, 'h2', mode === 'insert' ? 'titleInsert' : mode === 'delete' ? 'titleDelete' : 'titleEdit', {id: 'row-editor-title', tabindex: '-1'});
        state.close = action(state, 'close', close, {className: 'icon-button row-editor-close', symbol: 'close'});
        const context = text(state, 'p', 'context', {class: 'row-editor-context'}, {database: state.database, table: state.table});
        const intro = text(state, 'p', mode === 'insert' ? 'introInsert' : mode === 'delete' ? 'introDelete' : 'introEdit', {id: 'row-editor-intro', class: 'small muted'});
        const header = el('header', {class: 'row-editor-header'}, el('div', {}, title, context), state.close);
        state.status = text(state, 'p', 'loading', {id: 'row-editor-status', class: 'notice', role: 'status'});
        state.errorMessage = el('p');
        state.reload = action(state, 'reload', () => reload(state), {id: 'row-editor-reload', symbol: 'refresh', hidden: true});
        state.retry = action(state, 'retry', () => load(state), {symbol: 'refresh', hidden: true});
        state.errorBox = el('div', {id: 'row-editor-error', class: 'notice notice-error row-editor-error', role: 'alert', tabindex: '-1', hidden: true},
            state.errorMessage, el('div', {class: 'row-editor-recovery'}, state.reload, state.retry));
        state.content = el('div', {class: 'row-editor-content'});
        state.fallback = action(state, 'phpMyAdmin', () => {
            const target = state.table;
            dispose(state);
            onPhpMyAdmin(target);
        }, {symbol: 'external', hidden: true});
        const body = el('div', {class: 'row-editor-body'}, intro, state.status, state.errorBox, state.content, state.fallback);
        state.cancel = action(state, 'cancel', close, {id: 'row-editor-cancel'});
        state.save = action(state, mode === 'insert' ? 'insert' : mode === 'delete' ? 'delete' : 'save', () => save(state),
            {id: 'row-editor-save', kind: mode === 'delete' ? 'danger' : 'primary', symbol: mode === 'delete' ? 'trash' : 'check'});
        dialog.append(header, body, el('footer', {class: 'row-editor-footer'}, state.cancel, state.save));
        state.baseLabelCount = state.labels.length;
        state.languageChange = () => translate(state);
        window.addEventListener('govern:languagechange', state.languageChange);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') event.stopPropagation();
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(state); }
        });
        current = state;
        document.body.append(dialog);
        onBusy(true);
        translate(state);
        dialog.showModal();
        title.focus({preventScroll: true});
        await load(state);
        if (current === state && focusColumn && state.fields.has(focusColumn)) {
            const field = state.fields.get(focusColumn);
            (field.input.disabled ? field.mode : field.input).focus({preventScroll: true});
        }
        return current === state;
    }

    return {
        open, close,
        get busy() { return Boolean(current?.loading || current?.saving || current?.confirming); },
        get isOpen() { return Boolean(current); },
    };
}
