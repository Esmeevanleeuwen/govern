import {el, button, icon, errorText} from './ui.js';
import {t} from './i18n.js';
import {parseConnectionScope} from './connection-scope.js';
import {captureRecordContext, recordContextId, loadCompanionRecord} from './companion-model.js';
import {friendlyName, recordLabel} from './explorer-guide.js';
import {recordPositions, tableColor, valueText, RECORD_WIDTH, RECORD_HEIGHT} from './record-explorer-model.js';
import './companion-radar-messages.js';

const text = (key, params) => t('app.companionRadar.' + key, params);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const short = (value, length) => [...String(value)].length > length ? [...String(value)].slice(0, length - 1).join('') + '…' : String(value);
const svg = (name, attrs = {}, value) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (value !== undefined) node.textContent = value;
    return node;
};
let serial = 0;

/** A radar owns one captured source; the companion controller owns pairing and pins. */
export function mountCompanionRadar(root, {onPin = () => {}, onSelect, onFollowingChange = () => {}, onLoaded = () => {}} = {}) {
    let following = true, latest = null, context = null, record = null, pending = false, failure = null;
    let selected = '', selectedEdge = '', destroyed = false, controller, revision = 0, zoom = 1, pan = {x: 0, y: 0}, drag = null, graph, bounds, technicalOpen = false;
    const markerId = 'companion-radar-arrow-' + ++serial;
    const nodeElements = new Map(), edgeElements = new Map();
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    const category = table => context?.guided ? friendlyName(table) : table;
    const label = node => context?.guided ? recordLabel(node, node.table) : node.label;
    const action = (key, handler, attrs = {}) => button(text(key), handler, {className: 'button-small', ...attrs});
    const followButton = action('follow', () => setFollowing(true), {id: 'companion-radar-follow', symbol: 'link'});
    const freezeButton = action('freeze', () => setFollowing(false), {id: 'companion-radar-freeze', symbol: 'bookmark'});
    const refreshButton = action('refresh', () => load(context, true), {id: 'companion-radar-refresh', symbol: 'refresh'});
    const status = el('span', {class: 'radar-follow-state', role: 'status'});
    const source = el('p', {class: 'radar-source'});
    const summary = el('p', {class: 'radar-summary', role: 'status', 'aria-live': 'polite'});
    const graphRoot = el('div', {class: 'radar-viewport'});
    const zoomValue = el('span', {class: 'radar-zoom', 'aria-live': 'polite'});
    const zoomOut = action('zoomOut', () => setZoom(zoom / 1.3), {symbol: 'hide'});
    const zoomIn = action('zoomIn', () => setZoom(zoom * 1.3), {symbol: 'plus'});
    const fit = action('fit', () => { pan = {x: 0, y: 0}; setZoom(1); }, {symbol: 'expand'});
    const controls = el('div', {class: 'radar-controls'}, followButton, freezeButton, refreshButton, status);
    const selector = el('select', {id: 'companion-radar-record', class: 'input'});
    selector.addEventListener('change', () => chooseNode(selector.value), {signal});
    const selectorLabel = el('label', {class: 'radar-record-picker', for: 'companion-radar-record'}, el('span'), selector);
    const detail = el('aside', {id: 'companion-radar-detail', class: 'radar-detail'});
    const graphHelp = el('p', {class: 'small muted radar-graph-help'});
    const canvas = el('section', {class: 'radar-canvas'},
        el('div', {class: 'radar-canvas-heading'}, selectorLabel, el('div', {class: 'radar-zoom-controls'}, zoomOut, zoomValue, zoomIn, fit)), graphRoot, graphHelp);
    const errors = el('div', {class: 'radar-error'});
    const limits = el('p', {class: 'small muted radar-limits'});
    const introduction = el('p', {class: 'radar-introduction'});
    const shell = el('section', {id: 'companion-radar', class: 'companion-radar', 'data-following': 'true', 'aria-busy': 'false'},
        introduction, controls, source, errors, summary, el('div', {class: 'radar-layout'}, canvas, detail), limits);
    root.replaceChildren(shell);

    function setFollowing(value) {
        value = Boolean(value);
        if (destroyed || following === value) return;
        following = value; updateControls();
        onFollowingChange(value);
        if (following) load(latest);
    }
    function setContext(value) {
        if (destroyed) return;
        latest = value === null ? null : captureRecordContext(value);
        if (following) load(latest);
    }
    function updateControls() {
        shell.dataset.following = String(following);
        shell.setAttribute('aria-busy', String(pending));
        followButton.setAttribute('aria-pressed', String(following));
        freezeButton.setAttribute('aria-pressed', String(!following));
        refreshButton.disabled = !context || pending;
        selector.disabled = pending || !record;
        status.textContent = text(following ? 'following' : 'frozen');
        for (const control of [zoomOut, zoomIn, fit]) control.disabled = !record || pending;
        if (context) {
            shell.dataset.radarScope = context.database; shell.dataset.radarTable = context.table; shell.dataset.radarKey = JSON.stringify(context.key);
            const scope = parseConnectionScope(context.database);
            source.textContent = text(scope.connection === 'postgres' ? 'postgresSource' : 'source', scope);
        } else {
            delete shell.dataset.radarScope; delete shell.dataset.radarTable; delete shell.dataset.radarKey; source.textContent = '';
        }
    }
    async function load(value, force = false) {
        if (destroyed) return;
        const next = value === null ? null : captureRecordContext(value);
        if (!force && next && context && recordContextId(next) === recordContextId(context) && (record || pending)) {
            context = next;
            if (record) render();
            return;
        }
        controller?.abort(); controller = new AbortController();
        const current = ++revision, active = controller;
        context = next; record = null; failure = null; selected = ''; selectedEdge = '';
        zoom = 1; pan = {x: 0, y: 0}; pending = Boolean(context); render();
        if (!context) return;
        try {
            const result = await loadCompanionRecord(context, {signal: active.signal});
            if (destroyed || current !== revision || active.signal.aborted) return;
            record = result; selected = result.data.center;
            onLoaded(result);
        } catch (error) {
            if (destroyed || current !== revision || active.signal.aborted || error.name === 'AbortError') return;
            failure = error;
        } finally {
            if (!destroyed && current === revision) { pending = false; render(); }
        }
    }
    function contextFor(node) {
        return captureRecordContext({database: context.database, table: node.table, key: node.key, guided: context.guided});
    }
    function valuesList(values, friendly = false) {
        return el('dl', {class: 'radar-values'}, Object.entries(values || {}).map(([name, value]) => el('div', {},
            el('dt', {}, friendly ? friendlyName(name) : name),
            el('dd', {class: value === null ? 'null-value' : ''}, value === '' ? text('emptyValue') : valueText(value)))));
    }
    function renderRecordDetail(node) {
        if (!node) { detail.replaceChildren(); return; }
        const technical = el('details', {class: 'radar-technical', ...(technicalOpen ? {open: true} : {})}, el('summary', {}, text('technical')),
            el('p', {}, text('originalTable')), el('code', {}, node.table), el('h4', {}, text('key')), valuesList(node.key));
        let visibleValues = node.values || {};
        if (context.guided) {
            const identifiers = new Set(Object.keys(node.key).filter(name => /(^id$|_id$|^uuid$)/i.test(name)));
            for (const edge of record.data.edges) {
                if (edge.source === node.id) edge.columns.forEach(name => identifiers.add(name));
                if (edge.target === node.id) edge.referenced_columns.forEach(name => identifiers.add(name));
            }
            visibleValues = Object.fromEntries(Object.entries(visibleValues).filter(([name]) => !identifiers.has(name)));
            technical.append(el('h4', {}, text('values')), valuesList(node.values));
        }
        technical.addEventListener('toggle', () => { if (technical.isConnected) technicalOpen = technical.open; });
        const actions = el('div', {class: 'radar-detail-actions'},
            action('pin', () => onPin(contextFor(node)), {id: 'companion-radar-pin', symbol: 'bookmark', kind: 'primary'}),
            action('explore', () => { setFollowing(false); load(contextFor(node)); }, {id: 'companion-radar-explore', symbol: 'network', disabled: node.id === record.data.center}));
        if (onSelect) actions.append(action('showMain', () => onSelect(contextFor(node)), {id: 'companion-radar-main', symbol: 'external'}));
        const content = [el('p', {class: 'radar-detail-category'}, category(node.table)), el('h3', {}, label(node)), actions];
        if (Object.keys(visibleValues).length) content.push(el('h4', {}, text('values')), valuesList(visibleValues, Boolean(context.guided)));
        else if (!Object.keys(node.values || {}).length) content.push(el('p', {class: 'muted'}, text('noValues')));
        if (node.truncated) content.push(el('p', {class: 'radar-preview'}, text('preview')));
        detail.replaceChildren(...content, technical);
    }
    function renderEdgeDetail(edge) {
        const data = record.data;
        const sourceNode = data.nodes.find(node => node.id === edge.source), targetNode = data.nodes.find(node => node.id === edge.target);
        const rows = edge.columns.map((column, index) => {
            const target = edge.referenced_columns[index];
            return el('tr', {}, el('td', {}, el('code', {}, edge.source_table + '.' + column), el('span', {}, valueText(edge.source_values?.[column]))),
                el('td', {}, el('code', {}, edge.target_table + '.' + target), el('span', {}, valueText(edge.target_values?.[target]))));
        });
        detail.replaceChildren(...[el('h3', {}, text('evidence')),
            el('p', {class: 'small muted'}, text('evidenceHelp', {source: sourceNode ? label(sourceNode) : category(edge.source_table), target: targetNode ? label(targetNode) : category(edge.target_table)})),
            el('code', {class: 'radar-constraint'}, edge.name),
            el('div', {class: 'radar-evidence-scroll', tabindex: '0'}, el('table', {class: 'radar-evidence'},
                el('thead', {}, el('tr', {}, el('th', {}, text('sourceColumn')), el('th', {}, text('targetColumn')))), el('tbody', {}, rows))),
            sourceNode ? button(text('inspect', {label: label(sourceNode)}), () => chooseNode(sourceNode.id), {className: 'button-small'}) : null].filter(Boolean));
    }
    function chooseNode(id) {
        if (!record || pending || !record.data.nodes.some(node => node.id === id)) return;
        selected = id; selectedEdge = ''; selector.value = id; updateSelection();
    }
    function updateSelection() {
        for (const [id, node] of nodeElements) node.setAttribute('aria-pressed', String(!selectedEdge && id === selected));
        for (const [id, edge] of edgeElements) edge.setAttribute('aria-pressed', String(id === selectedEdge));
        if (!record) return;
        const edge = record.data.edges.find(edge => edge.id === selectedEdge);
        if (edge) renderEdgeDetail(edge); else renderRecordDetail(record.data.nodes.find(node => node.id === selected));
    }
    function activate(node, handler) {
        node.addEventListener('click', handler);
        node.addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); handler();
        });
    }
    function drawGraph() {
        nodeElements.clear(); edgeElements.clear();
        const data = record.data, layout = recordPositions(data.nodes, data.center);
        bounds = data.nodes.length === 1
            ? data.edges.length ? {x: -160, y: -180, width: 320, height: 280} : {x: -140, y: -100, width: 280, height: 200}
            : layout.bounds;
        graph = svg('svg', {class: 'radar-graph', tabindex: '0', 'aria-label': text('graph'), preserveAspectRatio: 'xMidYMid meet'});
        const marker = svg('marker', {id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'});
        marker.append(svg('path', {d: 'M 0 1 L 9 5 L 0 9 z', class: 'radar-arrow'}));
        const defs = svg('defs'); defs.append(marker); graph.append(defs);
        for (const [index, edge] of data.edges.entries()) {
            const a = layout.positions.get(edge.source), b = layout.positions.get(edge.target);
            if (!a || !b) continue;
            const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
            const offset = Math.min(RECORD_WIDTH / 2 / (Math.abs(dx) / length || .00001), RECORD_HEIGHT / 2 / (Math.abs(dy) / length || .00001));
            const start = {x: a.x + dx / length * offset, y: a.y + dy / length * offset};
            const end = {x: b.x - dx / length * (offset + 6), y: b.y - dy / length * (offset + 6)};
            const bend = (index % 3 - 1) * 20;
            const path = edge.source === edge.target ? `M ${a.x - 40} ${a.y - 35} C ${a.x - 130} ${a.y - 145}, ${a.x + 130} ${a.y - 145}, ${a.x + 40} ${a.y - 35}`
                : `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2 - dy / length * bend} ${(start.y + end.y) / 2 + dx / length * bend} ${end.x} ${end.y}`;
            const group = svg('g', {class: 'radar-edge', role: 'button', tabindex: 0, 'data-radar-edge': edge.id, 'aria-label': text('inspectLink', {name: edge.name})});
            group.append(svg('title', {}, edge.name + ': ' + edge.source_table + ' → ' + edge.target_table),
                svg('path', {d: path, class: 'radar-edge-hit'}), svg('path', {d: path, class: 'radar-edge-line', 'marker-end': 'url(#' + markerId + ')'}));
            activate(group, () => { selectedEdge = edge.id; updateSelection(); }); edgeElements.set(edge.id, group); graph.append(group);
        }
        for (const node of data.nodes) {
            const position = layout.positions.get(node.id);
            const group = svg('g', {class: 'radar-node', role: 'button', tabindex: 0, transform: `translate(${position.x - RECORD_WIDTH / 2} ${position.y - RECORD_HEIGHT / 2})`,
                'data-radar-node': node.id, 'data-color': tableColor(node.table), 'data-center': node.id === data.center, 'aria-label': text('inspect', {label: label(node)})});
            group.append(svg('title', {}, label(node) + '\n' + category(node.table)), svg('rect', {width: RECORD_WIDTH, height: RECORD_HEIGHT, rx: 16}),
                svg('circle', {cx: 16, cy: 19, r: 4}), svg('text', {x: 27, y: 23, class: 'radar-node-table'}, short(category(node.table), 22)),
                svg('text', {x: 14, y: 49, class: 'radar-node-label'}, short(label(node), 20)));
            activate(group, () => chooseNode(node.id)); nodeElements.set(node.id, group); graph.append(group);
        }
        graph.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('[role="button"]')) return;
            drag = {id: event.pointerId, x: event.clientX, y: event.clientY, pan: {...pan}}; graph.setPointerCapture(event.pointerId);
        });
        graph.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const box = graph.getBoundingClientRect(), units = Math.max(bounds.width / box.width, bounds.height / box.height) / zoom;
            pan = {x: drag.pan.x - (event.clientX - drag.x) * units, y: drag.pan.y - (event.clientY - drag.y) * units}; updateViewport();
        });
        const stop = () => { drag = null; };
        graph.addEventListener('pointerup', stop); graph.addEventListener('pointercancel', stop); graph.addEventListener('lostpointercapture', stop);
        graph.addEventListener('keydown', event => {
            if (event.target !== graph || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const step = 60 / zoom;
            pan = {x: pan.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: pan.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)}; updateViewport();
        });
        graphRoot.replaceChildren(graph); updateViewport();
    }
    function setZoom(value) { zoom = clamp(value, .5, 5); updateViewport(); }
    function updateViewport() {
        zoomValue.textContent = Math.round(zoom * 100) + '%';
        if (!graph || !bounds) return;
        const width = bounds.width / zoom, height = bounds.height / zoom;
        graph.setAttribute('viewBox', [bounds.x + bounds.width / 2 - width / 2 + pan.x, bounds.y + bounds.height / 2 - height / 2 + pan.y, width, height].join(' '));
    }
    function render() {
        updateControls(); errors.replaceChildren();
        if (failure) errors.append(el('p', {role: 'alert'}, errorText(failure)), action('retry', () => load(context, true), {symbol: 'refresh'}));
        if (!record) {
            selector.replaceChildren(); detail.replaceChildren(); limits.textContent = ''; summary.textContent = pending ? text('loading') : '';
            graphRoot.replaceChildren(el('div', {class: 'radar-empty'}, icon(pending ? 'clock' : 'network'),
                el('h3', {}, text(pending ? 'loading' : 'emptyTitle')), el('p', {}, pending ? '' : text('emptyBody'))));
            nodeElements.clear(); edgeElements.clear(); graph = null; return;
        }
        const data = record.data;
        summary.textContent = text('loaded', {nodes: data.nodes.length, edges: data.edges.length});
        selector.replaceChildren(...data.nodes.map(node => el('option', {value: node.id, selected: node.id === selected}, label(node) + ' · ' + category(node.table))));
        limits.textContent = text('bounded') + ' ' + (data.partial ? text('partial') + ' ' : '') + text('limits', {
            nodes: data.limits.max_nodes, edges: data.limits.max_edges, neighbors: data.limits.per_relation});
        drawGraph(); updateSelection();
    }
    function refreshLanguage() {
        if (destroyed) return;
        const active = document.activeElement, focusId = shell.contains(active) ? active.id : '';
        const nodeId = active?.getAttribute?.('data-radar-node'), edgeId = active?.getAttribute?.('data-radar-edge');
        const details = detail.querySelector('.radar-technical');
        if (details) technicalOpen = details.open;
        const scroll = detail.scrollTop;
        introduction.textContent = text('introduction'); graphHelp.textContent = text('graphHelp'); selectorLabel.firstElementChild.textContent = text('record');
        for (const [control, key] of [[followButton, 'follow'], [freezeButton, 'freeze'], [refreshButton, 'refresh'], [zoomIn, 'zoomIn'], [zoomOut, 'zoomOut'], [fit, 'fit']]) {
            control.querySelector('span').textContent = text(key); control.setAttribute('aria-label', text(key));
        }
        render();
        detail.scrollTop = scroll;
        const replacement = nodeId ? nodeElements.get(nodeId) : edgeId ? edgeElements.get(edgeId) : focusId ? shell.querySelector('#' + CSS.escape(focusId)) : null;
        replacement?.focus({preventScroll: true});
    }
    refreshLanguage();
    return {setContext, setFollowing, refreshLanguage, get following() { return following; }, destroy() {
        if (destroyed) return;
        destroyed = true; ++revision; controller?.abort(); lifetime.abort(); drag = null; root.replaceChildren();
    }};
}
