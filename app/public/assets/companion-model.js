import {request} from './api.js';
import {parseConnectionScope} from './connection-scope.js';
import {t} from './i18n.js';

export const MAX_PINNED_RECORDS = 4;
const KEY_BYTES = 2048;
const encoder = new TextEncoder();
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const wellFormed = value => !/[\uD800-\uDFFF]/u.test(value);
const identifier = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && wellFormed(value) && encoder.encode(value).length <= 512;
// PHP's default json_encode escapes Unicode and slashes when enforcing its key limit.
const keyBytes = key => JSON.stringify(key).replace(/\//g, '\\/').replace(/[^\x00-\x7f]/g,
    letter => '\\u' + letter.charCodeAt(0).toString(16).padStart(4, '0')).length;

/** A fresh, immutable source descriptor; preview data never becomes identity. */
export function captureRecordContext(value) {
    try {
        if (!plainObject(value) || !identifier(value.database) || !identifier(value.table)
            || !plainObject(value.key) || (value.guided !== undefined && typeof value.guided !== 'boolean')) return null;
        const entries = Object.entries(value.key);
        if (!entries.length || entries.some(([name, field]) => !identifier(name) || typeof field !== 'string'
            || field.includes('\0') || !wellFormed(field))) return null;
        const key = Object.fromEntries(entries);
        if (keyBytes(key) > KEY_BYTES) return null;
        const scope = parseConnectionScope(value.database);
        if (!identifier(scope.database) || (scope.schema !== undefined && !identifier(scope.schema))) return null;
        return Object.freeze({database: value.database, table: value.table, key: Object.freeze(key), guided: value.guided !== false});
    } catch { return null; }
}

/** Scope, table and every exact key field participate; source object order does not. */
export function recordContextId(value) {
    const context = captureRecordContext(value);
    return context ? JSON.stringify([context.database, context.table,
        Object.keys(context.key).sort().map(name => [name, context.key[name]])]) : null;
}

export async function loadCompanionRecord(value, {signal} = {}) {
    const context = captureRecordContext(value);
    if (!context) throw new Error(t('app.companion.invalidRecord'));
    const data = await request('explore', {params: {database: context.database, table: context.table,
        key: JSON.stringify(context.key)}, signal});
    const node = Array.isArray(data?.nodes) ? data.nodes.find(item => item.id === data.center) : null;
    if (data?.scope_key !== context.database || data.table !== context.table || node?.table !== context.table
        || recordContextId({...context, key: node?.key}) !== recordContextId(context)) {
        throw new Error(t('app.companion.wrongRecord'));
    }
    return {context, data, node};
}

function sameValue(left, right, depth = 0) {
    if (Object.is(left, right)) return true;
    if (depth > 64 || left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) !== Array.isArray(right)) return false;
    if (!Array.isArray(left) && (!plainObject(left) || !plainObject(right))) return false;
    const names = Object.keys(left).sort(), other = Object.keys(right).sort();
    return names.length === other.length && names.every((name, index) => name === other[index]
        && sameValue(left[name], right[name], depth + 1));
}

/** Compare stored previews by their original field names; absence is not NULL. */
export function comparisonRows(records) {
    const names = new Set(records.flatMap(record => Object.keys(record?.node?.values || {})));
    return [...names].map(name => {
        const cells = records.map(record => {
            const values = record?.node?.values || {};
            return {present: Object.hasOwn(values, name), value: values[name], truncated: record?.node?.truncated === true};
        });
        const complete = cells.filter(cell => !cell.truncated);
        const unknown = cells.some(cell => cell.truncated);
        const different = complete.length > 1 && complete.slice(1).some(cell => cell.present !== complete[0].present
            || (cell.present && !sameValue(cell.value, complete[0].value)));
        return {name, cells, different, unknown, comparable: cells.length > 1 && !unknown};
    });
}

/** Intersection of actual loaded one-hop neighbors, identified within their source. */
export function sharedConnections(records) {
    if (records.length < 2) return [];
    const neighborhoods = records.map(record => {
        const root = record.node?.id;
        const neighborIds = new Set((record.data?.edges || []).flatMap(edge => edge.source === root ? [edge.target]
            : edge.target === root ? [edge.source] : []));
        neighborIds.delete(root);
        const neighbors = new Map();
        for (const node of record.data?.nodes || []) {
            if (!neighborIds.has(node.id)) continue;
            const context = captureRecordContext({...record.context, table: node.table, key: node.key});
            const id = recordContextId(context);
            if (id) neighbors.set(id, {id, context, node});
        }
        return neighbors;
    });
    return [...neighborhoods[0].values()].filter(item => neighborhoods.slice(1).every(neighbors => neighbors.has(item.id)));
}
