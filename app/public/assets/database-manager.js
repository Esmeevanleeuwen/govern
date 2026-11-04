import {request} from './api.js';
import {t} from './i18n.js';
import {el, button, icon, errorText} from './ui.js';
import {attachDialog} from './modal-shell.js';
import './database-messages.js';
import './database-flow-messages.js';

const text = key => t('app.databaseFlow.' + key);
const keyOf = item => item.scope_key || item.name;
const engineOf = item => item.connection === 'postgres' || item.engine === 'postgres' ? 'postgres' : 'mariadb';
const tasks = ['create', 'database', 'table'];
const engines = ['mariadb', 'postgres'];

/** Choose a task, engine and destination before changing the workspace. */
export function createDatabaseManager({getDatabase, getDatabases, getEngines = () => [], getDefaultDatabase = () => '',
    isBusy, onPrepared, onSelect, onImport, onBusy = () => {}}) {
    const draft = {task: '', engine: '', database: '', mode: 'new', name: ''};
    let step = 0, saving = false, failure = null, invalid = false, opener, openerId = '', restoreFocus = true;
    const dialog = el('dialog', {id: 'database-manager-dialog', class: 'database-manager-dialog',
        'aria-labelledby': 'database-manager-title', 'aria-describedby': 'database-manager-description', 'data-selection-ui': ''});
    const title = el('h2', {id: 'database-manager-title'}), description = el('p', {id: 'database-manager-description', class: 'small muted'});
    const close = button('', dismiss, {id: 'database-manager-close', symbol: 'close', className: 'icon-button database-manager-close'});
    const heading = el('header', {class: 'database-manager-heading'}, el('div', {}, title, description), close);
    const progress = el('ol', {class: 'database-flow-progress'}), content = el('div', {class: 'database-flow-content'});
    const error = el('p', {id: 'database-manager-error', class: 'notice notice-error', role: 'alert', tabindex: '-1', hidden: true});
    const status = el('p', {class: 'small muted', role: 'status', 'aria-live': 'polite'});
    const back = button('', () => { if (!saving) { step--; failure = null; invalid = false; render(); focusStep(); } }, {id: 'database-manager-back', kind: 'ghost'});
    const cancel = button('', dismiss, {id: 'database-manager-cancel', kind: 'ghost'});
    const proceed = button('', submit, {id: 'database-manager-continue', kind: 'primary', symbol: 'arrow'});
    dialog.append(el('form', {novalidate: true, on: {submit: event => { event.preventDefault(); submit(); }}},
        heading, progress, content, error, status, el('footer', {class: 'database-manager-footer database-flow-footer'}, back, cancel, proceed)));
    document.body.append(dialog); attachDialog(dialog, {handle: heading});
    const meta = () => getEngines().find(item => item.id === draft.engine);
    const can = action => meta()?.configured === true && meta()?.capabilities?.[action] === true;
    const destinations = () => getDatabases().filter(item => engineOf(item) === draft.engine);
    const selected = () => destinations().find(item => keyOf(item) === draft.database);
    const creating = () => draft.engine === 'mariadb' && (draft.task === 'create' || draft.task === 'database' && draft.mode === 'new');
    const label = (tag, key, attrs = {}) => el(tag, attrs, text(key));
    const field = (key, input, help) => el('div', {class: 'database-flow-field'}, el('label', {class: 'field-label', for: input.id}, text(key)), input,
        help ? label('p', help, {class: 'field-hint'}) : null);
    function relabel(node, key) { node.querySelector('span').textContent = text(key); node.setAttribute('aria-label', text(key)); }
    function chooseTask(task) { draft.task = task; draft.engine = ''; step = 1; failure = null; invalid = false; render(); focusStep(); }
    function chooseEngine(engine) {
        draft.engine = engine; step = 2; failure = null; invalid = false;
        const items = destinations();
        if (!items.some(item => keyOf(item) === draft.database)) draft.database = keyOf(items.find(item => keyOf(item) === getDatabase()) || items.find(item => item.available !== false) || items[0] || {name: ''});
        if (!can('create_database')) draft.mode = 'existing';
        render(); focusStep();
    }
    function destinationField() {
        const items = destinations();
        const select = el('select', {id: 'database-manager-existing', class: 'input select', on: {change: event => {
            draft.database = event.target.value; failure = null; render(); document.getElementById('database-manager-existing')?.focus();
        }}}, items.map(item => el('option', {value: keyOf(item), selected: keyOf(item) === draft.database},
            item.available === false ? t('app.databases.unavailable', {name: item.label || item.name}) : item.label || item.name)));
        return field(draft.engine === 'postgres' ? 'databaseSchema' : 'destination', select, items.length ? 'destinationHelp' : 'noDestinations');
    }
    function render() {
        const active = dialog.contains(document.activeElement) ? document.activeElement : null, focused = active?.id;
        const caret = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        const scroll = dialog.scrollTop;
        title.textContent = text(step === 0 ? 'title' : draft.task + 'Title');
        description.textContent = text(step === 0 ? 'description' : step === 1 ? 'engineHelp'
            : draft.task === 'create' && draft.engine === 'postgres' ? 'existingDesignHelp' : draft.task + 'Help');
        relabel(close, 'close'); relabel(cancel, 'cancel'); relabel(back, 'back');
        progress.setAttribute('aria-label', text('steps'));
        progress.replaceChildren(...['taskStep', 'engineStep', 'destinationStep'].map((key, index) =>
            el('li', {'aria-current': index === step ? 'step' : null, class: index <= step ? 'active' : ''}, el('span', {'aria-hidden': 'true'}, index + 1), text(key))));
        content.replaceChildren();
        if (step === 0) content.append(el('div', {class: 'database-flow-choices'}, tasks.map(task =>
            el('button', {id: 'database-manager-task-' + task, class: 'database-flow-choice', type: 'button', on: {click: () => chooseTask(task)}},
                icon(task === 'create' ? 'plus' : task === 'database' ? 'database' : 'table'),
                el('span', {}, label('strong', task + 'Title'), label('small', task + 'ChoiceHelp')), icon('arrow')))));
        else if (step === 1) content.append(label('h3', 'engine'), el('div', {class: 'database-flow-choices', role: 'group', 'aria-label': text('engine')}, engines.map(id => {
            const info = getEngines().find(item => item.id === id);
            return el('button', {id: 'database-manager-engine-' + id, class: 'database-flow-choice', type: 'button', on: {click: () => chooseEngine(id)}}, icon('database'),
                el('span', {}, el('strong', {}, id === 'postgres' ? 'PostgreSQL' : 'MariaDB'), label('small', !info?.configured ? 'engineNotConfigured'
                    : draft.task === 'create' && !info.capabilities.create_database ? 'existingOnly' : id === 'postgres' ? 'postgresHelp' : 'mariaHelp')), icon('arrow'));
        })));
        else {
            content.append(el('p', {class: 'database-flow-context'}, label('span', 'engine'), el('strong', {}, draft.engine === 'postgres' ? 'PostgreSQL' : 'MariaDB')));
            if (!meta()?.configured) content.append(label('p', 'engineNotConfiguredHelp', {class: 'notice', id: 'database-manager-unavailable'}));
            else if (draft.task === 'create' && !can('create_database')) {
                content.append(label('p', draft.engine === 'postgres' ? 'postgresCreateHelp' : 'managerUnavailable', {class: 'notice', id: 'database-manager-unavailable'}));
                if (draft.engine === 'postgres') content.append(destinationField());
            } else if (draft.task !== 'create' && !can('import')) content.append(label('p', 'importUnavailable', {class: 'notice', id: 'database-manager-unavailable'}));
            else {
                if (draft.task === 'database') {
                    const mode = el('select', {id: 'database-manager-target-mode', class: 'input select', on: {change: event => {
                        draft.mode = event.target.value; failure = null; invalid = false; render(); document.getElementById('database-manager-target-mode')?.focus();
                    }}}, can('create_database') ? el('option', {value: 'new', selected: draft.mode === 'new'}, text('newDestination')) : null,
                    el('option', {value: 'existing', selected: draft.mode === 'existing'}, text('existingDestination')));
                    content.append(field('destinationType', mode));
                }
                if (creating()) {
                    const name = el('input', {id: 'database-manager-name', class: 'input', type: 'text', value: draft.name, maxlength: 64,
                        autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'database-manager-name-help database-manager-error', 'aria-invalid': String(invalid),
                        on: {input: event => { draft.name = event.target.value; failure = null; invalid = false; syncControls(); }}});
                    content.append(field('databaseName', name), label('p', 'nameHelp', {id: 'database-manager-name-help', class: 'field-hint'}));
                } else content.append(destinationField());
                if (draft.task !== 'create') content.append(label('p', draft.task === 'table' ? 'tableFilesHelp' : 'sqlFileHelp', {class: 'database-flow-next'}));
            }
        }
        back.hidden = step === 0; proceed.hidden = step !== 2;
        relabel(proceed, draft.task === 'create' ? (draft.engine === 'postgres' ? 'openSql' : 'createAndDesign') : creating() ? 'createAndChooseFile' : 'chooseFile');
        syncControls();
        const restored = focused ? document.getElementById(focused) : null;
        if (restored && !restored.disabled) { restored.focus({preventScroll: true}); if (caret && typeof restored.setSelectionRange === 'function') restored.setSelectionRange(...caret); }
        dialog.scrollTop = scroll;
    }
    function syncControls() {
        dialog.setAttribute('aria-busy', String(saving));
        content.querySelectorAll('button,input,select').forEach(node => { node.disabled = saving || node.tagName === 'SELECT' && !node.options.length; });
        close.disabled = cancel.disabled = back.disabled = saving;
        const available = Boolean(selected()) && selected().available !== false;
        const allowed = draft.task === 'create' ? creating() ? can('create_database') && Boolean(draft.name.trim()) : draft.engine === 'postgres' && can('query') && available
            : can('import') && (creating() ? can('create_database') && Boolean(draft.name.trim()) : available);
        proceed.disabled = saving || step !== 2 || !allowed;
        error.hidden = !failure && !invalid;
        error.textContent = invalid ? t('app.databases.invalidDatabaseName') : failure ? errorText(failure) : '';
        document.getElementById('database-manager-name')?.setAttribute('aria-invalid', String(invalid));
        status.textContent = saving ? text('preparing') : '';
    }
    function focusStep() { dialog.scrollTop = 0; content.querySelector('input:not([disabled]),select:not([disabled]),button:not([disabled])')?.focus({preventScroll: true}); }
    async function transition(work) {
        restoreFocus = false;
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
        dialog.close(); await closed;
        try { await work(); }
        catch (caught) { open({task: draft.task, engine: draft.engine, database: draft.database}); failure = caught; render(); error.focus({preventScroll: true}); }
    }
    async function submit() {
        if (saving || isBusy() || step !== 2 || proceed.disabled) return;
        const captured = {...draft}, importWorkflow = draft.task === 'table' ? 'import-table' : 'import-database';
        if (creating()) {
            const name = captured.name.trim();
            invalid = !/^[A-Za-z0-9_]{1,64}$/.test(name) || name.replaceAll('_', '\\_').length > 64
                || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(name.toLowerCase());
            if (invalid) { syncControls(); document.getElementById('database-manager-name')?.focus(); return; }
            const database = getDefaultDatabase();
            if (!database || database.startsWith('postgres:')) { failure = new Error(text('managerUnavailable')); syncControls(); return; }
            saving = true; failure = null; render();
            try {
                const result = await request('prepare-database', {params: {database}, body: {name}});
                if (result.database !== name || !Array.isArray(result.databases)) throw new Error(t('app.databases.managerResponseInvalid'));
                saving = false; render();
                await transition(() => onPrepared(result, {task: captured.task, importSql: captured.task !== 'create', importTab: 'import', workflow: importWorkflow, design: captured.task === 'create'}));
            } catch (caught) { failure = caught; saving = false; render(); error.focus({preventScroll: true}); }
        } else if (captured.task === 'create') await transition(() => onSelect(captured.database, {view: 'onderzoeken'}));
        else await transition(() => onImport(captured.database, {tab: captured.task === 'table' ? 'dataset' : 'import', workflow: importWorkflow}));
    }
    function dismiss() { if (!saving) dialog.close(); }
    function open(options = {}) {
        if (isBusy() || dialog.open) return false;
        opener = document.activeElement; openerId = opener?.id || ''; restoreFocus = true; failure = null; invalid = false;
        if (tasks.includes(options.task)) {
            draft.task = options.task;
            if (engines.includes(options.engine)) { draft.engine = options.engine; step = 2; }
            else { draft.engine = ''; step = 1; }
        } else step = 0;
        if (options.database) {
            draft.database = options.database;
            if (draft.task === 'database') draft.mode = 'existing';
        }
        if (step === 2) {
            const items = destinations();
            if (!items.some(item => keyOf(item) === draft.database)) draft.database = keyOf(items[0] || {name: ''});
            if (!can('create_database')) draft.mode = 'existing';
        }
        render(); dialog.showModal(); onBusy(true); focusStep(); return true;
    }
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        onBusy(false);
        if (restoreFocus) {
            const target = opener?.isConnected ? opener : document.getElementById(openerId);
            if (target && !target.disabled) target.focus({preventScroll: true});
        }
    });
    window.addEventListener('govern:languagechange', render); render();
    return {open, refresh: () => { if (dialog.open) render(); }, get isOpen() { return dialog.open; }};
}
