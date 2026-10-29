import {t, hasMessage} from './i18n.js';
import './selection-messages.js';

const message = (key, params) => t('app.selection.' + key, params);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const scalar = value => typeof value === 'string' || typeof value === 'bigint' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));
const display = value => value === null ? 'NULL' : value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const names = value => Array.isArray(value) && value.length > 0 && value.every(name => typeof name === 'string' && name.length > 0);
const quote = name => '`' + name.replace(/`/g, '``') + '`';

/** Hex literals keep backslashes, control characters and quotes independent of SQL string modes. */
function literal(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (value === '') return "''";
    if (!/[\\\x00-\x1f\x7f]/.test(value)) return "'" + value.replace(/'/g, "''") + "'";
    const hex = [...new TextEncoder().encode(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return 'CONVERT(0x' + hex + ' USING utf8mb4)';
}

function recordKey(meta) {
    if (!meta?.table || meta.snapshot || meta.truncated || !names(meta.primaryKey) || !meta.record || typeof meta.record !== 'object') return null;
    if (!meta.primaryKey.every(column => has(meta.record, column) && scalar(meta.record[column]))) return null;
    return JSON.stringify([meta.table, meta.primaryKey.map(column => [column, display(meta.record[column])])]);
}

function normalizeRelationship(key, table, database) {
    if (!key || typeof key !== 'object') return null;
    const source = key.sourceTable || table;
    const target = key.targetTable || key.referenced_table;
    const pairs = Array.isArray(key.pairs) ? key.pairs : names(key.columns) && names(key.referenced_columns)
        && key.columns.length === key.referenced_columns.length
        ? key.columns.map((column, index) => ({source: column, target: key.referenced_columns[index]})) : [];
    if (!source || !target || !pairs.length || !pairs.every(pair => typeof pair.source === 'string' && pair.source && typeof pair.target === 'string' && pair.target)) return null;
    const targetSchema = key.targetSchema || key.referenced_schema;
    return {name: key.name || '', source, target, pairs, external: key.external === true
        || Boolean(targetSchema && database && targetSchema !== database)};
}

function relationships(items, context) {
    const result = new Map();
    const add = (key, table) => {
        const value = normalizeRelationship(key, table, context.database || context.schema?.database);
        if (value) result.set(JSON.stringify(value), value);
    };
    for (const key of context.schema?.relationships || []) add(key);
    for (const table of context.schema?.tables || []) for (const key of table.foreign_keys || []) add(key, table.name);
    for (const {meta} of items) {
        if (meta.relationship) add(meta.relationship, meta.table);
        for (const key of meta.foreignKeys || []) add(key, meta.table);
    }
    return [...result.values()];
}

function kindLabel(kind) {
    const known = {table:'kindTable', column:'kindColumn', row:'kindRow', cell:'kindCell', relationship:'kindRelationship', control:'kindControl', workspace:'kindWorkspace'};
    return message(known[kind] || 'kindElement');
}

function entry(item, context) {
    const {meta = {}, tag = ''} = item;
    const kind = kindLabel(meta.kind), title = String(meta.label || meta.column || meta.table || message('unknown'));
    const details = [];
    let description;
    const columns = Array.isArray(meta.columns) ? meta.columns : [];
    const column = columns.find(value => value.name === meta.column);
    if (meta.kind === 'table') description = message('tableBody', {table: meta.table || title});
    else if (meta.kind === 'column') description = meta.attribute ? message('columnAttributeBody', {table:meta.table || '—', column:meta.column || title, attribute:meta.attribute, value:display(meta.value)})
        : message('columnBody', {table: meta.table || '—', column: meta.column || title});
    else if (meta.kind === 'row') description = message(meta.table ? 'rowBody':'resultRowBody', {table: meta.table});
    else if (meta.kind === 'cell') description = message(meta.table ? 'cellBody':'resultCellBody', {table: meta.table, column: meta.column || '—', value: display(meta.value)});
    else if (meta.kind === 'relationship') {
        const relation = normalizeRelationship(meta.relationship, meta.table, context.database);
        description = relation ? message('relationshipBody', {source:relation.source, target:relation.target, pairs:relation.pairs.map(pair => pair.source + ' → ' + pair.target).join(', ')})
            : message('noDeclared');
    } else description = meta.descriptionKey && hasMessage(meta.descriptionKey) ? t(meta.descriptionKey)
        : meta.purpose && hasMessage('app.selection.' + 'purpose_' + meta.purpose) ? message('purpose_' + meta.purpose, {table:meta.table || '—'})
        : message('elementBody', {name:title, tag});
    if (meta.description) details.push({label:message('comment'), value:String(meta.description)});
    if (column?.type) details.push({label:message('type'), value:String(column.type)});
    if (typeof column?.nullable === 'boolean') details.push({label:message('nullable'), value:message(column.nullable ? 'yes':'no')});
    if (column?.generated) details.push({label:message('generated'), value:String(column.generated === true ? message('yes') : column.generated)});
    if (meta.kind === 'cell') details.push({label:message('value'), value:display(meta.value)});
    if (meta.kind === 'row') for (const [label, value] of Object.entries(meta.record || {})) details.push({label, value:display(value)});
    if (meta.kind === 'row' || meta.kind === 'cell') {
        details.push({label:message('primaryKey'), value:recordKey(meta)
            ? meta.primaryKey.map(name => name + ' = ' + display(meta.record[name])).join(', ')
            : (meta.snapshot || meta.truncated) && names(meta.primaryKey) ? meta.primaryKey.join(', ') + ' · ' + message('displaySnapshot') : message('noPrimaryKey')});
    }
    if (meta.truncated) description += ' ' + message('previewTruncated');
    if (item.connected === false) description += ' ' + message('snapshot');
    return {title, kind, tag:String(tag), description, details};
}

function combined(items, context) {
    const records = items.filter(item => ['row','cell'].includes(item.meta.kind));
    const dataItems = items.filter(item => item.meta.table && item.meta.kind !== 'control');
    if (!dataItems.length) return message(records.length === items.length && records.length ? 'resultMeaning':'uiMeaning');
    if (dataItems.length !== items.length) return message('mixed');
    const tables = [...new Set(dataItems.map(item => item.meta.table))];
    const identities = records.map(item => recordKey(item.meta));
    if (records.some(item => item.meta.snapshot || item.meta.truncated)) return message('displaySnapshot');
    if (tables.length === 1) {
        if (records.length === items.length && identities.every(Boolean)) {
            const count = new Set(identities).size;
            return message(count === 1 ? (records.length > 1 ? 'sameRecord':'singleRecord') : 'differentRecords', {table:tables[0], count});
        }
        if (records.length === items.length && identities.some(identity => !identity)) return message(records.some(item => item.meta.snapshot && names(item.meta.primaryKey)) ? 'displaySnapshot':'noPrimaryKey');
        return message('sameTable', {table:tables[0]});
    }
    const direct = relationships(items, context).filter(relation => !relation.external && tables.includes(relation.source) && tables.includes(relation.target));
    const matching = direct.find(relation => records.some(source => source.meta.table === relation.source && records.some(target => target !== source && target.meta.table === relation.target
        && relation.pairs.every(pair => has(source.meta.record, pair.source) && has(target.meta.record, pair.target)
            && scalar(source.meta.record[pair.source]) && scalar(target.meta.record[pair.target])
            && display(source.meta.record[pair.source]) === display(target.meta.record[pair.target])))));
    if (matching) return message('matchedRecords', {name:matching.name || matching.source + ' → ' + matching.target,
        pairs:matching.pairs.map(pair => matching.source + '.' + pair.source + ' = ' + matching.target + '.' + pair.target).join(', ')});
    if (direct.length && records.length === items.length) return message('noRecordMatch');
    if (direct.length) { const relation = direct[0]; return message('declaredPath', {name:relation.name, source:relation.source, target:relation.target, pairs:relation.pairs.map(pair=>pair.source+' → '+pair.target).join(', ')}); }
    return message('noDeclared');
}

/** A factual local explainer. Values are returned as text, never HTML or executable actions. */
export function explainSelection(rawItems, context = {}) {
    const items = (Array.isArray(rawItems) ? rawItems : []).filter(item => item && item.meta && typeof item.meta === 'object');
    const entries = items.map(item => entry(item, context));
    const possibilities = [], actions = [];
    const tables = [...new Set(items.filter(item => item.meta.kind !== 'control' && typeof item.meta.table === 'string' && item.meta.table).map(item => item.meta.table))];
    if (tables.length === 1) {
        const table = tables[0];
        possibilities.push(message('inspectStructure'), message('browse'));
        actions.push({type:'structure', label:message('openStructure', {table}), table}, {type:'data', label:message('openData', {table}), table});
    }
    const recordItems = items.filter(item => ['row','cell'].includes(item.meta.kind));
    if (items.length && recordItems.length === items.length && tables.length === 1 && recordItems.every(item => recordKey(item.meta)
        && JSON.stringify(item.meta.primaryKey) === JSON.stringify(recordItems[0].meta.primaryKey))) {
        const unique = [...new Map(recordItems.map(item => [recordKey(item.meta),item.meta])).values()];
        // Each disjunct preserves the full key; never construct independent IN lists for composite keys.
        const predicates = unique.map(meta => '(' + meta.primaryKey.map(column => quote(column) + ' = ' + literal(meta.record[column])).join(' AND ') + ')');
        actions.push({type:'query', label:message('prepareQuery'), table:tables[0], sql:'SELECT *\nFROM ' + quote(tables[0]) + '\nWHERE ' + predicates.join('\n   OR ') + '\nLIMIT 200;'});
        possibilities.push(message('prepare'));
    }
    if (items.length && recordItems.length === items.length && !tables.length) possibilities.push(message('inspectResult'));
    else if (items.some(item => !item.meta.table || item.meta.kind === 'control')) possibilities.push(message('leavePointer'));
    else possibilities.push(message('compare'));
    return {
        title:items.length === 1 ? entries[0].title : message('selectedTitle', {count:items.length}),
        summary:message('summary', {count:items.length}), entries,
        relationship:combined(items,context), possibilities:[...new Set(possibilities)], actions,
    };
}
