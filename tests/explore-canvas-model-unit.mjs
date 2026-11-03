/** Canvas actions never rewind source data or revive invalidated FK evidence. */
import assert from 'node:assert/strict';
import {ensureRecordMapState, mergeRecordGraph, visibleRecordGraph, recordMapPositions,
    selectRecordMapItem, selectRecordMapNode, selectedRecordMapNodes, setRecordMapPinned,
    hideRecordMapNodes, showRecordMapNodes, moveRecordMapNode, recordMapCheckpoint,
    undoRecordMap, arrangeRecordMap, clearRecordMap, resetRecordMapEvidence, recordMapVisit,
    previousRecordMapVisit, restoreRecordMapVisit, originRecordMapVisit,
    recordMapVisitState} from '../app/public/assets/record-map-model.js';

const node = (id, table = 'people', value = 'SOURCE_VALUE_MUST_NOT_ENTER_UNDO') => ({id, table,
    key: {id: '9007199254740993-' + id}, label: id, row: {id: '9007199254740993-' + id, value}, columns: [], truncated: false});
const edge = (id, source, target) => ({id, source, target, kind: 'foreign_key',
    evidence: {sql: 'SOURCE_SQL_MUST_NOT_ENTER_UNDO', params: {value: 'SOURCE_PARAMETER_MUST_NOT_ENTER_UNDO'}}});
const create = (scope = 'mariadb:canvas') => {
    const state = ensureRecordMapState({}, scope);
    mergeRecordGraph(state, {focus: node('root'), nodes: [node('incoming', 'projects'), node('outgoing', 'sources')],
        edges: [edge('in', 'incoming', 'root'), edge('out', 'root', 'outgoing')], relations: [{id: 'real-relation'}]});
    recordMapPositions(state, 'root');
    return state;
};
const points = state => [...state.positions].map(([id, point]) => [id, {...point}]).sort(([a], [b]) => a.localeCompare(b));

const selection = create();
selectRecordMapNode(selection, 'root');
selectRecordMapNode(selection, 'incoming', {toggle: true});
assert.deepEqual([...selection.selectedNodes], ['root', 'incoming']);
assert.deepEqual(selection.selection, {kind: 'node', id: 'incoming'});
assert.deepEqual(selectedRecordMapNodes(selection).map(item => item.id).sort(), ['incoming', 'root']);
selectRecordMapNode(selection, 'incoming', {toggle: true});
assert.deepEqual([...selection.selectedNodes], ['root'], 'Shift toggle removes only the requested record.');
assert.deepEqual(selection.selection, {kind: 'node', id: 'root'});
assert.equal(selectRecordMapNode(selection, 'fabricated'), null);
assert.deepEqual([...selection.selectedNodes], ['root'], 'Unknown IDs cannot replace a real selection.');
selectRecordMapItem(selection, 'edge', 'in');
assert.equal(selection.selectedNodes.size, 0, 'Edge selection is separate from multiple-record selection.');
selectRecordMapItem(selection, 'node', 'outgoing');
assert.deepEqual([...selection.selectedNodes], ['outgoing'], 'Legacy selection uses the shared canvas selection.');

