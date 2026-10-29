import {el, icon, button, badge, number, empty} from './ui.js';
import {t} from './i18n.js';
import {attachSchemaWheelZoom} from './schema-navigation.js';
import {createSchemaHelp} from './schema-help.js';
import {normalizeSchema, initialPositions, tableHeight, filterTables, relatedTables, TABLE_WIDTH, HEADER_HEIGHT, ROW_HEIGHT} from './schema-model.js';
import './schema-messages.js';

const svgNS = 'http://www.w3.org/2000/svg';
const positionLimit = 100000;
const validPosition = value => value && Number.isFinite(value.x) && Number.isFinite(value.y)
    && value.x >= 0 && value.y >= 0 && value.x <= positionLimit && value.y <= positionLimit;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const svg = (tag, attributes = {}) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
};

/** A read-only view of the current catalog. Coordinates never change the database. */
export function mountSchemaVisualizer(root, {data, state = {}, contextRoot, onSelect, onSearch, initialSearch, onRefresh} = {}) {
    const model = normalizeSchema(data);
    const storageKey = 'govern.schema-layout.v1.' + encodeURIComponent(model.database);
    const defaults = initialPositions(model.tables);
    const lookup = new Map(model.tables.map(table => [table.name, table]));
    let destroyed = false;
    let pointer = null;
    let frame;
    let resizeObserver;
    let previousCanvasSize;
    const nodes = new Map();
    const cleanup = [];
    if (state.database !== model.database) {
        Object.assign(state, {database: model.database, positions: Object.create(null), viewport: null, search: '', neighborhood: false, loadedPositions: false, storageFailed: false, centeredSelected: ''});
    }
    if (!state.positions || typeof state.positions !== 'object') state.positions = Object.create(null);
    if (!state.loadedPositions) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw && raw.length < 2000000) {
                const saved = JSON.parse(raw);
                if (saved?.version === 1 && saved.positions && typeof saved.positions === 'object') {
                    for (const [name, position] of Object.entries(saved.positions)) {
                        if (validPosition(position)) Object.defineProperty(state.positions, name, {value: {x: position.x, y: position.y}, writable: true, enumerable: true, configurable: true});
                    }
                }
            }
        } catch { /* Browser storage is optional; moving still works in memory. */ }
        state.loadedPositions = true;
    }
    for (const table of model.tables) {
        if (!Object.hasOwn(state.positions, table.name) || !validPosition(state.positions[table.name])) {
            Object.defineProperty(state.positions, table.name, {value: {...defaults[table.name]}, writable: true, enumerable: true, configurable: true});
        }
    }
    state.search = typeof initialSearch === 'string' ? initialSearch : typeof state.search === 'string' ? state.search : '';
    if (!lookup.has(state.selected)) state.selected = '';
    if (!state.selected) state.neighborhood = false;
    state.showColumns = state.showColumns !== false;
    const renderedHeight = table => state.showColumns ? tableHeight(table) : HEADER_HEIGHT;
    const needsInitialFit = !state.viewport;
    if (!state.viewport || !Number.isFinite(state.viewport.x) || !Number.isFinite(state.viewport.y) || !Number.isFinite(state.viewport.zoom)) {
        state.viewport = {x: 32, y: 32, zoom: .75};
    }
    state.viewport.zoom = clamp(state.viewport.zoom, .12, 1.75);

    const status = el('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'});
    const storageStatus = el('p', {class: 'small muted schema-storage', role: 'status', 'aria-live': 'polite'}, t(state.storageFailed ? 'app.schema.storageUnavailable' : 'app.schema.local'));
    const summary = el('p', {class: 'small muted'}, t('app.schema.summary', {tables: number(model.tables.length), relationships: number(model.relationships.length)}));
    const search = el('input', {id: 'schema-search', type: 'search', class: 'input', value: state.search, placeholder: t('app.schema.search'), 'aria-label': t('app.schema.search'), autocomplete: 'off'});
    const zoomValue = el('output', {id: 'schema-zoom-value', class: 'schema-zoom-value'});
    const neighborhood = el('input', {type: 'checkbox', id: 'schema-neighborhood', checked: state.neighborhood});
    const fitButton = button(t('app.schema.fitShort'), fit, {id: 'schema-fit', symbol: 'expand', 'aria-label': t('app.schema.fit')});
    const zoomOut = button(t('app.schema.zoomOut'), () => zoomBy(1 / 1.2), {id: 'schema-zoom-out', className: 'icon-button'});
    zoomOut.querySelector('span').textContent = '−';
    const zoomIn = button(t('app.schema.zoomIn'), () => zoomBy(1.2), {id: 'schema-zoom-in', symbol: 'plus', className: 'icon-button'});
    zoomIn.querySelector('span').className = 'sr-only';
    const columnsToggle = button(t('app.schema.columnLabels'), () => {
        state.showColumns = !state.showColumns; draw();
        columnsToggle.setAttribute('aria-pressed', String(state.showColumns));
    }, {id: 'schema-columns-toggle', 'aria-pressed': String(state.showColumns), symbol: 'layers'});
    const areaHelp = createSchemaHelp({state});
    areaHelp.button.querySelector('span').textContent = t('app.schema.toolsHelp');
    areaHelp.button.setAttribute('aria-label', t('app.schema.helpLabel'));
    cleanup.push(() => areaHelp.destroy());
    const group = (key, className, ...controls) => el('div', {class: 'schema-tool-group ' + className, role: 'group', 'aria-label': t(key)}, controls);
    const zoomControls = group('app.schema.groupZoom', 'schema-zoom-controls', zoomOut, zoomValue, zoomIn,
        button(t('app.schema.actual'), () => setZoom(1), {id: 'schema-actual'}), fitButton);
    const refreshButton = onRefresh ? button(t('app.schema.refreshShort'), async () => {
        if (refreshButton.disabled) return;
        refreshButton.disabled = true;
        try { await onRefresh(); } finally { if (refreshButton.isConnected) refreshButton.disabled = false; }
    }, {
        id: 'schema-refresh', symbol: 'refresh', 'aria-label': t('app.schema.refresh'),
    }) : null;
    const toolbar = el('div', {class: 'schema-toolbar', role: 'group', 'aria-label': t('app.schema.panelTitle')},
        group('app.schema.groupDisplay', 'schema-display-controls', el('label', {class: 'schema-filter'}, neighborhood, t('app.schema.neighborhood')), columnsToggle),
        group('app.schema.groupLayout', 'schema-layout-controls', button(t('app.schema.arrangeShort'), reset, {id: 'schema-reset', symbol: 'layout', 'aria-label': t('app.schema.arrangeLabel')})),
        zoomControls,
        group('app.schema.groupSupport', 'schema-support-controls', refreshButton, areaHelp.button));
    const help = el('p', {id: 'schema-interaction-help', class: 'small muted schema-help'}, t('app.schema.interactionHelp'));
    const canvas = el('div', {id: 'schema-viewport', class: 'schema-viewport', role: 'region', tabindex: '0', 'aria-label': t('app.schema.canvas'), 'aria-describedby': 'schema-interaction-help schema-canvas-help'});
    const world = el('div', {class: 'schema-world'});
    const lines = svg('svg', {class: 'schema-lines', 'aria-hidden': 'true'});
    world.append(lines);
    canvas.append(world);
    const count = el('p', {class: 'small muted', id: 'schema-visible-count'});
    const index = el('nav', {class: 'schema-index', 'aria-label': t('app.schema.tables')});
    const selected = el('section', {id: 'schema-selected', class: 'schema-selected', tabindex: '-1', 'aria-label': t('app.schema.selected')});
    const tablePanel = el('section', {id: 'schema-table-panel', 'aria-label': t('app.schema.tables')},
        el('label', {class: 'schema-explorer-search'}, el('span', {class: 'sr-only'}, t('app.schema.search')), search), count, index);
    if (contextRoot) contextRoot.replaceChildren(tablePanel, selected);
    const layout = el('div', {class: 'schema-layout schema-unified-layout'}, el('div', {class: 'schema-board'}, canvas,
        el('p', {id: 'schema-canvas-help', class: 'sr-only'}, t('app.schema.canvasHelp'))));
    const noMatches = el('div', {class: 'schema-no-matches', hidden: true}, el('p', {}, t('app.schema.noMatches')),
        button(t('app.schema.showAll'), () => { state.neighborhood = false; neighborhood.checked = false; draw(); fit(); }));
    canvas.append(noMatches);
    const explanation = el('details', {class: 'schema-explanation', id: 'schema-explanation', open: Boolean(state.storageFailed)},
        el('summary', {}, t('app.schema.explanation')), help,
        el('p', {class: 'small muted'}, t('app.schema.foreignKeyHelp')), storageStatus);
    root.replaceChildren(el('div', {class: 'schema-workspace'}, toolbar, layout,
        el('div', {class: 'schema-canvas-footer'}, summary,
        el('div', {class: 'schema-legend'}, badge('PK'), el('span', {}, t('app.schema.primary')),
            badge('FK'), el('span', {}, t('app.schema.foreign')))), explanation, status));

    function syncCanvasSize() {
        if (destroyed || !canvas.isConnected) return;
        const next = {width: canvas.clientWidth, height: canvas.clientHeight};
        if (previousCanvasSize) {
            state.viewport.x += (next.width - previousCanvasSize.width) / 2;
            state.viewport.y += (next.height - previousCanvasSize.height) / 2;
        }
        previousCanvasSize = next;
        transform();
    }
    document.addEventListener('govern:explorerchange', syncCanvasSize);
    cleanup.push(() => document.removeEventListener('govern:explorerchange', syncCanvasSize));

    function persist() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({version: 1, positions: state.positions}));
            state.storageFailed = false;
        } catch { state.storageFailed = true; }
        storageStatus.textContent = t(state.storageFailed ? 'app.schema.storageUnavailable' : 'app.schema.local');
        if (state.storageFailed) explanation.open = true;
    }

    function visibleTables() { return filterTables(model, '', state.selected, state.neighborhood); }

    function pointToTable(name) {
        const table = lookup.get(name);
        if (!table) return;
        const position = state.positions[name];
        const rect = canvas.getBoundingClientRect();
        state.viewport.zoom = Math.max(state.viewport.zoom, .6);
        state.viewport.x = rect.width / 2 - (position.x + TABLE_WIDTH / 2) * state.viewport.zoom;
        state.viewport.y = rect.height / 2 - (position.y + Math.min(renderedHeight(table), rect.height / state.viewport.zoom) / 2) * state.viewport.zoom;
        transform();
    }

    function selectTable(name, center = false, rebuild = true) {
        const focusedContext = contextRoot?.contains(document.activeElement);
        if (state.selected !== name) state.columnsExpanded = false;
        state.selected = name;
        onSelect?.(name);
        if (rebuild && state.neighborhood) draw();
        else { drawSelection(); drawDetails(); }
        syncCanvasSize();
        // Selecting an object keeps both the table list and its keyboard position.
        if (focusedContext) (index.querySelector('[id="schema-index-' + encodeURIComponent(name) + '"]') || selected).focus({preventScroll: true});
        if (center) { pointToTable(name); state.centeredSelected = name; }
    }

    function transform() {
        const {x, y, zoom} = state.viewport;
        world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        zoomValue.textContent = Math.round(zoom * 100) + '%';
        zoomOut.disabled = zoom <= .12;
        zoomIn.disabled = zoom >= 1.75;
    }

    function setZoom(value, anchor) {
        const old = state.viewport.zoom;
        const zoom = clamp(value, .12, 1.75);
        const rect = canvas.getBoundingClientRect();
        const location = anchor || {x: rect.width / 2, y: rect.height / 2};
        state.viewport.x = location.x - (location.x - state.viewport.x) * zoom / old;
        state.viewport.y = location.y - (location.y - state.viewport.y) * zoom / old;
        state.viewport.zoom = zoom;
        transform();
    }
    function zoomBy(factor) { setZoom(state.viewport.zoom * factor); }

    function fit() {
        const tables = visibleTables();
        if (!tables.length) return;
        const rect = canvas.getBoundingClientRect();
        const minX = Math.min(...tables.map(table => state.positions[table.name].x));
        const minY = Math.min(...tables.map(table => state.positions[table.name].y));
        const maxX = Math.max(...tables.map(table => state.positions[table.name].x + TABLE_WIDTH));
        const maxY = Math.max(...tables.map(table => state.positions[table.name].y + renderedHeight(table)));
        const zoom = clamp(Math.min((rect.width - 64) / (maxX - minX), (rect.height - 64) / (maxY - minY)), .12, 1);
        Object.assign(state.viewport, {zoom, x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom});
        transform();
    }

    function reset() {
        const positions = initialPositions(model.tables);
        for (const table of model.tables) state.positions[table.name] = positions[table.name];
        persist(); draw(); fit(); status.textContent = t('app.schema.resetDone');
    }

    function drawDetails() {
        neighborhood.disabled = !state.selected;
        selected.replaceChildren();
        const table = lookup.get(state.selected);
        if (!table) { selected.append(el('p', {class: 'small muted'}, t('app.schema.selectHelp'))); return; }
        selected.append(el('p', {class: 'eyebrow'}, t(table.type === 'view' ? 'app.schema.view' : 'app.schema.selected')), el('h3', {class: 'schema-selected-name'}, table.name),
            el('p', {class: 'small muted'}, t('app.schema.columns', {count: number(table.columns.length)})));
        if (table.comment) selected.append(el('p', {class: 'small muted'}, table.comment));
        const columnDetails = el('details', {class: 'schema-column-details', id: 'schema-column-details'},
            el('summary', {id: 'schema-column-summary'}, t('app.schema.columnDetails')),
            el('ul', {class: 'schema-detail-columns'}, table.columns.map(column => el('li', {},
                el('div', {}, el('code', {}, column.name), column.primary ? badge('PK') : null),
                el('code', {class: 'muted'}, column.type),
                el('span', {class: 'small muted'}, t(column.nullable ? 'app.schema.nullable' : 'app.schema.required'))))));
        columnDetails.open = state.columnsExpanded === true;
        columnDetails.addEventListener('toggle', () => { if (columnDetails.isConnected) state.columnsExpanded = columnDetails.open; });
        const connectionDetails = el('details', {id: 'schema-relationship-details', class: 'schema-relationship-details'},
            el('summary', {}, t('app.schema.relationships')));
        connectionDetails.open = state.relationshipsExpanded === true;
        connectionDetails.addEventListener('toggle', () => { if (connectionDetails.isConnected) state.relationshipsExpanded = connectionDetails.open; });
        selected.append(columnDetails, connectionDetails);
        const relationships = model.relationships.filter(relation => relation.sourceTable === table.name || (!relation.external && relation.targetTable === table.name));
        if (!relationships.length) connectionDetails.append(el('p', {class: 'small muted'}, t('app.schema.noRelationships')));
        for (const relation of relationships) {
            const outgoing = relation.sourceTable === table.name;
            const targetName = outgoing ? relation.targetTable : relation.sourceTable;
            const targetAvailable = outgoing ? !relation.external && relation.targetAvailable : true;
            const targetLabel = outgoing && relation.external ? relation.targetSchema + '.' + targetName : targetName;
            const item = el('div', {class: 'schema-relation', 'data-schema-relation': relation.id},
                el('span', {class: 'small muted'}, t(outgoing ? 'app.schema.outgoing' : 'app.schema.incoming')),
                el('code', {class: 'schema-constraint-name'}, relation.name));
            if (targetAvailable) item.append(button(targetLabel, () => selectTable(targetName, true), {id: 'schema-relation-' + encodeURIComponent(relation.id), 'data-schema-select': targetName, className: 'button-small', symbol: 'link'}));
            else item.append(el('code', {class: 'schema-selected-name'}, targetLabel), el('p', {class: 'small muted'}, t(relation.external ? 'app.schema.outside' : 'app.schema.unavailable')));
            item.append(el('ul', {class: 'schema-pairs'}, relation.pairs.map(pair => el('li', {}, el('code', {}, pair.source), ' → ', el('code', {}, pair.target)))));
            connectionDetails.append(item);
        }
    }

    function drawSelection() {
        const related = relatedTables(model, state.selected);
        for (const [name, node] of nodes) {
            const chosen = name === state.selected;
            node.classList.toggle('is-selected', chosen);
            node.classList.toggle('is-related', !chosen && !!state.selected && related.has(name));
            node.querySelector('[data-schema-header]').setAttribute('aria-pressed', String(chosen));
        }
        for (const path of lines.querySelectorAll('.schema-edge')) {
            const connected = !state.selected || path.dataset.sourceTable === state.selected || path.dataset.targetTable === state.selected;
            path.classList.toggle('is-muted', !connected);
            path.classList.toggle('is-highlighted', !!state.selected && connected);
        }
        index.querySelectorAll('[data-schema-select]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.schemaSelect === state.selected)));
    }

    function drawLines() {
        const width = Math.max(1000, ...visibleTables().map(table => state.positions[table.name].x + TABLE_WIDTH + 100));
        const height = Math.max(1000, ...visibleTables().map(table => state.positions[table.name].y + renderedHeight(table) + 100));
        lines.setAttribute('width', String(width)); lines.setAttribute('height', String(height));
        world.style.width = width + 'px'; world.style.height = height + 'px';
        lines.replaceChildren();
        for (const relation of model.relationships) {
            if (relation.external || !relation.targetAvailable || !nodes.has(relation.sourceTable) || !nodes.has(relation.targetTable)) continue;
            const source = lookup.get(relation.sourceTable); const target = lookup.get(relation.targetTable);
            const sourcePosition = state.positions[source.name]; const targetPosition = state.positions[target.name];
            relation.pairs.forEach((pair, pairIndex) => {
                const sourceIndex = source.columns.findIndex(column => column.name === pair.source);
                const targetIndex = target.columns.findIndex(column => column.name === pair.target);
                if (sourceIndex < 0 || targetIndex < 0) return;
                const sy = sourcePosition.y + (state.showColumns ? HEADER_HEIGHT + sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2 : HEADER_HEIGHT / 2);
                const ty = targetPosition.y + (state.showColumns ? HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2 : HEADER_HEIGHT / 2);
                const self = source.name === target.name;
                const toRight = targetPosition.x >= sourcePosition.x;
                const sx = sourcePosition.x + (toRight || self ? TABLE_WIDTH : 0);
                const tx = targetPosition.x + (toRight && !self ? 0 : TABLE_WIDTH);
                const bend = self ? 50 + pairIndex * 14 : Math.max(45, Math.abs(tx - sx) / 2);
                const d = self ? `M${sx},${sy} C${sx + bend},${sy === ty ? sy - 40 : sy} ${tx + bend},${sy === ty ? ty + 40 : ty} ${tx},${ty}`
                    : `M${sx},${sy} C${sx + (toRight ? bend : -bend)},${sy} ${tx + (toRight ? -bend : bend)},${ty} ${tx},${ty}`;
                const path = svg('path', {class: 'schema-edge', d, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'data-source-table': source.name, 'data-target-table': target.name,
                    'data-source-column': pair.source, 'data-target-column': pair.target});
                const title = svg('title'); title.textContent = `${relation.name}: ${source.name}.${pair.source} → ${target.name}.${pair.target}`; path.append(title);
                lines.append(path, svg('circle', {class: 'schema-endpoint', cx: String(tx), cy: String(ty), r: '3'}));
            });
        }
        drawSelection();
    }

    function makeNode(table) {
        const foreignColumns = new Set(model.relationships.filter(relation => relation.sourceTable === table.name).flatMap(relation => relation.pairs.map(pair => pair.source)));
        const header = el('button', {type: 'button', id: 'schema-header-' + encodeURIComponent(table.name), class: 'schema-node-header', 'data-schema-header': table.name,
            'aria-label': t('app.schema.move', {table: table.name}), 'aria-describedby': 'schema-interaction-help', 'aria-pressed': String(state.selected === table.name)},
            el('span', {class: 'schema-node-title'}, icon(table.type === 'view' ? 'eye' : 'table'), el('strong', {title: table.name}, table.name)),
            el('span', {class: 'schema-node-subtitle'}, t(table.type === 'view' ? 'app.schema.view' : 'app.schema.table'), ' · ', t('app.schema.columns', {count: number(table.columns.length)})));
        const node = el('article', {class: 'schema-node', 'data-schema-node': table.name, style: `width:${TABLE_WIDTH}px;height:${renderedHeight(table)}px`}, header);
        node.append(el('ul', {class: 'schema-columns', hidden: !state.showColumns}, table.columns.map(column => {
            const foreign = foreignColumns.has(column.name);
            const kind = column.primary && foreign ? 'both' : column.primary ? 'primary' : 'foreign';
            const labels = [column.name, column.type, t(column.nullable ? 'app.schema.nullable' : 'app.schema.required')];
            if (column.primary || foreign) labels.push(t('app.schema.' + kind));
            if (column.generated) labels.push(t('app.schema.generated'));
            return el('li', {class: 'schema-column', title: labels.join(' · '), 'data-schema-column': column.name},
                el('span', {class: 'schema-key', title: column.primary || foreign ? t('app.schema.' + kind) : ''},
                    column.primary ? 'PK' : '', column.primary && foreign ? '·' : '', foreign ? 'FK' : ''),
                el('code', {class: 'schema-column-name'}, column.name), el('code', {class: 'schema-column-type'}, column.type));
        })));
        if (!table.columns.length && state.showColumns) node.append(el('p', {class: 'schema-no-columns small muted'}, t('app.schema.noColumns')));
        const position = state.positions[table.name];
        node.style.left = position.x + 'px'; node.style.top = position.y + 'px';
        header.addEventListener('click', () => selectTable(table.name));
        header.addEventListener('keydown', event => {
            const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
            if (!direction) return;
            event.preventDefault(); event.stopPropagation();
            selectTable(table.name, false, false);
            const step = event.shiftKey ? 80 : 20;
            const point = state.positions[table.name];
            point.x = clamp(point.x + direction[0] * step, 0, positionLimit); point.y = clamp(point.y + direction[1] * step, 0, positionLimit);
            updateNode(table.name);
            if (state.neighborhood) { draw(); nodes.get(table.name)?.querySelector('[data-schema-header]').focus({preventScroll: true}); }
            else drawLines();
            persist(); status.textContent = t('app.schema.moved', {table: table.name});
        });
        header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || pointer) return;
            event.preventDefault(); header.focus({preventScroll: true}); selectTable(table.name, false, false);
            pointer = {id: event.pointerId, type: 'table', name: table.name, x: event.clientX, y: event.clientY, origin: {...state.positions[table.name]}, target: header};
            header.setPointerCapture(event.pointerId); node.classList.add('is-moving');
        });
        return node;
    }

    function updateNode(name) {
        const node = nodes.get(name); const position = state.positions[name];
        if (node) { node.style.left = position.x + 'px'; node.style.top = position.y + 'px'; }
    }

    function drawIndex() {
        const matching = filterTables(model, state.search, '', false);
        count.textContent = t('app.schema.visible', {count: number(matching.length)});
        index.replaceChildren(...matching.map(table => button(table.name, () => selectTable(table.name, true), {
            id: 'schema-index-' + encodeURIComponent(table.name), 'data-schema-select': table.name,
            className: 'schema-index-item', symbol: table.type === 'view' ? 'eye' : 'table'})));
        if (!matching.length) index.append(el('p', {class: 'small muted'}, t('app.schema.noMatches')),
            button(t('app.schema.clear'), () => { state.search = ''; search.value = ''; onSearch?.(''); drawIndex(); search.focus(); }));
        drawSelection();
    }

    function draw() {
        const visible = visibleTables();
        nodes.clear(); world.querySelectorAll('.schema-node').forEach(node => node.remove());
        for (const table of visible) { const node = makeNode(table); nodes.set(table.name, node); world.append(node); }
        noMatches.hidden = visible.length > 0;
        drawIndex(); drawDetails(); drawLines(); transform(); syncCanvasSize();
    }

    search.addEventListener('input', () => { state.search = search.value; onSearch?.(state.search); drawIndex(); });
    neighborhood.addEventListener('change', () => { state.neighborhood = neighborhood.checked; draw(); fit(); });
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.schema-node, button') || pointer) return;
        event.preventDefault(); canvas.focus({preventScroll: true});
        pointer = {id: event.pointerId, type: 'pan', x: event.clientX, y: event.clientY, origin: {...state.viewport}, target: canvas};
        canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-panning');
    });
    function pointerMove(event) {
        if (!pointer || event.pointerId !== pointer.id) return;
        if (pointer.type === 'pan') {
            state.viewport.x = pointer.origin.x + event.clientX - pointer.x; state.viewport.y = pointer.origin.y + event.clientY - pointer.y; transform();
        } else {
            const position = state.positions[pointer.name];
            position.x = clamp(pointer.origin.x + (event.clientX - pointer.x) / state.viewport.zoom, 0, positionLimit);
            position.y = clamp(pointer.origin.y + (event.clientY - pointer.y) / state.viewport.zoom, 0, positionLimit);
            updateNode(pointer.name);
            if (!frame) frame = requestAnimationFrame(() => { frame = null; if (!destroyed) drawLines(); });
        }
    }
    function pointerEnd(event) {
        if (!pointer || event.pointerId !== pointer.id) return;
        const active = pointer;
        pointer = null;
        if (active.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
        canvas.classList.remove('is-panning');
        if (active.type === 'table') {
            nodes.get(active.name)?.classList.remove('is-moving'); persist();
            if (state.neighborhood) { draw(); nodes.get(active.name)?.querySelector('[data-schema-header]').focus({preventScroll: true}); }
            else drawLines();
            status.textContent = t('app.schema.moved', {table: active.name});
        }
    }
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('lostpointercapture', pointerEnd);
    cleanup.push(attachSchemaWheelZoom(canvas, {getZoom: () => state.viewport.zoom, setZoom: (value, anchor) => setZoom(value, anchor)}));
    canvas.addEventListener('keydown', event => {
        if (event.target !== canvas) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); }
        else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.2); }
        else if (event.key === 'Home') { event.preventDefault(); fit(); }
        else {
            const direction = {ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]}[event.key];
            if (direction) { event.preventDefault(); state.viewport.x += direction[0] * 60; state.viewport.y += direction[1] * 60; transform(); }
        }
    });
    if (!model.tables.length) {
        canvas.replaceChildren(empty(t('app.schema.empty'), t('app.schema.emptyHelp'), null, 'layers'));
        drawIndex(); drawDetails(); syncCanvasSize(); transform();
        [zoomOut, zoomIn, fitButton, columnsToggle, root.querySelector('#schema-actual'), root.querySelector('#schema-reset')].forEach(control => { control.disabled = true; });
    } else {
        draw();
        if (!model.relationships.length) explanation.append(el('p', {class: 'small muted schema-help'}, t('app.schema.noConnections')));
        if (needsInitialFit && !state.selected) fit();
        if (state.selected && state.centeredSelected !== state.selected) { pointToTable(state.selected); state.centeredSelected = state.selected; }
        if (typeof ResizeObserver !== 'undefined') {
            previousCanvasSize = {width: canvas.clientWidth, height: canvas.clientHeight};
            resizeObserver = new ResizeObserver(syncCanvasSize);
            resizeObserver.observe(canvas);
        }
    }
    return {destroy() {
        destroyed = true; if (frame) cancelAnimationFrame(frame); resizeObserver?.disconnect();
        const active = pointer; pointer = null;
        if (active?.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
        cleanup.forEach(callback => callback());
    }};
}
