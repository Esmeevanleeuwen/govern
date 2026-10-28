/** Pure catalog-to-diagram helpers. Relationships come only from declared foreign keys. */
export const TABLE_WIDTH = 280;
export const HEADER_HEIGHT = 64;
export const ROW_HEIGHT = 30;

const text = value => typeof value === 'string' && value.length > 0;
const names = value => Array.isArray(value) && value.length > 0 && value.every(text);
const compareNames = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function normalizeSchema(data = {}) {
    const database = typeof data?.database === 'string' ? data.database : '';
    const seen = new Set();
    const tables = (Array.isArray(data?.tables) ? data.tables : []).filter(table => {
        if (!table || !text(table.name) || seen.has(table.name)) return false;
        seen.add(table.name);
        return true;
    }).map(table => ({
        ...table,
        type: table.type === 'view' ? 'view' : 'table',
        comment: typeof table.comment === 'string' ? table.comment : '',
        columns: (Array.isArray(table.columns) ? table.columns : []).filter(column => column && text(column.name)).map(column => ({...column})),
        foreign_keys: Array.isArray(table.foreign_keys) ? table.foreign_keys : [],
    }));
    const relationships = [];
    const seenRelationships = new Set();
    for (const table of tables) {
        for (const key of table.foreign_keys) {
            if (!key || !text(key.name) || !text(key.referenced_table) || !names(key.columns)
                || !names(key.referenced_columns) || key.columns.length !== key.referenced_columns.length) continue;
            const targetSchema = text(key.referenced_schema) ? key.referenced_schema : database;
            const id = JSON.stringify([table.name, key.name, targetSchema, key.referenced_table, key.columns, key.referenced_columns]);
            if (seenRelationships.has(id)) continue;
            seenRelationships.add(id);
            const external = targetSchema !== database;
            relationships.push({
                id, name: key.name, sourceTable: table.name, targetTable: key.referenced_table,
                targetSchema, external, targetAvailable: !external && seen.has(key.referenced_table),
                pairs: key.columns.map((source, index) => ({source, target: key.referenced_columns[index]})),
            });
        }
    }
    return {database, tables, relationships};
}

export function tableHeight(table) {
    return HEADER_HEIGHT + 12 + (Array.isArray(table?.columns) ? table.columns.length : 0) * ROW_HEIGHT;
}

/** Balanced columns leave at least 80px between every initial card, including isolated views. */
export function initialPositions(tables = []) {
    const result = Object.create(null);
    const sorted = tables.slice().sort(compareNames);
    const columnCount = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
    const heights = new Array(columnCount).fill(56);
    for (const table of sorted) {
        const column = heights.indexOf(Math.min(...heights));
        result[table.name] = {x: 56 + column * (TABLE_WIDTH + 120), y: heights[column]};
        heights[column] += tableHeight(table) + 80;
    }
    return result;
}

export function relatedTables(model, name) {
    const related = new Set();
    if (!model.tables.some(table => table.name === name)) return related;
    related.add(name);
    for (const relationship of model.relationships) {
        if (relationship.external || !relationship.targetAvailable) continue;
        if (relationship.sourceTable === name) related.add(relationship.targetTable);
        if (relationship.targetTable === name) related.add(relationship.sourceTable);
    }
    return related;
}

export function filterTables(model, search = '', selected = '', neighborhood = false) {
    const needle = String(search).trim().toLowerCase();
    const related = neighborhood && selected ? relatedTables(model, selected) : null;
    return model.tables.filter(table => (!related || related.has(table.name))
        && (!needle || table.name.toLowerCase().includes(needle)
            || table.columns.some(column => column.name.toLowerCase().includes(needle))));
}

/** Ignore corrupt entries independently; prototype-like identifiers are ordinary names. */
export function validPositions(value, tables) {
    const result = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const table of tables) {
        if (!Object.hasOwn(value, table.name)) continue;
        const position = value[table.name];
        if (!position || typeof position !== 'object') continue;
        if (['x', 'y'].every(key => typeof position[key] === 'number' && Number.isFinite(position[key])
            && position[key] >= 0 && position[key] <= 10000000)) result[table.name] = {x: position.x, y: position.y};
    }
    return result;
}
