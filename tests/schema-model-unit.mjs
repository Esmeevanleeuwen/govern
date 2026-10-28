import assert from 'node:assert/strict';
import {normalizeSchema, initialPositions, tableHeight, relatedTables, filterTables, validPositions, TABLE_WIDTH} from '../app/public/assets/schema-model.js';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const column = name => ({name, type: 'bigint', primary: name === 'id'});
const key = (name, columns, referenced_table, referenced_columns, referenced_schema = 'work') => ({name, columns, referenced_table, referenced_columns, referenced_schema});
const source = {database: 'work', tables: [
    {name: 'child', columns: [column('id'), column('tenant'), column('parent')], foreign_keys: [
        key('fk_parent', ['tenant', 'parent'], 'parent', ['tenant', 'id']),
        key('fk_self', ['parent'], 'child', ['id']),
        key('fk_elsewhere', ['parent'], 'parent', ['id'], 'elsewhere'),
        key('fk_unavailable', ['parent'], 'hidden', ['id']),
    ]},
    {name: 'parent', columns: [column('tenant'), column('id')]},
    {name: 'lonely', columns: [column('parent')], foreign_keys: []},
    {name: 'view_all', type: 'view', columns: []},
]};
const model = normalizeSchema(source);
check(model.tables.length === 4 && model.relationships.length === 4, 'Keep every table and only declared relationships');
assert.deepEqual(model.relationships[0].pairs, [{source: 'tenant', target: 'tenant'}, {source: 'parent', target: 'id'}]); checks++;
check(model.relationships[1].sourceTable === model.relationships[1].targetTable, 'Keep self references');
check(model.relationships[2].external && !model.relationships[2].targetAvailable, 'An equal table name in another schema is external');
check(!model.relationships[3].external && !model.relationships[3].targetAvailable, 'An unavailable same-schema target is distinct from external');
check(model.tables[3].type === 'view' && tableHeight(model.tables[3]) === 76, 'Views and empty column lists have measurable cards');
assert.deepEqual([...relatedTables(model, 'parent')].sort(), ['child', 'parent']); checks++;
assert.deepEqual([...relatedTables(model, 'child')].sort(), ['child', 'parent']); checks++;
assert.deepEqual([...relatedTables(model, 'lonely')], ['lonely']); checks++;
check(relatedTables(model, 'missing').size === 0, 'Unknown selection cannot invent a neighborhood');
assert.deepEqual(filterTables(model, ' TENANT ').map(table => table.name), ['child', 'parent']); checks++;
assert.deepEqual(filterTables(model, '', 'parent', true).map(table => table.name), ['child', 'parent']); checks++;
check(filterTables(model, 'lonely', 'parent', true).length === 0, 'Search and related-table filter combine');
check(filterTables(model, '', '', true).length === 4, 'No selection retains all tables');
check(model.relationships.every(relationship => relationship.sourceTable !== 'lonely'), 'Matching column names do not imply a key');

const malformed = normalizeSchema({database: 'work', tables: [null, {name: ''}, {name: 'ok', columns: [null, {name: ''}, column('id')], foreign_keys: [
    key('bad', ['id', 'other'], 'ok', ['id']), key('empty', [], 'ok', []), null,
    key('good', ['id'], 'ok', ['id']), key('good', ['id'], 'ok', ['id']),
]}, {name: 'ok'}]});
check(malformed.tables.length === 1 && malformed.tables[0].columns.length === 1 && malformed.relationships.length === 1, 'Malformed or duplicate entries do not fabricate diagrams');
check(normalizeSchema(null).tables.length === 0 && normalizeSchema().relationships.length === 0, 'Empty or missing payload is safe');

const many = Array.from({length: 25}, (_, index) => ({name: 'table_' + index, columns: Array.from({length: index % 12}, (_, col) => column('field_' + col))}));
const positions = initialPositions(many);
assert.deepEqual(positions, initialPositions(many.slice().reverse())); checks++;
for (let index = 0; index < many.length; index++) for (let next = index + 1; next < many.length; next++) {
    const a = positions[many[index].name], b = positions[many[next].name];
    const separate = a.x + TABLE_WIDTH + 80 <= b.x || b.x + TABLE_WIDTH + 80 <= a.x
        || a.y + tableHeight(many[index]) + 80 <= b.y || b.y + tableHeight(many[next]) + 80 <= a.y;
    assert.ok(separate, 'Initial cards must not overlap');
}
checks++;
check(Object.keys(initialPositions([])).length === 0, 'Empty schema has no layout');
const special = normalizeSchema({database: 'work', tables: [{name: '__proto__', columns: []}, {name: 'constructor', columns: []}]});
check(special.tables.length === 2 && Object.hasOwn(initialPositions(special.tables), '__proto__'), 'Prototype names remain ordinary identifiers');
const saved = JSON.parse('{"__proto__":{"x":10,"y":20},"constructor":{"x":"20","y":30}}');
const validated = validPositions(saved, special.tables);
check(Object.hasOwn(validated, '__proto__') && !Object.hasOwn(validated, 'constructor'), 'Only finite numeric coordinates are accepted');
check(Object.keys(validPositions({parent: {x: -1, y: 1}}, model.tables)).length === 0, 'Negative coordinates are rejected');
check(Object.keys(validPositions({parent: {x: Infinity, y: 1}}, model.tables)).length === 0, 'Infinite coordinates are rejected');
check(Object.keys(validPositions([], model.tables)).length === 0, 'Malformed position envelopes are ignored');
check(source.tables[0].columns[0] !== model.tables[0].columns[0], 'Normalized column edits do not mutate the catalog payload');
console.log(`${checks} schema model checks passed.`);
