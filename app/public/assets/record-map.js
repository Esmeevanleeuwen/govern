import {request} from './api.js';
import {el, button, notice, errorText, number} from './ui.js';
import {t} from './i18n.js';
import {ensureRecordMapState, mergeRecordGraph, visibleRecordGraph, selectRecordMapItem,
    recordMapPositions, clearRecordMap, normalizeRecordNode, sameRecordKey, invalidateRecordMapNode} from './record-map-model.js';
import './record-map-messages.js';

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
    onOpenTable, onSelectRecord, onTableChange, signal, live = () => true} = {}) {
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
    const relationErrors = new Map();
    const active = () => !destroyed && !signal?.aborted && live();
    const relationKey = (node, relation) => JSON.stringify([node.id, relation.id]);
    const controller = () => { const value = new AbortController(); controllers.add(value); return value; };

    const summary = el('p', {class: 'record-map-summary'});
    const filterList = el('div', {class: 'record-map-filters', role: 'group', 'aria-label': text('filter')});
    const status = el('p', {class: 'record-map-status', role: 'status', 'aria-live': 'polite'});
    const picker = el('section', {class: 'record-map-picker', 'aria-label': text('records')});
    const tableSelect = el('select', {id: 'record-map-table', class: 'input select', 'aria-label': text('chooseTable')},
        available.map(table => el('option', {value: table.name, selected: table.name === state.table}, table.name)));
    const search = el('input', {id: 'record-map-search', class: 'input', type: 'search', value: state.search,
        placeholder: text('searchPlaceholder'), 'aria-label': text('search'), autocomplete: 'off'});
    const seedList = el('div', {id: 'record-map-records', class: 'record-map-record-list', 'aria-live': 'polite'});
    const seedPagination = el('div', {class: 'record-map-pagination'});
    picker.append(el('h3', {}, text('records')), el('div', {class: 'record-map-form'},
        el('label', {for: 'record-map-table'}, text('chooseTable'), tableSelect),
        el('label', {for: 'record-map-search'}, text('search'), search)), seedList, seedPagination);

    const zoomValue = el('output', {'aria-label': text('map')});
    const viewport = el('div', {class: 'record-map-viewport', tabindex: '0', 'aria-label': text('map'),
        'aria-describedby': 'record-map-help'});
    const svg = svgElement('svg', {class: 'record-map-svg', role: 'group', 'aria-label': text('map')});
    svg.append(svgElement('title', {}, text('map')));
    const world = svgElement('g', {class: 'record-map-world'});
    svg.append(world);
    const canvasEmpty = el('div', {class: 'record-map-empty'}, el('strong', {}, text('chooseRecord')));
    viewport.append(svg, canvasEmpty);
    const accessibleNodes = el('div', {id: 'record-map-node-list'});
    const accessible = el('details', {class: 'record-map-accessible-list'},
        el('summary', {}, text('recordList')), accessibleNodes);
    const inspector = el('aside', {id: 'record-map-inspector', class: 'record-map-inspector',
        'aria-label': text('inspector')});
    const board = el('section', {class: 'record-map-board', 'aria-label': text('map')},
        el('div', {class: 'record-map-controls'},
            button('−', () => zoomBy(1 / 1.2), {id: 'record-map-zoom-out', 'aria-label': text('zoomOut'), className: 'button-small'}),
            zoomValue,
            button('+', () => zoomBy(1.2), {id: 'record-map-zoom-in', 'aria-label': text('zoomIn'), className: 'button-small'}),
            button(text('fit'), fit, {id: 'record-map-fit', symbol: 'expand', className: 'button-small'}),
            button(text('clear'), clear, {id: 'record-map-clear', className: 'button-small'})),
        viewport, el('p', {id: 'record-map-help', class: 'record-map-help'}, text('help')),
        el('p', {class: 'sr-only'}, text('keyboardHelp')), accessible, status);
    const shell = el('section', {class: 'record-map'},
        el('div', {class: 'record-map-toolbar'},
            el('div', {}, summary, el('p', {class: 'record-map-side-help'}, text('partial'))), filterList),
        el('div', {class: 'record-map-layout'}, picker, board, inspector));
    root.append(shell);
    if (!available.length) {
        tableSelect.disabled = search.disabled = true;
        seedList.append(el('div', {class: 'record-map-empty'}, el('strong', {}, text('noTables')), el('p', {}, text('noTablesHelp'))));
    }

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
        if (!nodes.length) seedList.append(el('div', {class: 'record-map-empty'},
            el('strong', {}, text('noRecords')), el('p', {}, text('noRecordsHelp'))));
        for (const node of nodes) {
            seedList.append(el('button', {type: 'button', class: 'record-map-record',
                'data-map-record': node.id, 'aria-label': text('selectRecord', {label: node.label}),
                on: {click: () => selectRecord(node)}}, el('strong', {}, node.label),
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

    async function selectRecord(record) {
        if (!active() || !record || typeof record.table !== 'string' || !record.key) return null;
        const version = ++selectionVersion;
        const capturedEpoch = epoch;
        const pending = controller();
        selectionError = null;
        const existing = [...state.nodes.values()].find(node => node.table === record.table && sameRecordKey(node.key, record.key));
        if (existing) {
            selectRecordMapItem(state, 'node', existing.id); state.hiddenTables.delete(existing.table);
            onSelectRecord?.(existing);
        }
        inspecting = existing?.id || 'pending'; renderGraph(); renderInspector(); seedSelection();
        try {
            const data = await request('record-map', {params: {database: scopeKey},
                body: {table: record.table, key: record.key}, signal: pending.signal});
            if (!active() || pending.signal.aborted || capturedEpoch !== epoch || version !== selectionVersion) return null;
            const {focus} = mergeRecordGraph(state, data);
            if (!focus) throw new Error(text('sourceUnavailable'));
            selectRecordMapItem(state, 'node', focus.id); state.hiddenTables.delete(focus.table);
            inspecting = ''; recordMapPositions(state, focus.id);
            onSelectRecord?.(focus);
            renderFilters(); renderGraph(); renderInspector(); seedSelection();
            if (!state.viewport) fit();
            announce(text('selected', {label: focus.label}));
            return focus;
        } catch (error) {
            if (!active() || error.name === 'AbortError' || version !== selectionVersion || capturedEpoch !== epoch) return null;
            inspecting = ''; selectionError = error; renderInspector();
            return null;
        } finally { controllers.delete(pending); }
    }

    function chooseNode(node) {
        if (!active()) return;
        selectionVersion++;
        inspecting = ''; selectionError = null;
        selectRecordMapItem(state, 'node', node.id);
        onSelectRecord?.(node);
        renderGraph(); renderInspector(); seedSelection();
        announce(text('selected', {label: node.label}));
        if (!state.details.has(node.id)) selectRecord(node);
    }

    async function expand(node, relation) {
        const id = relationKey(node, relation);
        if (!active() || pendingRelations.has(id) || relation.external || relation.supported === false) return;
        const cursor = state.cursors.get(id);
        if (cursor && cursor.has_more !== true) return;
        const capturedEpoch = epoch;
        const pending = controller();
        pendingRelations.add(id); relationErrors.delete(id); renderInspector();
        try {
            const data = await request('record-map', {params: {database: scopeKey}, body: {
                table: node.table, key: node.key, relation: relation.id, offset: cursor?.next_offset || 0, page_size: 25,
            }, signal: pending.signal});
            if (!active() || pending.signal.aborted || capturedEpoch !== epoch) return;
            const {added} = mergeRecordGraph(state, data);
            state.cursors.set(id, {has_more: data.has_more === true, next_offset: data.next_offset,
                count: (cursor?.count || 0) + (data.edges?.length || 0)});
            recordMapPositions(state, node.id);
            renderFilters(); renderGraph(); fit();
            announce(added.length ? text('loaded', {count: number(added.length)})
                : data.edges?.length ? text(data.has_more ? 'moreAvailable' : 'complete') : text('emptyExpansion'));
        } catch (error) {
            if (!active() || error.name === 'AbortError' || capturedEpoch !== epoch) return;
            relationErrors.set(id, error);
        } finally {
            controllers.delete(pending);
            if (active() && capturedEpoch === epoch) {
                pendingRelations.delete(id);
                renderInspector();
                const target = [...inspector.querySelectorAll('[data-record-relation]')].find(item => item.dataset.recordRelation === relation.id);
                if (document.activeElement === document.body) target?.focus({preventScroll: true});
            }
        }
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
                    if (field.checked) state.hiddenTables.delete(name); else state.hiddenTables.add(name);
                    renderGraph();
                }}});
            const label = el('span', {class: 'record-map-type-label'}, name);
            label.style.setProperty('--map-color', graphColour(name));
            filterList.append(el('label', {}, field, label));
        }
        if (selectedTable) [...filterList.querySelectorAll('input')].find(input => input.dataset.mapEntityFilter === selectedTable)?.focus({preventScroll: true});
    }

    function dimensions() {
        const box = viewport.getBoundingClientRect();
        return {width: Math.max(1, box.width || 480), height: Math.max(1, box.height || 440)};
    }
    function camera() {
        const {width, height} = dimensions();
        return state.viewport || {x: width / 2, y: height / 2, zoom: 1};
    }
    function transform() {
        const view = camera();
        world.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.zoom + ')');
        const labelScale = Math.max(1, 1 / view.zoom);
        for (const label of world.querySelectorAll('.record-map-node-label')) label.style.fontSize = 12 * labelScale + 'px';
        for (const label of world.querySelectorAll('.record-map-node-type')) label.style.fontSize = 11 * labelScale + 'px';
        for (const hit of world.querySelectorAll('.record-map-node-hit')) hit.setAttribute('r', Math.max(27, 22 / view.zoom));
        zoomValue.textContent = Math.round(view.zoom * 100) + '%';
    }
    function fit() {
        const nodes = visibleRecordGraph(state).nodes;
        if (!nodes.length) { state.viewport = null; transform(); return; }
        const points = nodes.map(node => state.positions.get(node.id)).filter(Boolean);
        if (!points.length) return;
        const {width, height} = dimensions();
        const left = Math.min(...points.map(point => point.x)) - 100;
        const right = Math.max(...points.map(point => point.x)) + 100;
        const top = Math.min(...points.map(point => point.y)) - 65;
        const bottom = Math.max(...points.map(point => point.y)) + 80;
        const zoom = clamp(Math.min((width - 28) / (right - left), (height - 28) / (bottom - top)), .2, 1.3);
        state.viewport = {x: width / 2 - (left + right) / 2 * zoom,
            y: height / 2 - (top + bottom) / 2 * zoom, zoom};
        transform();
    }
    function zoomBy(factor, anchor) {
        const view = camera();
        const {width, height} = dimensions();
        const point = anchor || {x: width / 2, y: height / 2};
        const zoom = clamp(view.zoom * factor, .2, 2.5);
        const ratio = zoom / view.zoom;
        state.viewport = {x: point.x - (point.x - view.x) * ratio,
            y: point.y - (point.y - view.y) * ratio, zoom};
        transform();
    }
    function edgePath(edge) {
        const from = state.positions.get(edge.source), to = state.positions.get(edge.target);
        if (!from || !to) return '';
        if (edge.source === edge.target) return 'M ' + (from.x + 9) + ' ' + (from.y - 12)
            + ' C ' + (from.x + 84) + ' ' + (from.y - 90) + ' ' + (from.x - 84) + ' ' + (from.y - 90)
            + ' ' + (from.x - 9) + ' ' + (from.y - 12);
        const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
        const middle = {x: (from.x + to.x) / 2 - dy * 24, y: (from.y + to.y) / 2 + dx * 24};
        return 'M ' + (from.x + dx * 18) + ' ' + (from.y + dy * 18)
            + ' Q ' + middle.x + ' ' + middle.y + ' ' + (to.x - dx * 21) + ' ' + (to.y - dy * 21);
    }
    function chooseEdge(edge) {
        selectionVersion++; inspecting = ''; selectionError = null;
        selectRecordMapItem(state, 'edge', edge.id); onSelectRecord?.(null);
        renderGraph(); renderInspector(); seedSelection();
        announce(text('selectConnection', {name: edge.constraint || edge.id}));
    }
    function renderGraph() {
        if (!active()) return;
        const focusedNode = document.activeElement?.getAttribute?.('data-record-node');
        const focusedEdge = document.activeElement?.getAttribute?.('data-record-edge');
        recordMapPositions(state, state.selection?.kind === 'node' ? state.selection.id : '');
        const graph = visibleRecordGraph(state);
        const {width, height} = dimensions();
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svg.setAttribute('aria-label', text('counts', {nodes: number(graph.nodes.length), edges: number(graph.edges.length)}));
        world.replaceChildren(); accessibleNodes.replaceChildren();
        const definitions = svgElement('defs');
        const marker = svgElement('marker', {id: 'record-map-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5',
            markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse'});
        marker.append(svgElement('path', {d: 'M 0 1 L 9 5 L 0 9 Z', fill: 'var(--g-muted)'}));
        definitions.append(marker); world.append(definitions);
        for (const edge of graph.edges) {
            const selected = state.selection?.kind === 'edge' && state.selection.id === edge.id;
            world.append(svgElement('path', {class: 'record-map-edge', d: edgePath(edge),
                'data-edge-id': edge.id, 'data-selected': String(selected), 'marker-end': 'url(#record-map-arrow)'}));
            const hit = svgElement('path', {class: 'record-map-edge-hit', d: edgePath(edge), tabindex: '0', role: 'button',
                'data-record-edge': edge.id, 'aria-label': text('selectConnection', {name: edge.constraint || edge.id}),
                'aria-pressed': String(selected)});
            hit.append(svgElement('title', {}, edge.constraint || edge.id));
            hit.addEventListener('click', () => chooseEdge(edge));
            hit.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseEdge(edge); }
            });
            world.append(hit);
        }
        for (const node of graph.nodes) {
            const point = state.positions.get(node.id);
            const selected = state.selection?.kind === 'node' && state.selection.id === node.id;
            const group = svgElement('g', {class: 'record-map-node', transform: 'translate(' + point.x + ' ' + point.y + ')',
                'data-record-node': node.id, 'data-node-table': node.table, 'data-selected': String(selected),
                role: 'button', tabindex: '0', 'aria-label': text('selectRecord', {label: node.label}), 'aria-pressed': String(selected)});
            group.style.setProperty('--map-color', graphColour(node.table));
            group.append(svgElement('title', {}, node.label + ' · ' + node.table + ' · ' + JSON.stringify(node.key)),
                svgElement('circle', {class: 'record-map-node-hit', r: '27'}), svgElement('circle', {r: selected ? '18' : '14'}),
                svgElement('text', {class: 'record-map-node-label', y: '39'}, short(node.label)),
                svgElement('text', {class: 'record-map-node-type', y: '55'}, short(node.table, 28)));
            group.addEventListener('click', () => { if (!pointer?.moved && !pointer?.handled) chooseNode(node); });
            group.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseNode(node); }
            });
            world.append(group);
            accessibleNodes.append(button(node.label + ' · ' + node.table, () => chooseNode(node),
                {className: 'button-small', 'data-map-node-button': node.id, 'aria-pressed': String(selected)}));
        }
        const selected = state.selection;
        if (selected?.kind === 'edge') {
            const edge = state.edges.get(selected.id);
            if (edge) accessibleNodes.append(button(text('selectConnection', {name: edge.constraint || edge.id}), () => chooseEdge(edge),
                {className: 'button-small', 'aria-pressed': 'true'}));
        }
        canvasEmpty.hidden = graph.nodes.length > 0;
        canvasEmpty.replaceChildren(el('strong', {}, text(state.nodes.size ? 'allHidden' : 'chooseRecord')));
        summary.replaceChildren(el('strong', {}, text('counts', {nodes: number(state.nodes.size), edges: number(state.edges.size)})),
            el('span', {}, ' · ' + text('visible', {visible: number(graph.nodes.length), total: number(state.nodes.size)})));
        transform();
        if (focusedNode) [...world.querySelectorAll('[data-record-node]')].find(item => item.dataset.recordNode === focusedNode)?.focus({preventScroll: true});
        else if (focusedEdge) [...world.querySelectorAll('[data-record-edge]')].find(item => item.dataset.recordEdge === focusedEdge)?.focus({preventScroll: true});
    }

    function valuesList(values) {
        return el('dl', {class: 'record-map-values'}, Object.entries(values || {}).map(([name, value]) =>
            el('div', {}, el('dt', {}, name), el('dd', {}, shown(value)))));
    }
    function renderInspector() {
        const focusedRelation = document.activeElement?.dataset?.recordRelation;
        inspector.replaceChildren();
        if (selectionError) showError(selectionError, inspector);
        if (inspecting === 'pending') {
            inspector.append(el('h3', {}, text('inspector')), el('p', {class: 'record-map-side-help'}, text('loadingConnections')));
            return;
        }
        const selection = state.selection;
        if (!selection) {
            inspector.append(el('h3', {}, text('inspector')), el('p', {class: 'record-map-side-help'}, text('selectHelp')));
            return;
        }
        if (selection.kind === 'node') {
            const node = state.nodes.get(selection.id);
            if (!node) return;
            inspector.append(el('div', {class: 'record-map-inspector-heading'},
                el('span', {class: 'record-map-tag'}, node.table), el('h3', {}, node.label)),
            el('h4', {class: 'small muted'}, text('key')), valuesList(node.key),
            el('div', {class: 'record-map-actions'},
                onOpenTable ? button(text('openTable'), () => openTable(node), {'data-map-open-table': node.table, symbol: 'table', className: 'button-small'}) : null,
                button(text('refreshRecord'), () => refreshNode(node), {symbol: 'refresh', className: 'button-small', disabled: Boolean(inspecting)})));
            if (inspecting === node.id) inspector.append(el('p', {class: 'record-map-side-help'}, text('loadingConnections')));
            const relations = state.details.get(node.id)?.relations || [];
            const list = el('section', {class: 'record-map-relations'}, el('h3', {}, text('connections')));
            if (!relations.length && !inspecting) list.append(el('p', {class: 'record-map-side-help'}, text('noConnections')));
            for (const relation of relations) {
                const key = relationKey(node, relation);
                const cursor = state.cursors.get(key);
                const pending = pendingRelations.has(key);
                const unavailable = relation.external || relation.supported === false;
                const complete = cursor && cursor.has_more !== true;
                const target = relation.direction === 'incoming' ? relation.source_table : relation.target_table;
                const entry = el('div', {class: 'record-map-relation', 'data-map-relation-entry': relation.id},
                    el('div', {class: 'record-map-relation-title'},
                        el('small', {}, text(relation.direction === 'incoming' ? 'incoming' : 'outgoing')),
                        el('strong', {}, target || relation.constraint), el('small', {}, relation.constraint || relation.id)),
                    el('div', {class: 'record-map-relation-actions'}, button(text(pending ? 'loadingConnections' : complete ? 'expanded' : cursor ? 'more' : 'expand'),
                        () => expand(node, relation), {'data-record-relation': relation.id, 'data-relation-direction': relation.direction,
                            'data-relation-table': target, disabled: unavailable || pending || complete, className: 'button-small', symbol: 'network'})));
                if (unavailable) entry.append(el('p', {}, text(relation.external ? 'external' : 'unavailableRelation')));
                else if (cursor) entry.append(el('p', {}, text(cursor.has_more ? 'moreAvailable' : 'complete')));
                if (relationErrors.has(key)) showError(relationErrors.get(key), entry, () => expand(node, relation));
                list.append(entry);
            }
            inspector.append(list, el('section', {class: 'record-map-evidence'},
                el('h4', {}, text('values')), valuesList(node.row),
                node.truncated ? el('p', {class: 'record-map-side-help'}, text('preview')) : null));
        } else {
            const edge = state.edges.get(selection.id);
            if (!edge) return;
            const source = state.nodes.get(edge.source), target = state.nodes.get(edge.target);
            inspector.append(el('div', {class: 'record-map-inspector-heading'},
                el('span', {class: 'record-map-tag'}, text('declared')), el('h3', {}, edge.constraint || text('relationship'))),
                el('p', {class: 'record-map-side-help'}, text('explanation')),
                valuesList({[text('source')]: edge.source_table, [text('target')]: edge.target_table}));
            const pairs = el('section', {class: 'record-map-evidence'}, el('h4', {}, text('sourceValues')));
            const columns = edge.evidence?.column_pairs || (edge.source_columns || []).map((name, index) =>
                ({source: name, target: edge.target_columns?.[index]}));
            for (const pair of columns) {
                pairs.append(el('div', {class: 'record-map-source-pair'},
                    el('code', {}, edge.source_table + '.' + pair.source + ' → ' + edge.target_table + '.' + pair.target),
                    el('span', {}, shown(source?.row?.[pair.source]) + ' → ' + shown(target?.row?.[pair.target]))));
            }
            const actions = el('div', {class: 'record-map-actions'});
            if (source) actions.append(button(source.label, () => chooseNode(source), {className: 'button-small', 'data-map-edge-source': source.id}));
            if (target && target.id !== source?.id) actions.append(button(target.label, () => chooseNode(target), {className: 'button-small', 'data-map-edge-target': target.id}));
            inspector.append(pairs, actions);
            if (edge.evidence?.sql) inspector.append(el('div', {class: 'record-map-evidence'},
                el('details', {'data-map-sql': ''}, el('summary', {}, text('evidence')),
                    el('pre', {}, el('code', {}, edge.evidence.sql)),
                    el('p', {class: 'small muted'}, text('params')),
                    el('pre', {}, el('code', {}, JSON.stringify(edge.evidence.params || {}, null, 2))))));
        }
        if (focusedRelation) [...inspector.querySelectorAll('[data-record-relation]')]
            .find(item => item.dataset.recordRelation === focusedRelation)?.focus({preventScroll: true});
    }

    function cancelGraphRequests() {
        epoch++; selectionVersion++;
        for (const pending of controllers) {
            if (pending !== seedController) { pending.abort(); controllers.delete(pending); }
        }
        pendingRelations.clear(); relationErrors.clear();
    }
    function refreshNode(node) {
        cancelGraphRequests();
        invalidateRecordMapNode(state, node.id);
        selectRecord(node);
    }
    function clear() {
        cancelGraphRequests();
        inspecting = ''; selectionError = null;
        clearRecordMap(state); onSelectRecord?.(null);
        renderSeeds(); renderFilters(); renderGraph(); renderInspector();
        announce(text('chooseRecord'));
    }

    const onWheel = event => {
        if (!active()) return;
        event.preventDefault();
        const box = viewport.getBoundingClientRect();
        zoomBy(Math.exp(clamp(-event.deltaY * .0015, -.25, .25)), {x: event.clientX - box.left, y: event.clientY - box.top});
    };
    const onPointerDown = event => {
        if (!active() || event.button !== 0 || event.target.closest?.('[data-record-edge]')) return;
        const nodeId = event.target.closest?.('[data-record-node]')?.getAttribute('data-record-node');
        const view = camera();
        const point = nodeId ? state.positions.get(nodeId) : view;
        if (!point) return;
        pointer = {id: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY,
            x: point.x, y: point.y, zoom: view.zoom, moved: false, handled: false};
        viewport.setPointerCapture(event.pointerId);
    };
    const onPointerMove = event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
        if (!pointer.moved && Math.hypot(dx, dy) < 4) return;
        pointer.moved = true; viewport.classList.add('is-dragging');
        if (pointer.nodeId) {
            state.positions.set(pointer.nodeId, {x: pointer.x + dx / pointer.zoom, y: pointer.y + dy / pointer.zoom});
            renderGraph();
        } else { state.viewport = {x: pointer.x + dx, y: pointer.y + dy, zoom: pointer.zoom}; transform(); }
    };
    const onPointerUp = event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        viewport.classList.remove('is-dragging');
        if (event.type !== 'pointercancel' && pointer.nodeId && !pointer.moved) {
            pointer.handled = true; const node = state.nodes.get(pointer.nodeId); if (node) chooseNode(node);
        }
        const current = pointer;
        setTimeout(() => { if (pointer === current) pointer = null; }, 0);
    };
    const onKey = event => {
        if (event.target !== viewport) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); }
        else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.2); }
        else if (event.key.startsWith('Arrow')) {
            event.preventDefault(); const view = camera();
            state.viewport = {...view, x: view.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0),
                y: view.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0)}; transform();
        }
    };
    tableSelect.addEventListener('change', () => {
        state.table = tableSelect.value; state.search = ''; state.page = 1; state.seedResult = null;
        search.value = ''; onTableChange?.(state.table); loadSeeds();
    });
    search.addEventListener('input', () => {
        state.search = search.value; state.page = 1;
        clearTimeout(searchTimer); searchTimer = setTimeout(loadSeeds, 180);
    });
    viewport.addEventListener('wheel', onWheel, {passive: false});
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('keydown', onKey);
    let previousSize = dimensions();
    const observer = new ResizeObserver(() => {
        if (!active()) return;
        const size = dimensions();
        const changed = Math.abs(size.width - previousSize.width) > 2 || Math.abs(size.height - previousSize.height) > 2;
        previousSize = size;
        renderGraph();
        if (state.nodes.size && (!state.viewport || changed)) fit();
    });
    observer.observe(viewport);
    function destroy() {
        if (destroyed) return;
        destroyed = true; epoch++;
        clearTimeout(searchTimer);
        for (const pending of controllers) pending.abort();
        controllers.clear(); observer.disconnect();
        signal?.removeEventListener('abort', destroy);
        viewport.removeEventListener('wheel', onWheel);
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerUp);
        viewport.removeEventListener('pointercancel', onPointerUp);
        viewport.removeEventListener('keydown', onKey);
    }
    signal?.addEventListener('abort', destroy, {once: true});
    renderFilters(); renderGraph(); renderInspector();
    if (state.seedResult) renderSeeds();
    else if (available.length) loadSeeds();
    return {destroy, selectRecord};
}
