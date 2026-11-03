/** Request URLs retain captured connection/database/schema across a switch. */
import assert from 'node:assert/strict';
import {databaseScope, endpoint, getDatabase, setDatabase} from '../app/public/assets/api.js';

globalThis.window = {location: {origin: 'http://localhost:8080'}};
const params = (action, options) => Object.fromEntries(new URL(endpoint(action, options), window.location.origin).searchParams);
setDatabase('bestuursatlas');
assert.equal(getDatabase(), 'bestuursatlas');
assert.deepEqual(params('schema'), {action: 'schema', database: 'bestuursatlas'}, 'Existing MariaDB URLs stay compatible.');
setDatabase('postgres:govern_pg:public');
const captured = {database: getDatabase(), table: 'records'};
assert.deepEqual(params('browse', captured), {action: 'browse', connection: 'postgres', database: 'govern_pg', schema: 'public', table: 'records'});
setDatabase('postgres:govern_pg:archive');
assert.equal(params('browse', captured).schema, 'public', 'An old callback keeps the exact scope it captured.');
assert.equal(params('browse').schema, 'archive', 'New work uses the current schema.');
assert.deepEqual(params('schema', {database: 'bestuursatlas'}), {action: 'schema', database: 'bestuursatlas'}, 'Captured MariaDB work cannot inherit a new engine.');
assert.deepEqual(databaseScope('postgres:data%3Aset:quoted%20schema'), {connection: 'postgres', database: 'data:set', schema: 'quoted schema'});
for (const malformed of ['postgres:missing', 'postgres::public', 'postgres:db:', 'postgres:db:extra:part', 'postgres:db:%ZZ', 'postgres:db:%00']) {
    assert.throws(() => databaseScope(malformed), 'Malformed scopes fail before making a request.');
}
assert.throws(() => endpoint('browse', {connection: 'mariadb'}), 'A caller cannot override a captured engine.');
assert.throws(() => endpoint('browse', {schema: 'public'}), 'A caller cannot override a selected schema.');
setDatabase(5);
assert.equal(getDatabase(), '');
assert.deepEqual(params('bootstrap'), {action: 'bootstrap'}, 'Empty selection retains the server default.');
console.log('PASS: database request scope encoding, captured callbacks, engine isolation and legacy URLs.');
