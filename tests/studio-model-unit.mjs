import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {uuid, MIN_ZOOM, MAX_ZOOM, screenToWorld, zoomAt, editableNode,
    applyChanges, inverseChanges} from '../app/public/assets/studio-model.js';

const camera = {x: 150, y: -80, zoom: 1.25}, point = {x: 420, y: 310};
const world = screenToWorld(point, camera);
assert.deepEqual(world, {x: 216, y: 312});
for (const zoom of [0, 0.5, 2, 100]) {
    const next = zoomAt(camera, point, zoom);
    const anchored = screenToWorld(point, next);
    assert.ok(Math.abs(anchored.x - world.x) < 1e-9 && Math.abs(anchored.y - world.y) < 1e-9,
        'Pointer-anchored zoom preserves world coordinates within floating-point precision.');
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
}
assert.throws(() => screenToWorld(point, {...camera, zoom: 0}), TypeError);
assert.throws(() => zoomAt(camera, point, Number.NaN), TypeError);
assert.throws(() => screenToWorld({x: Infinity, y: 0}, camera), TypeError);

const node = (id, text = id) => ({id, kind: 'note', text, x: 1, y: 2, width: 280, height: 180,
    data: {colour: 'sage', nested: {items: [1, 2]}}});
const a = {...node('a'), source_segment_id: 'source-a', version: 7};
const b = node('b');
const edge = {id: 'ab', from_node_id: 'a', to_node_id: 'b', label: 'flow'};
const original = {board: {id: 'board', revision: 9}, nodes: [a, b], edges: [edge], segments: [{id: 'source-a', text: 'Original'}]};
const frozen = JSON.stringify(original);
const editable = editableNode(a);
assert.equal(Object.hasOwn(editable, 'source_segment_id'), false);
assert.equal(Object.hasOwn(editable, 'version'), false);
editable.data.nested.items.push(3);
assert.equal(a.data.nested.items.length, 2, 'Editable data is detached from the source snapshot.');

const edit = [{type: 'put-node', node: {...node('a', '<img src=x onerror=alert(1)>'),
    source_segment_id: 'fabricated', version: 999}}];
const edited = applyChanges(original, edit);
assert.equal(edited.nodes[0].text, '<img src=x onerror=alert(1)>', 'User content stays literal text.');
assert.equal(edited.nodes[0].source_segment_id, 'source-a');
assert.equal(edited.nodes[0].version, 7, 'Optimistic edits do not invent server versions.');
assert.equal(edited.board.revision, 9, 'Only a server reply can acknowledge a new revision.');
const restored = applyChanges(edited, inverseChanges(original, edit));
assert.deepEqual(restored, original, 'Undo of a text edit preserves source evidence and revision.');
assert.equal(JSON.stringify(original), frozen, 'Commands never mutate the original snapshot.');

const deletion = [{type: 'delete-node', id: 'a'}, {type: 'delete-node', id: 'b'}];
const removed = applyChanges(original, deletion);
assert.equal(removed.nodes.length + removed.edges.length, 0);
const deletionUndo = inverseChanges(original, deletion);
const recovered = applyChanges(removed, deletionUndo);
assert.deepEqual(recovered.nodes.map(editableNode).sort((left, right) => left.id.localeCompare(right.id)),
    original.nodes.map(editableNode));
assert.deepEqual(recovered.edges, original.edges, 'Undo recreates deleted endpoints before reconnecting their edge.');
assert.equal(recovered.segments[0].text, 'Original', 'Deleting canvas content does not mutate transcript evidence.');
assert.equal(Object.hasOwn(deletionUndo.find(change => change.node?.id === 'a').node, 'source_segment_id'), false,
    'A deletion undo never tries to forge server provenance.');

const batch = [{type: 'put-node', node: node('c')},
    {type: 'put-edge', edge: {id: 'bc', from_node_id: 'b', to_node_id: 'c', label: ''}},
    {type: 'put-node', node: node('c', 'updated')}, {type: 'delete-edge', id: 'ab'}];
assert.deepEqual(applyChanges(applyChanges(original, batch), inverseChanges(original, batch)), original,
    'A complete gesture is undone against its intermediate states in reverse order.');
const noOp = [{type: 'delete-node', id: 'missing'}, {type: 'delete-edge', id: 'missing'}];
assert.deepEqual(inverseChanges(original, noOp), []);
assert.throws(() => applyChanges(original, [{type: 'put-edge', edge: {...edge, to_node_id: 'missing'}}]), TypeError);
assert.throws(() => inverseChanges(original, [{type: 'unknown'}]), TypeError);
assert.throws(() => editableNode({...a, x: Number.NaN}), TypeError);
assert.equal(JSON.stringify(original), frozen, 'Rejected commands also leave their input untouched.');

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
try {
    Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true});
    assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    Object.defineProperty(globalThis, 'crypto', {value: {getRandomValues: webcrypto.getRandomValues.bind(webcrypto)}, configurable: true});
    assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'Secure byte fallback follows UUIDv4 bits.');
    Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
    assert.throws(() => uuid(), /Secure randomness/, 'Missing secure entropy never falls back to Math.random.');
} finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
}

console.log('PASS: studio geometry, immutable gestures, undo ordering, source preservation and secure IDs.');
