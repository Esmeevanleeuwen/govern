import {request} from './api.js';
import {el, button, icon, notice, errorText, number} from './ui.js';
import {t} from './i18n.js';
import {ensureRecordMapState, mergeRecordGraph, visibleRecordGraph, selectRecordMapItem,
    recordMapPositions, clearRecordMap, normalizeRecordNode, sameRecordKey, invalidateRecordMapNode, recordMapCheckpoint, undoRecordMap, selectRecordMapNode, selectedRecordMapNodes, setRecordMapPinned, hideRecordMapNodes, showRecordMapNodes, arrangeRecordMap, moveRecordMapNode} from './record-map-model.js';
import {friendlyName} from './explorer-guide.js';
import {openRecordWindow} from './record-window.js';
import './record-map-messages.js';
import './companion-launch-messages.js';

const ns = 'http://www.w3.org/2000/svg';
const text = (key, values) => t('app.recordMap.' + key, values);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shown = value => value === null || value === undefined ? 'NULL'
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
const short = (value, length = 32) => { const letters = Array.from(String(value)); return letters.length > length ? letters.slice(0, length).join('') + '…' : String(value); };
const svgElement = (tag, attributes = {}, value) => {
    const node = document.createElementNS(ns, tag);
    for (const [name, content] of Object.entries(attributes)) node.setAttribute(name, String(content));
    if (value !== undefined) node.textContent = value;
    return node;
};

