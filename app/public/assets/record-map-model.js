/** Shared record selection and graph state; no storage or database side effects. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPoint = value => object(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const layouts = new Set(['orbit', 'flow', 'manual']);
const undoLimit = 25;
const overlaps = (point, occupied) => occupied.some(other => Math.abs(other.x - point.x) < 240 && Math.abs(other.y - point.y) < 160);
const nodeIds = (state, ids) => [...new Set(typeof ids === 'string' ? [ids]
    : ids && typeof ids[Symbol.iterator] === 'function' ? ids : [])].filter(id => typeof id === 'string' && state.nodes.has(id));

export function ensureRecordMapState(state = {}, scopeKey = '') {
    if (state.scope_key !== scopeKey) {
        Object.assign(state, {scope_key: scopeKey, nodes: new Map(), edges: new Map(), positions: new Map(),
            details: new Map(), cursors: new Map(), expansions: new Map(), hiddenTables: new Set(), selection: null,
            selectedNodes: new Set(), pinned: new Set(), hiddenNodes: new Set(), hiddenEdges: new Set(), undoStack: [],
            layout: 'orbit', focusId: '', trail: [],
            table: '', search: '', page: 1, seedResult: null, viewport: null});
    }
    for (const key of ['nodes', 'edges', 'positions', 'details', 'cursors', 'expansions']) if (!(state[key] instanceof Map)) state[key] = new Map();
    for (const key of ['hiddenTables', 'pinned', 'hiddenNodes', 'hiddenEdges']) if (!(state[key] instanceof Set)) state[key] = new Set();
    if (!(state.selectedNodes instanceof Set)) state.selectedNodes = new Set(state.selection?.kind === 'node' && state.nodes.has(state.selection.id) ? [state.selection.id] : []);
    if (!Array.isArray(state.undoStack)) state.undoStack = [];
    if (!layouts.has(state.layout)) state.layout = 'orbit';
    if (typeof state.focusId !== 'string' || !state.nodes.has(state.focusId)) state.focusId = '';
    if (typeof state.table !== 'string') state.table = '';
    if (typeof state.search !== 'string') state.search = '';
    if (!Number.isSafeInteger(state.page) || state.page < 1) state.page = 1;
    if (state.viewport && (!validPoint(state.viewport) || !Number.isFinite(state.viewport.zoom) || state.viewport.zoom <= 0)) state.viewport = null;
    return state;
}

export function sameRecordKey(left, right) {
    if (!object(left) || !object(right)) return false;
    const names = Object.keys(left);
    return names.length === Object.keys(right).length && names.every(name => Object.hasOwn(right, name)
        && typeof left[name] === 'string' && left[name] === right[name]);
}

export function normalizeRecordNode(node) {
    if (!object(node) || typeof node.id !== 'string' || !node.id || typeof node.table !== 'string' || !node.table
        || !object(node.key) || !Object.keys(node.key).length || Object.values(node.key).some(value => typeof value !== 'string')) return null;
    return {...node, key: Object.fromEntries(Object.entries(node.key)),
        label: typeof node.label === 'string' ? node.label : node.table,
        row: object(node.row) ? Object.fromEntries(Object.entries(node.row)) : {},
        columns: Array.isArray(node.columns) ? node.columns.filter(object).map(column => ({...column})) : [],
        truncated: node.truncated === true};
}


function removeRecordEdge(state, id) {
    state.edges.delete(id);
    state.hiddenEdges?.delete(id);
    for (const ids of state.expansions.values()) ids.delete(id);
    if (state.selection?.kind === 'edge' && state.selection.id === id) state.selection = null;
}
export function invalidateRecordMapNode(state, id) {
    const affected = new Set([id]);
    for (const [edgeId, edge] of state.edges) if (edge.source === id || edge.target === id) {
        affected.add(edge.source); affected.add(edge.target); removeRecordEdge(state, edgeId);
    }
    for (const nodeId of affected) state.details.delete(nodeId);
    for (const key of state.cursors.keys()) {
        try { if (affected.has(JSON.parse(key)[0])) state.cursors.delete(key); } catch { state.cursors.delete(key); }
    }
    for (const key of state.expansions.keys()) {
        try { if (affected.has(JSON.parse(key)[0])) state.expansions.delete(key); } catch { state.expansions.delete(key); }
    }
}

export function mergeRecordGraph(state, payload = {}) {
    const added = [];
    state.expansions ||= new Map();
    const incoming = [...(Array.isArray(payload.nodes) ? payload.nodes : []), payload.focus]
        .map(normalizeRecordNode).filter(Boolean);
    for (const node of incoming) {
        const old = state.nodes.get(node.id);
        if (old && (JSON.stringify(old.row) !== JSON.stringify(node.row)
            || JSON.stringify(old.columns) !== JSON.stringify(node.columns) || !sameRecordKey(old.key, node.key))) invalidateRecordMapNode(state, node.id);
    }
    const focusId = normalizeRecordNode(payload.focus)?.id;
    const expansionKey = focusId && typeof payload.relation === 'string' ? JSON.stringify([focusId, payload.relation]) : null;
    if (expansionKey && (payload.offset ?? 0) === 0) {
        for (const id of [...(state.expansions.get(expansionKey) || [])]) removeRecordEdge(state, id);
        state.expansions.set(expansionKey, new Set());
    }
    if (expansionKey && !state.expansions.has(expansionKey)) state.expansions.set(expansionKey, new Set());
    for (const raw of Array.isArray(payload.nodes) ? payload.nodes : []) {
        const node = normalizeRecordNode(raw);
        if (!node) continue;
        if (!state.nodes.has(node.id)) added.push(node.id);
        state.nodes.set(node.id, node);
    }
    const focus = normalizeRecordNode(payload.focus);
    if (focus) {
        if (!state.nodes.has(focus.id)) added.push(focus.id);
        state.nodes.set(focus.id, focus);
        if (!state.focusId) state.focusId = focus.id;
        state.details.set(focus.id, {focus, relations: Array.isArray(payload.relations)
            ? payload.relations.filter(object).map(relation => ({...relation})) : []});
    }
    for (const edge of Array.isArray(payload.edges) ? payload.edges : []) {
        if (!object(edge) || typeof edge.id !== 'string' || !edge.id || edge.kind !== 'foreign_key'
            || !state.nodes.has(edge.source) || !state.nodes.has(edge.target)) continue;
        state.edges.set(edge.id, {...edge});
        state.hiddenEdges?.delete(edge.id);
        if (expansionKey) state.expansions.get(expansionKey).add(edge.id);
    }
    return {added, focus};
}

export function visibleRecordGraph(state) {
    const nodes = [...state.nodes.values()].filter(node => !state.hiddenTables.has(node.table) && !state.hiddenNodes?.has(node.id));
    const visible = new Set(nodes.map(node => node.id));
    return {nodes, edges: [...state.edges.values()].filter(edge => visible.has(edge.source) && visible.has(edge.target) && !state.hiddenEdges?.has(edge.id))};
}

export function selectRecordMapItem(state, kind, id) {
    if (kind === 'node') return selectRecordMapNode(state, id);
    const collection = kind === 'edge' ? state.edges : null;
    if (!collection?.has(id)) return null;
    state.selectedNodes?.clear();
    state.selection = {kind, id};
    return collection.get(id);
}

/** Selection uses exact scoped IDs; the primary item remains compatible with the inspector. */
export function selectRecordMapNode(state, id, {toggle = false} = {}) {
    const node = state.nodes.get(id);
    if (!node) return null;
    state.selectedNodes ||= new Set();
    if (!toggle) state.selectedNodes.clear();
    if (toggle && state.selectedNodes.has(id)) state.selectedNodes.delete(id);
    else {
        state.selectedNodes.add(id);
        state.hiddenNodes?.delete(id);
        state.hiddenTables.delete(node.table);
    }
    const primary = state.selectedNodes.has(id) ? id : [...state.selectedNodes].find(key => state.nodes.has(key));
    state.selection = primary ? {kind: 'node', id: primary} : null;
    return node;
}

