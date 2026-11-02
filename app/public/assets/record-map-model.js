/** Shared record selection and graph state; no storage or database side effects. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPoint = value => object(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

export function ensureRecordMapState(state = {}, scopeKey = '') {
    if (state.scope_key !== scopeKey) {
        Object.assign(state, {scope_key: scopeKey, nodes: new Map(), edges: new Map(), positions: new Map(),
            details: new Map(), cursors: new Map(), expansions: new Map(), hiddenTables: new Set(), selection: null,
            table: '', search: '', page: 1, seedResult: null, viewport: null});
    }
    for (const key of ['nodes', 'edges', 'positions', 'details', 'cursors', 'expansions']) if (!(state[key] instanceof Map)) state[key] = new Map();
    if (!(state.hiddenTables instanceof Set)) state.hiddenTables = new Set();
    if (typeof state.table !== 'string') state.table = '';
    if (typeof state.search !== 'string') state.search = '';
    if (!Number.isSafeInteger(state.page) || state.page < 1) state.page = 1;
    if (state.viewport && (!validPoint(state.viewport) || !Number.isFinite(state.viewport.zoom))) state.viewport = null;
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
        state.details.set(focus.id, {focus, relations: Array.isArray(payload.relations)
            ? payload.relations.filter(object).map(relation => ({...relation})) : []});
    }
    for (const edge of Array.isArray(payload.edges) ? payload.edges : []) {
        if (!object(edge) || typeof edge.id !== 'string' || !edge.id || edge.kind !== 'foreign_key'
            || !state.nodes.has(edge.source) || !state.nodes.has(edge.target)) continue;
        state.edges.set(edge.id, {...edge});
        if (expansionKey) state.expansions.get(expansionKey).add(edge.id);
    }
    return {added, focus};
}

export function visibleRecordGraph(state) {
    const nodes = [...state.nodes.values()].filter(node => !state.hiddenTables.has(node.table));
    const visible = new Set(nodes.map(node => node.id));
    return {nodes, edges: [...state.edges.values()].filter(edge => visible.has(edge.source) && visible.has(edge.target))};
}

export function selectRecordMapItem(state, kind, id) {
    const collection = kind === 'node' ? state.nodes : kind === 'edge' ? state.edges : null;
    if (!collection?.has(id)) return null;
    state.selection = {kind, id};
    return collection.get(id);
}

/** Stable radial placement around the expanded record; existing positions stay intact. */
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
    for (const [index, id] of unplaced.entries()) {
        let point;
        let attempt = index;
        do {
            const ring = Math.floor(attempt / 10);
            const radius = 190 + ring * 145;
            const angle = (attempt % 10) * Math.PI * 2 / 10 - Math.PI / 2 + ring * .28;
            point = {x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius};
            attempt++;
        } while (occupied.some(existing => Math.hypot(existing.x - point.x, existing.y - point.y) < 125));
        state.positions.set(id, point);
        occupied.push(point);
    }
    return state.positions;
}

export function clearRecordMap(state) {
    for (const key of ['nodes', 'edges', 'positions', 'details', 'cursors', 'expansions']) state[key]?.clear();
    state.hiddenTables.clear();
    state.selection = null;
    state.viewport = null;
}
