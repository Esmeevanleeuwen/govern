import {request, getDatabase as activeDatabase} from './api.js';
import {t, getLocale, getLanguage, hasMessage} from './i18n.js';
import {el, button, errorText, icon} from './ui.js';
import {attachDialog} from './modal-shell.js';
import {ACTIVE_JOB_STATES, blankDraft, datasetDrafts, engineId, engineLabel, fixedScope, identifierIssue, jobScopeKey, jobState, nameCollision, planPayload} from './database-workflow-model.js';
import './database-workflow-messages.js';

const text = (key, params) => t('databaseWorkflow.' + key, params);
const count = value => typeof value === 'number' ? value.toLocaleString(getLocale()) : text('unknownCount');
const id = name => 'database-workflow-' + name;
const localError = (key, params = {}) => Object.assign(new Error(text(key, params)), {translationKey: 'databaseWorkflow.' + key, error_params: params});
const newKey = () => crypto.randomUUID();
const cleanSuggestion = value => String(value || 'import_data').normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^[^A-Za-z]+/, '').slice(0, 63) || 'import_data';

/** One guided creation/import system. A contextual opening freezes its database scope. */
export function createDatabaseManager(options = {}) {
    const {getDatabase = activeDatabase, getDatabases = () => [], isBusy = () => false, onBusy = () => {},
        onOpenDatabase = options.onSelect, onFirstTable, onCompleted = () => {}} = options;
    let draft = blankDraft(), parkedDraft = null;
    let capabilities = null, recentJobs = [], visibleJobs = 5, loading = false, revision = 0, jobRevision = 0;
    let opener = null, openerId = '', restoreFocus = true, uploadController = null, pollTimer = null, pollFailures = 0;
    const dialog = el('dialog', {id: 'database-manager-dialog', class: 'database-manager-dialog database-workflow-dialog',
        'aria-labelledby': 'database-manager-title', 'aria-describedby': 'database-manager-description', 'data-selection-ui': ''});
    const title = el('h2', {id: 'database-manager-title'});
    const description = el('p', {id: 'database-manager-description', class: 'small muted'});
    const close = button('', () => dismiss(), {id: 'database-manager-close', symbol: 'close', className: 'icon-button database-manager-close'});
    const header = el('header', {class: 'database-manager-heading'}, el('div', {}, title, description), close);
    const steps = el('nav', {class: 'database-workflow-steps', 'aria-label': text('execution')});
    const content = el('div', {class: 'database-workflow-content'});
    const error = el('p', {id: 'database-manager-error', class: 'notice notice-error', role: 'alert', tabindex: '-1', hidden: true});
    const status = el('p', {id: 'database-manager-status', class: 'small muted', role: 'status', 'aria-live': 'polite', hidden: true});
    const footer = el('footer', {class: 'database-manager-footer database-workflow-footer'});
    const form = el('form', {novalidate: '', on: {submit: event => {
        event.preventDefault();
        if (!draft.operation) footer.querySelector('[data-primary]')?.click();
    }}}, header, steps, content, error, status, footer);
    dialog.append(form); document.body.append(dialog);
    attachDialog(dialog, {handle: header, outside: () => !draft.operation});

    const params = () => ({database: draft.scope?.scope_key || getDatabase()});
    const field = (label, control, hint) => el('div', {class: 'database-workflow-field'},
        el('label', {class: 'field-label', for: control.id}, label), control,
        hint ? el('p', {class: 'field-hint', id: control.id + '-help'}, hint) : null);
    const notice = (value, variant = '') => el('p', {class: 'notice ' + variant}, value);
    const previewNotice = dataset => dataset?.preview_truncated ? el('p', {class: 'notice database-workflow-preview-notice', role: 'note'}, text('previewTruncated')) : null;
    const action = (key, callback, attributes = {}, replacements = {}) => button(text(key, replacements), callback, {className: 'button-small', ...attributes});
    const primary = (key, callback, attributes = {}, replacements = {}) => action(key, callback, {kind: 'primary', 'data-primary': '', ...attributes}, replacements);
    const panel = (...children) => el('section', {class: 'database-manager-section'}, children);
    const engine = () => draft.scope?.engine || (draft.task === 'backup' ? engineId(draft.source?.engine) || draft.sourceEngine : draft.engine);
    const databaseName = () => draft.scope?.database || draft.name.trim();
    const engineInfo = value => (capabilities?.engines || []).find(item => engineId(item.id || item.engine) === value);
    const engineAvailable = value => { const item = engineInfo(value); return !!item && item.available !== false && item.can_create !== false; };
    const ready = () => !!capabilities && capabilities.worker_available !== false && (draft.scope || engineAvailable(engine()));
    const sourceBlocked = () => !!draft.source?.blocked || draft.source?.supported === false;
    const selectedTables = () => draft.tables.filter(table => table.selected);
    const sourceDataset = table => draft.source?.datasets?.find((item, index) => (item.index ?? index) === table.dataset);
    function invalidatePlan() { draft.plan = null; draft.submissionKey = ''; draft.uncertainSubmission = false; draft.error = null; draft.errorField = ''; }
    function setError(caught, focus = true, fieldId = '') {
        draft.error = caught; draft.errorField = fieldId; render();
        if (focus) (document.getElementById(fieldId) || error).focus({preventScroll: false});
    }
    function diagnostic(item) {
        if (typeof item === 'string') return hasMessage('error.' + item) ? t('error.' + item) : item;
        const code = item?.error_code || item?.code;
        if (code && hasMessage('error.' + code)) return t('error.' + code, item.params || item.error_params || {});
        if (code && hasMessage('databaseWorkflow.' + code)) return text(code, item.params || item.error_params || {});
        return item?.message_i18n?.[getLanguage()] || item?.error_i18n?.[getLanguage()] || item?.message || item?.error || code || '';
    }
    function warnings(items) { return (Array.isArray(items) ? items : []).map(item => notice(diagnostic(item))); }
    function destinationFacts() {
        const facts = [[text('engine'), engineLabel(engine())], [text(draft.scope ? 'database' : 'newName'), databaseName() || '—']];
        if (engine() === 'postgres') facts.push([text('schema'), draft.scope?.schema || 'public']);
        if (draft.source) facts.push([text('sourceLabel'), draft.source.name]);
        return el('dl', {class: 'database-workflow-facts'}, facts.map(([label, value]) => el('div', {}, el('dt', {}, label), el('dd', {}, value))));
    }
    function changeStep(step) { if (draft.operation) return; draft.step = step; draft.error = null; render(true); }
    function begin(task, context = null) {
        revision++; stopPolling(); draft = blankDraft({task, ...(context || {})});
        const current = fixedScope(getDatabase());
        draft.engine = draft.scope?.engine || (engineAvailable(current.engine) ? current.engine : (capabilities?.engines || []).map(item => engineId(item.id || item.engine)).find(engineAvailable) || '');
        render(true);
    }
    function chooseView() {
        const cards = el('div', {class: 'database-workflow-tasks'}, ['empty', 'backup', 'dataset'].map(task =>
            el('button', {type: 'button', id: id('task-' + task), class: 'database-workflow-task', on: {click: () => begin(task)}},
                icon(task === 'empty' ? 'plus' : task === 'backup' ? 'database' : 'table'), el('strong', {}, text(task)), el('span', {}, text(task + 'Help')))));
        return [cards, notice(text('localCopy')), parkedDraft ? action('resumeDraft', () => {draft = parkedDraft; parkedDraft = null; render(true);}, {id: id('resume-draft')}) : null, jobsView()].filter(Boolean);
    }
    function jobsView() {
        return el('section', {class: 'database-workflow-jobs'}, el('div', {class: 'database-workflow-section-heading'}, el('h3', {}, text('recentJobs')),
            action('refreshJobs', () => loadJobs(true), {symbol: 'refresh', disabled: loading})),
            recentJobs.length ? el('ul', {id: id('jobs-list')}, recentJobs.slice(0, visibleJobs).map(job => el('li', {}, el('div', {}, el('strong', {}, job.database || job.summary?.database || job.id),
                el('span', {class: 'small muted'}, engineLabel(job.engine) + ' · ' + text(jobState(job)))),
                action('openJob', () => openJob(job.id), {'data-job-id': job.id})))) : el('p', {class: 'small muted'}, text('noJobs')),
            recentJobs.length > 5 ? el('div', {class: 'database-workflow-section-heading'},
                el('p', {class: 'small muted', role: 'status'}, text('showingJobs', {shown: Math.min(visibleJobs, recentJobs.length), total: recentJobs.length})),
                action(visibleJobs < recentJobs.length ? 'showAllJobs' : 'showFewerJobs', () => {visibleJobs = visibleJobs < recentJobs.length ? recentJobs.length : 5; render();},
                    {id: id('show-jobs'), 'aria-controls': id('jobs-list')}, {count: recentJobs.length})) : null);
    }
    function previewTable(dataset) {
        return el('div', {class: 'database-workflow-table-scroll', tabindex: '0'}, el('table', {class: 'data-table'},
            el('caption', {}, text('sample', {shown: count(dataset.rows?.length || 0), total: count(dataset.count)})),
            el('thead', {}, el('tr', {}, (dataset.columns || []).map(column => el('th', {scope: 'col'}, column.source || column.name)))),
            el('tbody', {}, (dataset.rows || []).map(row => el('tr', {}, (Array.isArray(row) ? row : (dataset.columns || []).map(column => row[column.name]))
                .map(value => el('td', {}, value === null ? el('span', {class: 'database-workflow-null'}, 'NULL') : value)))))));
    }
    function readerSettings() {
        const settings = draft.settings;
        const change = () => { draft.sourceStale = !!draft.source; invalidatePlan(); render(); };
        const delimiter = el('select', {id: id('delimiter'), class: 'input', on: {change: event => {settings.delimiter = event.target.value; change();}}},
            [['auto', 'auto'], [',', 'comma'], [';', 'semicolon'], ['\t', 'tab'], ['|', 'pipe']].map(([value, label]) => el('option', {value, selected: settings.delimiter === value}, text(label))));
        return el('div', {class: 'database-workflow-source-settings'}, field(text('delimiter'), delimiter),
            el('label', {class: 'database-workflow-check'}, el('input', {type: 'checkbox', id: id('header'), checked: settings.header,
                on: {change: event => {settings.header = event.target.checked; change();}}}), text('header')),
            el('label', {class: 'database-workflow-check'}, el('input', {type: 'checkbox', id: id('skip-blank'), checked: settings.skip_blank_rows,
                on: {change: event => {settings.skip_blank_rows = event.target.checked; change();}}}), text('skipBlank')),
            el('p', {class: 'small muted'}, text('utf8')));
    }
    function sourceView() {
        const backup = draft.task === 'backup', limits = capabilities?.limits || {};
        const limitHelp = backup ? text('backupLimit', {limit: count((limits.sql_bytes || limits.backup_bytes || 262144) / 1024)})
            : text('datasetLimit', {limit: count((limits.dataset_bytes || 16777216) / 1048576), rows: count(limits.rows || 100000), columns: count(limits.columns || 256), cells: count(limits.max_cells || 1000000)});
        const file = el('input', {type: 'file', id: id('file'), class: 'input', accept: backup ? '.sql,.dump,.backup' : '.csv,.tsv,.txt,.xlsx,.json',
            'aria-describedby': id('file') + '-help', on: {change: event => {
                draft.file = event.target.files?.[0] || null; draft.source = null; draft.sourceStale = false;
                draft.sourceEngine = ''; draft.tables = []; invalidatePlan(); render();
            }}});
        const body = [el('h3', {}, text('sourceTitle')), field(text(backup ? 'backupFile' : 'datasetFile'), file, limitHelp)];
        if (draft.file) body.push(el('p', {class: 'database-workflow-source-card'}, text('sourceSummary', {name: draft.file.name, bytes: count(draft.file.size)})));
        if (!backup) body.push(readerSettings());
        body.push(action('inspect', () => inspectSource(), {id: id('inspect'), symbol: 'search', disabled: !draft.file || !!draft.operation}));
        if (draft.sourceStale) body.push(notice(text('fileChanged')));
        const source = draft.source;
        if (source) {
            body.push(el('p', {class: 'database-workflow-checked', role: 'status'}, icon('check'), text('fileChecked')));
            if (source.expires_at) {
                const expiry = new Date(typeof source.expires_at === 'number' ? source.expires_at * 1000 : source.expires_at);
                body.push(el('p', {class: 'small muted'}, text('expires', {time: Number.isNaN(expiry.valueOf()) ? source.expires_at : expiry.toLocaleString(getLocale())})));
            }
            body.push(...warnings(source.warnings));
            if (sourceBlocked()) body.push(notice(diagnostic({code: source.blocked_code}) || text('blocked'), 'notice-error'));
            if (backup) {
                const detected = engineId(source.engine);
                if (detected) body.push(notice(text('compatible', {engine: engineLabel(detected)})));
                else {
                    const select = el('select', {id: id('source-engine'), class: 'input', on: {change: event => {draft.sourceEngine = event.target.value; invalidatePlan(); render();}}},
                        el('option', {value: ''}, '—'), ['mariadb', 'postgres'].map(value => el('option', {value, selected: draft.sourceEngine === value}, engineLabel(value))));
                    body.push(field(text('sourceEngine'), select, text('ambiguous')));
                }
            } else body.push(...datasetSources());
        }
        return [panel(body)];
    }
    function datasetSources() {
        const body = [el('div', {class: 'database-workflow-section-heading'}, el('h4', {}, text('sheets')),
            el('p', {class: 'small muted', role: 'status'}, text('selectedSheets', {selected: selectedTables().length, total: draft.tables.length})))];
        for (const table of draft.tables) {
            const dataset = sourceDataset(table);
            if (!dataset) continue;
            body.push(el('section', {class: 'database-workflow-dataset'},
                el('label', {class: 'database-workflow-check'}, el('input', {type: 'checkbox', id: id('select-' + table.dataset), checked: table.selected,
                    on: {change: event => {table.selected = event.target.checked; invalidatePlan(); render();}}}), el('strong', {}, dataset.name),
                    dataset.hidden ? el('span', {class: 'small muted'}, text('hiddenSheet')) : null),
                el('p', {class: 'small muted'}, text('parsed', {rows: count(dataset.count), columns: count(dataset.columns?.length || 0)})),
                dataset.duplicate_rows ? el('p', {class: 'small muted'}, text('duplicates', {count: count(dataset.duplicate_rows)})) : null,
                dataset.formulas ? notice(text('formulas', {count: count(dataset.formulas)})) : null,
                dataset.skipped_blank_rows ? el('p', {class: 'small muted'}, text('blanks', {count: count(dataset.skipped_blank_rows)})) : null,
                table.selected ? previewNotice(dataset) : null, table.selected ? previewTable(dataset) : null));
        }
        body.push(notice(text('exactText'))); return body;
    }
    async function inspectSource() {
        if (!draft.file || draft.operation) return;
        const current = draft, generation = revision;
        uploadController = new AbortController();
        await run('upload', async () => {
            const data = new FormData(); data.append('file', current.file); data.append('kind', current.task);
            data.append('settings', JSON.stringify(current.settings));
            const source = await request('import-source', {params: params(), body: data, signal: uploadController.signal});
            if (draft !== current || revision !== generation) return;
            if (!source?.source_id || !Array.isArray(source.datasets || [])) throw localError('blocked');
            current.source = source; current.sourceStale = false; current.sourceEngine = engineId(source.engine);
            current.tables = datasetDrafts(source, current.suggestedTable).map(table => ({...table, table: current.suggestedTable || cleanSuggestion(sourceDataset(table)?.suggested_name || table.table)}));
            invalidatePlan();
        });
        uploadController = null;
    }
    async function continueSource() {
        if (!draft.source || draft.sourceStale || sourceBlocked()) return setError(localError('chooseFile'));
        if (draft.task === 'backup' && !engine()) return setError(localError('noSourceEngine'), true, id('source-engine'));
        if (draft.task === 'dataset' && !selectedTables().length) return setError(localError('selectDataset'));
        if (draft.scope) await loadTargets();
        if (!draft.error) changeStep('destination');
    }
    async function loadTargets() {
        await run('targets', async () => {
            const data = await request('import-targets', {params: params(), body: {source_id: draft.source.source_id, scope_key: draft.scope.scope_key}});
            const datasets = data.datasets || data.preview?.datasets || [];
            for (const table of draft.tables) {
                const source = datasets.find((item, index) => (item.index ?? index) === table.dataset);
                table.targets = source?.targets || data.targets || [];
                if (draft.targetMode === 'append') selectAppendTarget(table, table.table);
            }
        });
    }
    function selectAppendTarget(table, name = '') {
        const candidates = table.targets.filter(target => target.eligible !== false && target.available !== false);
        const target = candidates.find(target => target.name === name) || candidates[0];
        table.table = target?.name || ''; table.version = target?.version || '';
        const columns = (target?.columns || []).filter(column => column.importable !== false && !column.generated && !column.auto_increment);
        const taken = new Set();
        table.mapping = table.mapping.map(mapping => {
            const match = columns.find(column => column.name === mapping.source && !taken.has(column.name));
            if (match) taken.add(match.name);
            return {...mapping, target: match?.name || '', skip: !match};
        });
        invalidatePlan();
    }
    function destinationView() {
        const body = [el('h3', {}, text(draft.scope ? 'fixedTitle' : 'destinationTitle', {database: databaseName()}))];
        if (draft.scope) {
            body.push(destinationFacts(), notice(text('fixedHelp')));
            const mode = el('select', {id: id('mode'), class: 'input', on: {change: event => {
                draft.targetMode = event.target.value;
                for (const table of draft.tables) {
                    if (draft.targetMode === 'append') selectAppendTarget(table, table.table);
                    else { table.table = cleanSuggestion(sourceDataset(table)?.suggested_name || sourceDataset(table)?.name); table.version = '';
                        table.mapping = table.mapping.map(column => ({...column, target: column.source, skip: false})); }
                }
                invalidatePlan(); render();
            }}}, [['new_table', 'newTable'], ['append', 'append']].map(([value, key]) => el('option', {value, selected: draft.targetMode === value}, text(key))));
            body.push(field(text('mode'), mode));
            if (draft.targetMode === 'append') body.push(notice(text('existingRows')));
        } else {
            const fixedEngine = draft.task === 'backup';
            if (fixedEngine) body.push(el('p', {class: 'database-workflow-engine-badge'}, engineLabel(engine())), notice(text('compatible', {engine: engineLabel(engine())})));
            else {
                const choice = el('select', {id: id('engine'), class: 'input', on: {change: event => {draft.engine = event.target.value; invalidatePlan(); render();}}},
                    el('option', {value: ''}, '—'), ['mariadb', 'postgres'].map(value => el('option', {value, selected: draft.engine === value, disabled: !engineAvailable(value)},
                        engineAvailable(value) ? engineLabel(value) : text('engineUnavailable', {engine: engineLabel(value)}))));
                body.push(field(text('engine'), choice));
            }
            if (engine() && !engineAvailable(engine())) body.push(notice(text('engineUnavailable', {engine: engineLabel(engine())}), 'notice-error'));
            const name = el('input', {id: 'database-manager-name', class: 'input', type: 'text', value: draft.name,
                maxlength: 63, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
                'aria-invalid': draft.errorField === 'database-manager-name', 'aria-describedby': 'database-manager-name-help database-manager-error',
                on: {input: event => {draft.name = event.target.value; invalidatePlan(); error.hidden = true; updatePrimaryLabel();}}});
            body.push(field(text('newName'), name, text('nameHint') + (engine() === 'mariadb' ? ' ' + text('nameHintMaria') : '')), notice(text('newOnly')));
            if (engine() === 'postgres') body.push(el('details', {}, el('summary', {}, text('schema')), el('p', {}, text('schemaHelp'))));
        }
        if (draft.task === 'dataset') for (const table of selectedTables()) body.push(tableDestination(table));
        if (capabilities?.worker_available === false) body.push(notice(text('workerUnavailable'), 'notice-error'));
        return [panel(body)];
    }
    function tableDestination(table) {
        const dataset = sourceDataset(table), append = draft.scope && draft.targetMode === 'append';
        let control;
        if (append) {
            control = el('select', {id: id('table-' + table.dataset), class: 'input', on: {change: event => {selectAppendTarget(table, event.target.value); render();}}},
                el('option', {value: '', selected: !table.table}, '—'), table.targets.map(target => el('option', {value: target.name,
                    selected: table.table === target.name, disabled: target.eligible === false || target.available === false},
                    target.name + (target.eligible === false ? ' · ' + diagnostic({code: 'dataset_target_' + target.reason, message: text('noTarget')}) : ''))));
        } else control = el('input', {id: id('table-' + table.dataset), class: 'input', value: table.table, maxlength: 63, autocomplete: 'off',
            on: {input: event => {table.table = event.target.value; invalidatePlan(); error.hidden = true;}}});
        return el('section', {class: 'database-workflow-dataset'}, el('h4', {}, dataset?.name), field(text(append ? 'appendTable' : 'tableName'), control, append ? null : text('tableNameHint')),
            append && !table.targets.some(target => target.eligible !== false && target.available !== false) ? notice(text('noTargets')) : null,
            el('h4', {}, text('mapping')), mappingView(table), !append ? notice(text('targetGenerated')) : null,
            notice(text('exactText')));
    }
    function mappingView(table, readOnly = false) {
        const dataset = sourceDataset(table), append = draft.scope && draft.targetMode === 'append';
        const target = table.targets.find(candidate => candidate.name === table.table);
        const targetColumns = (target?.columns || []).filter(column => column.importable !== false && !column.generated && !column.auto_increment);
        return el('div', {class: 'database-workflow-mapping'}, previewNotice(dataset), table.mapping.map((mapping, position) => {
            const column = dataset?.columns?.find(candidate => candidate.name === mapping.source);
            const sourcePosition = dataset?.columns?.findIndex(candidate => candidate.name === mapping.source);
            const example = dataset?.rows?.[0]?.[sourcePosition];
            const targetId = id('column-' + table.dataset + '-' + position);
            let control;
            if (readOnly) control = el('p', {class: 'database-workflow-mapped-value'}, mapping.skip ? text('skipColumn') : mapping.target);
            else if (append) control = el('select', {id: targetId, class: 'input', 'aria-label': text('targetColumn') + ' · ' + mapping.source,
                on: {change: event => {mapping.target = event.target.value; mapping.skip = !event.target.value; invalidatePlan();}}},
                el('option', {value: '', selected: mapping.skip}, text('skipColumn')),
                targetColumns.map(candidate => el('option', {value: candidate.name, selected: !mapping.skip && mapping.target === candidate.name}, candidate.name)));
            else control = el('div', {}, el('input', {id: targetId, class: 'input', value: mapping.target, maxlength: 63, disabled: mapping.skip,
                'aria-label': text('targetColumn') + ' · ' + mapping.source,
                on: {input: event => {mapping.target = event.target.value; invalidatePlan();}}}),
                el('label', {class: 'database-workflow-check small'}, el('input', {type: 'checkbox', checked: mapping.skip,
                    on: {change: event => {mapping.skip = event.target.checked; invalidatePlan(); render();}}}), text('skipColumn')));
            const rule = readOnly ? el('p', {}, text(mapping.empty_as_null ? 'emptyNull' : 'keepEmpty'))
                : el('select', {class: 'input', value: String(mapping.empty_as_null), disabled: mapping.skip,
                    'aria-label': text('valueRule') + ' · ' + mapping.source,
                    on: {change: event => {mapping.empty_as_null = event.target.value === 'true'; invalidatePlan();}}},
                    el('option', {value: 'false', selected: !mapping.empty_as_null}, text('keepEmpty')),
                    el('option', {value: 'true', selected: mapping.empty_as_null}, text('emptyNull')));
            return el('div', {class: 'database-workflow-mapping-row'},
                el('div', {}, el('span', {class: 'small muted'}, text('sourceColumn')), el('strong', {}, column?.source || mapping.source),
                    el('span', {class: 'database-workflow-example small'}, text('example') + ': ' + (example === null ? 'NULL' : example ?? '—'))),
                el('div', {}, el('label', {class: 'small muted', for: readOnly ? null : targetId}, text('targetColumn')), control),
                el('div', {}, el('span', {class: 'small muted'}, text('valueRule')), rule));
        }));
    }
    function validationIssue() {
        if (!ready()) return {key: capabilities?.worker_available === false ? 'workerUnavailable' : 'engineUnavailable', params: {engine: engineLabel(engine())}, field: id('engine')};
        if (!draft.scope) {
            const problem = identifierIssue(draft.name, engine());
            if (problem) return {key: problem, field: 'database-manager-name'};
            if (nameCollision(draft.name, engine(), getDatabases())) return {key: 'collision', params: {name: draft.name.trim(), engine: engineLabel(engine())}, field: 'database-manager-name'};
        }
        if (draft.task === 'dataset') {
            if (!selectedTables().length) return {key: 'selectDataset'};
            const tableNames = new Set();
            for (const table of selectedTables()) {
                const append = draft.scope && draft.targetMode === 'append';
                if (append && !table.targets.some(target => target.name === table.table && target.eligible !== false && target.available !== false)) return {key: 'noTarget', field: id('table-' + table.dataset)};
                const problem = append ? '' : identifierIssue(table.table, engine(), true);
                if (problem) return {key: problem, field: id('table-' + table.dataset)};
                if (tableNames.has(table.table.trim().toLowerCase())) return {key: 'duplicateTarget', field: id('table-' + table.dataset)};
                tableNames.add(table.table.trim().toLowerCase());
                const mappings = table.mapping.filter(mapping => !mapping.skip), names = new Set();
                if (!mappings.length) return {key: 'selectColumn'};
                for (const mapping of mappings) {
                    if (!append && identifierIssue(mapping.target, engine(), true)) return {key: 'invalidTableName'};
                    if (!mapping.target || names.has(mapping.target.trim().toLowerCase())) return {key: 'duplicateTarget'};
                    names.add(mapping.target.trim().toLowerCase());
                }
            }
        }
        return null;
    }
    async function prepareReview(execute = false) {
        const issue = validationIssue();
        if (issue) return setError(localError(issue.key, issue.params), true, issue.field);
        let prepared = false;
        await run('review', async () => {
            const plan = await request('import-plan', {params: params(), body: planPayload(draft)});
            if (!plan?.plan_id || !plan.summary) throw localError('capabilitiesFailed');
            draft.plan = plan; draft.submissionKey = newKey(); prepared = true;
            if (!execute) draft.step = 'review';
        });
        if (prepared && execute) await submit();
        else if (prepared) render(true);
    }
    function reviewView() {
        const summary = draft.plan?.summary || {}, tables = summary.tables || [];
        const name = summary.database || databaseName();
        const body = [el('h3', {}, text('reviewTitle')), notice(text(draft.task === 'empty' ? 'reviewEmpty' : draft.scope ? 'reviewExisting' : 'reviewNew', {database: name})), destinationFacts(), notice(text('reviewNoWrites'))];
        if (draft.task === 'backup') body.push(notice(text('reviewBackup')), el('p', {class: 'small'},
            text('unitStatements') + ': ' + count(summary.statement_count)), ...warnings(summary.warnings));
        if (draft.task === 'dataset') for (const table of selectedTables()) {
            const dataset = sourceDataset(table), planned = tables.find(item => item.table === table.table);
            body.push(el('section', {class: 'database-workflow-dataset'}, el('h4', {}, text('tableSummary', {
                table: table.table, rows: count(planned?.rows ?? dataset?.count), columns: count(table.mapping.filter(mapping => !mapping.skip).length)})),
                mappingView(table, true), !draft.scope || draft.targetMode === 'new_table' ? notice(text('targetGenerated')) : notice(text('existingRows'))));
        }
        if (draft.uncertainSubmission) body.push(notice(text('uncertainSubmission'), 'notice-error'), jobsView());
        return [panel(body)];
    }
    function executionLabel() {
        const database = databaseName();
        if (draft.task === 'empty') return database ? text('create', {database}) : text('createUnnamed');
        if (!draft.scope) return text('createImport', {database});
        return draft.targetMode === 'append' ? text('appendAction', {table: selectedTables().map(table => table.table).join(', ')}) : text('createTableImport');
    }
    function updatePrimaryLabel() {
        const node = footer.querySelector('[data-primary]');
        if (node && draft.step === 'destination' && draft.task === 'empty') {
            node.setAttribute('aria-label', executionLabel()); node.querySelector('span').textContent = executionLabel();
        }
    }
    async function submit() {
        if (!draft.plan || draft.operation || draft.uncertainSubmission) return;
        const planId = draft.plan.plan_id, key = draft.submissionKey;
        await run('submit', async () => {
            try {
                const response = await request('import-submit', {params: params(), body: {plan_id: planId, submission_key: key}});
                if (!response?.job?.id) throw localError('uncertainSubmission');
                acceptJob(response.job);
            } catch (caught) {
                if (!caught.status || caught.status >= 500 && caught.error_code !== 'workflow_worker_unavailable') {
                    draft.uncertainSubmission = true; draft.step = 'review'; await loadJobs(false);
                    throw localError('uncertainSubmission');
                }
                throw caught;
            }
        });
    }
    function rememberJob(job) { try { sessionStorage.setItem('govern:database-workflow-job', job.id); } catch {} }
    function acceptJob(job) {
        if (!job?.id) return;
        draft.job = job; rememberJob(job);
        draft.step = ACTIVE_JOB_STATES.has(jobState(job)) ? 'job' : 'result';
        if (!ACTIVE_JOB_STATES.has(jobState(job)) && draft.notifiedJob !== job.id) {
            draft.notifiedJob = job.id;
            Promise.resolve(onCompleted(job)).catch(caught => { if (draft.job?.id === job.id) setError(caught, false); });
        }
        schedulePoll();
    }
    function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
    function schedulePoll(delay = 1400) {
        stopPolling();
        if (dialog.open && draft.job && ACTIVE_JOB_STATES.has(jobState(draft.job)) && pollFailures < 3)
            pollTimer = setTimeout(() => fetchJob(draft.job.id), delay);
    }
    async function openJob(jobId) {
        if (draft.operation) return;
        jobRevision++; draft.error = null; pollFailures = 0;
        await fetchJob(jobId, true);
    }
    async function fetchJob(jobId, manual = false) {
        const generation = jobRevision;
        if (manual) { pollFailures = 0; status.textContent = text('refreshStatus'); status.hidden = false; }
        try {
            const response = await request('import-job', {params: {...params(), id: jobId}});
            if (generation !== jobRevision) return;
            if (!response?.job?.id || response.job.id !== jobId) throw localError('statusUnavailable');
            draft.error = null; pollFailures = 0; acceptJob(response.job); render(manual);
        } catch (caught) {
            if (generation !== jobRevision) return;
            pollFailures++; draft.error = Object.assign(localError('statusUnavailable'), {detail: errorText(caught)});
            render(); schedulePoll(5000);
        }
    }
    async function requestStop() {
        if (!draft.job || draft.operation) return;
        jobRevision++; stopPolling();
        await run('stop', async () => {
            const response = await request('import-stop', {params: params(), body: {id: draft.job.id}});
            if (!response?.job?.id) throw localError('statusUnavailable');
            acceptJob(response.job);
        });
        schedulePoll();
    }
    function jobView() {
        const job = draft.job, state = jobState(job), active = ACTIVE_JOB_STATES.has(state), name = job.database || job.result?.database || '—';
        const body = [el('div', {class: 'database-workflow-result-heading'}, icon(state === 'completed' ? 'check' : active ? 'clock' : 'info'),
            el('div', {}, el('h3', {}, text('jobTitle', {database: name, state: text(state)})),
                el('p', {class: 'small muted'}, engineId(job.engine) ? engineLabel(job.engine) : ''))),
            el('p', {class: 'database-workflow-job-state', 'data-job-state': state, role: 'status', 'aria-live': 'polite'}, text(state)),
            el('p', {}, text(active ? 'progressHelp' : state + 'Help')),
            el('dl', {class: 'database-workflow-facts'}, el('div', {}, el('dt', {}, text('jobId')), el('dd', {}, job.id)),
                el('div', {}, el('dt', {}, text('destination')), el('dd', {}, name + (job.schema && job.engine === 'postgres' ? ' · ' + job.schema : ''))))];
        if (typeof job.completed_units === 'number') {
            const unit = ({rows: 'unitRows', tables: 'unitTables', statements: 'unitStatements'})[job.unit_kind];
            if (unit) body.push(el('p', {role: 'status', 'aria-live': 'polite'}, text('units', {count: count(job.completed_units), unit: text(unit)})));
        }
        if (job.stop_requested && active) body.push(notice(text('stopRequested') + '. ' + text('stopHelp')));
        if (!active && state !== 'completed') {
            body.push(notice(text('noReplay')));
            if (job.created_database) body.push(notice(text('createdRemains', {database: name})));
        }
        if (state === 'completed' && job.kind === 'empty') body.push(notice(text('emptyReady')));
        const resultTables = Array.isArray(job.result?.tables) ? job.result.tables : Array.isArray(job.result?.verified_tables) ? job.result.verified_tables : Array.isArray(job.tables) ? job.tables : [];
        if (resultTables.length) body.push(el('ul', {class: 'database-workflow-result-tables'}, resultTables.map((item, index) => {
            const table = typeof item === 'string' ? item : item.table || item.name;
            const rows = typeof item === 'object' ? item.imported ?? item.rows ?? item.verified_rows : undefined;
            return el('li', {}, el('div', {}, el('strong', {}, table), typeof rows === 'number' ? el('p', {class: 'small muted'}, text('rows') + ': ' + count(rows)) : null),
                jobScopeKey(job) && ['completed', 'partial'].includes(state) ? action('openTable', () => navigate(() => onOpenDatabase?.(jobScopeKey(job), table)), {id: id('open-table-' + index)}, {table}) : null);
        })));
        if (job.error_code) body.push(notice(diagnostic({code: job.error_code, params: job.error_params || {}, message: text(state === 'unknown' ? 'unknownHelp' : 'failedHelp')}), 'notice-error'));
        const details = {id: job.id, state, stage: job.stage, created_database: job.created_database,
            completed_units: job.completed_units, unit_kind: job.unit_kind, error_code: job.error_code,
            ...(job.diagnostics || job.failure ? {diagnostics: job.diagnostics || job.failure} : {})};
        body.push(el('details', {class: 'database-workflow-technical'}, el('summary', {}, text('technical')), el('pre', {}, JSON.stringify(details, null, 2))));
        return [panel(body)];
    }
    function footerView() {
        if (draft.operation === 'upload') return [action('cancelUpload', () => {uploadController?.abort(); draft.sourceStale = !!draft.source;}, {id: id('cancel-upload')})];
        if (draft.step === 'choose') return [action('close', dismiss, {id: 'database-manager-cancel'})];
        if (draft.step === 'source') return [action('back', () => draft.scope ? dismiss() : begin(''), {disabled: !!draft.operation}),
            primary('next', continueSource, {id: id('source-next'), disabled: !draft.source || draft.sourceStale || sourceBlocked() || !!draft.operation})];
        if (draft.step === 'destination') return [action('back', () => draft.task === 'empty' ? begin('') : changeStep('source'), {disabled: !!draft.operation}),
            button(draft.task === 'empty' ? executionLabel() : text('review'), () => prepareReview(draft.task === 'empty'),
                {id: id('review'), kind: 'primary', 'data-primary': '', disabled: !ready() || !!draft.operation, className: 'button-small'})];
        if (draft.step === 'review') return [action('back', () => changeStep('destination'), {disabled: !!draft.operation}),
            button(executionLabel(), submit, {id: id('submit'), kind: 'primary', 'data-primary': '', disabled: draft.uncertainSubmission || !!draft.operation, className: 'button-small'})];
        if (draft.job) {
            const job = draft.job, key = jobScopeKey(job), state = jobState(job), active = ACTIVE_JOB_STATES.has(state);
            const actions = [action('leave', dismiss, {id: id('leave'), disabled: !!draft.operation}),
                action('refreshStatus', () => fetchJob(job.id, true), {id: id('refresh-job'), symbol: 'refresh', disabled: !!draft.operation})];
            if (active) actions.push(action(job.stop_requested ? 'stopRequested' : 'stop', requestStop, {id: id('stop'), disabled: job.stop_requested || !!draft.operation}));
            else {
                if (key && (job.created_database || state === 'completed' || state === 'partial')) {
                    actions.push(primary('openDatabase', () => navigate(() => onOpenDatabase?.(key)), {id: id('open')}, {database: job.database || job.result?.database}));
                    if (state === 'completed' && job.kind === 'empty' && onFirstTable)
                        actions.push(primary('firstTable', () => navigate(() => onFirstTable(key)), {id: id('first-table'), symbol: 'plus'}));
                }
                actions.push(action('newTask', () => {draft = blankDraft(); revision++; stopPolling(); render(true); loadJobs();}, {id: id('new-task')}));
            }
            return actions;
        }
        return [action('close', dismiss)];
    }
    function render(focusHeading = false) {
        const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
        const focusedId = focused?.id, selection = focused?.selectionStart;
        const activeStep = draft.step;
        title.textContent = draft.scope ? text('fixedTitle', {database: draft.scope.database}) : text('title');
        title.tabIndex = -1;
        description.textContent = draft.step === 'choose' ? text('description') : draft.job ? text('jobTitle', {database: draft.job.database || '—', state: text(jobState(draft.job))}) : text(draft.task);
        close.setAttribute('aria-label', text('close')); close.querySelector('span').textContent = text('close');
        close.disabled = !!draft.operation;
        steps.setAttribute('aria-label', text('execution'));
        const order = draft.task === 'empty' ? ['destination', 'execution', 'result'] : ['source', 'destination', 'review', 'execution', 'result'];
        const current = activeStep === 'job' ? 'execution' : activeStep;
        steps.replaceChildren(...(activeStep === 'choose' ? [] : [el('ol', {}, order.map((step, index) => el('li', {
            class: current === step ? 'active' : '', 'aria-current': current === step ? 'step' : null}, el('span', {'aria-hidden': 'true'}, index + 1), text(step))))]));
        const contents = activeStep === 'choose' ? chooseView() : activeStep === 'source' ? sourceView()
            : activeStep === 'destination' ? destinationView() : activeStep === 'review' ? reviewView() : draft.job ? jobView() : chooseView();
        content.replaceChildren(...contents);
        if (!capabilities && !loading) content.append(action('retry', loadCapabilities, {id: id('retry-capabilities'), symbol: 'refresh'}));
        footer.replaceChildren(...footerView());
        error.hidden = !draft.error; error.textContent = draft.error ? errorText(draft.error) : '';
        const operationText = {upload: 'inspecting', targets: 'loadingTargets', review: 'reviewing', submit: 'submitting', stop: 'stopRequested'}[draft.operation];
        status.hidden = !draft.operation && !loading; status.textContent = operationText ? text(operationText) : loading ? t('ui.loading') : '';
        dialog.setAttribute('aria-busy', String(!!draft.operation));
        if (draft.operation) content.querySelectorAll('button,input,select').forEach(control => {control.disabled = true;});
        dialog.querySelectorAll('button,input,select').forEach((control, index) => {if (!control.id) control.id = id('control-' + index);});
        if (dialog.open) {
            if (focusHeading) { dialog.scrollTop = 0; title.focus({preventScroll: true}); }
            else if (focusedId) {
                const replacement = document.getElementById(focusedId);
                if (replacement && !replacement.disabled && replacement !== focused) {
                    replacement.focus({preventScroll: true});
                    if (typeof selection === 'number' && replacement.setSelectionRange && ['text', 'search'].includes(replacement.type)) replacement.setSelectionRange(selection, selection);
                }
            }
        }
    }
    async function run(operation, work) {
        if (draft.operation) return;
        const current = draft, generation = revision;
        current.operation = operation; current.error = null; render();
        try { await work(); }
        catch (caught) {
            if (draft !== current || generation !== revision) return;
            if (caught.name === 'AbortError') current.error = localError('uploadCancelled');
            else current.error = caught;
        } finally {
            if (draft === current && generation === revision) { current.operation = ''; render(); }
        }
        if (current.error && dialog.open) error.focus({preventScroll: false});
    }
    async function loadJobs(showError = false) {
        try {
            const data = await request('import-jobs', {params: params()});
            recentJobs = Array.isArray(data.jobs) ? data.jobs : [];
            if (dialog.open && (draft.step === 'choose' || draft.uncertainSubmission)) render();
        } catch (caught) { if (showError) setError(caught); }
    }
    async function loadCapabilities() {
        loading = true; render();
        const results = await Promise.allSettled([request('database-workflows', {params: params()}), request('import-jobs', {params: params()})]);
        if (results[0].status === 'fulfilled') {
            capabilities = results[0].value;
            if (!draft.engine && !draft.scope) {
                const currentEngine = fixedScope(getDatabase()).engine;
                draft.engine = engineAvailable(currentEngine) ? currentEngine : ['mariadb', 'postgres'].find(engineAvailable) || '';
            }
        } else draft.error = results[0].reason;
        if (results[1].status === 'fulfilled') recentJobs = results[1].value.jobs || [];
        loading = false; render();
    }
    function dismiss() { if (!draft.operation && dialog.open) dialog.close(); }
    async function navigate(work) {
        if (draft.operation || !dialog.open) return;
        const navigationDraft = draft, navigationRevision = revision;
        const existingWindows = new Set(document.querySelectorAll('dialog[open]'));
        const stillCurrent = () => draft === navigationDraft && revision === navigationRevision && !dialog.open && !isBusy()
            && [...document.querySelectorAll('dialog[open]')].every(window => existingWindows.has(window));
        restoreFocus = false;
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
        dialog.close(); await closed;
        if (!stillCurrent()) return;
        try { await work(); }
        catch (caught) {
            // A late navigation failure belongs to its original result, never a
            // new task opened while the workspace callback was pending.
            if (!stillCurrent()) return;
            navigationDraft.error = caught; restoreFocus = true;
            render(); dialog.showModal(); onBusy(true); error.focus({preventScroll: false});
        }
    }
    function open(openOptions = {}) {
        if (draft.operation || isBusy() || dialog.open) return false;
        opener = document.activeElement; openerId = opener?.id || ''; restoreFocus = true; visibleJobs = 5;
        if (openOptions.scope || openOptions.task) {
            draft = blankDraft(openOptions); revision++; jobRevision++; stopPolling();
            draft.engine = draft.scope?.engine || (engineAvailable(fixedScope(getDatabase()).engine) ? fixedScope(getDatabase()).engine : '');
        } else {
            if (draft.task && !draft.job && draft.step !== 'choose') parkedDraft = draft;
            draft = blankDraft(); revision++; jobRevision++; stopPolling();
        }
        render(); dialog.showModal(); onBusy(true); title.focus({preventScroll: true});
        loadCapabilities();
        if (draft.job) { pollFailures = 0; fetchJob(draft.job.id); }
        return true;
    }
    dialog.addEventListener('cancel', event => { if (draft.operation) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        stopPolling(); onBusy(false);
        if (restoreFocus) {
            const node = opener?.isConnected ? opener : document.getElementById(openerId);
            if (node && !node.disabled) node.focus({preventScroll: true});
        }
    });
    const translate = () => render();
    window.addEventListener('govern:languagechange', translate);
    render();
    return {open, refresh() { if (dialog.open) render(); }, close: dismiss,
        get isOpen() { return dialog.open; }, get isBusy() { return !!draft.operation; }};
}