export function selectedRecordMapNodes(state) {
    const selected = state.selectedNodes || new Set();
    return visibleRecordGraph(state).nodes.filter(node => selected.has(node.id));
}

export function setRecordMapPinned(state, ids, pinned = true) {
    state.pinned ||= new Set();
    for (const id of nodeIds(state, ids)) pinned ? state.pinned.add(id) : state.pinned.delete(id);
    return state.pinned;
}

export function hideRecordMapNodes(state, ids) {
    state.hiddenNodes ||= new Set();
    let hidden = 0;
    for (const id of nodeIds(state, ids)) {
        if (!state.hiddenNodes.has(id)) hidden++;
        state.hiddenNodes.add(id);
        state.selectedNodes?.delete(id);
    }
    const graph = visibleRecordGraph(state), shown = new Set(graph.nodes.map(node => node.id));
    if (state.selection?.kind === 'node' && !shown.has(state.selection.id)
        || state.selection?.kind === 'edge' && !graph.edges.some(edge => edge.id === state.selection.id)) {
        const primary = graph.nodes.find(node => state.selectedNodes?.has(node.id));
        state.selection = primary ? {kind: 'node', id: primary.id} : null;
    }
    if (!shown.has(state.focusId)) state.focusId = graph.nodes[0]?.id || '';
    return hidden;
}

