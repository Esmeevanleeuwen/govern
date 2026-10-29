import {el, icon, button, badge, number, empty} from './ui.js';
import {t} from './i18n.js';
import {attachSchemaWheelZoom} from './schema-navigation.js';
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
export function mountSchemaVisualizer(root, {data, state = {}, onBrowse, onStructure} = {}) {
    const model = normalizeSchema(data);
    const storageKey = 'govern.schema-layout.v1.' + encodeURIComponent(model.database);
    const defaults = initialPositions(model.tables);
    const lookup = new Map(model.tables.map(table => [table.name, table]));
    let destroyed = false;
    let pointer = null;
    let frame;
    let resizeObserver;
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
    state.search = typeof state.search === 'string' ? state.search : '';
    if (!lookup.has(state.selected)) state.selected = '';
    if (!state.selected) state.neighborhood = false;
    if (typeof state.panelCollapsed !== 'boolean') state.panelCollapsed = window.matchMedia('(max-width: 700px)').matches;
    if (!['tables', 'selection'].includes(state.panelTab)) state.panelTab = state.selected ? 'selection' : 'tables';
    if (!state.selected) state.panelTab = 'tables';
    if (state.panelSelection !== state.selected) {
        if (state.selected) state.panelTab = 'selection';
        state.panelSelection = state.selected;
    }
    const needsInitialFit = !state.viewport;
    if (!state.viewport || !Number.isFinite(state.viewport.x) || !Number.isFinite(state.viewport.y) || !Number.isFinite(state.viewport.zoom)) {
        state.viewport = {x: 32, y: 32, zoom: .75};
    }
    state.viewport.zoom = clamp(state.viewport.zoom, .12, 1.75);

    const status = el('p', {class: 'sr-only', role: 'status', 'aria-live': 'polite'});
    const storageStatus = el('p', {class: 'small muted schema-storage'}, t(state.storageFailed ? 'app.schema.storageUnavailable' : 'app.schema.local'));
    const summary = el('p', {class: 'small muted'}, t('app.schema.summary', {tables: number(model.tables.length), relationships: number(model.relationships.length)}));
    const search = el('input', {id: 'schema-search', type: 'search', class: 'input', value: state.search, placeholder: t('app.schema.search'), 'aria-label': t('app.schema.search'), autocomplete: 'off'});
    const zoomValue = el('output', {id: 'schema-zoom-value', class: 'schema-zoom-value'});
    const neighborhood = el('input', {type: 'checkbox', id: 'schema-neighborhood', checked: state.neighborhood});
    const fitButton = button(t('app.schema.fit'), fit, {id: 'schema-fit', symbol: 'expand'});
    const zoomOut = button(t('app.schema.zoomOut'), () => zoomBy(1 / 1.2), {id: 'schema-zoom-out', className: 'icon-button'});
    zoomOut.querySelector('span').textContent = '−';
    const zoomIn = button(t('app.schema.zoomIn'), () => zoomBy(1.2), {id: 'schema-zoom-in', symbol: 'plus', className: 'icon-button'});
    zoomIn.querySelector('span').className = 'sr-only';
    const toolbar = el('div', {class: 'schema-toolbar'}, el('label', {class: 'schema-search'}, el('span', {class: 'sr-only'}, t('app.schema.search')), search),
        el('div', {class: 'schema-zoom-controls'}, zoomOut, zoomValue, zoomIn,
            button(t('app.schema.actual'), () => setZoom(1), {id: 'schema-actual'}), fitButton),
        button(t('app.schema.reset'), reset, {id: 'schema-reset', symbol: 'layout'}));
    const panelToggle = button(t('app.schema.panelShow'), () => setPanelCollapsed(!state.panelCollapsed, true), {
        id: 'schema-panel-toggle', symbol: 'layout', 'aria-controls': 'schema-context-panel', 'aria-expanded': String(!state.panelCollapsed),
    });
    toolbar.prepend(panelToggle);
    const help = el('p', {id: 'schema-interaction-help', class: 'small muted schema-help'}, t('app.schema.interactionHelp'));
    const canvas = el('div', {id: 'schema-viewport', class: 'schema-viewport', role: 'region', tabindex: '0', 'aria-label': t('app.schema.canvas'), 'aria-describedby': 'schema-interaction-help schema-canvas-help'});
    const world = el('div', {class: 'schema-world'});
    const lines = svg('svg', {class: 'schema-lines', 'aria-hidden': 'true'});
    world.append(lines);
    canvas.append(world);
    const count = el('p', {class: 'small muted', id: 'schema-visible-count'});
    const index = el('nav', {class: 'schema-index', 'aria-label': t('app.schema.tables')});
    const selected = el('section', {id: 'schema-selected', class: 'schema-selected'});
    const tablesTab = button(t('app.schema.tables'), () => setPanelTab('tables'), {id: 'schema-tab-tables', role: 'tab', 'aria-controls': 'schema-table-panel'});
    const selectionTab = button(t('app.schema.selectionTab'), () => setPanelTab('selection'), {id: 'schema-tab-selection', role: 'tab', 'aria-controls': 'schema-selection-panel'});
    const tabs = el('div', {class: 'schema-panel-tabs', id: 'schema-panel-tabs', role: 'tablist', 'aria-label': t('app.schema.panelTitle')}, tablesTab, selectionTab);
    tabs.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'tables' : event.key === 'End' ? 'selection' : state.panelTab === 'tables' ? 'selection' : 'tables';
        if (next === 'selection' && !state.selected) return;
        setPanelTab(next); (next === 'tables' ? tablesTab : selectionTab).focus();
    });
    const tablePanel = el('section', {id: 'schema-table-panel', role: 'tabpanel', 'aria-labelledby': 'schema-tab-tables', tabindex: '0'}, count, index);
    const selectionPanel = el('section', {id: 'schema-selection-panel', role: 'tabpanel', 'aria-labelledby': 'schema-tab-selection', tabindex: '0'}, selected);
    const panelClose = button(t('app.schema.panelHide'), () => setPanelCollapsed(true, true), {id: 'schema-panel-close', symbol: 'close', className: 'icon-button'});
    panelClose.querySelector('span').className = 'sr-only';
    const panelChrome = el('div', {class: 'schema-panel-chrome'},
        el('div', {class: 'schema-panel-heading'}, el('div', {}, el('p', {class: 'eyebrow'}, t('app.schema.panelEyebrow')), el('h2', {}, t('app.schema.panelTitle'))), panelClose), tabs);
    const sidebar = el('aside', {id: 'schema-context-panel', class: 'card schema-aside', 'aria-label': t('app.schema.panelTitle')},
        panelChrome, tablePanel, selectionPanel);
    sidebar.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); setPanelCollapsed(true, true); } });
    const layout = el('div', {class: 'schema-layout'}, sidebar, el('div', {class: 'schema-board'}, canvas,
        el('p', {id: 'schema-canvas-help', class: 'sr-only'}, t('app.schema.canvasHelp')), help));
    const noMatches = el('div', {class: 'schema-no-matches', hidden: true}, el('p', {}, t('app.schema.noMatches')),
        button(t('app.schema.clear'), () => { search.value = ''; state.search = ''; state.neighborhood = false; neighborhood.checked = false; draw(); fit(); }));
    canvas.append(noMatches);
    root.replaceChildren(el('div', {class: 'schema-workspace'}, toolbar,
        el('div', {class: 'schema-caption'}, summary,
            el('label', {class: 'schema-filter'}, neighborhood, t('app.schema.neighborhood'))),
        layout,
        el('div', {class: 'schema-legend'}, badge('PK'), el('span', {}, t('app.schema.primary')),
            badge('FK'), el('span', {}, t('app.schema.foreign'))),
        el('p', {class: 'small muted'}, t('app.schema.foreignKeyHelp')), storageStatus, status));

    function syncPanel() {
        const collapsed = state.panelCollapsed;
        sidebar.hidden = collapsed;
        sidebar.inert = collapsed;
        layout.classList.toggle('is-panel-collapsed', collapsed);
        panelToggle.setAttribute('aria-expanded', String(!collapsed));
        const toggleLabel = t(collapsed ? 'app.schema.panelShow' : 'app.schema.panelHide');
        panelToggle.setAttribute('aria-label', toggleLabel);
        panelToggle.querySelector('span').textContent = toggleLabel;
        selectionTab.disabled = !state.selected;
        for (const [tab, name, panel] of [[tablesTab, 'tables', tablePanel], [selectionTab, 'selection', selectionPanel]]) {
            const active = state.panelTab === name;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            panel.hidden = !active;
            panel.inert = !active;
        }
    }

    function setPanelTab(name) {
        if (name === 'selection' && !state.selected) return;
        state.panelTab = name;
        syncPanel();
        sidebar.scrollTop = 0;
    }

    function setPanelCollapsed(collapsed, returnFocus = false) {
        const rect = canvas.getBoundingClientRect();
        const center = {x: (rect.width / 2 - state.viewport.x) / state.viewport.zoom, y: (rect.height / 2 - state.viewport.y) / state.viewport.zoom};
        state.panelCollapsed = collapsed;
        syncPanel();
        // Keep the same diagram point at the center when the second menu changes width.
        const next = canvas.getBoundingClientRect();
        state.viewport.x = next.width / 2 - center.x * state.viewport.zoom;
        state.viewport.y = next.height / 2 - center.y * state.viewport.zoom;
        transform();
        if (returnFocus) {
            if (collapsed) panelToggle.focus();
            else {
                (state.panelTab === 'tables' ? tablesTab : selectionTab).focus({preventScroll: true});
                if (window.matchMedia('(max-width: 700px)').matches) sidebar.scrollIntoView({block: 'nearest', behavior: 'auto'});
            }
        }
    }

    function persist() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({version: 1, positions: state.positions}));
            state.storageFailed = false;
        } catch { state.storageFailed = true; }
        storageStatus.textContent = t(state.storageFailed ? 'app.schema.storageUnavailable' : 'app.schema.local');
    }

    function visibleTables() { return filterTables(model, state.search, state.selected, state.neighborhood); }

    function pointToTable(name) {
        const table = lookup.get(name);
        if (!table) return;
        const position = state.positions[name];
        const rect = canvas.getBoundingClientRect();
        state.viewport.zoom = Math.max(state.viewport.zoom, .6);
        state.viewport.x = rect.width / 2 - (position.x + TABLE_WIDTH / 2) * state.viewport.zoom;
        state.viewport.y = rect.height / 2 - (position.y + Math.min(tableHeight(table), rect.height / state.viewport.zoom) / 2) * state.viewport.zoom;
        transform();
    }

    function selectTable(name, center = false, rebuild = true) {
        const fromPanel = sidebar.contains(document.activeElement);
        const resetPanelScroll = state.selected !== name || state.panelTab !== 'selection';
        if (state.selected !== name) state.columnsExpanded = false;
        state.selected = name;
        state.panelSelection = name;
        state.panelTab = 'selection';
        if (center && !visibleTables().some(table => table.name === name)) { state.search = ''; search.value = ''; }
        if (rebuild && (state.neighborhood || center)) draw();
        else { drawSelection(); drawDetails(); }
        syncPanel();
        if (resetPanelScroll) sidebar.scrollTop = 0;
        if (fromPanel && !state.panelCollapsed) selectionTab.focus({preventScroll: true});
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
        const maxY = Math.max(...tables.map(table => state.positions[table.name].y + tableHeight(table)));
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
        const actions = el('div', {class: 'schema-detail-actions'});
        if (onBrowse) actions.append(button(t('app.schema.browse'), () => onBrowse(table.name), {id: 'schema-browse', className: 'button-small', symbol: 'table'}));
        if (onStructure) actions.append(button(t('app.schema.structure'), () => onStructure(table.name), {id: 'schema-structure', className: 'button-small', symbol: 'layers'}));
        const focusConnections = button(t('app.schema.focusConnections'), () => {
            state.neighborhood = true; neighborhood.checked = true; state.search = ''; search.value = ''; draw(); fit();
            selected.querySelector('#schema-focus-connections')?.focus({preventScroll: true});
        }, {id: 'schema-focus-connections', className: 'button-small', symbol: 'link'});
        actions.append(focusConnections);
        const columnDetails = el('details', {class: 'schema-column-details', id: 'schema-column-details'},
            el('summary', {id: 'schema-column-summary'}, t('app.schema.columnDetails')),
            el('ul', {class: 'schema-detail-columns'}, table.columns.map(column => el('li', {},
                el('div', {}, el('code', {}, column.name), column.primary ? badge('PK') : null),
                el('code', {class: 'muted'}, column.type),
                el('span', {class: 'small muted'}, t(column.nullable ? 'app.schema.nullable' : 'app.schema.required'))))));
        columnDetails.open = state.columnsExpanded === true;
        columnDetails.addEventListener('toggle', () => { if (columnDetails.isConnected) state.columnsExpanded = columnDetails.open; });
        selected.append(actions, columnDetails, el('h3', {}, t('app.schema.relationships')));
        const relationships = model.relationships.filter(relation => relation.sourceTable === table.name || (!relation.external && relation.targetTable === table.name));
        if (!relationships.length) selected.append(el('p', {class: 'small muted'}, t('app.schema.noRelationships')));
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
            selected.append(item);
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
        const height = Math.max(1000, ...visibleTables().map(table => state.positions[table.name].y + tableHeight(table) + 100));
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
                const sy = sourcePosition.y + HEADER_HEIGHT + sourceIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                const ty = targetPosition.y + HEADER_HEIGHT + targetIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
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
        const node = el('article', {class: 'schema-node', 'data-schema-node': table.name, style: `width:${TABLE_WIDTH}px;height:${tableHeight(table)}px`}, header);
        node.append(el('ul', {class: 'schema-columns'}, table.columns.map(column => {
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
        if (!table.columns.length) node.append(el('p', {class: 'schema-no-columns small muted'}, t('app.schema.noColumns')));
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

    function draw() {
        const visible = visibleTables();
        nodes.clear(); world.querySelectorAll('.schema-node').forEach(node => node.remove());
        for (const table of visible) { const node = makeNode(table); nodes.set(table.name, node); world.append(node); }
        noMatches.hidden = visible.length > 0;
        count.textContent = t('app.schema.visible', {count: number(visible.length)});
        index.replaceChildren(...visible.map(table => button(table.name, () => selectTable(table.name, true), {id: 'schema-index-' + encodeURIComponent(table.name), 'data-schema-select': table.name, className: 'schema-index-item', symbol: table.type === 'view' ? 'eye' : 'table'})));
        drawDetails(); drawLines(); transform(); syncPanel();
    }

    search.addEventListener('input', () => { state.search = search.value; state.panelTab = 'tables'; draw(); fit(); sidebar.scrollTop = 0; });
    neighborhood.addEventListener('change', () => {
        state.neighborhood = neighborhood.checked;
        state.search = ''; search.value = '';
        draw(); fit();
    });
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
        root.replaceChildren(empty(t('app.schema.empty'), t('app.schema.emptyHelp'), null, 'layers'));
    } else {
        draw();
        if (!model.relationships.length) root.append(el('p', {class: 'small muted schema-help'}, t('app.schema.noConnections')));
        if (needsInitialFit && !state.selected) fit();
        if (state.selected && state.centeredSelected !== state.selected) { pointToTable(state.selected); state.centeredSelected = state.selected; }
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => { if (!destroyed) transform(); });
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
