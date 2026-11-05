import {request, setDatabase, setCsrf} from './api.js';
import {el, icon} from './ui.js';
import {t, getLanguage, setLanguage} from './i18n.js';
import {getPreferences, updatePreferences} from './preferences.js';
import {createMicrophone} from './studio-microphone.js';
import {uuid, clamp, MIN_ZOOM, MAX_ZOOM, CARD_WIDTH, CARD_HEIGHT, screenToWorld, zoomAt, editableNode, applyChanges, inverseChanges} from './studio-model.js';
import './studio-messages.js';

const $ = id => document.getElementById('studio-' + id);
const tr = (key, values) => t('studio.' + key, values);
const scope = document.body.dataset.studioScope;
const state = {
    bootstrap: null, board: '', server: null, snapshot: null, generation: '', camera: {x: 110, y: 80, zoom: 1},
    selected: null, editor: null, mode: 'select', connectFrom: null, queue: [], saving: false, failed: null,
    reviewed: false, undo: [], redo: [], pollBusy: false, boardVersion: 0, alive: true,
    voice: {state: 'idle', queued: 0, capturing: false}, recording: null, microphone: null, creating: false,
    pointers: new Map(), gesture: null, notice: null, nextPoll: null, editTimer: null, lastConnected: 0,
};
setLanguage(getPreferences().language);
setDatabase(scope);

function api(action, body, params = {}) {
    return request(action, {params: {database: scope, ...params}, ...(body === undefined ? {} : {body})});
}

function svg(tag, attrs = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
}

function control(key, symbol, handler, attributes = {}) {
    const node = el('button', {type: 'button', class: 'studio-icon-button', 'aria-label': tr(key), title: tr(key), on: {click: handler}, ...attributes});
    if (symbol === 'mic') node.append(microphoneIcon());
    else if (symbol === 'pen') node.append(svg('svg', {viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, class: 'icon', 'aria-hidden': true}));
    else if (symbol === 'undo' || symbol === 'redo') node.textContent = symbol === 'undo' ? '↶' : '↷';
    else node.append(icon(symbol));
    if (symbol === 'pen') node.firstChild.append(svg('path', {d: 'm4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4', 'stroke-linejoin': 'round'}));
    return node;
}