export function showRecordMapNodes(state, ids) {
    state.hiddenNodes ||= new Set();
    let shown = 0;
    for (const id of nodeIds(state, ids)) {
        if (state.hiddenNodes.delete(id)) shown++;
        state.hiddenTables.delete(state.nodes.get(id).table);
    }
    return shown;
}

/** Moving and pinning affect the canvas only, including when a card is already pinned. */
export function moveRecordMapNode(state, id, point) {
    if (!state.nodes.has(id) || !validPoint(point)) return false;
    state.positions.set(id, {x: point.x, y: point.y});
    state.layout = 'manual';
    return true;
}

function presentation(state) {
    return {scope_key: state.scope_key,
        shownNodes: [...state.nodes.keys()].filter(id => !state.hiddenNodes?.has(id)).sort(),
        shownEdges: [...state.edges.keys()].filter(id => !state.hiddenEdges?.has(id)).sort(),
        positions: [...state.positions].filter(([id, point]) => validPoint(point))
            .sort(([a], [b]) => a.localeCompare(b)).map(([id, point]) => [id, {x: point.x, y: point.y}]),
        hiddenTables: [...state.hiddenTables].sort(), selectedNodes: [...(state.selectedNodes || [])].sort(),
        pinned: [...(state.pinned || [])].sort(), selection: state.selection ? {kind: state.selection.kind, id: state.selection.id} : null,
        focusId: state.focusId || '', layout: layouts.has(state.layout) ? state.layout : 'orbit',
        trail: Array.isArray(state.trail) ? state.trail.filter(id => state.nodes.has(id)) : [],
        viewport: validPoint(state.viewport) && Number.isFinite(state.viewport.zoom) && state.viewport.zoom > 0
            ? {x: state.viewport.x, y: state.viewport.y, zoom: state.viewport.zoom} : null};
}

/** One checkpoint per gesture; snapshots contain no records, SQL, relation details or cursors. */
export function recordMapCheckpoint(state) {
    state.undoStack ||= [];
    const snapshot = presentation(state);
    if (JSON.stringify(state.undoStack.at(-1)) === JSON.stringify(snapshot)) return false;
    state.undoStack.push(snapshot);
    if (state.undoStack.length > undoLimit) state.undoStack.splice(0, state.undoStack.length - undoLimit);
    return true;
}