setRecordMapPinned(selection, ['root', 'incoming', 'fabricated']);
assert.deepEqual([...selection.pinned], ['root', 'incoming']);
recordMapCheckpoint(selection);
const originalPoint = {...selection.positions.get('outgoing')};
moveRecordMapNode(selection, 'outgoing', {x: 810, y: -415});
setRecordMapPinned(selection, 'outgoing');
assert.equal(hideRecordMapNodes(selection, ['outgoing', 'fabricated']), 1);
assert.equal(selection.selectedNodes.size, 0);
assert.equal(selection.selection, null);
assert.equal(visibleRecordGraph(selection).edges.length, 1);
assert.equal(selection.nodes.has('outgoing'), true, 'Hide keeps the current source cache.');
assert.equal(undoRecordMap(selection), true);
assert.deepEqual(selection.positions.get('outgoing'), originalPoint);
assert.equal(selection.hiddenNodes.size, 0);
assert.equal(selection.pinned.has('outgoing'), false);
assert.deepEqual([...selection.selectedNodes], ['outgoing']);
assert.equal(visibleRecordGraph(selection).edges.length, 2, 'Undo reveals only evidence still in the current cache.');
selection.hiddenTables.add('sources');
hideRecordMapNodes(selection, 'outgoing');
assert.equal(showRecordMapNodes(selection, 'outgoing'), 1);
assert.equal(selection.hiddenTables.has('sources'), false, 'Explicit record reveal also reveals its table.');
assert.equal(visibleRecordGraph(selection).nodes.length, 3);
assert.equal(moveRecordMapNode(selection, 'outgoing', {x: Infinity, y: 0}), false);
assert.equal(moveRecordMapNode(selection, 'fabricated', {x: 1, y: 2}), false);
assert.equal(selection.layout, 'orbit', 'Invalid movement does not change layout.');

const safe = create();
safe.viewport = {x: 4, y: 8, zoom: .75, extra: 'VIEWPORT_SECRET'};
safe.selection = {kind: 'node', id: 'root', extra: 'SELECTION_SECRET'};
safe.selectedNodes.add('root');
recordMapCheckpoint(safe);
const serialized = JSON.stringify(safe.undoStack);
for (const secret of ['SOURCE_VALUE', 'SOURCE_SQL', 'SOURCE_PARAMETER', 'VIEWPORT_SECRET', 'SELECTION_SECRET']) {
    assert.equal(serialized.includes(secret), false, 'Undo excludes source values and unrelated objects: ' + secret);
}
assert.deepEqual(safe.undoStack[0].viewport, {x: 4, y: 8, zoom: .75});
const newer = {...node('incoming', 'projects', 'CURRENT_SOURCE_VALUE'),
    row: {id: '9007199254740993-incoming', value: 'CURRENT_SOURCE_VALUE', changed_fk: 'new'}};
mergeRecordGraph(safe, {focus: newer, nodes: [], edges: [], relations: [{id: 'current-relation'}]});
assert.equal(safe.edges.has('in'), false);
safe.cursors.set('CURRENT_CURSOR', {has_more: false});
moveRecordMapNode(safe, 'root', {x: 1000, y: 1000});
assert.equal(undoRecordMap(safe), true);
assert.equal(safe.nodes.get('incoming').row.value, 'CURRENT_SOURCE_VALUE', 'Undo never restores a previous row preview.');
assert.equal(safe.edges.has('in'), false, 'Undo cannot revive evidence invalidated by changed FK values.');
assert.equal(safe.details.get('incoming').relations[0].id, 'current-relation');
assert.equal(safe.cursors.has('CURRENT_CURSOR'), true, 'Current API details and cursors stay current.');

const expansion = create();
recordMapCheckpoint(expansion);
mergeRecordGraph(expansion, {nodes: [node('new', 'tasks', 'CURRENT_NEW_VALUE')], edges: [
    edge('new-neighbor', 'root', 'new'), edge('new-between-loaded', 'incoming', 'outgoing')], relation: 'next', offset: 0});
