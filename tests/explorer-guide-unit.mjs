import assert from 'node:assert/strict';
import {friendlyName, recordLabel, connectedGroups, getExplorerMode, setExplorerMode, connectionDescription} from '../app/public/assets/explorer-guide.js';

assert.equal(friendlyName('demo_organizations'), 'Demo organizations');
assert.equal(friendlyName('HTTPServiceOwner'), 'HTTP Service Owner');
assert.equal(friendlyName('één_organisatie'), 'Één organisatie');
assert.equal(friendlyName('0_column'), '0 column');
assert.equal(friendlyName('<img_onerror=x>'), '<img onerror=x>', 'Display aliases are text, never parsed markup.');
assert.equal(friendlyName(null), '');
const root = {id: 'root', table: 'organizations', label: 'Northbridge', key: {id: '9007199254740993'}};
const portal = {id: 'portal', table: 'demo_systems', label: 'Resident Services Portal', key: {id: '1'}};
const contact = {id: 'contact', table: 'contacts', label: 'Alex Example', key: {id: '1'}};
const omitted = {id: 'unlinked', table: 'contacts', label: 'Not connected'};
const relations = [
    {id: 'owns', source_table: 'demo_systems', target_table: 'organizations'},
    {id: 'operates', source_table: 'demo_systems', target_table: 'organizations'},
    {id: 'contact', source_table: 'contacts', target_table: 'organizations'},
];
const edges = [
    {id: 'a', source: 'portal', target: 'root', relation: 'owns'},
    {id: 'b', source: 'portal', target: 'root', relation: 'operates'},
    {id: 'c', source: 'contact', target: 'root', relation: 'contact'},
    {id: 'duplicate', source: 'contact', target: 'root', relation: 'contact'},
    {id: 'missing', source: 'missing', target: 'root', relation: 'contact'},
    {id: 'undeclared', source: 'unlinked', target: 'root', relation: 'not-in-catalog'},
    {id: 'not-rooted', source: 'portal', target: 'contact', relation: 'owns'},
];
const data = {center: 'root', nodes: [root, portal, contact, omitted], relations, edges};
const before = JSON.stringify(data);
assert.deepEqual(connectedGroups(data), [
    {table: 'contacts', label: 'Contacts', count: 1, relationIds: ['contact']},
    {table: 'demo_systems', label: 'Demo systems', count: 1, relationIds: ['operates', 'owns']},
], 'Parallel links count a real neighboring item once; unrelated and undeclared edges are excluded.');
assert.deepEqual(connectedGroups({...data, center: 'missing'}), []);
assert.deepEqual(connectedGroups(null), []);
assert.equal(recordLabel(root), 'Northbridge');
assert.equal(recordLabel({label: 'join_table · 1 / 2', key: {left: '1', right: '2'}}, 'join_table'), 'join_table · 1 / 2',
    'A candidate without preview fields cannot prove that its label is a generated fallback.');
assert.equal(recordLabel({table: 'join_table', label: 'join_table · 1 / 2', key: {left: '1', right: '2'},
    values: {left: '1', right: '2'}, truncated: false}), 'Join table · 1 / 2');
assert.equal(recordLabel({table: 'join_table', label: 'join_table · 1 / 2', key: {left: '1', right: '2'},
    values: {left: '1'}, truncated: true}), 'join_table · 1 / 2', 'An incomplete preview cannot prove the source of a label.');
assert.equal(recordLabel({table: 'join_table', label: 'join_table · 1 / 2', key: {left: '1', right: '2'}, values: {name: 'join_table · 1 / 2'}}),
    'join_table · 1 / 2', 'Actual named values stay verbatim even if they resemble a fallback label.');
assert.equal(recordLabel({table: 'values', key: {id: '9007199254740993'}}), 'Values · 9007199254740993');
assert.ok(connectionDescription(edges[0], portal, root).includes('Resident Services Portal'));
assert.ok(connectionDescription(edges[0], portal, root).includes('Northbridge'));
assert.notEqual(connectionDescription(edges[0], root, portal), connectionDescription(edges[0], portal, root),
    'An explanation requires the actual source and target.');
assert.equal(JSON.stringify(data), before, 'Guide helpers never alter records, exact keys or source relationships.');

const saved = new Map();
globalThis.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
assert.equal(getExplorerMode(), 'guided');
assert.equal(setExplorerMode('detailed'), true);
assert.equal(getExplorerMode(), 'detailed');
assert.deepEqual([...saved], [['govern.explorer.mode.v1', 'detailed']], 'Only the mode is stored, without any record content.');
assert.equal(setExplorerMode({records: data}), false);
assert.equal(saved.size, 1);
saved.set('govern.explorer.mode.v1', 'unknown');
assert.equal(getExplorerMode(), 'guided');
globalThis.localStorage = {getItem: () => 'guided', setItem() {throw new Error('quota');}};
assert.equal(getExplorerMode(), 'guided');
assert.equal(setExplorerMode('detailed'), false);
assert.equal(getExplorerMode(), 'detailed', 'A readable stale value cannot replace the explicit same-page choice when saving fails.');
Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('blocked');}});
assert.equal(setExplorerMode('detailed'), false);
assert.equal(getExplorerMode(), 'detailed', 'Blocked persistence keeps the same-page selection across rerenders.');
assert.equal(setExplorerMode('guided'), false);
assert.equal(getExplorerMode(), 'guided');
delete globalThis.localStorage;
console.log('PASS: guided labels, distinct linked groups, exact-source preservation and mode-only browser storage.');
