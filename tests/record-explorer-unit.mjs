import assert from 'node:assert/strict';
import {recordPositions, visibleNeighborhood, valueText, tableColor, RECORD_WIDTH, RECORD_HEIGHT} from '../app/public/assets/record-explorer-model.js';

const root = {id: 'root', label: 'Northbridge', table: 'organizations', key: {id: '9007199254740993'}, values: {budget: '123456789012345678901234.12'}};
const portal = {id: 'portal', label: 'Portal', table: 'systems', values: {active: false}};
const contact = {id: 'contact', label: 'Alex', table: 'contacts', values: {missing: null}};
const relations = [
    {id: 'owns', name: 'owner_fk', source_table: 'systems', target_table: 'organizations', columns: ['owner_id'], referenced_columns: ['id']},
    {id: 'contacts', name: 'contact_fk', source_table: 'contacts', target_table: 'organizations', columns: ['org_id'], referenced_columns: ['id']},
];
const edges = relations.map((relation, index) => ({...relation, id: 'edge' + index, source: index ? 'contact' : 'portal', target: 'root'}));
const data = {center: 'root', nodes: [root, portal, contact], edges, relations};
const before = JSON.stringify(data);
assert.deepEqual(visibleNeighborhood(data).nodes.map(node => node.id), ['root', 'portal', 'contact']);
assert.deepEqual(visibleNeighborhood(data, {search: 'PORTAL'}).nodes.map(node => node.id), ['root', 'portal']);
assert.deepEqual([...visibleNeighborhood(data, {search: 'PORTAL'}).context], ['root']);
assert.deepEqual(visibleNeighborhood(data, {enabledRelations: ['contacts']}).nodes.map(node => node.id), ['root', 'contact']);
assert.deepEqual(visibleNeighborhood(data, {enabledRelations: []}).nodes.map(node => node.id), ['root']);
assert.equal(visibleNeighborhood(data, {search: 'no match'}).matching.size, 0);
assert.equal(visibleNeighborhood(data, {search: '123456789012345678901234.12'}).matching.has('root'), true);
assert.equal(valueText('9007199254740993'), '9007199254740993');
assert.equal(valueText(false), 'false'); assert.equal(valueText(0), '0'); assert.equal(valueText(null), 'NULL');
assert.equal(JSON.stringify(data), before, 'Filtering never mutates records, exact keys or relationships.');
assert.equal(tableColor('__proto__'), tableColor('__proto__'));
const many = Array.from({length: 60}, (_, index) => ({id: 'n' + index, table: 'table' + index % 5, label: 'Record ' + index}));
const layout = recordPositions(many, 'n0');
assert.deepEqual([...layout.positions], [...recordPositions(many.slice().reverse(), 'n0').positions], 'Layout is stable across response ordering.');
assert.deepEqual(layout.positions.get('n0'), {x: 0, y: 0});
for (let index = 0; index < many.length; index++) for (let other = index + 1; other < many.length; other++) {
    const a = layout.positions.get(many[index].id), b = layout.positions.get(many[other].id);
    assert.ok(Math.abs(a.x - b.x) >= RECORD_WIDTH || Math.abs(a.y - b.y) >= RECORD_HEIGHT,
        'Record cards do not overlap at the backend node limit.');
}
assert.equal(recordPositions([], null).positions.size, 0);
console.log('PASS: record graph filtering, exact values, stable colors, scope-neutral data and non-overlapping 60-record layout.');