/** One selection model drives the graph and inspector; records never enter persistent storage. */
export function mountRecordMap(root, {state = {}, tables = [], scopeKey = '', initialTable = '',
    onOpenTable, onSelectRecord, onTableChange, companion = null, signal, live = () => true} = {}) {
    ensureRecordMapState(state, scopeKey);
    const available = tables.filter(table => table && typeof table.name === 'string');
    const tableColours = new Map([...new Set(available.map(table => table.name))].sort().map((name, index) => [name, index]));
    if (initialTable && available.some(table => table.name === initialTable) && state.table !== initialTable) {
        state.table = initialTable; state.search = ''; state.page = 1; state.seedResult = null;
    }
    if (!available.some(table => table.name === state.table)) state.table = available[0]?.name || '';
    let destroyed = false, epoch = 0, seedVersion = 0, selectionVersion = 0, searchTimer, pointer;
    let seedController, seedLoading = false, inspecting = '', selectionError = null;
    const controllers = new Set();
    const pendingRelations = new Set();
    const sourceVersions = new Map();
    const relationErrors = new Map();
    const active = () => !destroyed && !signal?.aborted && live();
    const relationKey = (node, relation) => JSON.stringify([node.id, relation.id]);
    const controller = () => { const value = new AbortController(); controllers.add(value); return value; };

    if (state.panelScope !== scopeKey) {
        state.panelScope = scopeKey; state.panels = {sources: {open: state.nodes.size === 0}, inspector: {open: false}}; state.trail = [];
    }
    state.panels ||= {sources: {open: true}, inspector: {open: false}};
    state.trail = Array.isArray(state.trail) ? state.trail.filter(id => state.nodes.has(id)) : [];
    let layoutVersion = 0, mode = 'select', suppressClick = false;
    let lastOpenPanel = state.panels.inspector.open ? 'inspector' : 'sources';
    const nodeElements = new Map();
    const smallButton = (label, handler, attributes = {}) => button(label, handler, {className: 'button-small', ...attributes});
    const summary = el('p', {class: 'record-map-summary'});
    const filterList = el('div', {class: 'record-map-filters', role: 'group', 'aria-label': text('filter')});
    const filters = el('details', {class: 'record-map-popover'}, el('summary', {}, text('filter')), filterList);
    const questionList = el('div', {class: 'record-map-question-list', id: 'explorer-guide'});
    const questions = el('details', {class: 'record-map-popover', id: 'record-map-questions'}, el('summary', {}, text('questions')), questionList);
    const status = el('p', {class: 'record-map-status sr-only', role: 'status', 'aria-live': 'polite'});
    const zoomValue = el('output', {'aria-label': text('map')});
    const viewport = el('div', {class: 'record-map-viewport workspace-canvas-viewport', tabindex: '0', 'aria-label': text('map'), 'aria-describedby': 'record-map-help'});
    const world = el('div', {class: 'record-map-world'});
    const svg = svgElement('svg', {class: 'record-map-svg', role: 'group', 'aria-label': text('map')});
    const nodesRoot = el('div', {class: 'record-map-nodes'});
    world.append(svg, nodesRoot); viewport.append(world);
    const canvasEmpty = el('div', {class: 'record-map-empty'});
    const trail = el('nav', {class: 'record-map-trail', 'aria-label': text('path')});
    const sceneHeading = el('div', {class: 'record-map-scene-heading'}, el('h2', {}, text('canvasTitle')), trail);
    const tableSelect = el('select', {id: 'record-map-table', class: 'input select', 'aria-label': text('chooseTable')},
        available.map(table => el('option', {value: table.name, selected: table.name === state.table}, friendlyName(table.name))));
    const search = el('input', {id: 'record-map-search', class: 'input', type: 'search', value: state.search,
        placeholder: text('searchPlaceholder'), 'aria-label': text('search'), autocomplete: 'off'});
    const seedList = el('div', {id: 'record-map-records', class: 'record-map-record-list', 'aria-live': 'polite'});
    const seedPagination = el('div', {class: 'record-map-pagination'});
    const pickerBody = el('div', {class: 'record-map-panel-body'},
        el('label', {for: 'record-map-table'}, text('chooseTable'), tableSelect),
        el('label', {for: 'record-map-search'}, text('search'), search), seedList, seedPagination);
    const inspectorBody = el('div', {class: 'record-map-panel-body'});
    const picker = panel('sources', 'record-map-sources', text('sources'), pickerBody);
    const inspector = panel('inspector', 'record-map-inspector', text('inspector'), inspectorBody);
    const sourcesToggle = smallButton(text('sources'), toggleSources, {id: 'record-map-sources-toggle', symbol: 'layout', 'aria-expanded': String(state.panels.sources.open)});
    const undoButton = smallButton(text('undo'), undo, {id: 'record-map-undo', disabled: !state.undoStack?.length});
    const quick = el('div', {class: 'record-map-quick'}, undoButton, smallButton(text('clearView'), closePanels, {id: 'record-map-clear-view', symbol: 'expand'}));
    const selectButton = smallButton(text('selectMode'), () => setMode('select'), {id: 'record-map-select', symbol: 'pointer', 'aria-pressed': 'true'});
    const panButton = smallButton(text('panMode'), () => setMode('pan'), {id: 'record-map-pan', 'aria-pressed': 'false'});
    const layout = el('select', {id: 'record-map-layout', class: 'input select', 'aria-label': text('layout')},
        ['orbit', 'flow', 'manual'].map(value => el('option', {value, selected: state.layout === value}, text(value))));
    const dock = el('div', {class: 'record-map-controls', 'aria-label': text('canvasTools')}, selectButton, panButton, layout,
        smallButton('−', () => zoomBy(1 / 1.2), {id: 'record-map-zoom-out', 'aria-label': text('zoomOut')}), zoomValue,
        smallButton('+', () => zoomBy(1.2), {id: 'record-map-zoom-in', 'aria-label': text('zoomIn')}),
        smallButton(text('fit'), fit, {id: 'record-map-fit', symbol: 'expand'}));
    const selectedName = el('span', {class: 'record-map-selected-name'});
    const pinButton = smallButton(text('pin'), pinSelected, {id: 'record-map-pin'});
    const selectionBar = el('div', {class: 'record-map-selection', hidden: true, 'aria-label': text('selectionActions')}, selectedName,
        smallButton(text('expand'), openQuestions, {id: 'record-map-expand-selected'}), pinButton,
        smallButton(text('inspect'), inspectSelected, {id: 'record-map-inspect-selected'}), smallButton(text('hide'), hideSelected, {id: 'record-map-hide'}));
    const minimapSvg = svgElement('svg', {viewBox: '0 0 130 75', 'aria-hidden': 'true'});
    const minimap = el('button', {type: 'button', class: 'record-map-minimap', 'aria-label': text('fit'), on: {click: fit}}, minimapSvg);
    const accessibleNodes = el('div', {id: 'record-map-node-list'}), accessibleEdges = el('div', {class: 'record-map-edge-list'});
    const accessible = el('details', {class: 'record-map-accessible-list'}, el('summary', {}, text('recordList')), accessibleNodes, accessibleEdges);
    const scene = el('section', {class: 'record-map-scene workspace-canvas-scene', 'aria-label': text('map')}, viewport, canvasEmpty, sceneHeading, quick, picker, inspector,
        selectionBar, dock, minimap, el('div', {class: 'record-map-canvas-caption'}, summary, el('span', {id: 'record-map-help'}, text('canvasHelp'))));
    const shell = el('section', {class: 'record-map record-map-canvas', 'data-flexible-explorer': '', 'data-layout': state.layout || 'manual'},
        el('div', {class: 'record-map-toolbar workspace-canvas-toolbar'}, el('p', {class: 'record-map-side-help'}, text('partial')),
            el('div', {class: 'record-map-tools'}, sourcesToggle, filters, questions,
                companion ? smallButton(t('app.companionLaunch.open'), () => companion.open('compare'), {id: 'explorer-companion-open', symbol: 'monitor'}) : null,
                companion ? smallButton(t('app.companionLaunch.radar'), () => companion.open('radar'), {id: 'explorer-companion-radar', symbol: 'network'}) : null,
                smallButton(text('clear'), clear, {id: 'record-map-clear'}))),
        scene, accessible, status, el('p', {class: 'sr-only'}, text('keyboardHelp')));
    root.append(shell);
    if (!available.length) tableSelect.disabled = search.disabled = true;
    function graphColour(table) {
        let hash = 0;
        for (const letter of table) hash = (hash * 31 + letter.codePointAt(0)) >>> 0;
        const colours = ['var(--g-accent)', 'color-mix(in srgb, var(--g-accent) 72%, var(--g-ink))',
            'color-mix(in srgb, var(--g-accent) 58%, var(--g-muted))',
            'color-mix(in srgb, var(--g-accent) 72%, var(--g-ambient-violet))',
            'color-mix(in srgb, var(--g-accent) 62%, var(--g-ambient-gold))'];
        return colours[(tableColours.get(table) ?? hash) % colours.length];
    }

    function announce(message) { status.textContent = message; }
    const recordContext = node => ({database: scopeKey, table: node.table, key: {...node.key}, guided: true});
    function openWindow(node) { if (active()) openRecordWindow(recordContext(node)); }
    function pinComparison(node) { if (active()) companion?.pin(recordContext(node)); }
    function showError(error, holder, retry) {
        holder.append(el('div', {class: 'record-map-error', role: 'alert'}, el('p', {}, errorText(error)),
            retry ? button(text('retry'), retry, {className: 'button-small'}) : null));
    }
    function seedSelection() {
        const selected = state.selection?.kind === 'node' ? state.selection.id : '';
        for (const item of seedList.querySelectorAll('[data-map-record]')) item.setAttribute('aria-pressed', String(item.dataset.mapRecord === selected));
    }

    function renderSeeds(error) {
        seedList.replaceChildren(); seedPagination.replaceChildren();
        if (seedLoading) { seedList.append(el('p', {class: 'record-map-side-help'}, text('loading'))); return; }
        if (error) { showError(error, seedList, () => loadSeeds()); return; }
        const data = state.seedResult;
        if (!data) return;
        if (data.supported === false) { seedList.append(notice(text('unsupported'))); return; }
        const nodes = (data.nodes || []).map(normalizeRecordNode).filter(Boolean);
        if (!nodes.length) seedList.append(el('div', {class: 'record-map-picker-empty'},
            el('strong', {}, text('noRecords')), el('p', {}, text('noRecordsHelp'))));
        for (const node of nodes) {
            seedList.append(el('button', {type: 'button', class: 'record-map-record',
                'data-map-record': node.id, 'aria-label': text('selectRecord', {label: node.label}),
                on: {click: () => selectRecord(node, {setFocus: !state.focusId, checkpoint: true})}}, el('strong', {}, node.label),
                el('small', {}, Object.entries(node.key).map(([key, value]) => key + ': ' + value).join(' · '))));
        }
        seedPagination.append(button(text('previous'), () => { state.page--; loadSeeds(); }, {className: 'button-small', disabled: state.page <= 1}),
            el('span', {class: 'small muted'}, text('page', {page: number(state.page)})),
            button(text('next'), () => { state.page++; loadSeeds(); }, {className: 'button-small', disabled: data.has_more !== true}));
        seedSelection();
    }
    async function loadSeeds() {
        if (!active() || !state.table) return;
        seedController?.abort();
        const pending = controller(); seedController = pending;
        const version = ++seedVersion;
        seedLoading = true; renderSeeds();
        try {
            const data = await request('record-map-records', {params: {database: scopeKey, table: state.table,
                page: state.page, page_size: 10, q: state.search}, signal: pending.signal});
            if (!active() || pending.signal.aborted || version !== seedVersion) return;
            state.seedResult = data;
            seedLoading = false; renderSeeds();
        } catch (error) {
            if (!active() || error.name === 'AbortError' || version !== seedVersion) return;
            seedLoading = false; renderSeeds(error);
        } finally { controllers.delete(pending); }
    }

    async function selectRecord(record, {setFocus: focusSelected = true, reveal = true, checkpoint = false, invalidate = true} = {}) {
        if (!active() || !record || typeof record.table !== 'string' || !record.key) return null;
        const version = ++selectionVersion;
        const capturedEpoch = epoch;
        const pending = controller();
        selectionError = null;
        const existing = [...state.nodes.values()].find(node => node.table === record.table && sameRecordKey(node.key, record.key));
        const readId = existing?.id || record.id;
        if (readId) sourceVersions.set(readId, (sourceVersions.get(readId) || 0) + 1);
        if (existing) {
            if (invalidate) invalidateRecordMapNode(state, existing.id);
            if (!checkpoint) { selectRecordMapItem(state, 'node', existing.id); state.hiddenTables.delete(existing.table); onSelectRecord?.(existing); }
        }
        inspecting = existing && !checkpoint ? existing.id : 'pending'; renderGraph(); renderInspector(); seedSelection(); if (reveal) { setPanel('sources', false); setPanel('inspector', true); }
        try {
            const data = await request('record-map', {params: {database: scopeKey},
                body: {table: record.table, key: record.key}, signal: pending.signal});
            if (!active() || pending.signal.aborted || capturedEpoch !== epoch || version !== selectionVersion) return null;
            if (checkpoint) recordMapCheckpoint(state);
            const {focus} = mergeRecordGraph(state, data);
            if (!focus) throw new Error(text('sourceUnavailable'));
            if (!readId) sourceVersions.set(focus.id, (sourceVersions.get(focus.id) || 0) + 1);
            showRecordMapNodes(state, [focus.id]); selectRecordMapNode(state, focus.id); if (focusSelected || !state.focusId) setFocus(focus);
            inspecting = ''; recordMapPositions(state, focus.id);
            onSelectRecord?.(focus);
            renderAll();
            if (!state.viewport) fit(); else if (reveal) revealSelection();
            announce(text('selected', {label: focus.label}));
            return focus;
        } catch (error) {
            if (!active() || error.name === 'AbortError' || version !== selectionVersion || capturedEpoch !== epoch) return null;
            inspecting = ''; selectionError = error; renderInspector();
            return null;
        } finally { controllers.delete(pending); }
    }

    function chooseNode(node, toggle = false) {
        if (!active() || mode === 'pan') return;
        selectionVersion++;
        inspecting = ''; selectionError = null;
        selectRecordMapNode(state, node.id, {toggle});
        const selected = selectedRecordMapNodes(state); onSelectRecord?.(selected.length === 1 ? selected[0] : null);
        renderGraph(); renderInspector(); seedSelection();
        announce(text('selected', {label: node.label}));
        renderQuestions(); if (toggle) setPanel('inspector', false); else { setPanel('inspector', true); if (!state.details.has(node.id)) selectRecord(node, {setFocus: false, invalidate: false}); }
    }

    async function expand(node, relation) {
        const id = relationKey(node, relation);
        if (!active() || pendingRelations.has(id) || relation.external || relation.supported === false) return;
        const cursor = state.cursors.get(id);
        if (cursor && cursor.has_more !== true) { showCached(node, relation); return; }
        const capturedEpoch = epoch, readVersions = new Map(sourceVersions);
        const pending = controller();
        pendingRelations.add(id); relationErrors.delete(id); renderInspector(); renderQuestions();
        try {
            const data = await request('record-map', {params: {database: scopeKey}, body: {
                table: node.table, key: node.key, relation: relation.id, offset: cursor?.next_offset || 0, page_size: 25,
            }, signal: pending.signal});
            if (!active() || pending.signal.aborted || capturedEpoch !== epoch) return;
            if ([...(data.nodes || []), data.focus].filter(Boolean).some(node => (sourceVersions.get(node.id) || 0) !== (readVersions.get(node.id) || 0))) return;
            recordMapCheckpoint(state); const before = new Map([...state.positions].map(([id, p]) => [id, {...p}]));
            const {added} = mergeRecordGraph(state, data); showRecordMapNodes(state, (data.nodes || []).map(node => node.id));
            state.cursors.set(id, {has_more: data.has_more === true, next_offset: data.next_offset,
                count: (cursor?.count || 0) + (data.edges?.length || 0)});
            recordMapPositions(state, node.id);
            if (dimensions().width < 600) setPanel('inspector', false);
            renderFilters(); renderGraph(); renderQuestions(); fit(); focusMobile(node.id); animatePositions(before);
            announce(added.length ? text('loaded', {count: number(added.length)})
                : data.edges?.length ? text(data.has_more ? 'moreAvailable' : 'complete') : text('emptyExpansion'));
        } catch (error) {
            if (!active() || error.name === 'AbortError' || capturedEpoch !== epoch) return;
            relationErrors.set(id, error);
        } finally {
            controllers.delete(pending);
            if (active() && capturedEpoch === epoch) {
                pendingRelations.delete(id);
                renderInspector(); renderQuestions();
                const target = [...inspector.querySelectorAll('[data-record-relation]')].find(item => item.dataset.recordRelation === relation.id);
                if (document.activeElement === document.body) target?.focus({preventScroll: true});
            }
        }
    }

    function chooseEdge(edge) {
        selectionVersion++; inspecting = ''; selectionError = null; selectRecordMapItem(state, 'edge', edge.id); onSelectRecord?.(null);
        renderGraph(); renderInspector(); renderQuestions(); seedSelection(); setPanel('inspector', true);
        announce(text('selectConnection', {name: edge.constraint || edge.id}));
    }

    function openTable(node) {
        try {
            const result = onOpenTable?.(node.table, node.key);
            if (result?.catch) result.catch(error => { if (active()) { selectionError = error; renderInspector(); } });
        } catch (error) { selectionError = error; renderInspector(); }
    }

    function renderFilters() {
        const selectedTable = document.activeElement?.dataset?.mapEntityFilter;
        filterList.replaceChildren();
        const names = [...new Set([...state.nodes.values()].map(node => node.table))].sort();
        if (names.length) filterList.append(el('span', {class: 'record-map-summary'}, text('filter')));
        for (const name of names) {
            const field = el('input', {type: 'checkbox', checked: !state.hiddenTables.has(name),
                'data-map-entity-filter': name, 'aria-label': name, on: {change: () => {
                    recordMapCheckpoint(state); if (field.checked) state.hiddenTables.delete(name); else state.hiddenTables.add(name);
                    renderGraph(); renderQuestions();
                }}});
            const label = el('span', {class: 'record-map-type-label'}, name);
            label.style.setProperty('--map-color', graphColour(name));
            filterList.append(el('label', {}, field, label));
        }
        if (selectedTable) [...filterList.querySelectorAll('input')].find(input => input.dataset.mapEntityFilter === selectedTable)?.focus({preventScroll: true});
    }

    function dimensions() { const box = viewport.getBoundingClientRect(); return {width: Math.max(1, box.width || 640), height: Math.max(1, box.height || 600)}; }
    function camera() { const size = dimensions(); return state.viewport || {x: size.width / 2, y: size.height / 2, zoom: 1}; }
    function canvasBox() {
        const size = dimensions(), box = {left: 28, right: size.width - 28, top: 95, bottom: size.height - 130};
        if (size.width >= 600) { for (const node of [picker, inspector].filter(node => !node.hidden)) {
            if (node.offsetLeft + node.offsetWidth / 2 < size.width / 2) box.left = Math.max(box.left, node.offsetLeft + node.offsetWidth + 20);
            else box.right = Math.min(box.right, node.offsetLeft - 20);
        } if (box.right - box.left < 240) { box.left = 28; box.right = size.width - 28; } }
        if (size.width < 600 && (!picker.hidden || !inspector.hidden)) box.bottom = Math.max(box.top + 130, size.height - 400);
        return box;
    }
    function transform() {
        const view = camera(); world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
        shell.dataset.compact = String(view.zoom < .72); shell.dataset.overview = String(view.zoom < .45);
        for (const node of nodeElements.values()) {
            const face = node.querySelector('.record-map-node-face'), overview = view.zoom < .45;
            const height = Math.max(overview ? 44 / view.zoom : view.zoom < .72 ? 68 : 112, 44 / view.zoom), width = overview ? 44 / view.zoom : 204;
            Object.assign(face.style, {width: width + 'px', height: height + 'px', left: (204 - width) / 2 + 'px', top: (112 - height) / 2 + 'px'});
            node.querySelector('.record-map-node-label').style.fontSize = Math.max(15, 11.5 / view.zoom) + 'px';
            for (const part of node.querySelectorAll('.record-map-node-type,.record-map-node-footer')) part.style.fontSize = Math.max(11, 11 / view.zoom) + 'px';
            const expand = node.querySelector('.record-map-card-expand'); if (expand) expand.style.transform = 'scale(' + 1 / view.zoom + ')';
        }
        zoomValue.textContent = Math.round(view.zoom * 100) + '%'; viewport.style.backgroundPosition = view.x % 22 + 'px ' + view.y % 22 + 'px';
    }
    function fit() {
        const graph = visibleRecordGraph(state); if (!graph.nodes.length) { state.viewport = null; transform(); return; }
        const points = graph.nodes.map(node => state.positions.get(node.id)).filter(Boolean); if (!points.length) return;
        const left = Math.min(...points.map(p => p.x)) - 128, right = Math.max(...points.map(p => p.x)) + 128,
            top = Math.min(...points.map(p => p.y)) - 72, bottom = Math.max(...points.map(p => p.y)) + 86, box = canvasBox();
        const zoom = clamp(Math.min((box.right - box.left) / (right - left), (box.bottom - box.top) / (bottom - top)), .25, 1.1);
        state.viewport = {x: (box.left + box.right) / 2 - (left + right) / 2 * zoom,
            y: (box.top + box.bottom) / 2 - (top + bottom) / 2 * zoom, zoom}; transform(); renderMinimap();
    }
    function zoomBy(factor, anchor) {
        const view = camera(), size = dimensions(), p = anchor || {x: size.width / 2, y: size.height / 2}, zoom = clamp(view.zoom * factor, .25, 2), ratio = zoom / view.zoom;
        state.viewport = {x: p.x - (p.x - view.x) * ratio, y: p.y - (p.y - view.y) * ratio, zoom}; transform();
    }
    function focusMobile(id = state.focusId) {
        if (dimensions().width >= 600 || camera().zoom >= .65) return;
        const p = state.positions.get(id), box = canvasBox(); if (!p) return;
        state.viewport = {x: (box.left + box.right) / 2 - p.x * .65, y: (box.top + box.bottom) / 2 - p.y * .65, zoom: .65}; transform();
    }
    function revealSelection() {
        const node = selectedRecordMapNodes(state)[0], p = node && state.positions.get(node.id); if (!p) return;
        const view = camera(), box = canvasBox(), x = p.x * view.zoom + view.x, y = p.y * view.zoom + view.y,
            px = Math.min(112 * view.zoom, (box.right - box.left) / 2), py = 64 * view.zoom;
        state.viewport = {...view, x: view.x + clamp(x, box.left + px, box.right - px) - x,
            y: view.y + clamp(y, box.top + py, box.bottom - py) - y}; transform();
    }
    function edgePath(edge) {
        const a = state.positions.get(edge.source), b = state.positions.get(edge.target); if (!a || !b) return '';
        if (edge.source === edge.target) return 'M ' + (a.x + 30) + ' ' + (a.y - 48) + ' C ' + (a.x + 150) + ' ' + (a.y - 155) + ' ' + (a.x - 150) + ' ' + (a.y - 155) + ' ' + (a.x - 30) + ' ' + (a.y - 48);
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
        const start = {x: a.x + dx * 90, y: a.y + dy * 43}, end = {x: b.x - dx * 90, y: b.y - dy * 43};
        return 'M ' + start.x + ' ' + start.y + ' Q ' + ((start.x + end.x) / 2 - dy * 26) + ' ' + ((start.y + end.y) / 2 + dx * 26) + ' ' + end.x + ' ' + end.y;
    }
    function renderEdges() {
        const focused = document.activeElement?.getAttribute?.('data-record-edge'); svg.replaceChildren(); accessibleEdges.replaceChildren();
        const defs = svgElement('defs'), marker = svgElement('marker', {id: 'record-map-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto'});
        marker.append(svgElement('path', {d: 'M 0 1 L 9 5 L 0 9 Z', fill: 'var(--g-muted)'})); defs.append(marker); svg.append(defs);
        for (const edge of visibleRecordGraph(state).edges) {
            const selected = state.selection?.kind === 'edge' && state.selection.id === edge.id;
            svg.append(svgElement('path', {class: 'record-map-edge', d: edgePath(edge), 'data-selected': String(selected), 'marker-end': 'url(#record-map-arrow)'}));
            const hit = svgElement('path', {class: 'record-map-edge-hit', d: edgePath(edge), tabindex: '0', role: 'button', 'data-record-edge': edge.id,
                'aria-label': text('selectConnection', {name: edge.constraint || edge.id}), 'aria-pressed': String(selected)});
            hit.addEventListener('pointerdown', event => event.stopPropagation()); hit.addEventListener('click', () => chooseEdge(edge));
            hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseEdge(edge); } });
            svg.append(hit); accessibleEdges.append(smallButton(text('selectConnection', {name: edge.constraint || edge.id}), () => chooseEdge(edge)));
        }
        if (focused) [...svg.querySelectorAll('[data-record-edge]')].find(node => node.dataset.recordEdge === focused)?.focus({preventScroll: true});
    }
    function renderGraph() {
        if (!active()) return;
        const focused = document.activeElement?.getAttribute?.('data-record-node'); recordMapPositions(state, state.focusId || '');
        const graph = visibleRecordGraph(state), ids = new Set(graph.nodes.map(node => node.id));
        for (const [id, node] of nodeElements) if (!ids.has(id)) { node.remove(); nodeElements.delete(id); }
        accessibleNodes.replaceChildren();
        for (const node of graph.nodes) {
            let card = nodeElements.get(node.id);
            if (!card) { card = el('article', {class: 'record-map-node', 'data-node-id': node.id}); nodeElements.set(node.id, card); nodesRoot.append(card); }
            const p = state.positions.get(node.id), selected = state.selectedNodes.has(node.id), count = state.details.get(node.id)?.relations?.length;
            card.style.left = p.x - 102 + 'px'; card.style.top = p.y - 56 + 'px'; card.style.setProperty('--map-color', graphColour(node.table));
            card.dataset.selected = String(selected); card.dataset.pinned = String(state.pinned.has(node.id)); card.dataset.root = String(state.focusId === node.id);
            const face = el('button', {type: 'button', class: 'record-map-node-face', 'data-record-node': node.id, 'data-node-table': node.table,
                'aria-label': text('selectRecord', {label: node.label}), 'aria-pressed': String(selected), title: node.label + ' · ' + node.table,
                on: {click: event => { if (!suppressClick || event.detail === 0) chooseNode(node, event.shiftKey); }, keydown: event => moveWithKey(event, node)}},
                el('span', {class: 'record-map-node-type'}, friendlyName(node.table), state.pinned.has(node.id) ? ' · ' + text('pinState') : ''),
                el('strong', {class: 'record-map-node-label'}, node.label), el('span', {class: 'record-map-node-footer'},
                    state.focusId === node.id ? text('currentFocus') : count === undefined ? text('inspectToExplore') : text('connectionTypes', {count: number(count)})));
            card.replaceChildren(face, smallButton('+', () => { chooseNode(node); openQuestions(); }, {className: 'record-map-card-expand', 'aria-label': text('expandRecord', {label: node.label})}));
            accessibleNodes.append(el('div', {class: 'record-map-record-actions'},
                smallButton(node.label + ' · ' + friendlyName(node.table), () => chooseNode(node), {'data-map-node-button': node.id, 'aria-pressed': String(selected)}),
                smallButton(t('app.recordWindow.openRecord', {label: node.label}), () => openWindow(node), {'data-explorer-window': node.id, symbol: 'external'})));
        }
        renderEdges(); renderMinimap(); renderTrail();
        canvasEmpty.hidden = graph.nodes.length > 0; canvasEmpty.replaceChildren(el('strong', {}, text(state.nodes.size ? 'allHidden' : 'chooseRecord')),
            smallButton(text(state.nodes.size ? 'showLoaded' : 'sources'), () => state.nodes.size ? showLoaded() : openSources(), {kind: 'primary'}));
        summary.replaceChildren(el('strong', {}, text('counts', {nodes: number(graph.nodes.length), edges: number(graph.edges.length)})), el('span', {}, text('visible', {visible: number(graph.nodes.length), total: number(state.nodes.size)})));
        updateSelectionBar(); transform();
        if (focused) [...nodesRoot.querySelectorAll('[data-record-node]')].find(node => node.dataset.recordNode === focused)?.focus({preventScroll: true});
    }
    function renderMinimap() {
        minimapSvg.replaceChildren(); const graph = visibleRecordGraph(state); if (!graph.nodes.length) return;
        const points = graph.nodes.map(node => state.positions.get(node.id)), left = Math.min(...points.map(p => p.x)) - 120, right = Math.max(...points.map(p => p.x)) + 120,
            top = Math.min(...points.map(p => p.y)) - 70, bottom = Math.max(...points.map(p => p.y)) + 70;
        const x = value => 8 + (value - left) / (right - left) * 114, y = value => 7 + (value - top) / (bottom - top) * 61;
        for (const edge of graph.edges) { const a = state.positions.get(edge.source), b = state.positions.get(edge.target); minimapSvg.append(svgElement('line', {x1: x(a.x), y1: y(a.y), x2: x(b.x), y2: y(b.y)})); }
        for (const node of graph.nodes) { const p = state.positions.get(node.id); minimapSvg.append(svgElement('rect', {x: x(p.x) - 4, y: y(p.y) - 2.5, width: 8, height: 5, rx: 1, 'data-selected': String(state.selectedNodes.has(node.id))})); }
    }
    function moveWithKey(event, node) {
        const delta = {ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20]}[event.key];
        if (!delta || mode === 'pan') return;
        event.preventDefault(); layoutVersion++; recordMapCheckpoint(state); const p = state.positions.get(node.id), zoom = camera().zoom;
        moveRecordMapNode(state, node.id, {x: p.x + delta[0] / zoom, y: p.y + delta[1] / zoom}); renderGraph();
    }
    function valuesList(values) {
        return el('dl', {class: 'record-map-values'}, Object.entries(values || {}).map(([name, value]) =>
            el('div', {}, el('dt', {}, name), el('dd', {}, shown(value)))));
    }
    function renderInspector() {
        const focusedRelation = document.activeElement?.dataset?.recordRelation;
        inspectorBody.replaceChildren();
        if (selectionError) showError(selectionError, inspectorBody);
        if (inspecting === 'pending') {
            inspectorBody.append(el('h3', {}, text('inspector')), el('p', {class: 'record-map-side-help'}, text('loadingConnections')));
            return;
        }
        const selection = state.selection;
        if (!selection) {
            inspectorBody.append(el('h3', {}, text('inspector')), el('p', {class: 'record-map-side-help'}, text('selectHelp')));
            return;
        }
        if (selection.kind === 'node') {
            const node = state.nodes.get(selection.id);
            if (!node) return;
            inspectorBody.append(el('div', {class: 'record-map-inspector-heading'},
                el('span', {class: 'record-map-tag'}, node.table), el('h3', {}, node.label)),

            el('div', {class: 'record-map-actions'}, smallButton(text('exploreFrom'), () => exploreFrom(node), {'data-map-follow': node.id, kind: 'primary'}),
                onOpenTable ? button(text('openTable'), () => openTable(node), {'data-map-open-table': node.table, symbol: 'table', className: 'button-small'}) : null,
                smallButton(t('app.recordWindow.open'), () => openWindow(node), {id: 'explorer-open-window', symbol: 'external', disabled: Boolean(inspecting)}),
                companion ? smallButton(t('app.companionLaunch.pin'), () => pinComparison(node), {id: 'explorer-companion-pin', symbol: 'pin', disabled: Boolean(inspecting)}) : null,
                button(text('refreshRecord'), () => refreshNode(node), {symbol: 'refresh', className: 'button-small', disabled: Boolean(inspecting)})));
            if (inspecting === node.id) inspectorBody.append(el('p', {class: 'record-map-side-help'}, text('loadingConnections')));
            const relations = state.details.get(node.id)?.relations || [];
            const list = el('section', {class: 'record-map-relations'}, el('h3', {}, text('connections')));
            if (!relations.length && !inspecting) list.append(el('p', {class: 'record-map-side-help'}, text('noConnections')));
            for (const relation of relations) {
                const key = relationKey(node, relation);
                const cursor = state.cursors.get(key);
                const pending = pendingRelations.has(key);
                const unavailable = relation.external || relation.supported === false;
                const complete = cursor && cursor.has_more !== true, cached = loadedRelation(node, relation);
                const target = relation.direction === 'incoming' ? relation.source_table : relation.target_table;
                const entry = el('div', {class: 'record-map-relation', 'data-map-relation-entry': relation.id},
                    el('div', {class: 'record-map-relation-title'},
                        el('small', {}, text(relation.direction === 'incoming' ? 'incoming' : 'outgoing')),
                        el('strong', {}, friendlyName(target || relation.constraint)), el('small', {class: 'record-map-key', hidden: true}, relation.constraint || relation.id)),
                    el('div', {class: 'record-map-relation-actions'}, button(text(pending ? 'loadingConnections' : complete ? (cached.hidden ? 'showCached' : 'expanded') : cursor ? 'more' : 'expand'),
                        () => expand(node, relation), {'data-record-relation': relation.id, 'data-relation-direction': relation.direction,
                            'data-relation-table': target, disabled: unavailable || pending || (complete && !cached.hidden), className: 'button-small', symbol: 'network'})));
                if (unavailable) entry.append(el('p', {}, text(relation.external ? 'external' : 'unavailableRelation')));
                else if (cursor) entry.append(el('p', {}, text(cursor.has_more ? 'moreAvailable' : 'complete')));
                if (relationErrors.has(key)) showError(relationErrors.get(key), entry, () => expand(node, relation));
                list.append(entry);
            }
            inspectorBody.append(list, el('details', {class: 'record-map-technical', 'data-map-technical': ''}, el('summary', {}, text('technical')),
                el('h4', {}, text('chooseTable')), el('code', {}, node.table), el('h4', {}, text('key')), valuesList(node.key),
                el('h4', {}, text('values')), valuesList(node.row),
                node.truncated ? el('p', {class: 'record-map-side-help'}, text('preview')) : null));
        } else {
            const edge = state.edges.get(selection.id);
            if (!edge) return;
            const source = state.nodes.get(edge.source), target = state.nodes.get(edge.target);
            inspectorBody.append(el('div', {class: 'record-map-inspector-heading'},
                el('span', {class: 'record-map-tag'}, text('declared')), el('h3', {}, text('relationship'))),
                el('p', {class: 'record-map-side-help'}, text('explanation')),
                valuesList({[text('source')]: source?.label || edge.source_table, [text('target')]: target?.label || edge.target_table}));
            const pairs = el('section', {class: 'record-map-evidence'}, el('h4', {}, text('sourceValues')));
            const columns = edge.evidence?.column_pairs || (edge.source_columns || []).map((name, index) =>
                ({source: name, target: edge.target_columns?.[index]}));
            for (const pair of columns) {
                pairs.append(el('div', {class: 'record-map-source-pair'},
                    el('code', {}, edge.source_table + '.' + pair.source + ' → ' + edge.target_table + '.' + pair.target),
                    el('span', {}, shown(edge.source_values?.[pair.source] ?? source?.row?.[pair.source]) + ' → ' + shown(edge.target_values?.[pair.target] ?? target?.row?.[pair.target]))));
            }
            const actions = el('div', {class: 'record-map-actions'});
            if (source) actions.append(button(source.label, () => chooseNode(source), {className: 'button-small', 'data-map-edge-source': source.id}));
            if (target && target.id !== source?.id) actions.append(button(target.label, () => chooseNode(target), {className: 'button-small', 'data-map-edge-target': target.id}));
            const technical = el('details', {class: 'record-map-technical', 'data-map-sql': '', 'data-map-technical': ''},
                el('summary', {}, text('technical')), el('h4', {}, text('constraint')), el('code', {}, edge.constraint), pairs);
            if (edge.evidence?.sql) technical.append(el('h4', {}, text('evidence')), el('pre', {}, el('code', {}, edge.evidence.sql)),
                    el('p', {class: 'small muted'}, text('params')),
                    el('pre', {}, el('code', {}, JSON.stringify(edge.evidence.params || {}, null, 2))));
            inspectorBody.append(actions, technical);
        }
        if (focusedRelation) [...inspectorBody.querySelectorAll('[data-record-relation]')]
            .find(item => item.dataset.recordRelation === focusedRelation)?.focus({preventScroll: true});
    }

    function cancelGraphRequests() {
        epoch++; selectionVersion++; layoutVersion++;
        for (const pending of controllers) {
            if (pending !== seedController) { pending.abort(); controllers.delete(pending); }
        }
        pendingRelations.clear(); relationErrors.clear();
    }
    function refreshNode(node) {
        cancelGraphRequests();
        invalidateRecordMapNode(state, node.id);
        selectRecord(node, {setFocus: false});
    }
    function clear() {
        cancelGraphRequests();
        inspecting = ''; selectionError = null;
        clearRecordMap(state); state.trail = []; onSelectRecord?.(null); setPanel('inspector', false); setPanel('sources', true);
        renderSeeds(); renderFilters(); renderGraph(); renderInspector();
        announce(text('chooseRecord'));
    }

    function panel(name, id, title, content) {
        const node = el('aside', {id, class: 'record-map-panel record-map-' + name, 'aria-label': title, hidden: !state.panels[name].open},
            el('header', {class: 'record-map-panel-head', 'data-map-panel-handle': name}, el('strong', {}, el('button', {type: 'button', class: 'record-map-panel-grip', 'data-map-panel-move': name, 'aria-label': text('movePanel', {name: title}), on: {keydown: event => movePanelWithKey(event, name)}}, icon('grip')), title),
                smallButton('×', () => setPanel(name, false), {id: 'record-map-' + name + '-close',
                    'aria-label': text(name === 'sources' ? 'closeSources' : 'closeInspector'), kind: 'ghost'})), content);
        for (const key of ['left', 'top', 'width']) if (Number.isFinite(state.panels[name][key])) node.style[key] = state.panels[name][key] + 'px';
        if (Number.isFinite(state.panels[name].left)) node.style.right = 'auto';
        return node;
    }
    function movePanelWithKey(event, name) {
        const delta = {ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20]}[event.key];
        if (!delta || dimensions().width < 600) return; event.preventDefault();
        const node = name === 'sources' ? picker : inspector, size = dimensions();
        if (event.shiftKey && delta[0]) { const width = clamp(node.offsetWidth + delta[0], 210, Math.min(360, size.width - 32)); node.style.width = width + 'px'; state.panels[name].width = width; }
        else { const left = clamp(node.offsetLeft + delta[0], 8, Math.max(8, size.width - node.offsetWidth - 8)), top = clamp(node.offsetTop + delta[1], 76, Math.max(76, size.height - node.offsetHeight - 94));
            node.style.left = left + 'px'; node.style.top = top + 'px'; node.style.right = 'auto'; Object.assign(state.panels[name], {left, top}); }
    }
    function syncPanelLayout(size = dimensions()) {
        shell.dataset.narrow = String(size.width < 600);
        shell.dataset.constrained = String(size.width < 1000);
        if (size.width < 900 && !picker.hidden && !inspector.hidden) {
            const keep = picker.contains(document.activeElement) ? 'sources'
                : inspector.contains(document.activeElement) ? 'inspector' : lastOpenPanel;
            setPanel(keep === 'sources' ? 'inspector' : 'sources', false);
        }
        updateSelectionBar();
    }
    function setPanel(name, open) {
        const node = name === 'sources' ? picker : inspector;
        if (open) lastOpenPanel = name;
        state.panels[name].open = open; node.hidden = !open;
        if (open && dimensions().width < 900) {
            const other = name === 'sources' ? 'inspector' : 'sources';
            state.panels[other].open = false; (other === 'sources' ? picker : inspector).hidden = true;
        }
        sourcesToggle.setAttribute('aria-expanded', String(!picker.hidden)); updateSelectionBar();
        if (open) revealSelection();
    }
    function openSources() { setPanel('sources', true); }
    function toggleSources() { setPanel('sources', picker.hidden); }
    function closePanels() {
        state.panels.sources.open = state.panels.inspector.open = false; picker.hidden = inspector.hidden = true;
        sourcesToggle.setAttribute('aria-expanded', 'false'); questions.open = filters.open = false; updateSelectionBar();
    }
    function setMode(value) {
        mode = value; shell.dataset.mode = mode;
        selectButton.setAttribute('aria-pressed', String(mode === 'select')); panButton.setAttribute('aria-pressed', String(mode === 'pan'));
    }
    function undo() {
        if (!undoRecordMap(state)) return;
        layoutVersion++; const selected = selectedRecordMapNodes(state);
        onSelectRecord?.(selected.length === 1 ? selected[0] : null);
        state.trail = state.trail.filter(id => state.nodes.has(id) && !state.hiddenNodes.has(id));
        renderAll(); announce(text('undone'));
    }
    function pinSelected() {
        const selected = selectedRecordMapNodes(state); if (!selected.length) return;
        layoutVersion++; recordMapCheckpoint(state); const pinned = !selected.every(node => state.pinned.has(node.id));
        setRecordMapPinned(state, selected.map(node => node.id), pinned); renderAll(); announce(text(pinned ? 'pinned' : 'unpinned'));
    }
    function hideSelected() {
        const selected = selectedRecordMapNodes(state); if (!selected.length) return;
        cancelGraphRequests(); recordMapCheckpoint(state); hideRecordMapNodes(state, selected.map(node => node.id));
        onSelectRecord?.(null); setPanel('inspector', false); renderAll(); announce(text('hidden'));
    }
    function inspectSelected() {
        const node = selectedRecordMapNodes(state)[0]; if (!node) return;
        renderInspector(); setPanel('inspector', true);
        if (!state.details.has(node.id)) selectRecord(node, {setFocus: false, invalidate: false});
    }
    function openQuestions() { questions.open = true; renderQuestions(); questionList.querySelector('button:not(:disabled)')?.focus(); }
    function setFocus(node) {
        state.focusId = node.id;
        if (state.trail.at(-1) !== node.id) state.trail.push(node.id);
        if (state.trail.length > 30) state.trail.shift();
    }
    function exploreFrom(node) {
        setFocus(node); selectRecordMapNode(state, node.id); onSelectRecord?.(node);
        if (state.table !== node.table) {
            state.table = node.table; state.search = ''; state.page = 1; state.seedResult = null;
            tableSelect.value = node.table; search.value = ''; onTableChange?.(node.table); loadSeeds();
        }
        closePanels(); renderAll(); const p = state.positions.get(node.id), box = canvasBox(), view = camera();
        if (p) { state.viewport = {...view, x: (box.left + box.right) / 2 - p.x * view.zoom, y: (box.top + box.bottom) / 2 - p.y * view.zoom}; transform(); }
        if (!state.details.has(node.id)) selectRecord(node, {setFocus: false, reveal: false, invalidate: false});
    }
    function loadedRelation(node, relation) {
        const edges = [...(state.expansions.get(relationKey(node, relation)) || [])].map(id => state.edges.get(id)).filter(Boolean);
        const ids = [...new Set(edges.flatMap(edge => [edge.source, edge.target]).filter(id => id !== node.id))];
        return {edges, ids, hidden: ids.some(id => state.hiddenNodes.has(id) || state.hiddenTables.has(state.nodes.get(id)?.table))
            || edges.some(edge => state.hiddenEdges?.has(edge.id))};
    }
    function showCached(node, relation) {
        const loaded = loadedRelation(node, relation); if (!loaded.hidden) return;
        recordMapCheckpoint(state); showRecordMapNodes(state, loaded.ids);
        for (const edge of loaded.edges) state.hiddenEdges?.delete(edge.id); renderAll();
    }
    function showLoaded() {
        recordMapCheckpoint(state); state.hiddenTables.clear(); showRecordMapNodes(state, [...state.nodes.keys()]);
        state.hiddenEdges?.clear(); renderAll(); questions.open = false; fit();
    }
    function renderQuestions() {
        questionList.replaceChildren(smallButton(text('showLoaded'), showLoaded, {'data-guide-all': ''}));
        const node = selectedRecordMapNodes(state)[0] || state.nodes.get(state.focusId);
        if (!node) { questionList.append(el('p', {class: 'record-map-side-help'}, text('chooseRecord'))); return; }
        questionList.append(el('p', {class: 'record-map-question-context'}, node.label));
        if (!state.details.has(node.id)) { questionList.append(smallButton(text('readConnections'), () => selectRecord(node, {setFocus: false, invalidate: false}), {'data-map-question': 'read'})); return; }
        for (const relation of state.details.get(node.id).relations || []) {
            const target = relation.direction === 'incoming' ? relation.source_table : relation.target_table;
            const cursor = state.cursors.get(relationKey(node, relation)), complete = cursor && !cursor.has_more;
            questionList.append(smallButton(text('showLinked', {table: friendlyName(target)}), () => { questions.open = false; expand(node, relation); },
                {'data-map-question': relation.id, 'data-guide-group': target,
                    disabled: relation.external || relation.supported === false || pendingRelations.has(relationKey(node, relation)) || (complete && !loadedRelation(node, relation).hidden)}));
        }
    }
    function updateSelectionBar() {
        const selected = selectedRecordMapNodes(state);
        shell.dataset.panelOpen = String(!picker.hidden || !inspector.hidden);
        selectionBar.hidden = !selected.length || (dimensions().width < 600 && (!picker.hidden || !inspector.hidden));
        selectedName.textContent = selected.length === 1 ? selected[0].label : text('multiSelected', {count: number(selected.length)});
        pinButton.textContent = text(selected.length && selected.every(node => state.pinned.has(node.id)) ? 'unpin' : 'pin');
        shell.querySelector('#record-map-expand-selected').disabled = selected.length !== 1;
        undoButton.disabled = !state.undoStack?.length; layout.value = state.layout || 'manual'; shell.dataset.layout = state.layout || 'manual';
    }
    function renderTrail() {
        trail.replaceChildren();
        for (const [index, id] of state.trail.entries()) {
            const node = state.nodes.get(id); if (!node) continue;
            if (trail.childElementCount) trail.append(el('span', {'aria-hidden': 'true'}, '›'));
            trail.append(el('button', {type: 'button', on: {click: () => { state.trail = state.trail.slice(0, index + 1); exploreFrom(node); }}}, node.label));
        }
    }
    function renderAll() { renderFilters(); renderGraph(); renderInspector(); renderQuestions(); seedSelection(); }
    function animatePositions(before) {
        const version = ++layoutVersion, targets = new Map([...state.positions].map(([id, point]) => [id, {...point}]));
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const begin = performance.now();
        function frame(now) {
            if (!active() || version !== layoutVersion) return;
            const progress = clamp((now - begin) / 320, 0, 1), eased = 1 - Math.pow(1 - progress, 3);
            for (const [id, end] of targets) {
                const start = before.get(id) || end, p = {x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased};
                state.positions.set(id, p); const element = nodeElements.get(id);
                if (element) { element.style.left = p.x - 102 + 'px'; element.style.top = p.y - 56 + 'px'; }
            }
            renderEdges(); renderMinimap();
            if (progress < 1) requestAnimationFrame(frame);
            else { for (const [id, point] of targets) state.positions.set(id, point); renderGraph(); }
        }
        requestAnimationFrame(frame);
    }
    const onWheel = event => { if (!active()) return; event.preventDefault(); const box = viewport.getBoundingClientRect(); zoomBy(Math.exp(clamp(-event.deltaY * .0015, -.25, .25)), {x: event.clientX - box.left, y: event.clientY - box.top}); };
    const onPointerDown = event => {
        if (!active() || event.button !== 0 || event.target.closest('[data-record-edge],.record-map-card-expand')) return;
        layoutVersion++; const nodeId = mode === 'select' ? event.target.closest('[data-record-node]')?.dataset.recordNode : null;
        const p = nodeId ? state.positions.get(nodeId) : camera(); if (!p) return;
        pointer = {id: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY, x: p.x, y: p.y,
            zoom: camera().zoom, moved: false, checkpointed: false}; viewport.setPointerCapture(event.pointerId);
    };
    const onPointerMove = event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
        if (!pointer.moved && Math.hypot(dx, dy) < 4) return;
        pointer.moved = true; viewport.classList.add('is-dragging');
        if (pointer.nodeId) {
            if (!pointer.checkpointed) { recordMapCheckpoint(state); pointer.checkpointed = true; }
            moveRecordMapNode(state, pointer.nodeId, {x: pointer.x + dx / pointer.zoom, y: pointer.y + dy / pointer.zoom});
            const card = nodeElements.get(pointer.nodeId), p = state.positions.get(pointer.nodeId);
            if (card) { card.style.left = p.x - 102 + 'px'; card.style.top = p.y - 56 + 'px'; }
            layout.value = state.layout; shell.dataset.layout = state.layout; undoButton.disabled = !state.undoStack.length; renderEdges(); renderMinimap();
        } else { state.viewport = {x: pointer.x + dx, y: pointer.y + dy, zoom: pointer.zoom}; transform(); }
    };
    const onPointerUp = event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const previous = pointer; pointer = null; suppressClick = true;
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        viewport.classList.remove('is-dragging');
        if (event.type !== 'pointercancel' && previous.nodeId && !previous.moved) { const node = state.nodes.get(previous.nodeId); if (node) chooseNode(node, event.shiftKey); }
        setTimeout(() => { suppressClick = false; }, 120);
    };
    const onKey = event => {
        if (event.key === 'Escape') { closePanels(); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input,textarea,select')) { event.preventDefault(); undo(); return; }
        if (event.target !== viewport) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); }
        else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.2); }
        else if (event.key.startsWith('Arrow')) { event.preventDefault(); const view = camera(); state.viewport = {...view,
            x: view.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: view.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0)}; transform(); }
    };
    const panelCleanups = [];
    for (const name of ['sources', 'inspector']) {
        const node = name === 'sources' ? picker : inspector, handle = node.querySelector('[data-map-panel-handle]');
        const down = event => {
            if (event.target.closest('button:not([data-map-panel-move])') || dimensions().width < 600 || event.button !== 0) return;
            const start = {x: event.clientX, y: event.clientY, left: node.offsetLeft, top: node.offsetTop}; handle.setPointerCapture(event.pointerId);
            const move = next => { const size = dimensions(), left = clamp(start.left + next.clientX - start.x, 8, Math.max(8, size.width - node.offsetWidth - 8)),
                top = clamp(start.top + next.clientY - start.y, 76, Math.max(76, size.height - node.offsetHeight - 94));
                node.style.left = left + 'px'; node.style.top = top + 'px'; node.style.right = 'auto'; Object.assign(state.panels[name], {left, top}); };
            const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
            handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up); event.preventDefault();
        };
        handle.addEventListener('pointerdown', down); panelCleanups.push(() => handle.removeEventListener('pointerdown', down));
        const resize = new ResizeObserver(() => { if (active() && dimensions().width >= 600 && !node.hidden) state.panels[name].width = node.offsetWidth; }); resize.observe(node); panelCleanups.push(() => resize.disconnect());
    }
    tableSelect.addEventListener('change', () => { state.table = tableSelect.value; state.search = ''; state.page = 1; state.seedResult = null; search.value = ''; onTableChange?.(state.table); loadSeeds(); });
    search.addEventListener('input', () => { state.search = search.value; state.page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(loadSeeds, 180); });
    layout.addEventListener('change', () => { const before = new Map([...state.positions].map(([id, p]) => [id, {...p}])); recordMapCheckpoint(state); arrangeRecordMap(state, layout.value, state.focusId); renderGraph(); fit(); focusMobile(); animatePositions(before); announce(text('arranged')); });
    viewport.addEventListener('pointerdown', onPointerDown); viewport.addEventListener('pointermove', onPointerMove); viewport.addEventListener('pointerup', onPointerUp); viewport.addEventListener('pointercancel', onPointerUp); viewport.addEventListener('wheel', onWheel, {passive: false}); shell.addEventListener('keydown', onKey);
    let previousSize = '';
    const observer = new ResizeObserver(() => { if (!active()) return; const size = dimensions(), key = size.width + 'x' + size.height; if (key === previousSize) return; previousSize = key;
        syncPanelLayout(size);
        if (state.nodes.size) { fit(); if (size.width < 600 && camera().zoom < .65) { const p = state.positions.get(state.focusId); if (p) { const box = canvasBox(); state.viewport = {x: (box.left + box.right) / 2 - p.x * .65, y: (box.top + box.bottom) / 2 - p.y * .65, zoom: .65}; transform(); } } }
    }); observer.observe(viewport);
    function destroy() {
        if (destroyed) return; destroyed = true; epoch++; layoutVersion++; clearTimeout(searchTimer);
        for (const pending of controllers) pending.abort(); controllers.clear(); observer.disconnect(); panelCleanups.forEach(cleanup => cleanup()); signal?.removeEventListener('abort', destroy);
        viewport.removeEventListener('pointerdown', onPointerDown); viewport.removeEventListener('pointermove', onPointerMove); viewport.removeEventListener('pointerup', onPointerUp); viewport.removeEventListener('pointercancel', onPointerUp); viewport.removeEventListener('wheel', onWheel); shell.removeEventListener('keydown', onKey);
    }
    signal?.addEventListener('abort', destroy, {once: true});
    if (!available.length) seedList.append(notice(text('noTablesHelp')));
    syncPanelLayout();
    renderAll();
    const restoredSelection = selectedRecordMapNodes(state);
    onSelectRecord?.(restoredSelection.length === 1 ? restoredSelection[0] : null);
    if (state.seedResult) renderSeeds(); else if (available.length) loadSeeds();
    return {destroy, selectRecord, openSources, toggleSources, closePanels};
}