/** Restore only presentation around the current source cache, never historical evidence. */
export function undoRecordMap(state) {
    const snapshot = state.undoStack?.pop();
    if (!snapshot || snapshot.scope_key !== state.scope_key) return false;
    const shown = new Set(snapshot.shownNodes), shownEdges = new Set(snapshot.shownEdges);
    state.hiddenNodes = new Set([...state.nodes.keys()].filter(id => !shown.has(id)));
    state.hiddenEdges = new Set([...state.edges.keys()].filter(id => !shownEdges.has(id)));
    state.hiddenTables = new Set(snapshot.hiddenTables);
    const positions = new Map([...state.positions].filter(([id, point]) => validPoint(point)));
    for (const [id, point] of snapshot.positions) {
        if (validPoint(point)) positions.set(id, {x: point.x, y: point.y});
    }
    state.positions = positions;
    state.pinned = new Set(snapshot.pinned);
    const visible = new Set(visibleRecordGraph(state).nodes.map(node => node.id));
    state.selectedNodes = new Set(snapshot.selectedNodes.filter(id => visible.has(id)));
    const selection = snapshot.selection;
    state.selection = selection?.kind === 'edge' && visibleRecordGraph(state).edges.some(edge => edge.id === selection.id)
        ? {...selection} : selection?.kind === 'node' && state.selectedNodes.has(selection.id) ? {...selection} : null;
    if (!state.selection && state.selectedNodes.size) state.selection = {kind: 'node', id: [...state.selectedNodes][0]};
    state.focusId = visible.has(snapshot.focusId) ? snapshot.focusId : visibleRecordGraph(state).nodes[0]?.id || '';
    const trail = (snapshot.trail || []).filter(id => visible.has(id)), focusIndex = trail.lastIndexOf(state.focusId);
    state.trail = focusIndex >= 0 ? trail.slice(0, focusIndex + 1) : state.focusId ? [state.focusId] : [];
    state.layout = layouts.has(snapshot.layout) ? snapshot.layout : 'orbit';
    state.viewport = snapshot.viewport ? {...snapshot.viewport} : null;
    return true;
}

function orbitPoint(attempt, count, centre) {
    const firstSlots = Math.max(1, Math.min(8, count));
    const extra = attempt - firstSlots;
    const ring = extra < 0 ? 0 : 1 + Math.floor(extra / 8);
    const slots = ring === 0 ? firstSlots : 8;
    const index = ring === 0 ? attempt : extra % 8;
    const angle = index * Math.PI * 2 / slots + (ring === 0 && slots === 2 ? 0 : -Math.PI / 2) + ring * .16;
    return {x: centre.x + Math.cos(angle) * (360 + ring * 280),
        y: centre.y + Math.sin(angle) * (260 + ring * 210)};
}

/** Place only new cards around the expanded record; dragged and pinned cards stay intact. */
export function recordMapPositions(state, focusId = '') {
    for (const [id, point] of state.positions) if (!validPoint(point)) state.positions.delete(id);
    const unplaced = [...state.nodes.keys()].filter(id => !state.positions.has(id)).sort();
    if (!unplaced.length) return state.positions;
    if (!state.positions.size) {
        const first = state.nodes.has(focusId) ? focusId : unplaced[0];
        state.positions.set(first, {x: 0, y: 0});
        unplaced.splice(unplaced.indexOf(first), 1);
    }
    const centre = state.positions.get(focusId) || {x: 0, y: 0};
    const occupied = [...state.positions.values()];
    for (const id of unplaced) {
        let point, attempt = 0;
        do {
            point = orbitPoint(attempt++, unplaced.length, centre);
        } while (overlaps(point, occupied));
        state.positions.set(id, point);
        occupied.push(point);
    }
    return state.positions;
}

