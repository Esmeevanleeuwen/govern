import {request} from './api.js';
import {el, icon, button, badge, loading, empty, errorPanel, notice, number} from './ui.js';
import {t, hasMessage} from './i18n.js';
import {recordPositions, visibleNeighborhood, valueText, tableColor, RECORD_WIDTH, RECORD_HEIGHT} from './record-explorer-model.js';
import {friendlyName, recordLabel, connectedGroups, getExplorerMode, setExplorerMode, connectionDescription, renderExplorerGuide} from './explorer-guide.js';
import './explorer-messages.js';

let instanceId = 0;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const svg = (name, attributes = {}, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
};
const short = (text, length) => [...String(text)].length > length ? [...String(text)].slice(0, length - 1).join('') + '…' : String(text);

/** Bounded, catalog-derived record neighborhoods; never a writer connection. */
export function mountRecordExplorer(root, {database, tables = [], state = {}, initialTable,
    signal, isLive = () => true, onSelectTable = () => {}, onExperienceChange = () => {}} = {}) {
    const names = new Set(tables.map(table => table.name));
    const initial = names.has(initialTable) ? initialTable : names.has(state.table) ? state.table : tables[0]?.name || '';
    if (state.scope_key !== database || state.table !== initial) Object.assign(state, {
        scope_key: database, table: initial, rootKey: null, search: '', selected: '', selectedEdge: '', enabledRelations: null, zoom: 1, pan: {x: 0, y: 0}});
    state.search = typeof state.search === 'string' ? state.search : '';
    state.zoom = Number.isFinite(state.zoom) ? clamp(state.zoom, 0.5, 4) : 1;
    state.pan = state.pan && Number.isFinite(state.pan.x) && Number.isFinite(state.pan.y) ? state.pan : {x: 0, y: 0};
    if (!Array.isArray(state.enabledRelations)) state.enabledRelations = null;
    let destroyed = false, busy = false, controller, revision = 0, data = null, visible, graph, bounds, pointer;
    let experience = getExplorerMode();
    const guided = () => experience === 'guided';
    const categoryName = name => guided() ? friendlyName(name) : name;
    const itemName = node => guided() ? recordLabel(node, node.table || state.table) : node.label;
    const nodeElements = new Map(), edgeElements = new Map(), rows = new Map();
    const markerId = 'explorer-arrow-' + ++instanceId;
    const live = () => !destroyed && !signal?.aborted && isLive();
    const tableSelect = el('select', {id: 'explorer-table', class: 'input', 'aria-label': t('app.explorer.table')},
        tables.map(table => el('option', {value: table.name, selected: table.name === state.table}, table.name)));
    const recordSelect = el('select', {id: 'explorer-record', class: 'input', 'aria-label': t('app.explorer.record'), disabled: true});
    const search = el('input', {id: 'explorer-filter', class: 'input', type: 'search', value: state.search,
        maxlength: 200, placeholder: t('app.explorer.filterPlaceholder'), 'aria-label': t('app.explorer.filter')});
    const refresh = button(t('app.explorer.refresh'), () => load(state.table, state.rootKey), {symbol: 'refresh', className: 'button-small'});
    const errorRoot = el('div', {class: 'record-explorer-error'});
    const guideRoot = el('div', {class: 'record-explorer-guide-root'});
    const summary = el('div', {class: 'record-explorer-summary', role: 'status', 'aria-live': 'polite'});
    const relationRoot = el('fieldset', {class: 'record-explorer-relations'});
    const relationSummary = el('summary', {}, t('app.explorer.relationships'));
    const relationPanel = el('details', {id: 'explorer-relationships', class: 'record-explorer-relationship-panel', ...(state.relationshipsOpen ? {open: true} : {})}, relationSummary, relationRoot);
    relationPanel.addEventListener('toggle', () => { state.relationshipsOpen = relationPanel.open; });
    const graphRoot = el('div', {class: 'record-explorer-viewport'});
    const zoomValue = el('span', {class: 'record-explorer-zoom', 'aria-live': 'polite'});
    const graphCard = el('section', {class: 'record-explorer-graph-card', 'aria-labelledby': 'explorer-graph-title'},
        el('div', {class: 'record-explorer-section-heading'}, el('div', {}, el('h3', {id: 'explorer-graph-title'}, t('app.explorer.graph')),
            el('p', {class: 'small muted'}, t('app.explorer.graphHelp'))),
        el('div', {class: 'record-explorer-zoom-controls'},
            button('−', () => setZoom(state.zoom / 1.25), {'aria-label': t('app.explorer.zoomOut'), className: 'button-small'}), zoomValue,
            button('+', () => setZoom(state.zoom * 1.25), {'aria-label': t('app.explorer.zoomIn'), className: 'button-small'}),
            button(t('app.explorer.fit'), () => { state.pan = {x: 0, y: 0}; setZoom(1); }, {symbol: 'expand', className: 'button-small'}))),
        graphRoot, el('p', {class: 'record-explorer-filter-help small muted'}, t('app.explorer.localFilterHelp')));
    const recordsRoot = el('div', {class: 'record-explorer-records'});
    const drawer = el('aside', {id: 'explorer-detail', class: 'record-explorer-detail', 'aria-label': t('app.explorer.detail')});
    const limitsRoot = el('details', {class: 'record-explorer-limits'});
    const field = (label, input) => el('label', {class: 'record-explorer-field'}, el('span', {}, label), input);
    const tableField = field(t('app.explorer.table'), tableSelect), recordField = field(t('app.explorer.record'), recordSelect), searchField = field(t('app.explorer.filter'), search);
    const guidedButton = button(t('app.explorerGuide.guided'), () => changeExperience('guided'), {id: 'explorer-mode-guided', 'aria-pressed': String(guided())});
    const detailedButton = button(t('app.explorerGuide.detailed'), () => changeExperience('detailed'), {id: 'explorer-mode-detailed', 'aria-pressed': String(!guided())});
    const shell = el('section', {class: 'record-explorer', 'data-record-explorer': '', 'aria-busy': 'false'},
        el('div', {class: 'record-explorer-introduction'}, el('div', {}, el('p', {class: 'eyebrow'}, t('app.explorer.eyebrow')),
            el('p', {}, t('app.explorer.introduction'))), badge(t('app.explorer.readOnly'), 'badge-blue')),
        el('div', {class: 'record-explorer-mode', role: 'group', 'aria-label': t('app.explorerGuide.modeLabel')}, guidedButton, detailedButton),
        el('div', {class: 'record-explorer-controls'}, tableField, recordField, searchField, refresh), errorRoot, summary, guideRoot, relationPanel,
        el('div', {class: 'record-explorer-layout'}, el('div', {class: 'record-explorer-main'}, graphCard, recordsRoot), drawer), limitsRoot);
    root.replaceChildren(shell); graphRoot.append(loading(t('app.explorer.loading')));
    drawer.append(el('p', {class: 'eyebrow'}, t('app.explorer.detail')), el('p', {class: 'muted'}, t('app.explorer.chooseRecord')));
    tableSelect.addEventListener('change', () => load(tableSelect.value, null, true));
    recordSelect.addEventListener('change', () => {
        const candidate = data?.candidates.find(item => item.id === recordSelect.value) || data?.nodes.find(item => item.id === recordSelect.value);
        if (candidate) load(state.table, candidate.key, true);
    });
    search.addEventListener('input', () => { state.search = search.value; draw(); });
    signal?.addEventListener('abort', destroy, {once: true});
    function updateExperience() {
        shell.dataset.experience = experience;
        guidedButton.setAttribute('aria-pressed', String(guided())); detailedButton.setAttribute('aria-pressed', String(!guided()));
        relationPanel.hidden = guided(); guideRoot.hidden = !guided();
        for (const [wrapper, input, easy, detailed] of [[tableField, tableSelect, 'category', 'table'], [recordField, recordSelect, 'item', 'record'], [searchField, search, 'search', 'filter']]) {
            const text = t('app.' + (guided() ? 'explorerGuide.' + easy : 'explorer.' + detailed));
            wrapper.firstElementChild.textContent = text; input.setAttribute('aria-label', text);
        }
        for (const option of tableSelect.options) option.textContent = categoryName(option.value);
        shell.querySelector('.record-explorer-introduction .eyebrow').hidden = guided();
        shell.querySelector('.record-explorer-introduction > div > p:last-child').textContent = t(guided() ? 'app.explorerGuide.introduction' : 'app.explorer.introduction');
        graphCard.querySelector('h3').textContent = t(guided() ? 'app.explorerGuide.graph' : 'app.explorer.graph');
        graphCard.querySelector('.record-explorer-section-heading p').textContent = t(guided() ? 'app.explorerGuide.graphHelp' : 'app.explorer.graphHelp');
        if (data) updateCandidates();
    }
    function changeExperience(mode) {
        if (!live() || !['guided', 'detailed'].includes(mode)) return;
        experience = mode; setExplorerMode(mode); updateExperience();
        if (data) { draw(); drawLimits(); }
        onExperienceChange(mode);
    }
    function updateCandidates() {
        const candidates = [...data.candidates], center = data.nodes.find(node => node.id === data.center);
        if (center && !candidates.some(node => node.id === center.id)) candidates.unshift(center);
        recordSelect.replaceChildren(...candidates.map(node => el('option', {value: node.id, selected: node.id === data.center}, itemName(node))));
    }
    function setBusy(value) {
        busy = value; shell.setAttribute('aria-busy', String(value));
        tableSelect.disabled = value || !tables.length; recordSelect.disabled = value || !data?.candidates?.length;
        refresh.disabled = value || !state.table; search.disabled = value || !data;
        for (const input of relationRoot.querySelectorAll('input,button')) input.disabled = value;
        guideRoot.inert = value;
        guideRoot.setAttribute('aria-disabled', String(value));
        if (value) summary.replaceChildren(el('span', {}, t('app.explorer.loading')));
    }
    async function load(table, key = null, clear = false, focusCenter = false) {
        if (!live() || !names.has(table)) return;
        controller?.abort(); controller = new AbortController();
        const active = controller, current = ++revision; setBusy(true); errorRoot.replaceChildren();
        try {
            const result = await request('explore', {params: {database, table, ...(key ? {key: JSON.stringify(key)} : {})}, signal: active.signal});
            if (!live() || current !== revision || active.signal.aborted) return;
            if (result.scope_key !== database) throw new Error(t('app.explorer.scopeChanged'));
            data = result; state.table = data.table;
            state.rootKey = data.nodes.find(node => node.id === data.center)?.key || null;
            if (clear) Object.assign(state, {search: '', enabledRelations: null, selected: data.center, selectedEdge: '', zoom: 1, pan: {x: 0, y: 0}});
            if (!data.nodes.some(node => node.id === state.selected)) state.selected = data.center;
            if (!data.edges.some(edge => edge.id === state.selectedEdge)) state.selectedEdge = '';
            tableSelect.value = state.table; search.value = state.search;
            updateCandidates();
            drawRelations(); draw(); drawLimits(); onSelectTable(data.table);
            if (focusCenter) {
                if (guided()) graphRoot.scrollIntoView({block: 'center'});
                nodeElements.get(data.center)?.focus({preventScroll: true});
            }
        } catch (error) {
            if (!live() || current !== revision || error.name === 'AbortError') return;
            tableSelect.value = state.table;
            errorRoot.replaceChildren(errorPanel(error, () => load(table, key)),
                button(t('app.explorer.reset'), () => load(table, null, true), {symbol: 'refresh', className: 'button-small'}));
            if (!data) graphRoot.replaceChildren(empty(t('app.explorer.emptyTitle'), t('app.explorer.emptyHelp')));
        } finally {
            if (live() && current === revision) { setBusy(false); updateSummary(); updateSelection(); }
        }
    }
    function drawRelations() {
        relationSummary.replaceChildren(t('app.explorer.relationships'), el('span', {class: 'record-explorer-relation-count'}, number(data.relations.length)));
        relationRoot.replaceChildren(el('legend', {class: 'sr-only'}, t('app.explorer.relationships')));
        if (!data.relations.length) { relationRoot.append(el('p', {class: 'small muted'}, t('app.explorer.noRelationships'))); return; }
        relationRoot.append(el('span', {class: 'small muted'}, t('app.explorer.relationshipsHelp')),
            button(t('app.explorer.allRelationships'), () => { state.enabledRelations = null; drawRelations(); draw(); }, {kind: 'ghost', className: 'button-small'}));
        const choices = el('div', {class: 'record-explorer-relation-choices'});
        for (const relation of data.relations) {
            const input = el('input', {type: 'checkbox', 'data-explorer-relation': relation.id,
                checked: state.enabledRelations === null || state.enabledRelations.includes(relation.id)});
            input.addEventListener('change', () => {
                const enabled = new Set(state.enabledRelations === null ? data.relations.map(item => item.id) : state.enabledRelations);
                if (input.checked) enabled.add(relation.id); else enabled.delete(relation.id);
                state.enabledRelations = [...enabled]; draw();
            });
            choices.append(el('label', {class: 'record-explorer-relation-choice'}, input, el('span', {},
                el('span', {class: 'record-explorer-relation-name'}, relation.name), el('small', {}, relation.source_table + ' → ' + relation.target_table))));
        }
        relationRoot.append(choices);
    }
    function draw() {
        if (!data || !live()) return;
        visible = visibleNeighborhood(data, guided() ? {...state, searchLabels: node => [categoryName(node.table), itemName(node)]} : state);
        if (!visible.edges.some(edge => edge.id === state.selectedEdge)) state.selectedEdge = '';
        if (!visible.nodes.some(node => node.id === state.selected)) state.selected = data.center;
        drawGraph(); drawTable(); updateSelection(); updateSummary(); drawGuide();
    }
    function drawGuide() {
        if (!guided() || !data) return;
        const active = document.activeElement, hadFocus = guideRoot.contains(active);
        const activeId = active?.id, activeGroup = active?.getAttribute?.('data-guide-group');
        const previousChoice = guideRoot.querySelector('#explorer-guide-item')?.value;
        const previousQuestions = guideRoot.querySelector('#explorer-guide-questions');
        if (previousQuestions) state.guideQuestionsOpen = previousQuestions.open;
        const resetFilters = () => { state.enabledRelations = null; state.search = ''; search.value = ''; state.selectedEdge = ''; };
        guideRoot.replaceChildren(renderExplorerGuide(data, {
            selectedId: previousChoice || state.selected,
            onShowAll: () => {
                if (busy || !live()) return;
                resetFilters(); drawRelations(); draw();
            },
            onShowGroup: group => {
                if (busy || !live()) return;
                const chosen = connectedGroups(data).find(item => item.table === group.table);
                if (!chosen) return;
                resetFilters(); state.enabledRelations = [...chosen.relationIds]; drawRelations(); draw();
            },
            onExplain: id => {
                if (busy || !live()) return;
                const edge = data.edges.find(item => item.source === id && item.target === data.center || item.target === id && item.source === data.center);
                if (!edge) return;
                resetFilters(); drawRelations(); draw(); selectEdge(edge.id, true);
                drawer.scrollIntoView({block: 'nearest'});
            },
            onFollow: id => {
                if (busy || !live()) return;
                const node = data.nodes.find(item => item.id === id);
                if (node) load(node.table, node.key, true, true);
            },
        }));
        const questions = guideRoot.querySelector('#explorer-guide-questions');
        if (questions) {
            questions.open = Boolean(state.guideQuestionsOpen);
            questions.addEventListener('toggle', () => { state.guideQuestionsOpen = questions.open; });
        }
        const groups = connectedGroups(data), enabled = state.enabledRelations === null ? null : new Set(state.enabledRelations);
        for (const control of guideRoot.querySelectorAll('[data-guide-group]')) {
            const group = groups.find(item => item.table === control.dataset.guideGroup);
            control.setAttribute('aria-pressed', String(!!enabled && !state.search && enabled.size === group.relationIds.length && group.relationIds.every(id => enabled.has(id))));
        }
        guideRoot.querySelector('[data-guide-all]')?.setAttribute('aria-pressed', String(enabled === null && !state.search));
        guideRoot.inert = busy;
        if (hadFocus) {
            const replacement = activeId ? guideRoot.querySelector('#' + CSS.escape(activeId))
                : activeGroup !== null ? [...guideRoot.querySelectorAll('[data-guide-group]')].find(control => control.dataset.guideGroup === activeGroup) : null;
            replacement?.focus({preventScroll: true});
        }
    }
    function updateSummary() {
        if (!data || busy) return;
        const content = [el('strong', {}, t(guided() ? 'app.explorerGuide.visibleItems' : 'app.explorer.recordCount', {shown: number(visible?.nodes.length || 0), loaded: number(data.nodes.length)})),
            el('span', {}, t(guided() ? 'app.explorerGuide.visibleLinks' : 'app.explorer.linkCount', {count: number(visible?.edges.length || 0)}))];
        if (!guided()) content.push(el('span', {class: 'muted'}, t('app.explorer.queryTime', {time: number(Math.round(Number(data.elapsed_ms) || 0))})));
        summary.replaceChildren(...content);
        if (data.partial) summary.append(el('span', {class: 'record-explorer-partial'}, icon('info'), t('app.explorer.partial')));
    }
    function activate(element, callback) {
        element.addEventListener('click', () => { if (!busy) callback(); });
        element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy) callback(); }
        });
    }
    function drawGraph() {
        nodeElements.clear(); edgeElements.clear(); graph = null;
        if (!visible.nodes.length) {
            const keyless = data.omitted.some(item => item.code === 'keyless' || item.code === 'unsupported_key');
            graphRoot.replaceChildren(empty(t(keyless ? guided() ? 'app.explorerGuide.unavailableTitle' : 'app.explorer.keylessTitle' : 'app.explorer.emptyTitle'), t(keyless ? guided() ? 'app.explorerGuide.unavailableHelp' : 'app.explorer.keylessHelp' : 'app.explorer.emptyHelp'))); return;
        }
        const layout = recordPositions(visible.nodes, data.center); bounds = layout.bounds;
        graph = svg('svg', {class: 'record-explorer-graph', tabindex: '0', 'aria-label': t('app.explorer.graph'), preserveAspectRatio: 'xMidYMid meet'});
        const definitions = svg('defs'), marker = svg('marker', {id: markerId, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'});
        marker.append(svg('path', {d: 'M 0 1 L 9 5 L 0 9 z', class: 'record-explorer-arrow'})); definitions.append(marker); graph.append(definitions);
        const edgeLayer = svg('g'), nodeLayer = svg('g'); graph.append(edgeLayer, nodeLayer);
        visible.edges.forEach((edge, index) => {
            const source = layout.positions.get(edge.source), target = layout.positions.get(edge.target);
            if (!source || !target) return;
            const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
            const offset = Math.min(RECORD_WIDTH / 2 / (Math.abs(dx) / length || 0.00001), RECORD_HEIGHT / 2 / (Math.abs(dy) / length || 0.00001));
            const start = {x: source.x + dx / length * offset, y: source.y + dy / length * offset};
            const end = {x: target.x - dx / length * (offset + 6), y: target.y - dy / length * (offset + 6)};
            const bend = (index % 3 - 1) * 18;
            const path = edge.source === edge.target
                ? `M ${source.x - 40} ${source.y - RECORD_HEIGHT / 2} C ${source.x - 140} ${source.y - 160}, ${source.x + 140} ${source.y - 160}, ${source.x + 40} ${source.y - RECORD_HEIGHT / 2}`
                : `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2 - dy / length * bend} ${(start.y + end.y) / 2 + dx / length * bend} ${end.x} ${end.y}`;
            const group = svg('g', {class: 'record-explorer-edge', role: 'button', tabindex: '0', 'data-explorer-edge': edge.id,
                'aria-label': guided() ? t('app.explorerGuide.inspectLink', {label: categoryName(edge.source_table) + ' → ' + categoryName(edge.target_table)}) : t('app.explorer.inspectConnection', {name: edge.name}), 'aria-pressed': 'false'});
            group.append(svg('title', {}, guided() ? categoryName(edge.source_table) + ' → ' + categoryName(edge.target_table) : edge.name + ': ' + edge.source_table + ' → ' + edge.target_table),
                svg('path', {d: path, class: 'record-explorer-edge-hit'}), svg('path', {d: path, class: 'record-explorer-edge-line', 'marker-end': 'url(#' + markerId + ')'}));
            activate(group, () => selectEdge(edge.id)); edgeLayer.append(group); edgeElements.set(edge.id, group);
        });
        for (const node of visible.nodes) {
            const position = layout.positions.get(node.id);
            const group = svg('g', {class: 'record-explorer-node', role: 'button', tabindex: '0',
                transform: `translate(${position.x - RECORD_WIDTH / 2} ${position.y - RECORD_HEIGHT / 2})`, 'data-explorer-node': node.id,
                'data-color': tableColor(node.table), 'data-focus': String(node.id === data.center), 'data-context': String(visible.context.has(node.id)),
                'aria-label': t(guided() ? 'app.explorerGuide.inspectItem' : 'app.explorer.inspect', {label: itemName(node)}), 'aria-pressed': 'false'});
            group.append(svg('title', {}, itemName(node) + '\n' + categoryName(node.table)), svg('rect', {width: RECORD_WIDTH, height: RECORD_HEIGHT, rx: 16, class: 'record-explorer-node-surface'}),
                svg('circle', {cx: 16, cy: 19, r: 4, class: 'record-explorer-node-dot'}), svg('text', {x: 27, y: 23, class: 'record-explorer-node-table'}, short(categoryName(node.table), 22)),
                svg('text', {x: 14, y: 49, class: 'record-explorer-node-label'}, short(itemName(node), 20)));
            activate(group, () => selectNode(node.id)); nodeLayer.append(group); nodeElements.set(node.id, group);
        }
        graph.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('[role="button"]')) return;
            pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, pan: {...state.pan}}; graph.setPointerCapture(event.pointerId); graph.classList.add('is-panning');
        });
        graph.addEventListener('pointermove', event => {
            if (!pointer || event.pointerId !== pointer.id) return;
            const rectangle = graph.getBoundingClientRect(), units = Math.max(bounds.width / rectangle.width, bounds.height / rectangle.height) / state.zoom;
            state.pan = {x: pointer.pan.x - (event.clientX - pointer.x) * units, y: pointer.pan.y - (event.clientY - pointer.y) * units}; updateViewport();
        });
        const stop = () => { pointer = null; graph?.classList.remove('is-panning'); };
        graph.addEventListener('pointerup', stop); graph.addEventListener('pointercancel', stop);
        graph.addEventListener('keydown', event => {
            if (event.target !== graph || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); const step = 60 / state.zoom;
            state.pan = {x: state.pan.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
                y: state.pan.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)}; updateViewport();
        });
        graphRoot.replaceChildren(graph); updateViewport();
    }
    function setZoom(value) { state.zoom = clamp(value, 0.5, 4); updateViewport(); }
    function updateViewport() {
        zoomValue.textContent = Math.round(state.zoom * 100) + '%'; zoomValue.setAttribute('aria-label', t('app.explorer.zoom', {percent: Math.round(state.zoom * 100)}));
        if (!graph || !bounds) return;
        const width = bounds.width / state.zoom, height = bounds.height / state.zoom;
        graph.setAttribute('viewBox', [bounds.x + bounds.width / 2 - width / 2 + state.pan.x, bounds.y + bounds.height / 2 - height / 2 + state.pan.y, width, height].join(' '));
    }
    function drawTable() {
        rows.clear();
        const table = el('table', {class: 'data-table record-explorer-table'}, el('caption', {class: 'sr-only'}, t('app.explorer.records')),
            el('thead', {}, el('tr', {}, [t(guided() ? 'app.explorerGuide.itemColumn' : 'app.explorer.recordColumn'), t(guided() ? 'app.explorerGuide.categoryColumn' : 'app.explorer.tableColumn'), t('app.explorer.linksColumn')].map(label => el('th', {scope: 'col'}, label)))));
        const body = el('tbody');
        for (const node of visible.nodes) {
            const recordButton = el('button', {type: 'button', class: 'record-explorer-row-button', 'aria-label': t(guided() ? 'app.explorerGuide.inspectItem' : 'app.explorer.inspect', {label: itemName(node)}),
                'aria-pressed': 'false', on: {click: () => selectNode(node.id)}}, el('span', {class: 'record-explorer-color-dot', 'data-color': tableColor(node.table)}),
                el('span', {}, el('strong', {}, itemName(node)), guided() ? null : el('small', {class: 'record-explorer-key'}, Object.entries(node.key || {}).map(([key, value]) => key + '=' + valueText(value)).join(' · '))),
                node.id === data.center ? badge(t(guided() ? 'app.explorerGuide.focus' : 'app.explorer.focus')) : null);
            const row = el('tr', {'data-explorer-row': node.id}, el('td', {}, recordButton), el('td', {class: 'record-explorer-table-name'}, categoryName(node.table)),
                el('td', {}, number(visible.edges.filter(edge => edge.source === node.id || edge.target === node.id).length)));
            body.append(row); rows.set(node.id, row);
        }
        table.append(body); recordsRoot.replaceChildren(el('div', {class: 'record-explorer-section-heading'}, el('h3', {}, t(guided() ? 'app.explorerGuide.records' : 'app.explorer.records'))),
            el('div', {class: 'table-scroll', tabindex: '0', 'aria-label': t('app.explorer.records')}, table));
    }
    function selectNode(id, focusDrawer = false) {
        if (busy) return;
        state.selected = id; state.selectedEdge = ''; updateSelection();
        const row = rows.get(id), scroller = recordsRoot.querySelector('.table-scroll');
        if (row && scroller) {
            const record = row.getBoundingClientRect(), frame = scroller.getBoundingClientRect();
            const top = frame.top + (scroller.querySelector('thead')?.getBoundingClientRect().height || 0);
            if (record.top < top || record.height > frame.bottom - top) scroller.scrollTop += record.top - top;
            else if (record.bottom > frame.bottom) scroller.scrollTop += record.bottom - frame.bottom;
        }
        if (focusDrawer) drawer.querySelector('h3')?.focus({preventScroll: true});
    }
    function selectEdge(id, focusDrawer = false) {
        state.selectedEdge = id; updateSelection(); if (focusDrawer) drawer.querySelector('h3')?.focus({preventScroll: true});
    }
    function updateSelection() {
        if (!data) return;
        const selectedEdge = data.edges.find(edge => edge.id === state.selectedEdge);
        for (const [id, element] of nodeElements) {
            const selected = id === state.selected && !selectedEdge;
            element.setAttribute('data-selected', String(selected)); element.setAttribute('aria-pressed', String(selected));
            element.setAttribute('data-related', String(!!selectedEdge && [selectedEdge.source, selectedEdge.target].includes(id)));
        }
        for (const [id, row] of rows) {
            const selected = id === state.selected && !selectedEdge;
            row.setAttribute('data-selected', String(selected)); row.querySelector('button').setAttribute('aria-pressed', String(selected));
        }
        const lookup = new Map(data.edges.map(edge => [edge.id, edge]));
        for (const [id, element] of edgeElements) {
            const edge = lookup.get(id); element.setAttribute('data-selected', String(id === state.selectedEdge)); element.setAttribute('aria-pressed', String(id === state.selectedEdge));
            element.setAttribute('data-related', String(!selectedEdge && [edge.source, edge.target].includes(state.selected)));
        }
        if (selectedEdge) drawEvidence(selectedEdge); else drawRecord(data.nodes.find(node => node.id === state.selected));
    }
    function valuesList(values, friendly = false) {
        return el('dl', {class: 'record-explorer-values'}, Object.entries(values || {}).map(([name, value]) =>
            el('div', {}, el('dt', {}, friendly ? friendlyName(name) : name), el('dd', {class: value === null ? 'null-value' : ''}, valueText(value)))));
    }
    function technicalDetails(...children) {
        const details = el('details', {'data-explorer-technical': '', class: 'record-explorer-technical', ...(state.technicalOpen ? {open: true} : {})},
            el('summary', {}, t('app.explorerGuide.technicalDetails')), children);
        details.addEventListener('toggle', () => { if (details.isConnected) state.technicalOpen = details.open; });
        return details;
    }
    function drawRecord(node) {
        drawer.replaceChildren(el('p', {class: 'eyebrow'}, t(guided() ? 'app.explorerGuide.detail' : 'app.explorer.detail')));
        if (!node) { drawer.removeAttribute('data-explorer-selected'); drawer.append(el('p', {class: 'muted'}, t('app.explorer.chooseRecord'))); return; }
        drawer.setAttribute('data-explorer-selected', node.id);
        drawer.append(el('p', {class: 'record-explorer-detail-table'}, categoryName(node.table)), el('h3', {tabindex: '-1'}, itemName(node)),
            button(t(node.id === data.center ? guided() ? 'app.explorerGuide.alreadyFocus' : 'app.explorer.alreadyFocus' : guided() ? 'app.explorerGuide.follow' : 'app.explorer.expand'), () => load(node.table, node.key, true, true),
                {id: 'explorer-expand', symbol: 'network', disabled: busy || node.id === data.center}));
        if (guided()) {
            const identifiers = new Set(Object.keys(node.key).filter(name => /(^id$|_id$|^uuid$)/i.test(name)));
            for (const edge of data.edges) {
                if (edge.source === node.id) edge.columns.forEach(name => identifiers.add(name));
                if (edge.target === node.id) edge.referenced_columns.forEach(name => identifiers.add(name));
            }
            const values = Object.fromEntries(Object.entries(node.values).filter(([name]) => !identifiers.has(name)));
            if (Object.keys(values).length) drawer.append(el('h4', {}, t('app.explorerGuide.itemValues')), valuesList(values, true));
            drawer.append(technicalDetails(el('p', {}, t('app.explorerGuide.originalName')), el('code', {}, node.table),
                el('h4', {}, t('app.explorer.key')), valuesList(node.key), el('h4', {}, t('app.explorer.fields')), valuesList(node.values)));
        } else drawer.append(el('h4', {}, t('app.explorer.key')), valuesList(node.key), el('h4', {}, t('app.explorer.fields')), valuesList(node.values));
        if (node.truncated) drawer.append(notice(t('app.explorer.preview')));
        const related = (visible?.edges || []).filter(edge => edge.source === node.id || edge.target === node.id);
        drawer.append(el('h4', {}, t(guided() ? 'app.explorerGuide.linkedItems' : 'app.explorer.recordLinks')));
        if (!related.length) drawer.append(el('p', {class: 'small muted'}, t(guided() ? 'app.explorerGuide.noLinks' : 'app.explorer.noRelationships')));
        else drawer.append(el('div', {class: 'record-explorer-record-links'}, related.map(edge => {
            const other = data.nodes.find(item => item.id === (edge.source === node.id ? edge.target : edge.source));
            return el('button', {type: 'button', class: 'record-explorer-record-link', on: {click: () => selectEdge(edge.id, true)}},
                icon('link'), el('span', {}, el('strong', {}, other ? itemName(other) : guided() ? categoryName(edge.target_table) : edge.name),
                    el('small', {}, guided() ? categoryName(other?.table || edge.target_table) : edge.name)));
        })));
    }
    function drawEvidence(edge) {
        drawer.removeAttribute('data-explorer-selected');
        const source = data.nodes.find(node => node.id === edge.source), target = data.nodes.find(node => node.id === edge.target);
        const mapping = edge.columns.map((column, index) => el('tr', {},
            el('td', {}, el('strong', {}, edge.source_table + '.' + column), el('code', {}, valueText(edge.source_values?.[column]))),
            el('td', {}, el('strong', {}, edge.target_table + '.' + edge.referenced_columns[index]), el('code', {}, valueText(edge.target_values?.[edge.referenced_columns[index]])))));
        const original = el('div', {}, el('code', {class: 'record-explorer-constraint'}, edge.name),
            el('div', {class: 'table-scroll'}, el('table', {class: 'data-table record-explorer-evidence-table'},
                el('thead', {}, el('tr', {}, el('th', {}, t('app.explorer.sourceColumn')), el('th', {}, t('app.explorer.targetColumn')))), el('tbody', {}, mapping))));
        drawer.replaceChildren(el('section', {'data-explorer-evidence': edge.id}, el('p', {class: 'eyebrow'}, t(guided() ? 'app.explorerGuide.detail' : 'app.explorer.detail')),
            el('h3', {tabindex: '-1'}, t('app.explorer.connectionTitle')),
            el('p', {class: 'small muted'}, guided() ? connectionDescription(edge, source, target) : t('app.explorer.connectionHelp')),
            el('div', {class: 'record-explorer-endpoint'}, el('small', {}, guided() ? categoryName(edge.source_table) : t('app.explorer.source')), el('strong', {}, source ? itemName(source) : categoryName(edge.source_table))),
            el('div', {class: 'record-explorer-endpoint'}, el('small', {}, guided() ? categoryName(edge.target_table) : t('app.explorer.target')), el('strong', {}, target ? itemName(target) : categoryName(edge.target_table))),
            guided() ? technicalDetails(original) : original,
            el('div', {class: 'record-explorer-evidence-actions'},
                source ? button(t('app.explorer.openSource'), () => selectNode(source.id, true), {kind: 'ghost', className: 'button-small'}) : null,
                target ? button(t('app.explorer.openTarget'), () => selectNode(target.id, true), {kind: 'ghost', className: 'button-small'}) : null)));
    }
    function drawLimits() {
        const reasons = [...new Set(data.omitted.map(item => item.code))];
        limitsRoot.replaceChildren(el('summary', {}, t('app.explorer.limits')), el('p', {}, t('app.explorer.bounded')),
            el('p', {class: 'small muted'}, t('app.explorer.limitsHelp')),
            el('p', {class: 'small muted'}, t('app.explorer.limitsValues', {nodes: data.limits.max_nodes, edges: data.limits.max_edges, neighbors: data.limits.per_relation})),
            reasons.length ? el('ul', {}, reasons.filter(code => hasMessage('app.explorer.omitted.' + code)).map(code => el('li', {}, t('app.explorer.omitted.' + code)))) : null);
    }
    function destroy() { destroyed = true; controller?.abort(); pointer = null; signal?.removeEventListener('abort', destroy); }
    const ready = initial ? load(initial, state.rootKey) : Promise.resolve();
    if (!initial) { graphRoot.replaceChildren(empty(t('app.explorer.emptyTitle'), t('app.explorer.emptyHelp'))); setBusy(false); }
    updateExperience(); updateViewport(); return {destroy, ready};
}