recordMapPositions(expansion, 'root');
selectRecordMapNode(expansion, 'new');
assert.equal(undoRecordMap(expansion), true);
assert.equal(expansion.nodes.size, 4, 'Undo Add retains current source records in memory.');
assert.equal(expansion.hiddenNodes.has('new'), true);
assert.equal(expansion.hiddenEdges.has('new-between-loaded'), true, 'Undo also hides newly added links between existing nodes.');
assert.equal(visibleRecordGraph(expansion).nodes.length, 3);
assert.equal(visibleRecordGraph(expansion).edges.length, 2);
mergeRecordGraph(expansion, {edges: [edge('new-between-loaded', 'incoming', 'outgoing')]});
assert.equal(expansion.hiddenEdges.has('new-between-loaded'), false, 'Fresh explicit evidence can be revealed again.');
assert.equal(expansion.nodes.get('new').row.value, 'CURRENT_NEW_VALUE');
const removed = create();
selectRecordMapNode(removed, 'incoming');
recordMapCheckpoint(removed);
removed.nodes.delete('incoming'); removed.edges.delete('in');
assert.equal(undoRecordMap(removed), true);
assert.equal(removed.nodes.has('incoming'), false, 'Undo cannot recreate a forgotten source record.');
assert.equal(visibleRecordGraph(removed).nodes.some(item => item.id === 'incoming'), false);
assert.equal(removed.selectedNodes.has('incoming'), false);

const placement = create(), initial = points(placement);
assert.ok(Math.abs(placement.positions.get('incoming').y) < 1 && Math.abs(placement.positions.get('outgoing').y) < 1,
    'Two neighbors use the available canvas width instead of shrinking a tall three-card stack.');
assert.ok(placement.positions.get('incoming').x * placement.positions.get('outgoing').x < 0);
setRecordMapPinned(placement, 'incoming');
moveRecordMapNode(placement, 'incoming', {x: -730, y: 48});
const dragged = points(placement);
mergeRecordGraph(placement, {nodes: Array.from({length: 18}, (_, index) => node('added-' + index, 'tasks'))});
recordMapPositions(placement, 'incoming');
for (const [id, point] of dragged) assert.deepEqual(placement.positions.get(id), point, 'Expansion preserves every existing location.');
const placed = [...placement.positions.values()];
for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    assert.ok(Math.abs(placed[i].x - placed[j].x) >= 240 || Math.abs(placed[i].y - placed[j].y) >= 160,
        'New cards reserve space for their readable rectangular content.');
}
const reordered = ensureRecordMapState({}, 'mariadb:deterministic');
mergeRecordGraph(reordered, {focus: node('root'), nodes: [node('outgoing', 'sources'), node('incoming', 'projects')]});
recordMapPositions(reordered, 'root');
assert.deepEqual(points(reordered), initial, 'Positions do not depend on API row ordering.');

const layout = create();
mergeRecordGraph(layout, {nodes: [node('deep-in', 'tasks'), node('deep-out', 'tasks')],
    edges: [edge('deep-in-edge', 'deep-in', 'incoming'), edge('deep-out-edge', 'outgoing', 'deep-out')]});
recordMapPositions(layout, 'root'); recordMapCheckpoint(layout);
const beforeFlow = points(layout);
arrangeRecordMap(layout, 'flow', 'root');
assert.equal(layout.positions.get('root').x, 0);
assert.ok(layout.positions.get('incoming').x < 0 && layout.positions.get('outgoing').x > 0,
    'Flow separates declared incoming and outgoing FK first columns.');
assert.ok(layout.positions.get('deep-in').x < layout.positions.get('incoming').x);
assert.ok(layout.positions.get('deep-out').x > layout.positions.get('outgoing').x);
assert.equal(layout.layout, 'flow');
assert.equal(undoRecordMap(layout), true);
assert.deepEqual(points(layout), beforeFlow);
assert.equal(layout.layout, 'orbit');
moveRecordMapNode(layout, 'root', {x: 77, y: 29});
moveRecordMapNode(layout, 'incoming', {x: -955, y: -341});
setRecordMapPinned(layout, ['root', 'incoming']);
const rootPin = {...layout.positions.get('root')}, incomingPin = {...layout.positions.get('incoming')};
for (const kind of ['orbit', 'flow']) {
    arrangeRecordMap(layout, kind, 'root');
    assert.deepEqual(layout.positions.get('root'), rootPin);
    assert.deepEqual(layout.positions.get('incoming'), incomingPin);
}
const beforeManual = points(layout);
arrangeRecordMap(layout, 'manual');
assert.deepEqual(points(layout), beforeManual, 'Manual changes no card locations.');
assert.equal(layout.layout, 'manual');
arrangeRecordMap(layout, 'invented-layout');
assert.equal(layout.layout, 'manual');
assert.deepEqual(points(layout), beforeManual);

