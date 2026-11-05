/** Pure whiteboard geometry and commands. Server revisions remain the authority. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 180;
export const WORLD_LIMIT = 1000000;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const kinds = new Set(['note', 'idea', 'screen', 'stroke']);

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** No Math.random fallback: IDs also identify idempotent writes. */
export function uuid() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable.');
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cameraValues(camera) {
    if (!object(camera) || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)
        || !Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new TypeError('Invalid camera.');
    return camera;
}

function pointValues(point) {
    if (!object(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError('Invalid point.');
    return point;
}

export function screenToWorld(point, camera) {
    cameraValues(camera);
    pointValues(point);
    return {x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom};
}

/** Preserve the world point below the pointer while zooming. */
export function zoomAt(camera, point, newZoom) {
    const world = screenToWorld(point, camera);
    if (!Number.isFinite(newZoom)) throw new TypeError('Invalid zoom.');
    const zoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    return {x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom};
}

/** Only these fields can be sent back. Provenance and versions belong to the server. */
export function editableNode(node) {
    if (!object(node) || typeof node.id !== 'string' || !node.id || !kinds.has(node.kind)
        || typeof node.text !== 'string' || ![node.x, node.y, node.width, node.height].every(Number.isFinite)
        || node.width <= 0 || node.height <= 0 || !object(node.data)) throw new TypeError('Invalid node.');
    return {id: node.id, kind: node.kind, text: node.text, x: node.x, y: node.y,
        width: node.width, height: node.height, data: copy(node.data)};
}

function editableEdge(edge) {
    if (!object(edge) || ![edge.id, edge.from_node_id, edge.to_node_id].every(value => typeof value === 'string' && value)
        || typeof edge.label !== 'string') throw new TypeError('Invalid edge.');
    return {id: edge.id, from_node_id: edge.from_node_id, to_node_id: edge.to_node_id, label: edge.label};
}

function snapshotCopy(snapshot) {
    if (!object(snapshot) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) throw new TypeError('Invalid snapshot.');
    return copy(snapshot);
}

function applyOne(snapshot, change) {
    if (!object(change)) throw new TypeError('Invalid change.');
    switch (change.type) {
    case 'put-node': {
        const node = editableNode(change.node);
        const index = snapshot.nodes.findIndex(value => value.id === node.id);
        // An editable command cannot replace immutable source/version metadata.
        if (index === -1) snapshot.nodes.push(node);
        else snapshot.nodes[index] = {...snapshot.nodes[index], ...node};
        break;
    }
    case 'delete-node':
        if (typeof change.id !== 'string' || !change.id) throw new TypeError('Invalid node ID.');
        snapshot.nodes = snapshot.nodes.filter(node => node.id !== change.id);
        snapshot.edges = snapshot.edges.filter(edge => edge.from_node_id !== change.id && edge.to_node_id !== change.id);
        break;
    case 'put-edge': {
        const edge = editableEdge(change.edge);
        if (![edge.from_node_id, edge.to_node_id].every(id => snapshot.nodes.some(node => node.id === id))) {
            throw new TypeError('Edge endpoints must exist.');
        }
        const index = snapshot.edges.findIndex(value => value.id === edge.id);
        if (index === -1) snapshot.edges.push(edge);
        else snapshot.edges[index] = {...snapshot.edges[index], ...edge};
        break;
    }
    case 'delete-edge':
        if (typeof change.id !== 'string' || !change.id) throw new TypeError('Invalid edge ID.');
        snapshot.edges = snapshot.edges.filter(edge => edge.id !== change.id);
        break;
    default:
        throw new TypeError('Unknown change.');
    }
}

/** Optimistic local projection; does not increment the server's board revision. */
export function applyChanges(snapshot, changes) {
    if (!Array.isArray(changes)) throw new TypeError('Invalid changes.');
    const result = snapshotCopy(snapshot);
    for (const change of changes) applyOne(result, change);
    return result;
}

/** Reverse complete gestures, accounting for intermediate commands and deleted links. */
export function inverseChanges(snapshot, changes) {
    if (!Array.isArray(changes)) throw new TypeError('Invalid changes.');
    const current = snapshotCopy(snapshot);
    let inverse = [];
    for (const change of changes) {
        if (!object(change)) throw new TypeError('Invalid change.');
        let undo = [];
        if (change.type === 'put-node') {
            const old = current.nodes.find(node => node.id === change.node?.id);
            undo = old ? [{type: 'put-node', node: editableNode(old)}] : [{type: 'delete-node', id: change.node?.id}];
        } else if (change.type === 'delete-node') {
            const old = current.nodes.find(node => node.id === change.id);
            if (old) undo = [{type: 'put-node', node: editableNode(old)}, ...current.edges
                .filter(edge => edge.from_node_id === change.id || edge.to_node_id === change.id)
                .map(edge => ({type: 'put-edge', edge: editableEdge(edge)}))];
        } else if (change.type === 'put-edge') {
            const old = current.edges.find(edge => edge.id === change.edge?.id);
            undo = old ? [{type: 'put-edge', edge: editableEdge(old)}] : [{type: 'delete-edge', id: change.edge?.id}];
        } else if (change.type === 'delete-edge') {
            const old = current.edges.find(edge => edge.id === change.id);
            if (old) undo = [{type: 'put-edge', edge: editableEdge(old)}];
        }
        // Validate and update the intermediate state before returning a command.
        applyOne(current, change);
        inverse = [...undo, ...inverse];
    }
    return inverse;
}