/** FK direction establishes the first flow column; subsequent hops retain that branch. */
function flowGroups(state, ids, focusId) {
    const known = new Set([focusId, ...ids]), adjacency = new Map([...known].map(id => [id, []]));
    for (const edge of visibleRecordGraph(state).edges) {
        if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue;
        adjacency.get(edge.source).push({id: edge.target, side: 1});
        adjacency.get(edge.target).push({id: edge.source, side: -1});
    }
    for (const list of adjacency.values()) list.sort((a, b) => a.id.localeCompare(b.id) || a.side - b.side);
    const branches = new Map([[focusId, {side: 0, depth: 0}]]), queue = [focusId];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index], branch = branches.get(current);
        for (const neighbor of adjacency.get(current)) {
            if (branches.has(neighbor.id)) continue;
            branches.set(neighbor.id, {side: current === focusId ? neighbor.side : branch.side, depth: branch.depth + 1});
            queue.push(neighbor.id);
        }
    }
    const groups = new Map();
    for (const id of ids) {
        const branch = branches.get(id) || {side: 1, depth: 1};
        const key = branch.side + ':' + branch.depth;
        if (!groups.has(key)) groups.set(key, {...branch, ids: []});
        groups.get(key).ids.push(id);
    }
    return [...groups.values()].sort((a, b) => a.depth - b.depth || a.side - b.side);
}

/** Explicit arrange action. Manual keeps every position; all layouts preserve pins. */
export function arrangeRecordMap(state, layout = 'orbit', focusId = '') {
    if (!layouts.has(layout)) return state.positions;
    state.layout = layout;
    if (layout === 'manual') return state.positions;
    recordMapPositions(state, focusId);
    const ids = visibleRecordGraph(state).nodes.map(node => node.id).sort();
    if (!ids.length) return state.positions;
    const focus = ids.includes(focusId) ? focusId : ids.includes(state.focusId) ? state.focusId
        : state.selection?.kind === 'node' && ids.includes(state.selection.id) ? state.selection.id : ids[0];
    state.focusId = focus;
    const centre = state.pinned?.has(focus) ? state.positions.get(focus) : {x: 0, y: 0};
    state.positions.set(focus, {...centre});
    const movable = ids.filter(id => id !== focus && !state.pinned?.has(id));
    const occupied = ids.filter(id => id === focus || state.pinned?.has(id)).map(id => state.positions.get(id));
    if (layout === 'flow') {
        for (const group of flowGroups(state, ids.filter(id => id !== focus), focus)) {
            for (const [row, id] of group.ids.entries()) {
                if (!movable.includes(id)) continue;
                const point = {x: centre.x + group.side * group.depth * 300,
                    y: centre.y + (row - (group.ids.length - 1) / 2) * 180};
                while (overlaps(point, occupied)) point.y += 180;
                state.positions.set(id, point); occupied.push(point);
            }
        }
    } else {
        for (const id of movable) {
            let point, attempt = 0;
            do { point = orbitPoint(attempt++, movable.length, centre); } while (overlaps(point, occupied));
            state.positions.set(id, point); occupied.push(point);
        }
    }
    return state.positions;
}

export function clearRecordMap(state) {
    for (const key of ['nodes', 'edges', 'positions', 'details', 'cursors', 'expansions']) state[key]?.clear();
    for (const key of ['hiddenTables', 'hiddenNodes', 'hiddenEdges', 'selectedNodes', 'pinned']) state[key]?.clear();
    state.undoStack = [];
    state.selection = null;
    state.focusId = '';
    state.trail = [];
    state.layout = 'orbit';
    state.viewport = null;
}

/** Source refresh invalidates evidence and history, retaining only same-scope canvas geometry. */
export function resetRecordMapEvidence(state) {
    const previous = state.nodes.get(state.focusId)
        || (state.selection?.kind === 'node' ? state.nodes.get(state.selection.id) : null);
    const focus = previous ? {table: previous.table, key: {...previous.key}} : null;
    for (const key of ['nodes', 'edges', 'details', 'cursors', 'expansions', 'hiddenNodes', 'hiddenEdges', 'selectedNodes']) state[key]?.clear();
    state.seedResult = null;
    state.undoStack = [];
    state.selection = null;
    state.focusId = '';
    state.trail = [];
    delete state.pendingRecord;
    return focus;
}