const path = create();
path.trail = ['root'];
recordMapCheckpoint(path); setRecordMapPinned(path, 'incoming');
path.focusId = 'incoming'; path.trail.push('incoming');
assert.equal(undoRecordMap(path), true);
assert.equal(path.focusId, 'root');
assert.deepEqual(path.trail, ['root'], 'Undo restores a path consistent with its restored focus, using only scoped IDs.');

const navigation = create();
assert.equal(navigation.originId, 'root', 'The first exact focus remains a passive starting-record marker.');
assert.deepEqual(originRecordMapVisit(navigation), {scope_key: 'mariadb:canvas', id: 'root', table: 'people',
    key: {id: '9007199254740993-root'}, viewport: null, index: -1});
recordMapVisit(navigation, 'root', {x: 1, y: 2, zoom: .8});
recordMapVisit(navigation, 'root', {x: 3, y: 4, zoom: .9});
assert.equal(navigation.navigationHistory.length, 1, 'Repeated inspection of one record updates its viewpoint.');
selectRecordMapNode(navigation, 'incoming');
recordMapVisit(navigation, 'incoming', {x: 10, y: 20, zoom: 1.1});
selectRecordMapNode(navigation, 'outgoing');
recordMapVisit(navigation, 'outgoing', {x: 30, y: 40, zoom: 1.2});
const previous = previousRecordMapVisit(navigation);
assert.deepEqual(previous, {scope_key: 'mariadb:canvas', id: 'incoming', table: 'projects',
    key: {id: '9007199254740993-incoming'}, viewport: {x: 30, y: 40, zoom: 1.2}, index: 1});
assert.equal(navigation.navigationIndex, 2, 'Reading the Back target does not move history before recovery succeeds.');
setRecordMapPinned(navigation, 'root'); navigation.hiddenTables.add('sources');
const graphBeforeBack = {nodes: navigation.nodes.size, edges: navigation.edges.size, undo: navigation.undoStack.length};
const restored = restoreRecordMapVisit(navigation, previous.index, {x: 50, y: 60, zoom: 1.3});
assert.equal(restored.id, 'incoming');
assert.equal(navigation.navigationIndex, 1);
assert.deepEqual({nodes: navigation.nodes.size, edges: navigation.edges.size, undo: navigation.undoStack.length}, graphBeforeBack,
    'Back history cannot unload branches or consume presentation Undo.');
assert.equal(navigation.pinned.has('root'), true); assert.equal(navigation.hiddenTables.has('sources'), true);
recordMapVisit(navigation, 'root', {x: 70, y: 80, zoom: 1.4});
assert.deepEqual(navigation.navigationHistory.map(entry => entry.id), ['root', 'incoming', 'root'],
    'A deliberate visit after Back discards the obsolete forward entry.');
const serializedNavigation = JSON.stringify(navigation.navigationHistory);
for (const secret of ['SOURCE_VALUE', 'SOURCE_SQL', 'SOURCE_PARAMETER']) {
    assert.equal(serializedNavigation.includes(secret), false, 'Navigation stores references and viewpoints only: ' + secret);
}
const incomingVisit = navigation.navigationHistory[1];
assert.equal(recordMapVisitState(navigation, incomingVisit), 'visible');
hideRecordMapNodes(navigation, 'incoming');
assert.equal(recordMapVisitState(navigation, incomingVisit), 'hidden', 'Back can request explicit reveal without changing filters.');
navigation.nodes.delete('incoming');
assert.equal(recordMapVisitState(navigation, incomingVisit), 'unloaded', 'An absent target remains a reread reference, not copied row data.');
assert.equal(recordMapVisitState(navigation, {...incomingVisit, scope_key: 'postgres:other:public'}), 'invalid');