function microphoneIcon() {
    const node = svg('svg', {viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', class: 'icon', 'aria-hidden': true});
    node.append(svg('path', {d: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8'}));
    return node;
}

function actionButton(key, handler) {
    return el('button', {type: 'button', class: 'button button-secondary', on: {click: handler}}, tr(key));
}

function showNotice(message, {kind = 'info', actions = []} = {}) {
    state.notice = message ? {message, kind, actions} : null;
    const root = $('notice');
    root.hidden = !message;
    root.dataset.kind = kind;
    root.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    root.replaceChildren();
    if (!message) return;
    root.append(el('p', {}, message));
    if (actions.length) root.append(el('div', {class: 'studio-notice-actions'}, actions));
}

function mutationError(error) {
    state.failed = error;
    state.reviewed = false;
    const conflict = error.status === 409;
    const generation = error.error_code === 'studio_generation_conflict';
    const actions = generation ? [actionButton('retry', () => location.reload())]
        : conflict ? [actionButton('reviewChanges', reviewChanges), actionButton('discardChanges', discardChanges)]
            : [actionButton('retry', retryChanges), actionButton('discardChanges', discardChanges)];
    if (error.status === 401) actions.unshift(el('a', {class: 'button button-secondary', href: '/auth.php?' + new URLSearchParams({mode: 'login', next: 'studio', board: state.board})}, tr('signIn')));
    showNotice(generation ? tr('generationConflict') : conflict ? tr('conflict') : error.message, {kind: 'error', actions});
    renderStatus();
}

function visibleSnapshot() {
    if (!state.server) return null;
    return state.queue.reduce((value, entry) => applyChanges(value, entry.changes), state.server);
}

function enqueue(changes, {history = true} = {}) {
    if (!state.snapshot || state.failed || state.reviewed || changes.length === 0) return false;
    const inverse = inverseChanges(state.snapshot, changes);
    const entry = {changes, inverse, operation_id: uuid(), history, body: null};
    state.queue.push(entry);
    state.snapshot = visibleSnapshot();
    renderScene();
    renderStatus();
    void flush();
    return true;
}

async function flush() {
    if (state.saving || state.failed || state.reviewed || !state.queue.length) return;
    state.saving = true;
    const entry = state.queue[0];
    const board = state.board;
    entry.body ||= {board_id: board, generation: state.generation, base_revision: Number(state.server.board.revision), operation_id: entry.operation_id, changes: entry.changes};
    renderStatus();
    try {
        const result = await api('studio-mutate', entry.body);
        if (board !== state.board) return;
        const previousNodes = new Map(state.server.nodes.map(node => [node.id, Number(node.version || 0)]));
        state.server = applyChanges(state.server, entry.changes);
        for (const change of entry.changes) {
            if (change.type !== 'put-node') continue;
            const version = (previousNodes.get(change.node.id) || 0) + 1;
            previousNodes.set(change.node.id, version);
            const node = state.server.nodes.find(item => item.id === change.node.id);
            if (node) node.version = version;
            // A later local keystroke shares the newly acknowledged base version.
            if (state.editor?.id === change.node.id) state.editor.version = version;
        }
        state.server.board.revision = Number(result.revision);
        state.queue.shift();
        state.snapshot = visibleSnapshot();
        if (entry.history) { state.undo.push({changes: entry.changes, inverse: entry.inverse}); state.undo = state.undo.slice(-30); state.redo = []; }
        state.lastConnected = Date.now();
    } catch (error) {
        mutationError(error);
    } finally {
        state.saving = false;
        renderScene(); renderStatus();
        if (!state.failed && state.queue.length) void flush();
        else if (!state.failed) void pollBoard();
    }
}

async function retryChanges() {
    // An uncertain transport outcome retries the exact idempotent command.
    state.failed = null;
    showNotice(null);
    await flush();
}

async function reviewChanges() {
    try {
        const snapshot = await api('studio-board', undefined, {board: state.board});
        if (snapshot.generation !== state.generation) throw Object.assign(new Error(tr('generationConflict')), {status: 409, error_code: 'studio_generation_conflict'});
        state.server = snapshot;
        state.snapshot = snapshot;
        state.reviewed = true;
        state.undo = []; state.redo = [];
        renderScene(); renderStatus();
        showNotice(tr('reviewHelp'), {actions: [actionButton('applyDraft', applyReviewedChanges), actionButton('discardChanges', discardChanges)]});
    } catch (error) { mutationError(error); }
}

function applyReviewedChanges() {
    // This explicit choice is a fresh command against the version just reviewed.
    const changes = state.queue.flatMap(entry => entry.changes);
    if (changes.length > 100) { mutationError(new Error(tr('pendingSwitch'))); return; }
    try { applyChanges(state.server, changes); }
    catch { showNotice(tr('conflict'), {kind: 'error', actions: [actionButton('discardChanges', discardChanges)]}); return; }
    state.queue = [];
    state.failed = null; state.reviewed = false;
    state.snapshot = state.server;
    showNotice(null);
    try { enqueue(changes); } catch (error) { mutationError(error); }
}

async function discardChanges() {
    if (!window.confirm(tr('discardConfirm'))) return;
    state.queue = []; state.failed = null; state.reviewed = false; state.editor = null;
    showNotice(null);
    await pollBoard(true);
    renderEditor(true); renderStatus();
}

function hasUnsaved() { return state.queue.length > 0 || state.saving || Boolean(state.editor?.dirty); }

async function pollBoard(force = false) {
    if (state.pollBusy || !state.board || !state.alive || (!force && (state.queue.length || state.saving || state.failed || state.gesture))) return;
    const board = state.board, version = state.boardVersion;
    state.pollBusy = true;
    try {
        const snapshot = await api('studio-board', undefined, {board});
        if (!state.alive || board !== state.board || version !== state.boardVersion || (!force && (state.queue.length || state.saving || state.gesture))) return;
        if (state.generation && snapshot.generation !== state.generation) throw Object.assign(new Error(tr('generationConflict')), {status: 409, error_code: 'studio_generation_conflict'});
        const remoteChanged = state.server && Number(state.server.board.revision) !== Number(snapshot.board.revision);
        if (remoteChanged) { state.undo = []; state.redo = []; }
        if (state.editor?.dirty) {
            const current = snapshot.nodes.find(node => node.id === state.editor.id);
            if (!current || Number(current.version) !== state.editor.version) state.editor.conflict = true;
        }
        state.server = snapshot; state.snapshot = snapshot; state.generation = snapshot.generation;
        state.lastConnected = Date.now();
        if (state.selected && !snapshot.nodes.some(node => node.id === state.selected) && !state.editor?.dirty) state.selected = null;
        renderScene(); renderBoards(); renderTranscripts(); renderEditor(); renderStatus();
    } catch (error) {
        if (version !== state.boardVersion) return;
        if (error.error_code === 'studio_generation_conflict') mutationError(error);
        else {
            $('connection').textContent = tr('offline'); $('live-dot').dataset.connected = 'false';
            if (force) showNotice(error.message, {kind: 'error', actions: [actionButton('retry', () => pollBoard(true))]});
        }
    } finally { state.pollBusy = false; }
}

async function openBoard(id) {
    if (id === state.board && state.snapshot) return;
    if (state.recording) { showNotice(tr('recordingSwitch')); return; }
    if (hasUnsaved()) { showNotice(tr('pendingSwitch')); return; }
    state.boardVersion++;
    state.board = id; state.snapshot = null; state.server = null; state.selected = null; state.editor = null;
    state.queue = []; state.failed = null; state.undo = []; state.redo = []; state.camera = {x: 110, y: 80, zoom: 1};
    $('board-title').textContent = tr('loading');
    showNotice(null); renderScene(); renderEditor(true); renderStatus();
    const url = new URL(location.href); url.searchParams.set('board', id); history.replaceState(null, '', url);
    await pollBoard(true);
    if (state.snapshot) { $('board-title').textContent = state.snapshot.board.title; fitCamera(); }
    renderBoards(); renderStatus();
}

function renderBoards() {
    const root = $('board-list'); root.replaceChildren();
    const boards = state.bootstrap?.boards || [];
    if (!boards.length) { root.append(el('p', {class: 'studio-no-boards'}, tr('noBoards'))); return; }
    for (const board of boards) {
        const title = board.id === state.board && state.snapshot ? state.snapshot.board.title : board.title;
        root.append(el('button', {type: 'button', class: 'studio-board-item', role: 'listitem', 'data-board-id': board.id,
            'aria-current': board.id === state.board ? 'page' : null, on: {click: () => { void openBoard(board.id); $('app').dataset.boards = 'closed'; }}},
        icon('layout'), el('span', {}, el('strong', {}, title), el('small', {}, tr('whiteboard')))));
    }
}

function cameraPoint(event) {
    const bounds = $('canvas').getBoundingClientRect();
    return {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
}

function applyCamera() {
    const {x, y, zoom} = state.camera;
    $('world').style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
    $('canvas').style.backgroundSize = `${23 * zoom}px ${23 * zoom}px`;
    $('canvas').style.backgroundPosition = `${x}px ${y}px`;
    const label = $('camera-controls').querySelector('.studio-zoom-label');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
}

function fitCamera() {
    if (!state.snapshot?.nodes.length) { state.camera = {x: 110, y: 80, zoom: 1}; applyCamera(); return; }
    const nodes = state.snapshot.nodes;
    const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
    const maxX = Math.max(...nodes.map(node => node.x + node.width)), maxY = Math.max(...nodes.map(node => node.y + node.height));
    const bounds = $('canvas').getBoundingClientRect();
    const zoom = clamp(Math.min((bounds.width - 150) / Math.max(1, maxX - minX), (bounds.height - 120) / Math.max(1, maxY - minY), 1), MIN_ZOOM, MAX_ZOOM);
    state.camera = {x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom + 20,
        y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom, zoom};
    applyCamera();
}

function renderScene() {
    const root = $('nodes'), lines = $('lines');
    const focused = document.activeElement?.dataset.studioNode;
    root.replaceChildren(); lines.replaceChildren();
    const snapshot = state.snapshot, empty = $('empty');
    empty.hidden = Boolean(snapshot?.nodes.length);
    empty.querySelector('h3').textContent = tr(state.board ? 'emptyBoardTitle' : 'emptyTitle');
    empty.querySelector('p:not(.studio-eyebrow)').textContent = tr(state.board ? 'emptyBoardHelp' : 'emptyHelp');
    $('empty-action').textContent = tr(state.board ? 'note' : 'newBoard');
    if (snapshot) {
        $('board-title').textContent = snapshot.board.title;
        for (const edge of snapshot.edges) {
            const a = snapshot.nodes.find(node => node.id === edge.from_node_id), b = snapshot.nodes.find(node => node.id === edge.to_node_id);
            if (!a || !b) continue;
            const x1 = a.x + a.width / 2, y1 = a.y + a.height / 2, x2 = b.x + b.width / 2, y2 = b.y + b.height / 2;
            lines.append(svg('path', {class: 'studio-edge', 'data-studio-edge': edge.id, d: `M${x1} ${y1} C${x1 + (x2 - x1) / 2} ${y1},${x1 + (x2 - x1) / 2} ${y2},${x2} ${y2}`}));
        }
        for (const node of snapshot.nodes) {
            const card = el('article', {class: 'studio-node', 'data-studio-node': node.id, 'data-kind': node.kind,
                'data-selected': node.id === state.selected ? 'true' : 'false', tabindex: 0, role: 'button',
                'aria-label': tr(node.kind) + ': ' + node.text.slice(0, 120), 'aria-pressed': node.id === state.selected ? 'true' : 'false'});
            card.style.left = node.x + 'px'; card.style.top = node.y + 'px';
            card.style.width = node.width + 'px'; card.style.height = node.height + 'px';
            if (node.kind === 'stroke') {
                const drawing = svg('svg', {class: 'studio-stroke', viewBox: `0 0 ${node.width} ${node.height}`});
                drawing.append(svg('polyline', {points: (node.data?.points || []).map(point => point.join(',')).join(' '), fill: 'none',
                    stroke: node.data?.color || '#0b7476', 'stroke-width': node.data?.size || 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
                card.append(drawing);
            } else if (node.kind === 'screen') {
                card.append(el('div', {class: 'studio-screen-bar', 'aria-hidden': 'true'}, el('i'), el('i'), el('i')),
                    el('div', {class: 'studio-screen-body'}, el('div', {class: 'studio-node-top'}, icon('layout'), tr('wireframeLabel')),
                        el('p', {class: 'studio-screen-title'}, node.text),
                        el('div', {class: 'studio-screen-field', 'aria-hidden': 'true'}, tr('wireframeField')),
                        el('div', {class: 'studio-screen-field', 'aria-hidden': 'true'}, tr('wireframeField')),
                        el('div', {class: 'studio-screen-button', 'aria-hidden': 'true'}, tr('wireframeButton'))));
            } else card.append(el('div', {class: 'studio-node-top'}, icon(node.kind === 'idea' ? 'sparkles' : 'bookmark'), tr(node.kind)), el('p', {class: 'studio-node-text'}, node.text));
            if (node.source_segment_id) card.append(el('div', {class: 'studio-node-source'}, icon('clock'), tr('source')));
            root.append(card);
        }
    }
    if (focused) root.querySelector(`[data-studio-node="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
    $('canvas').dataset.mode = state.mode;
    applyCamera();
}

function renderTools() {
    const root = $('toolbar'); root.replaceChildren();
    const chooseMode = mode => { state.mode = mode; state.connectFrom = null; renderTools(); $('canvas').dataset.mode = mode; if (mode === 'connect') showNotice(tr('connectHelp')); };
    for (const [key, symbol, action] of [
        ['select', 'pointer', () => chooseMode('select')], ['pan', 'grip', () => chooseMode('pan')],
        ['note', 'bookmark', () => addNode('note')], ['idea', 'sparkles', () => addNode('idea')],
        ['screen', 'layout', () => addNode('screen')], ['connect', 'link', () => chooseMode('connect')], ['draw', 'pen', () => chooseMode('draw')],
    ]) root.append(control(key, symbol, action, {'data-studio-tool': key, disabled: !state.snapshot,
        'aria-pressed': String(key === state.mode)}));
    root.append(el('span', {class: 'studio-toolbar-separator', 'aria-hidden': 'true'}),
        control('delete', 'trash', deleteSelection, {disabled: !state.selected || Boolean(state.failed), 'data-studio-tool': 'delete'}));
    const camera = $('camera-controls'); camera.replaceChildren();
    camera.append(control('zoomOut', 'collapse', () => zoomCenter(.8)), el('span', {class: 'studio-zoom-label'}, Math.round(state.camera.zoom * 100) + '%'),
        control('zoomIn', 'plus', () => zoomCenter(1.25)), control('fit', 'expand', fitCamera),
        control('undo', 'undo', undo, {disabled: !state.undo.length || hasUnsaved() || Boolean(state.failed), 'data-studio-tool': 'undo'}),
        control('redo', 'redo', redo, {disabled: !state.redo.length || hasUnsaved() || Boolean(state.failed), 'data-studio-tool': 'redo'}));
}

function zoomCenter(factor) {
    const bounds = $('canvas').getBoundingClientRect();
    state.camera = zoomAt(state.camera, {x: bounds.width / 2, y: bounds.height / 2}, state.camera.zoom * factor); applyCamera();
}

function addNode(kind, text) {
    if (!state.snapshot) { showNotice(tr('chooseBoard')); return; }
    if (!commitEditor()) return;
    const bounds = $('canvas').getBoundingClientRect();
    const point = screenToWorld({x: bounds.width / 2, y: bounds.height / 2}, state.camera);
    const offset = state.snapshot.nodes.length % 5 * 17;
    const node = {id: uuid(), kind, text: text ?? tr(kind === 'idea' ? 'newIdea' : kind === 'screen' ? 'newScreen' : 'newNote'),
        x: point.x - CARD_WIDTH / 2 + offset, y: point.y - CARD_HEIGHT / 2 + offset,
        width: kind === 'screen' ? 300 : CARD_WIDTH, height: kind === 'screen' ? 285 : CARD_HEIGHT,
        data: kind === 'screen' ? {layout: 'form'} : {}};
    if (enqueue([{type: 'put-node', node}])) { state.selected = node.id; state.editor = null; renderScene(); renderEditor(true); renderTools(); }
}

function selectNode(id) {
    if (id === state.selected) return;
    if (!commitEditor()) return;
    state.selected = id; state.editor = null; renderScene(); renderEditor(true); renderTools();
}

function deleteSelection() {
    if (!state.selected || !state.snapshot || state.failed) return;
    if (!commitEditor()) return;
    const id = state.selected;
    if (enqueue([{type: 'delete-node', id}])) { state.selected = null; state.editor = null; renderEditor(true); renderTools(); }
}

function undo() {
    if (hasUnsaved() || state.failed || !state.undo.length) return;
    const entry = state.undo.pop();
    if (enqueue(entry.inverse, {history: false})) state.redo.push(entry);
    renderTools();
}

function redo() {
    if (hasUnsaved() || state.failed || !state.redo.length) return;
    const entry = state.redo.pop();
    if (enqueue(entry.changes, {history: false})) state.undo.push(entry);
    renderTools();
}

function renderEditor(force = false) {
    const root = $('editor');
    const node = state.snapshot?.nodes.find(value => value.id === state.selected);
    if (!node && !state.editor?.dirty) { root.hidden = true; root.replaceChildren(); state.editor = null; return; }
    if (state.editor?.id === state.selected && !force) {
        if (!state.editor.dirty && node) {
            state.editor.version = Number(node.version || 0); state.editor.text = node.text;
            const input = $('edit-text'); if (input && document.activeElement !== input) input.value = node.text;
        }
        if (state.editor.conflict) showEditorConflict();
        return;
    }
    if (!node) return;
    state.editor = {id: node.id, text: node.text, version: Number(node.version || 0), dirty: false, conflict: false};
    root.hidden = false; root.replaceChildren();
    root.append(el('h4', {id: 'studio-editor-title'}, tr('editTitle')));
    if (node.kind !== 'stroke') {
        const field = el('textarea', {id: 'studio-edit-text', class: 'input', rows: 4, maxlength: 4000, 'aria-label': tr('content')}); field.value = node.text;
        field.addEventListener('input', () => {
            state.editor.text = field.value; state.editor.dirty = true;
            clearTimeout(state.editTimer); state.editTimer = setTimeout(() => commitEditor(), 650); renderStatus();
        });
        field.addEventListener('blur', () => commitEditor());
        root.append(el('label', {for: 'studio-edit-text'}, tr('content')), field, el('p', {class: 'studio-editor-help'}, tr('editHelp')),
            actionButton('save', () => commitEditor()));
    }
    const segment = state.snapshot.segments.find(item => item.id === node.source_segment_id);
    if (segment) root.append(el('div', {class: 'studio-source'}, el('h5', {}, tr('source')), el('small', {}, timestamp(segment.start_ms) + ' – ' + timestamp(segment.end_ms)), el('p', {}, segment.text), el('small', {}, tr('sourceHelp'))));
    root.append(actionButton('delete', deleteSelection));
}

function showEditorConflict() {
    if (!state.editor) return;
    clearTimeout(state.editTimer);
    let message = $('edit-conflict');
    if (!message) {
        message = el('div', {id: 'studio-edit-conflict', class: 'studio-source', role: 'alert'}, el('p', {}, tr('editedElsewhere')),
            actionButton('saveAsNew', () => {
                const text = state.editor.text;
                state.editor.dirty = false; state.editor.conflict = false; state.editor = null;
                addNode('note', text);
            }));
        $('editor').append(message);
    }
}

function commitEditor() {
    clearTimeout(state.editTimer);
    const editor = state.editor;
    if (!editor?.dirty) return true;
    if (editor.conflict || state.failed) { if (editor.conflict) showEditorConflict(); return false; }
    const node = state.snapshot?.nodes.find(item => item.id === editor.id);
    if (!node || Number(node.version || 0) !== editor.version) { editor.conflict = true; showEditorConflict(); return false; }
    const change = {type: 'put-node', node: {...editableNode(node), text: editor.text}};
    if (enqueue([change])) { editor.dirty = false; return true; }
    return false;
}

function timestamp(value) {
    const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function renderTranscripts() {
    const root = $('transcripts'), segments = state.snapshot?.segments || [];
    $('transcript-count').textContent = String(segments.filter(segment => segment.text).length);
    root.replaceChildren();
    if (!segments.length) root.append(el('p', {class: 'studio-transcript-empty'}, tr('noTranscripts')));
    for (const segment of [...segments].reverse().slice(0, 40)) {
        const card = el('button', {type: 'button', class: 'studio-transcript', disabled: !segment.node_id,
            on: {click: () => { selectNode(segment.node_id); const node = state.snapshot.nodes.find(value => value.id === segment.node_id); if (node) { const bounds = $('canvas').getBoundingClientRect(); state.camera.x = bounds.width / 2 - (node.x + node.width / 2) * state.camera.zoom; state.camera.y = bounds.height / 2 - (node.y + node.height / 2) * state.camera.zoom; applyCamera(); } }}},
        el('time', {}, timestamp(segment.start_ms) + ' – ' + timestamp(segment.end_ms)), el('p', {}, segment.text || tr('noSpeech')));
        root.append(card);
    }
}

function renderStatus() {
    const ready = Boolean(state.bootstrap?.ready), board = Boolean(state.snapshot);
    $('new-board').disabled = !ready || state.creating || Boolean(state.recording);
    $('share').disabled = !board;
    $('save-state').textContent = !board ? '' : state.failed || state.editor?.conflict ? tr('unsaved') : hasUnsaved() ? tr('saving') : tr('saved');
    $('save-state').dataset.error = String(Boolean(state.failed || state.editor?.conflict));
    $('save-state').title = board ? tr('revision', {revision: state.server.board.revision}) : '';
    const connected = state.lastConnected && Date.now() - state.lastConnected < 6000;
    $('connection').textContent = tr(connected ? 'connected' : state.bootstrap ? 'offline' : 'connecting');
    $('live-dot').dataset.connected = String(Boolean(connected));
    const voice = state.voice, provider = state.bootstrap?.transcription?.enabled;
    $('microphone').disabled = !board || !provider || ['starting', 'stopping'].includes(voice.state);
    $('microphone').replaceChildren(microphoneIcon(), el('span', {}, tr(state.recording ? 'stopRecording' : 'startRecording')));
    $('microphone-retry').hidden = !state.recording || !state.microphone?.pending || voice.state !== 'failed';
    $('recording-orb').dataset.recording = String(voice.capturing);
    const voiceKey = voice.state === 'recording' ? 'voiceRecording' : voice.state === 'starting' ? 'voiceStarting'
        : voice.state === 'stopping' ? 'voiceStopping' : voice.state === 'sending' ? 'voiceSending'
            : voice.state === 'failed' ? 'voiceFailed' : voice.state === 'stopped' ? 'voiceStopped' : 'voiceReady';
    $('voice-status').textContent = !board ? tr('chooseBoardVoice') : !provider ? tr('transcriptionDisabled') : tr(voiceKey, {count: voice.queued});
    renderTools();
}

function microphoneError(error) {
    const key = 'microphone' + ({secure: 'Secure', unsupported: 'Unsupported', permission: 'Permission', device: 'Device', queue: 'Queue', interrupted: 'Interrupted', transport: 'Transport'}[error.code] || 'Transport');
    const cause = error.cause || error;
    const actions = cause.status === 401 ? [el('a', {class: 'button button-secondary', href: '/auth.php?' + new URLSearchParams({mode: 'login', next: 'studio', board: state.board})}, tr('signIn'))] : [];
    showNotice(cause.error_i18n?.[getLanguage()] || (cause.status ? cause.message : tr(key)), {kind: 'error', actions});
    renderStatus();
}

async function startMicrophone() {
    if (!state.snapshot || !state.bootstrap?.transcription?.enabled || state.recording) return;
    if (!commitEditor()) return;
    const rec = {id: uuid(), board_id: state.board, generation: state.generation, started: false, stopRequested: false};
    rec.startBody = {id: rec.id, board_id: rec.board_id, generation: rec.generation, operation_id: uuid()};
    state.recording = rec;
    const mic = createMicrophone({chunkSeconds: state.bootstrap.transcription.chunk_seconds || 6,
        onState: value => { state.voice = value; renderStatus(); }, onError: microphoneError,
        onChunk: async chunk => {
            await rec.promise;
            const form = new FormData(); form.append('file', chunk.blob, 'fragment.wav');
            for (const [key, value] of Object.entries({board_id: rec.board_id, recording_id: rec.id, generation: rec.generation,
                sequence: chunk.sequence, start_ms: chunk.start_ms, end_ms: chunk.end_ms, operation_id: chunk.operation_id})) form.append(key, String(value));
            await api('studio-audio', form); await pollBoard();
        }});
    state.microphone = mic;
    rec.promise = api('studio-start-recording', rec.startBody).then(result => { rec.started = true; return result; });
    rec.promise.catch(() => {});
    try {
        // start() resumes AudioContext during this gesture, before either network await.
        await Promise.all([mic.start(), rec.promise]); showNotice(null);
    } catch (error) {
        await mic.stop().catch(() => {});
        if (!mic.pending) {
            await rec.promise.then(() => api('studio-stop-recording', {id: rec.id, board_id: rec.board_id, generation: rec.generation})).catch(() => {});
            void mic.dispose().catch(() => {}); state.recording = null; state.microphone = null;
        }
        microphoneError(error);
    }
    renderStatus();
}

async function finishRecording(rec) {
    await api('studio-stop-recording', {id: rec.id, board_id: rec.board_id, generation: rec.generation});
    await state.microphone?.dispose(); state.microphone = null; state.recording = null;
    state.voice = {state: 'stopped', queued: 0, capturing: false};
    renderStatus(); await pollBoard();
}

async function stopMicrophone() {
    const rec = state.recording;
    if (!rec || rec.stopRequested) return;
    rec.stopRequested = true;
    try { await state.microphone.stop(); await rec.promise; await finishRecording(rec); }
    catch (error) { rec.stopRequested = false; microphoneError(error); }
}

async function retryMicrophone() {
    const rec = state.recording;
    if (!rec || rec.stopRequested) return;
    rec.stopRequested = true;
    try {
        if (!rec.started) rec.promise = api('studio-start-recording', rec.startBody).then(result => { rec.started = true; return result; });
        await rec.promise; await state.microphone.retry(); await state.microphone.stop(); await finishRecording(rec); showNotice(null);
    } catch (error) { rec.stopRequested = false; microphoneError(error); }
}

function openCreate() {
    if (!state.bootstrap?.ready) return;
    if (state.recording) { showNotice(tr('recordingSwitch')); return; }
    if (hasUnsaved()) { showNotice(tr('pendingSwitch')); return; }
    $('create-dialog').showModal(); $('board-name').focus();
}

let createAttempt = null;
async function createBoard(event) {
    event.preventDefault();
    if (state.creating) return;
    const title = $('board-name').value.trim();
    if (!title) { $('board-name').reportValidity(); return; }
    if (!createAttempt || createAttempt.title !== title) createAttempt = {id: uuid(), title, generation: state.generation, operation_id: uuid()};
    state.creating = true; $('create-submit').disabled = true; $('create-cancel').disabled = true;
    $('create-submit').textContent = tr('creating'); $('create-error').hidden = true;
    try {
        const board = await api('studio-create-board', createAttempt);
        state.bootstrap.boards = [...state.bootstrap.boards.filter(item => item.id !== board.id), board];
        $('create-dialog').close(); $('board-name').value = ''; createAttempt = null; await openBoard(board.id);
    } catch (error) { $('create-error').textContent = error.message; $('create-error').hidden = false; }
    finally { state.creating = false; $('create-submit').disabled = false; $('create-cancel').disabled = false; $('create-submit').textContent = tr('create'); renderStatus(); }
}

function translate() {
    for (const element of document.querySelectorAll('[data-studio-text]')) element.textContent = tr(element.dataset.studioText);
    $('govern-external').replaceChildren(icon('external'));
    $('share').setAttribute('aria-label', tr('openPhone'));
    $('share').replaceChildren(icon('external'), el('span', {class: 'studio-share-long'}, tr('openPhone')), el('span', {class: 'studio-share-short'}, tr('share')));
    $('language').value = getLanguage(); $('theme').setAttribute('aria-label', tr('theme'));
    $('theme').replaceChildren(icon(getPreferences().theme === 'dark' ? 'sun' : 'moon'));
    $('boards-toggle').setAttribute('aria-label', tr('toggleBoards'));
    $('inspector-toggle').setAttribute('aria-label', tr('toggleInspector'));
    $('inspector-close').setAttribute('aria-label', tr('closePanel'));
    $('canvas').setAttribute('aria-label', tr('keyboardHelp'));
    renderScene(); renderBoards(); renderTranscripts(); renderStatus();
    if (!state.editor?.dirty && !state.editor?.conflict) renderEditor(true);
}

function pointerDown(event) {
    if (!state.snapshot || event.button > 0 || event.target.closest('.studio-toolbar,.studio-canvas-bottom,.studio-empty')) return;
    const point = cameraPoint(event), canvas = $('canvas');
    canvas.focus({preventScroll: true}); canvas.setPointerCapture(event.pointerId);
    state.pointers.set(event.pointerId, point);
    if (state.pointers.size === 2) {
        state.snapshot = visibleSnapshot(); renderScene();
        const [a, b] = [...state.pointers.values()];
        state.gesture = {type: 'pinch', camera: {...state.camera}, midpoint: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, distance: Math.hypot(a.x - b.x, a.y - b.y)};
        return;
    }
    if (state.pointers.size > 2) return;
    const id = event.target.closest('[data-studio-node]')?.dataset.studioNode;
    if (state.mode === 'connect' && id) {
        if (!commitEditor()) return;
        if (!state.connectFrom) { state.connectFrom = id; selectNode(id); showNotice(tr('connectNext')); }
        else if (state.connectFrom !== id) {
            enqueue([{type: 'put-edge', edge: {id: uuid(), from_node_id: state.connectFrom, to_node_id: id, label: ''}}]);
            state.connectFrom = null; showNotice(null);
        }
        return;
    }
    if (state.mode === 'draw' && !state.failed) {
        if (!commitEditor()) return;
        const world = screenToWorld(point, state.camera);
        state.gesture = {type: 'draw', points: [[world.x, world.y]]};
    } else if (id && state.mode !== 'pan') {
        selectNode(id);
        const node = state.snapshot.nodes.find(item => item.id === id);
        if (!state.failed && !state.editor?.conflict) state.gesture = {type: 'node', id, point, before: editableNode(node)};
    } else {
        if (!commitEditor()) return;
        if (!id) selectNode(null);
        state.gesture = {type: 'pan', point, camera: {...state.camera}};
    }
}

function pointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    const point = cameraPoint(event); state.pointers.set(event.pointerId, point);
    const gesture = state.gesture; if (!gesture) return;
    if (gesture.type === 'pinch' && state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        const midpoint = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesture.distance);
        const camera = zoomAt(gesture.camera, gesture.midpoint, gesture.camera.zoom * ratio);
        state.camera = {...camera, x: camera.x + midpoint.x - gesture.midpoint.x, y: camera.y + midpoint.y - gesture.midpoint.y}; applyCamera();
    } else if (gesture.type === 'pan') {
        state.camera = {...gesture.camera, x: gesture.camera.x + point.x - gesture.point.x, y: gesture.camera.y + point.y - gesture.point.y}; applyCamera();
    } else if (gesture.type === 'node') {
        const node = state.snapshot.nodes.find(item => item.id === gesture.id);
        node.x = clamp(gesture.before.x + (point.x - gesture.point.x) / state.camera.zoom, -1000000, 1000000);
        node.y = clamp(gesture.before.y + (point.y - gesture.point.y) / state.camera.zoom, -1000000, 1000000);
        renderScene();
    } else if (gesture.type === 'draw') {
        const world = screenToWorld(point, state.camera), last = gesture.points.at(-1);
        if (Math.hypot(world.x - last[0], world.y - last[1]) < 2 / state.camera.zoom) return;
        gesture.points.push([world.x, world.y]);
        if (gesture.points.length > 1800) gesture.points = gesture.points.filter((_, index) => index % 2 === 0);
        let preview = $('stroke-preview');
        if (!preview) { preview = svg('polyline', {id: 'studio-stroke-preview', fill: 'none', stroke: '#0b7476', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}); $('lines').append(preview); }
        preview.setAttribute('points', gesture.points.map(value => value.join(',')).join(' '));
    }
}

function pointerEnd(event) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    const gesture = state.gesture;
    state.gesture = null;
    if (event.type === 'pointercancel') { state.snapshot = visibleSnapshot(); renderScene(); return; }
    if (!gesture) return;
    if (gesture.type === 'node') {
        const node = state.snapshot.nodes.find(item => item.id === gesture.id);
        const changed = editableNode(node);
        state.snapshot = visibleSnapshot();
        if (changed.x !== gesture.before.x || changed.y !== gesture.before.y) enqueue([{type: 'put-node', node: changed}]);
        else renderScene();
    } else if (gesture.type === 'draw' && gesture.points.length >= 2) {
        const minX = Math.min(...gesture.points.map(point => point[0])), minY = Math.min(...gesture.points.map(point => point[1]));
        const width = Math.max(1, Math.max(...gesture.points.map(point => point[0])) - minX), height = Math.max(1, Math.max(...gesture.points.map(point => point[1])) - minY);
        if (width <= 10000 && height <= 10000) enqueue([{type: 'put-node', node: {id: uuid(), kind: 'stroke', text: '', x: minX, y: minY, width, height,
            data: {points: gesture.points.map(point => [point[0] - minX, point[1] - minY]), color: '#0b7476', size: 3}}}]);
        else renderScene();
    }
}

function keydown(event) {
    if (event.target.closest('input,textarea,select,button,a')) return;
    if (event.key === 'Escape') { selectNode(null); state.mode = 'select'; state.connectFrom = null; renderTools(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (event.key === 'Enter' && state.selected) { $('app').dataset.inspector = 'open'; $('edit-text')?.focus(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 40 : 10;
    const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
    const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
    const node = state.snapshot?.nodes.find(item => item.id === state.selected);
    if (node && !state.failed) enqueue([{type: 'put-node', node: {...editableNode(node), x: node.x + dx, y: node.y + dy}}]);
    else { state.camera.x -= dx; state.camera.y -= dy; applyCamera(); }
}

$('recording-orb').append(microphoneIcon());
$('boards-toggle').append(icon('menu'));
$('inspector-toggle').append(icon('layers'));
$('inspector-close').append(icon('close'));
$('app').dataset.inspector = matchMedia('(min-width: 901px)').matches ? 'open' : 'closed';
$('new-board').addEventListener('click', openCreate);
$('empty-action').addEventListener('click', () => state.board ? addNode('note') : openCreate());
$('create-form').addEventListener('submit', createBoard);
$('create-cancel').addEventListener('click', () => { if (!state.creating) $('create-dialog').close(); });
$('create-dialog').addEventListener('cancel', event => { if (state.creating) event.preventDefault(); });
$('language').addEventListener('change', event => { updatePreferences({language: event.target.value}); setLanguage(event.target.value); });
$('theme').addEventListener('click', () => { updatePreferences({theme: getPreferences().theme === 'dark' ? 'light' : 'dark'}); translate(); });
$('boards-toggle').addEventListener('click', () => {
    const open = $('app').dataset.boards !== 'open'; $('app').dataset.boards = open ? 'open' : 'closed';
    $('boards-toggle').setAttribute('aria-expanded', String(open)); if (open) $('app').dataset.inspector = 'closed';
});
$('inspector-toggle').addEventListener('click', () => {
    const open = $('app').dataset.inspector !== 'open'; $('app').dataset.inspector = open ? 'open' : 'closed';
    $('inspector-toggle').setAttribute('aria-expanded', String(open)); if (open) $('app').dataset.boards = 'closed';
});
$('inspector-close').addEventListener('click', () => { $('app').dataset.inspector = 'closed'; $('inspector-toggle').setAttribute('aria-expanded', 'false'); $('inspector-toggle').focus(); });
$('share').addEventListener('click', () => {
    const link = new URL('/studio.php', location.origin); link.searchParams.set('board', state.board);
    $('board-link').value = link.href; $('share-status').textContent = ''; $('share-dialog').showModal();
});
$('share-close').addEventListener('click', () => $('share-dialog').close());
$('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('board-link').value); $('share-status').textContent = tr('copied'); }
    catch { $('board-link').focus(); $('board-link').select(); $('share-status').textContent = tr('copyManually'); }
});
$('microphone').addEventListener('click', () => { if (state.recording) void stopMicrophone(); else void startMicrophone(); });
$('microphone-retry').addEventListener('click', () => { void retryMicrophone(); });
$('canvas').addEventListener('pointerdown', pointerDown);
$('canvas').addEventListener('pointermove', pointerMove);
$('canvas').addEventListener('pointerup', pointerEnd);
$('canvas').addEventListener('pointercancel', pointerEnd);
$('canvas').addEventListener('lostpointercapture', event => { if (state.pointers.has(event.pointerId)) pointerEnd({...event, pointerId: event.pointerId, type: 'pointercancel'}); });
$('canvas').addEventListener('keydown', keydown);
$('canvas').addEventListener('dblclick', event => {
    const id = event.target.closest('[data-studio-node]')?.dataset.studioNode;
    if (id) { selectNode(id); $('app').dataset.inspector = 'open'; $('edit-text')?.focus(); }
});
$('canvas').addEventListener('wheel', event => {
    if (event.target.closest('.studio-toolbar,.studio-canvas-bottom')) return;
    event.preventDefault(); state.camera = zoomAt(state.camera, cameraPoint(event), state.camera.zoom * Math.exp(-event.deltaY * .0015)); applyCamera();
}, {passive: false});
window.addEventListener('govern:languagechange', translate);
window.addEventListener('beforeunload', event => { if (hasUnsaved() || state.recording) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { state.alive = false; clearTimeout(state.nextPoll); clearTimeout(state.editTimer); void state.microphone?.dispose().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) { state.alive = true; schedulePoll(); } });
window.addEventListener('resize', applyCamera);

function schedulePoll() {
    clearTimeout(state.nextPoll);
    if (!state.alive) return;
    state.nextPoll = setTimeout(async () => {
        if (!document.hidden) await pollBoard();
        renderStatus(); schedulePoll();
    }, 1500);
}

async function initialize() {
    translate();
    if (document.body.dataset.studioEnabled !== '1' || !scope) { showNotice(tr('disabled')); return; }
    try {
        const data = await api('studio-bootstrap');
        state.bootstrap = data; state.generation = data.generation; setCsrf(data.csrf);
        state.lastConnected = Date.now();
        if (!data.ready) { showNotice(tr('notReady')); renderStatus(); return; }
        renderBoards(); renderStatus();
        const requested = new URLSearchParams(location.search).get('board');
        if (requested || data.boards.length) await openBoard(requested || data.boards[0].id);
        if (!data.transcription?.enabled) showNotice(tr('transcriptionDisabled'));
        schedulePoll();
    } catch (error) { showNotice(error.message, {kind: 'error', actions: [actionButton('retry', initialize)]}); }
}

void initialize();
