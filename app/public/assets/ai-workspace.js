import {request} from './api.js';
import {el, icon, button, errorText, confirmAction, copyText} from './ui.js';
import {t, getLanguage} from './i18n.js';
import './ai-messages.js';

const text = (key, params) => t('app.ai.' + key, params);
const MAX_TARGETS = 8;
const MAX_MESSAGES = 40;
const safeTargets = targets => (Array.isArray(targets) ? targets : []).slice(0, MAX_TARGETS).map(target =>
    Object.fromEntries(['kind', 'table', 'column', 'label', 'tag'].filter(key => typeof target?.[key] === 'string')
        .map(key => [key, Array.from(target[key]).slice(0, key === 'label' ? 240 : 192).join('')])));
const contextKey = state => JSON.stringify([state.route, state.targets]);
const sourceName = source => typeof source === 'string' ? source : source?.label || source?.table || source?.name || source?.column || '';

/** Local AI is a separate, optional capability. It never executes SQL. */
export function createAiWorkspace({getDatabase, onOpenSql = async () => false, onSettings = () => {}, onOpenChange = () => {}}) {
    const databases = new Map();
    const settingViews = new Set();
    const narrow = matchMedia('(max-width: 700px)');
    let database = String(getDatabase() || '');
    let revision = 0;
    let serial = 0;
    let opener = null;
    let openerId = '';
    let destroyed = false;
    let confirming = false;

    const panel = el('dialog', {id: 'ai-workspace-panel', class: 'ai-workspace',
        'aria-labelledby': 'ai-panel-title', 'aria-describedby': 'ai-panel-subtitle', 'data-selection-ui': ''});
    const title = el('h2', {id: 'ai-panel-title'});
    const subtitle = el('p', {id: 'ai-panel-subtitle', class: 'small muted'});
    const closeButton = button('', () => close(), {id: 'ai-close', symbol: 'close', className: 'ai-icon-button icon-button'});
    const clearButton = button('', () => clear(), {id: 'ai-clear', symbol: 'plus', className: 'ai-icon-button icon-button'});
    const settingsButton = button('', () => { close(); onSettings(); }, {id: 'ai-open-settings', symbol: 'settings', className: 'ai-icon-button icon-button'});
    const statusDot = el('span', {class: 'ai-status-dot'});
    const statusText = el('span');
    const modelText = el('code');
    const status = el('div', {id: 'ai-status', class: 'ai-panel-status', role: 'status', 'aria-live': 'polite'}, statusDot, statusText, modelText);
    const contextSummary = el('summary');
    const contextChips = el('div', {class: 'ai-context-chips'});
    const sources = el('ul', {class: 'ai-context-sources'});
    const contextNote = el('p', {class: 'ai-context-note small muted'});
    const contextExtra = el('p', {class: 'ai-context-note small muted', hidden: true});
    const contextRetry = button('', () => refreshContext(), {id: 'ai-retry-context', symbol: 'refresh', className: 'button-small', hidden: true});
    const context = el('details', {id: 'ai-context', class: 'ai-context-block'}, contextSummary, contextChips, sources, contextNote, contextExtra, contextRetry);
    const statusHelp = el('p', {class: 'small muted'});
    const retryStatus = button('', () => refreshStatus(), {id: 'ai-retry-status', symbol: 'refresh', className: 'button-small'});
    const setup = el('div', {class: 'ai-setup'}, statusHelp, retryStatus);
    const thread = el('div', {id: 'ai-thread', class: 'ai-thread', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions'});
    const emptyTitle = el('h3');
    const emptyDescription = el('p');
    const suggestionButtons = ['suggestionExplain', 'suggestionRelations', 'suggestionSql'].map(key => {
        const node = button('', () => { const state = active(); state.draft = text(key); prompt.value = state.draft; prompt.focus(); updateControls(); }, {className: 'button-small'});
        return {key, node};
    });
    const empty = el('div', {class: 'ai-empty'}, el('div', {class: 'ai-empty-icon'}, icon('book')), emptyTitle, emptyDescription,
        el('div', {class: 'ai-suggestions'}, suggestionButtons.map(item => item.node)));
    const error = el('div', {id: 'ai-error', class: 'notice notice-error ai-panel-error', role: 'alert', tabindex: '-1', hidden: true});
    const pending = el('div', {id: 'ai-pending', class: 'ai-pending', role: 'status', hidden: true});
    const scroll = el('div', {class: 'ai-panel-scroll'}, context, setup, empty, thread, error, pending);
    const promptLabel = el('label', {for: 'ai-prompt', class: 'sr-only'});
    const prompt = el('textarea', {id: 'ai-prompt', class: 'input', rows: 3, maxlength: 4000, autocomplete: 'off',
        'aria-describedby': 'ai-prompt-hint ai-footer'});
    const sendButton = button('', () => send(), {id: 'ai-send', symbol: 'arrow', kind: 'primary', className: 'button-small'});
    const stopButton = button('', () => stop(), {id: 'ai-stop', symbol: 'close', className: 'button-small', hidden: true});
    const promptHint = el('span', {id: 'ai-prompt-hint', class: 'ai-composer-hint small muted'});
    const footer = el('p', {id: 'ai-footer', class: 'ai-panel-footer small muted'});
    panel.append(el('header', {class: 'ai-panel-header'}, el('div', {class: 'ai-panel-heading'}, title, subtitle),
        el('div', {class: 'ai-panel-actions'}, clearButton, settingsButton, closeButton)), status, scroll,
    el('div', {class: 'ai-composer'}, promptLabel, prompt, el('div', {class: 'ai-composer-footer'}, promptHint,
        el('div', {class: 'ai-message-actions'}, stopButton, sendButton))), footer);
    document.body.append(panel);

    function active() {
        if (!databases.has(database)) databases.set(database, {database, route: 'overzicht', targets: [], draft: '', messages: [],
            context: null, contextError: null, status: null, statusError: null, checking: false, loadingContext: false,
            sending: false, pendingPrompt: '', error: null, stopped: false, contextRequest: null, statusRequest: null, chatRequest: null});
        return databases.get(database);
    }

    function live(state, capturedRevision) { return !destroyed && database === state.database && revision === capturedRevision; }
    function abort(state) {
        for (const key of ['contextRequest', 'statusRequest', 'chatRequest']) { state[key]?.abort(); state[key] = null; }
        state.loadingContext = state.checking = state.sending = false;
        state.pendingPrompt = '';
    }
    function label(node, key) {
        const value = text(key);
        node.setAttribute('aria-label', value);
        node.querySelector('span').textContent = value;
    }
    function statusKey(state) {
        if (state.checking) return 'statusChecking';
        return {disabled: 'statusDisabled', offline: 'statusOffline', model_missing: 'statusModelMissing', ready: 'statusReady'}[state.status?.status] || 'statusOffline';
    }
    function statusHelpKey(state) {
        return {disabled: 'disabledHelp', offline: 'offlineHelp', model_missing: 'modelMissingHelp', ready: 'readyHelp'}[state.status?.status] || 'offlineHelp';
    }

    function updateControls() {
        const state = active();
        panel.setAttribute('aria-busy', String(state.sending));
        sendButton.disabled = !database || !state.status?.ready || !state.context || state.checking || state.loadingContext || state.sending || !state.draft.trim();
        stopButton.hidden = !state.sending;
        label(sendButton, state.sending ? 'sending' : 'send');
        label(stopButton, 'stop');
        clearButton.disabled = confirming;
        retryStatus.disabled = state.checking;
        contextRetry.disabled = state.loadingContext;
        pending.hidden = !state.sending;
        pending.textContent = state.sending ? text('sending') : '';
        error.hidden = !state.error && !state.stopped;
        if (!error.hidden) error.textContent = state.stopped ? text('stopped') : errorText(state.error);
        statusText.textContent = text(statusKey(state));
        statusDot.className = 'ai-status-dot ' + (state.checking ? 'loading' : state.status?.status || 'offline');
        modelText.textContent = state.status?.model || '';
        setup.hidden = Boolean(state.status?.ready) && !state.statusError;
        statusHelp.textContent = state.statusError ? errorText(state.statusError) : text(statusHelpKey(state));
        empty.hidden = state.messages.length > 0;
        for (const {node} of suggestionButtons) node.disabled = state.sending;
    }

    function drawContext() {
        const state = active();
        context.setAttribute('aria-busy', String(state.loadingContext));
        contextSummary.textContent = text('context');
        contextChips.replaceChildren(el('span', {class: 'ai-chip'}, database || text('noDatabase')));
        for (const target of state.targets) {
            const name = target.column ? target.table + '.' + target.column : target.table || target.label || target.tag || target.kind;
            if (name) contextChips.append(el('span', {class: 'ai-chip'}, name));
        }
        if (!state.targets.length) contextChips.append(el('span', {class: 'ai-chip'}, text('contextEmpty')));
        contextNote.textContent = text('contextNoRecords');
        contextExtra.hidden = !state.loadingContext && !state.contextError && !state.context?.truncated;
        contextExtra.textContent = state.loadingContext ? text('contextLoading') : state.contextError
            ? errorText(state.contextError) : state.context?.truncated ? text('contextTruncated') : '';
        contextRetry.hidden = !state.contextError;
        label(contextRetry, 'contextRetry');
        sources.replaceChildren();
        for (const source of Array.isArray(state.context?.sources) ? state.context.sources : []) {
            const name = sourceName(source);
            const detail = [];
            if (Array.isArray(source?.columns)) detail.push(text('sourceColumns', {count: source.columns.length}));
            if (Array.isArray(source?.foreign_keys)) detail.push(text('sourceRelations', {count: source.foreign_keys.length}));
            sources.append(el('li', {}, el('code', {}, name || text('sourceUi')), detail.length ? el('small', {}, detail.join(' · ')) : null));
        }
    }

    function drawThread() {
        const state = active();
        const focusId = document.activeElement?.id;
        const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
        thread.replaceChildren();
        for (const item of state.messages) {
            const meta = el('div', {class: 'ai-message-meta'}, el('strong', {}, text(item.role === 'user' ? 'you' : 'assistant')),
                el('span', {}, item.database));
            const article = el('article', {class: 'ai-message ' + item.role}, meta, el('div', {class: 'ai-message-content'}, item.content));
            if (item.sql) {
                const open = button(text('openSql'), async () => {
                    if (item.database !== String(getDatabase() || '') || item.database !== database) return;
                    open.disabled = true;
                    try {
                        if (await onOpenSql(item.sql, {database: item.database})) {
                            close({restoreFocus: false});
                            requestAnimationFrame(() => document.getElementById('sql-editor')?.focus({preventScroll: true}));
                        }
                    } catch (failure) { active().error = failure; updateControls(); }
                    finally { open.disabled = false; }
                }, {id: 'ai-open-sql-' + item.id, symbol: 'code', className: 'button-small ai-open-sql'});
                const copy = button(text('copySql'), () => copyText(item.sql), {id: 'ai-copy-sql-' + item.id,
                    symbol: 'copy', className: 'button-small ai-copy-sql'});
                article.append(el('div', {class: 'ai-sql'}, el('strong', {}, text('proposedSql')), el('pre', {}, el('code', {}, item.sql)),
                    el('p', {class: 'small muted'}, text('sqlHelp')), el('div', {class: 'ai-message-actions'}, copy, open)));
            }
            if (Array.isArray(item.context?.sources) && item.context.sources.length) {
                article.append(el('details', {class: 'ai-context-block'}, el('summary', {}, text('sources')),
                    el('ul', {class: 'ai-context-sources'}, item.context.sources.map(source => el('li', {}, el('code', {}, sourceName(source) || text('sourceUi')))))));
            }
            thread.append(article);
        }
        if (focusId?.startsWith('ai-')) document.getElementById(focusId)?.focus({preventScroll: true});
        if (nearBottom) scroll.scrollTop = scroll.scrollHeight;
    }

    function draw() {
        const state = active();
        title.textContent = text('title');
        subtitle.textContent = (database ? database + ' · ' : '') + text('subtitle');
        label(closeButton, 'close'); label(clearButton, 'clear'); label(settingsButton, 'settings'); label(retryStatus, 'retryStatus');
        status.setAttribute('aria-label', text('statusLabel'));
        promptLabel.textContent = text('promptLabel');
        prompt.placeholder = text('promptPlaceholder');
        prompt.value = state.draft;
        promptHint.textContent = text('promptHint');
        footer.textContent = text('footer');
        emptyTitle.textContent = text('emptyTitle'); emptyDescription.textContent = text('emptyDescription');
        for (const {key, node} of suggestionButtons) label(node, key);
        drawContext(); drawThread(); updateControls(); updateSettings();
    }

    async function refreshContext() {
        const state = active();
        state.contextRequest?.abort();
        state.context = null; state.contextError = null;
        if (!database) { draw(); return; }
        const controller = new AbortController();
        state.contextRequest = controller; state.loadingContext = true;
        const capturedRevision = revision;
        drawContext(); updateControls();
        try {
            const data = await request('ai-context', {params: {database: state.database},
                body: {targets: state.targets, route: state.route}, signal: controller.signal});
            if (!live(state, capturedRevision) || state.contextRequest !== controller) return;
            if (data.database !== state.database) throw new Error(text('responseWrongDatabase'));
            state.context = data;
        } catch (failure) {
            if (failure.name !== 'AbortError' && live(state, capturedRevision) && state.contextRequest === controller) state.contextError = failure;
        } finally {
            if (live(state, capturedRevision) && state.contextRequest === controller) {
                state.contextRequest = null; state.loadingContext = false; drawContext(); updateControls();
            }
        }
    }

    async function refreshStatus() {
        const state = active();
        const settingsOpener = document.activeElement?.closest?.('#ai-settings') ? document.activeElement.id : null;
        state.statusRequest?.abort();
        const controller = new AbortController();
        state.statusRequest = controller; state.checking = true; state.statusError = null;
        const capturedRevision = revision;
        updateControls(); updateSettings();
        try {
            const data = await request('ai-status', {params: {database: state.database}, signal: controller.signal});
            if (!live(state, capturedRevision) || state.statusRequest !== controller) return;
            state.status = data;
        } catch (failure) {
            if (failure.name !== 'AbortError' && live(state, capturedRevision) && state.statusRequest === controller) {
                state.statusError = failure; state.status = null;
            }
        } finally {
            if (live(state, capturedRevision) && state.statusRequest === controller) {
                state.statusRequest = null; state.checking = false; updateControls(); updateSettings();
                if (settingsOpener && document.activeElement === document.body) {
                    const replacement = document.getElementById(settingsOpener);
                    if (replacement && !replacement.disabled) replacement.focus({preventScroll: true});
                }
            }
        }
    }

    async function send() {
        const state = active();
        if (sendButton.disabled) return;
        const message = state.draft.trim();
        const key = contextKey(state);
        const capturedRevision = revision;
        const controller = new AbortController();
        state.chatRequest = controller; state.sending = true; state.pendingPrompt = message; state.error = null; state.stopped = false;
        const history = [];
        const encoder = new TextEncoder();
        for (const item of state.messages.filter(item => item.contextKey === key).slice(-8).reverse()) {
            const content = item.content + (item.sql ? '\n\nSQL:\n' + item.sql : '');
            const entry = {role: item.role, content};
            if (encoder.encode(JSON.stringify([entry])).length > 4000) continue;
            if (encoder.encode(JSON.stringify([entry, ...history])).length > 4000) break;
            history.unshift(entry);
        }
        updateControls();
        try {
            const data = await request('ai-chat', {params: {database: state.database}, body: {
                message, targets: state.targets, route: state.route, language: getLanguage(), history,
            }, signal: controller.signal});
            if (!live(state, capturedRevision) || state.chatRequest !== controller) return;
            if (data.database !== state.database) throw new Error(text('responseWrongDatabase'));
            if (typeof data.answer !== 'string' || !data.answer.trim() || (data.sql !== null && data.sql !== undefined && typeof data.sql !== 'string'))
                throw new Error(text('responseInvalid'));
            state.messages.push({id: ++serial, role: 'user', content: message, database: state.database, contextKey: key},
                {id: ++serial, role: 'assistant', content: data.answer, sql: data.sql || null, context: data.context,
                    database: state.database, contextKey: key});
            state.messages = state.messages.slice(-MAX_MESSAGES);
            if (state.draft.trim() === message) { state.draft = ''; prompt.value = ''; }
            drawThread(); scroll.scrollTop = scroll.scrollHeight;
        } catch (failure) {
            if (failure.name !== 'AbortError' && live(state, capturedRevision) && state.chatRequest === controller) state.error = failure;
        } finally {
            if (live(state, capturedRevision) && state.chatRequest === controller) {
                state.chatRequest = null; state.sending = false; state.pendingPrompt = ''; updateControls();
            }
        }
    }

    function stop() {
        const state = active();
        if (!state.sending) return;
        state.chatRequest?.abort(); state.chatRequest = null; state.sending = false; state.pendingPrompt = ''; state.stopped = true;
        updateControls(); prompt.focus({preventScroll: true});
    }

    async function clear() {
        const state = active();
        if (confirming) return;
        if (state.messages.length || state.draft || state.sending) {
            confirming = true; updateControls();
            const capturedRevision = revision;
            let confirmed;
            try { confirmed = await confirmAction({title: text('clearTitle'), description: text('clearDescription'), confirmLabel: text('clearConfirm'), danger: true}); }
            finally { confirming = false; updateControls(); }
            if (!confirmed || !live(state, capturedRevision)) return;
        }
        state.chatRequest?.abort(); state.chatRequest = null; state.sending = false; state.pendingPrompt = '';
        state.messages = []; state.draft = ''; state.error = null; state.stopped = false;
        draw(); prompt.focus({preventScroll: true});
    }

    function showPanel() {
        panel.setAttribute('aria-modal', String(narrow.matches));
        if (narrow.matches) panel.showModal(); else panel.show();
    }

    function open(options = {}) {
        setDatabase(String(getDatabase() || ''));
        const state = active();
        if (!panel.open) { opener = document.activeElement; openerId = opener?.id || ''; }
        const changed = contextKey(state);
        if (options.targets !== undefined || options.table) state.targets = safeTargets(options.targets?.length ? options.targets : options.table ? [{kind: 'table', table: options.table}] : []);
        if (typeof options.route === 'string') state.route = options.route.slice(0, 80);
        if (changed !== contextKey(state)) {
            state.chatRequest?.abort(); state.chatRequest = null; state.sending = false; state.pendingPrompt = ''; state.error = null; state.stopped = false;
            state.context = null;
        }
        draw();
        if (!panel.open) { showPanel(); onOpenChange(true); }
        prompt.focus({preventScroll: true});
        if (!state.context || changed !== contextKey(state)) refreshContext();
        refreshStatus();
        return panel;
    }

    function close({restoreFocus = true} = {}) {
        if (!panel.open) return;
        panel.close();
        onOpenChange(false);
        if (restoreFocus) {
            const target = opener?.isConnected ? opener : document.getElementById(openerId);
            if (target && !target.disabled) target.focus({preventScroll: true});
        }
    }

    function setDatabase(value) {
        const next = String(value || '');
        if (next === database) return;
        abort(active()); revision += 1; database = next;
        draw();
        if (panel.open) { refreshContext(); refreshStatus(); }
        else if ([...settingViews].some(view => view.isConnected)) refreshStatus();
    }

    function settingsContent(section) {
        const state = active();
        section.replaceChildren(el('h2', {}, icon('book'), text('settingsTitle')), el('p', {}, text('settingsHelp')));
        const values = el('dl', {class: 'ai-setting-values'},
            el('div', {}, el('dt', {}, text('provider')), el('dd', {}, text('localConnection'))),
            el('div', {}, el('dt', {}, text('model')), el('dd', {}, el('code', {}, state.status?.model || '—'))),
            el('div', {}, el('dt', {}, text('statusLabel')), el('dd', {role: 'status'}, text(statusKey(state)))));
        const test = button(text('retryStatus'), () => refreshStatus(), {id: 'ai-test-connection', symbol: 'refresh', className: 'button-small', disabled: state.checking});
        const controls = el('div', {class: 'setting-actions'}, test, button(text('openPanel'), () => open(), {symbol: 'book', className: 'button-small'}));
        const details = el('details', {class: 'ai-setup'}, el('summary', {}, text('setupTitle')), el('p', {}, text('setupIntro')),
            el('strong', {}, text('setupDownload')), el('pre', {}, el('code', {}, 'ollama run ' + (state.status?.model || 'qwen3:4b-instruct'))),
            el('strong', {}, text('setupEnv')), el('pre', {}, el('code', {}, 'AI_ENABLED=1\nAI_MODEL=qwen3:4b-instruct\nAI_BASE_URL=http://host.docker.internal:11434')),
            el('p', {}, text('setupEndpoint')), el('p', {}, text('setupNetwork')), el('p', {}, text('setupPrivacy')));
        if (!state.status?.ready) details.open = true;
        section.append(values, state.statusError ? el('p', {class: 'notice notice-error'}, errorText(state.statusError))
            : el('p', {class: 'small muted'}, text(statusHelpKey(state))), controls, details,
        el('p', {class: 'small muted'}, text('historyNote')), el('p', {class: 'small muted'}, text('recordsFuture')));
    }

    function updateSettings() {
        for (const section of settingViews) {
            if (!section.isConnected) { settingViews.delete(section); continue; }
            const focusId = section.contains(document.activeElement) ? document.activeElement.id : null;
            const wasOpen = section.querySelector('details')?.open;
            settingsContent(section);
            if (wasOpen !== undefined) section.querySelector('details').open = wasOpen;
            if (focusId) document.getElementById(focusId)?.focus({preventScroll: true});
        }
    }

    function renderSettings() {
        const section = el('section', {id: 'ai-settings', class: 'settings-section ai-settings-section'});
        settingsContent(section); settingViews.add(section);
        queueMicrotask(() => { if (section.isConnected) refreshStatus(); });
        return section;
    }

    prompt.addEventListener('input', () => { active().draft = prompt.value; updateControls(); });
    prompt.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); send(); }
    });
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
    const languageChange = () => {
        const start = prompt.selectionStart, end = prompt.selectionEnd, top = prompt.scrollTop;
        draw(); prompt.setSelectionRange(start, end); prompt.scrollTop = top;
    };
    window.addEventListener('govern:languagechange', languageChange);
    const sizeChange = () => {
        if (!panel.open) return;
        const focused = document.activeElement;
        panel.close(); showPanel();
        (focused?.isConnected && panel.contains(focused) ? focused : prompt).focus({preventScroll: true});
    };
    narrow.addEventListener('change', sizeChange);
    draw();

    return {open, close, setDatabase, renderSettings, refreshStatus,
        toggle: options => panel.open ? close() : open(options),
        get isOpen() { return panel.open; },
        destroy() {
            destroyed = true; revision += 1;
            for (const state of databases.values()) abort(state);
            window.removeEventListener('govern:languagechange', languageChange);
            narrow.removeEventListener('change', sizeChange);
            close(); panel.remove(); settingViews.clear(); databases.clear();
        },
    };
}
