import assert from 'node:assert/strict';
import {captureRecordContext, recordContextId, loadCompanionRecord, comparisonRows, sharedConnections,
    MAX_PINNED_RECORDS} from '../app/public/assets/companion-model.js';

const publicScope = 'postgres:govern_pg:public', archiveScope = 'postgres:govern_pg:archive';
const source = {database: publicScope, table: 'systems', key: {tenant: '7', id: '9007199254740993'}, guided: true};
const captured = captureRecordContext(source);
assert.deepEqual(captured, source);
assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.key));
source.key.id = '1';
assert.equal(captured.key.id, '9007199254740993', 'A later source mutation never changes the captured key.');
assert.equal(MAX_PINNED_RECORDS, 4);
assert.equal(recordContextId(captured), recordContextId({...captured, guided: false, key: {id: '9007199254740993', tenant: '7'}}),
    'Source ordering and display mode do not change record identity.');
assert.notEqual(recordContextId(captured), recordContextId({...captured, database: archiveScope}));
assert.notEqual(recordContextId(captured), recordContextId({...captured, table: 'organizations'}));
assert.notEqual(recordContextId(captured), recordContextId({...captured, key: {...captured.key, id: '9007199254740992'}}));
assert.notEqual(recordContextId({...captured, table: 'a:b', key: {x: 'c'}}),
    recordContextId({...captured, table: 'a', key: {x: 'b:c'}}), 'Delimited values cannot collide.');

for (const invalid of [null, [], {}, {...captured, database: ''}, {...captured, table: ''},
    {...captured, database: 'postgres:govern_pg'}, {...captured, database: 'postgres:govern_pg:%ZZ'},
    {...captured, key: {}}, {...captured, key: []}, {...captured, key: {id: 9007199254740992}},
    {...captured, key: {id: null}}, {...captured, key: {id: 'a\0b'}}, {...captured, key: {id: '\ud800'}},
    {...captured, guided: 'yes'}, {...captured, table: 'a'.repeat(513)}]) {
    assert.equal(captureRecordContext(invalid), null, 'Invalid source context is rejected.');
    assert.equal(recordContextId(invalid), null);
}
assert.equal(captureRecordContext({...captured, key: {id: ''}}).key.id, '', 'A stored empty string is a valid key scalar.');
const ownNames = Object.fromEntries([['__proto__', 'source'], ['constructor', 'record']]);
const unusual = captureRecordContext({...captured, key: ownNames});
assert.ok(Object.hasOwn(unusual.key, '__proto__'));
assert.equal(unusual.key.__proto__, 'source');
assert.equal(Object.getPrototypeOf(unusual.key), Object.prototype, 'Identifier copying does not mutate an object prototype.');
const emptyLength = JSON.stringify({id: ''}).length;
assert.ok(captureRecordContext({...captured, key: {id: 'a'.repeat(2048 - emptyLength)}}));
assert.equal(captureRecordContext({...captured, key: {id: 'a'.repeat(2049 - emptyLength)}}), null);
assert.ok(captureRecordContext({...captured, key: {id: 'é'.repeat(300)}}));
assert.equal(captureRecordContext({...captured, key: {id: 'é'.repeat(350)}}), null,
    'Unicode uses the server JSON-escaped byte limit rather than shorter browser UTF-8 JSON.');
assert.equal(captureRecordContext({...captured, key: {id: '/'.repeat(1020)}}), null, 'PHP JSON also escapes slashes.');
assert.ok(captureRecordContext({...captured, key: {id: '😀'}}));

const record = (values, {context = captured, truncated = false, id = 'root', nodes = [], edges = []} = {}) => {
    const node = {id, table: context.table, key: context.key, label: 'Actual source label', values, truncated};
    return {context, node, data: {scope_key: context.database, table: context.table, center: id, nodes: [node, ...nodes], edges}};
};
const originals = [record({nullable: null, empty: '', amount: '123456789012345678901234.12', precise: '1.00', missing: 'here'}),
    record({nullable: '', empty: '', amount: '123456789012345678901234.13', precise: '1'})];