const boundedNavigation = create();
recordMapVisit(boundedNavigation, 'root', {x: 0, y: 0, zoom: 1});
const manyNodes = Array.from({length: 55}, (_, index) => node('visit-' + index, 'visits'));
mergeRecordGraph(boundedNavigation, {nodes: manyNodes});
for (const [index, item] of manyNodes.entries()) recordMapVisit(boundedNavigation, item.id, {x: index, y: index, zoom: 1});
assert.equal(boundedNavigation.navigationHistory.length, 50, 'Record navigation has its own bounded 50-entry history.');
assert.equal(boundedNavigation.navigationHistory[0].id, 'visit-5');
assert.equal(originRecordMapVisit(boundedNavigation).id, 'root', 'The starting record stays directly reachable after history trims.');
assert.equal(originRecordMapVisit(boundedNavigation).index, -1);

const history = create();
for (let index = 0; index < 40; index++) {
    recordMapCheckpoint(history); moveRecordMapNode(history, 'root', {x: index + 1, y: index + 1});
}
assert.equal(history.undoStack.length, 25, 'Repeated gestures cannot grow undo indefinitely.');
for (let index = 0; index < 25; index++) assert.equal(undoRecordMap(history), true);
assert.deepEqual(history.positions.get('root'), {x: 15, y: 15});
assert.equal(undoRecordMap(history), false);
recordMapCheckpoint(history);
assert.equal(recordMapCheckpoint(history), false, 'Unchanged presentation does not duplicate history.');
history.undoStack.at(-1).scope_key = 'postgres:other:public';
const beforeWrongScope = points(history);
assert.equal(undoRecordMap(history), false);
assert.deepEqual(points(history), beforeWrongScope, 'Foreign-scope history cannot alter this canvas.');

const scope = create();
recordMapCheckpoint(scope); setRecordMapPinned(scope, 'root'); hideRecordMapNodes(scope, 'outgoing');
ensureRecordMapState(scope, 'postgres:canvas:archive');
for (const name of ['nodes', 'edges', 'positions', 'details', 'cursors', 'expansions', 'hiddenTables', 'hiddenNodes', 'hiddenEdges', 'selectedNodes', 'pinned']) assert.equal(scope[name].size, 0);
assert.equal(scope.undoStack.length, 0); assert.equal(scope.focusId, ''); assert.equal(scope.layout, 'orbit');
assert.equal(scope.selection, null);
assert.deepEqual(scope.trail, []);
scope.viewport = {x: 0, y: 0, zoom: -1};
ensureRecordMapState(scope, 'postgres:canvas:archive');
assert.equal(scope.viewport, null);
mergeRecordGraph(scope, {focus: node('root')});
scope.table = 'people'; scope.search = 'retained source'; scope.page = 4;
recordMapVisit(scope, 'root', {x: 1, y: 2, zoom: 1});
recordMapCheckpoint(scope); setRecordMapPinned(scope, 'root');
const epochBeforeClear = scope.graphEpoch; clearRecordMap(scope);
assert.equal(scope.nodes.size + scope.pinned.size + scope.hiddenNodes.size + scope.hiddenEdges.size + scope.selectedNodes.size + scope.undoStack.length, 0);
assert.equal(scope.scope_key, 'postgres:canvas:archive', 'Clear never changes the request scope.');
assert.equal(scope.table, 'people'); assert.equal(scope.search, 'retained source'); assert.equal(scope.page, 4);
assert.equal(scope.originId, ''); assert.equal(scope.originRecord, null);
assert.equal(scope.navigationHistory.length, 0); assert.equal(scope.navigationIndex, -1);
assert.equal(scope.graphEpoch, epochBeforeClear + 1, 'Clear advances the generation used to reject late graph replies.');

const refreshed = create();
moveRecordMapNode(refreshed, 'root', {x: 45, y: -21});
moveRecordMapNode(refreshed, 'incoming', {x: 705, y: 95});
setRecordMapPinned(refreshed, ['root', 'incoming']);
selectRecordMapNode(refreshed, 'root');
refreshed.focusId = 'root'; refreshed.layout = 'flow';
refreshed.table = 'people'; refreshed.search = 'retained search'; refreshed.page = 3;
refreshed.viewport = {x: 10, y: 20, zoom: .9};
refreshed.hiddenTables.add('sources'); refreshed.seedResult = {nodes: [node('old-seed')]};
refreshed.trail = ['root', 'incoming']; refreshed.panels = {library: {left: 12, top: 34}};
refreshed.cursors.set('old-cursor', {has_more: false});
refreshed.expansions.set('old-relation', new Set(['in']));
refreshed.hiddenNodes.add('outgoing'); refreshed.hiddenEdges.add('out');
recordMapCheckpoint(refreshed);
recordMapVisit(refreshed, 'root', {x: 4, y: 5, zoom: .75});
const beforeRefresh = points(refreshed), oldScope = refreshed.scope_key, epochBeforeRefresh = refreshed.graphEpoch;
assert.deepEqual(resetRecordMapEvidence(refreshed), {table: 'people', key: {id: '9007199254740993-root'}});
for (const name of ['nodes', 'edges', 'details', 'cursors', 'expansions', 'hiddenNodes', 'hiddenEdges', 'selectedNodes']) assert.equal(refreshed[name].size, 0);
assert.equal(refreshed.seedResult, null); assert.equal(refreshed.undoStack.length, 0);
assert.equal(refreshed.selection, null); assert.equal(refreshed.focusId, '');
assert.equal(refreshed.originId, ''); assert.equal(refreshed.originRecord, null);
assert.equal(refreshed.navigationHistory.length, 0); assert.equal(refreshed.navigationIndex, -1);
assert.equal(refreshed.graphEpoch, epochBeforeRefresh + 1);
assert.deepEqual(refreshed.trail, []);
assert.deepEqual(points(refreshed), beforeRefresh);
assert.deepEqual([...refreshed.pinned], ['root', 'incoming']);
assert.equal(refreshed.layout, 'flow'); assert.equal(refreshed.scope_key, oldScope);
assert.equal(refreshed.table, 'people'); assert.equal(refreshed.search, 'retained search'); assert.equal(refreshed.page, 3);
assert.deepEqual(refreshed.viewport, {x: 10, y: 20, zoom: .9});
assert.deepEqual([...refreshed.hiddenTables], ['sources']);
assert.deepEqual(refreshed.panels, {library: {left: 12, top: 34}});
assert.equal(undoRecordMap(refreshed), false, 'Evidence reset prevents Undo from revealing any previous source snapshot.');
mergeRecordGraph(refreshed, {focus: node('root', 'people', 'AFTER_REFRESH')});
recordMapCheckpoint(refreshed); moveRecordMapNode(refreshed, 'root', {x: 999, y: 999});
assert.equal(undoRecordMap(refreshed), true);
assert.deepEqual(refreshed.positions.get('incoming'), {x: 705, y: 95}, 'Undo after refresh keeps unloaded cards’ retained geometry.');
assert.equal(refreshed.pinned.has('incoming'), true, 'Undo after refresh retains pins for later re-expansion.');
mergeRecordGraph(refreshed, {nodes: [node('incoming', 'projects', 'REFRESHED_NEIGHBOR')]});
recordMapPositions(refreshed, 'root');
assert.deepEqual(refreshed.positions.get('incoming'), {x: 705, y: 95});
assert.equal(refreshed.nodes.get('incoming').row.value, 'REFRESHED_NEIGHBOR');
assert.equal(resetRecordMapEvidence(ensureRecordMapState({}, 'empty')), null);
console.log('PASS: canvas multi-selection, pin/hide/show, source-safe bounded undo, scope isolation, card spacing, stable expansion and Orbit/Flow/Manual layouts.');