const snapshot = JSON.stringify(originals);
const rows = new Map(comparisonRows(originals).map(row => [row.name, row]));
assert.equal(rows.get('nullable').different, true);
assert.equal(rows.get('empty').different, false);
assert.equal(rows.get('amount').different, true);
assert.equal(rows.get('precise').different, true, 'Comparison never coerces exact source text into numeric equality.');
assert.deepEqual(rows.get('missing').cells.map(cell => cell.present), [true, false]);
assert.equal(rows.get('missing').different, true);
assert.equal(rows.get('amount').unknown, false);
assert.equal(rows.get('amount').comparable, true);
assert.deepEqual(comparisonRows([]), []);
assert.equal(comparisonRows([originals[0]])[0].comparable, false);
assert.equal(comparisonRows([record({value: null}), record({})])[0].different, true, 'Missing and NULL stay distinct.');
assert.equal(comparisonRows([record({value: {b: 2, a: [true, '2']}}), record({value: {a: [true, '2'], b: 2}})])[0].different,
    false, 'JSON object property ordering alone is not a difference.');
assert.equal(comparisonRows([record({value: [1, 2]}), record({value: [2, 1]})])[0].different, true);
const uncertain = comparisonRows([record({value: 'same'}), record({value: 'same'}, {truncated: true})])[0];
assert.equal(uncertain.unknown, true);
assert.equal(uncertain.comparable, false);
assert.equal(uncertain.different, false, 'A possibly shortened preview cannot prove equality or a difference.');
const omitted = comparisonRows([record({value: 'present'}), record({}, {truncated: true})])[0];
assert.equal(omitted.unknown, true); assert.equal(omitted.different, false);
assert.equal(comparisonRows([record({value: 'a'}), record({value: 'b'}), record({value: 'a'}, {truncated: true})])[0].different,
    true, 'Two complete previews may prove a difference even when another is incomplete.');
assert.equal(JSON.stringify(originals), snapshot, 'Deriving rows never mutates source objects.');

const neighbor = {id: 'neighbor', table: 'organizations', key: {id: '5'}, label: 'Same displayed label', values: {name: 'Org'}};
const elsewhere = {...neighbor, id: 'other', key: {id: '6'}};
const neighborhood = (context, nodes = [neighbor], edges = [{source: 'root', target: 'neighbor'}]) => record({}, {context, nodes, edges});
assert.equal(sharedConnections([neighborhood(captured)]).length, 0);
assert.equal(sharedConnections([neighborhood(captured), neighborhood({...captured, key: {id: '2'}})]).length, 1);
assert.equal(sharedConnections([neighborhood(captured), neighborhood({...captured, database: archiveScope})]).length, 0,
    'The same table/key in a different schema is never a shared connection.');
assert.equal(sharedConnections([neighborhood(captured), neighborhood(captured, [elsewhere], [{source: 'root', target: 'other'}])]).length,
    0, 'Matching labels do not establish shared identity.');
assert.equal(sharedConnections([neighborhood(captured), neighborhood(captured, [neighbor], [])]).length, 0,
    'Loaded nodes without an actual root edge are not connections.');
const duplicateEdges = [{source: 'root', target: 'neighbor'}, {source: 'neighbor', target: 'root'}];
assert.equal(sharedConnections([neighborhood(captured, [neighbor], duplicateEdges), neighborhood(captured)]).length, 1);

const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
try {
    globalThis.window = {location: {origin: 'http://127.0.0.1:8080'}};
    let response = record({amount: '123456789012345678901234.12'}).data;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({url, options});
        return new Response(JSON.stringify({ok: true, data: response}), {status: 200, headers: {'Content-Type': 'application/json'}});
    };
    const controller = new AbortController();
    const loaded = await loadCompanionRecord(captured, {signal: controller.signal});
    assert.equal(loaded.node.values.amount, '123456789012345678901234.12');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.signal, controller.signal);
    const params = new URL(calls[0].url, globalThis.window.location.origin).searchParams;
    assert.equal(params.get('action'), 'explore'); assert.equal(params.get('database'), 'govern_pg');
    assert.equal(params.get('connection'), 'postgres'); assert.equal(params.get('schema'), 'public');
    assert.deepEqual(JSON.parse(params.get('key')), captured.key);
    for (const wrong of [{...response, scope_key: archiveScope}, {...response, table: 'other'},
        {...response, center: 'missing'}, {...response, nodes: [{...loaded.node, key: {id: '9007199254740992', tenant: '7'}}]},
        {...response, nodes: [{...loaded.node, table: 'other'}]}]) {
        response = wrong;
        await assert.rejects(loadCompanionRecord(captured), /wrongRecord/, 'Wrong scope/table/key responses are never shown.');
    }
    const callsBeforeInvalid = calls.length;
    await assert.rejects(loadCompanionRecord({...captured, key: {id: 5}}), /invalidRecord/);
    assert.equal(calls.length, callsBeforeInvalid, 'Invalid contexts never produce API requests.');
} finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
}

console.log('PASS: companion exact identities, bounded contexts, scoped read-only loads, honest comparison and shared connections.');
