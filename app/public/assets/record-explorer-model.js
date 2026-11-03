/** Deterministic view helpers; record values and source data stay untouched. */
export const RECORD_WIDTH = 188;
export const RECORD_HEIGHT = 70;
export function relationKey(relation) {
    return JSON.stringify([relation.source_table, relation.target_table, relation.name,
        relation.columns || [], relation.referenced_columns || []]);
}
export function valueText(value) {
    if (value === null || value === undefined) return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function tableColor(table) {
    return [...String(table)].reduce((hash, letter) => (hash * 31 + letter.codePointAt(0)) >>> 0, 0) % 6;
}
/** Keep the focus as context, even when its text does not match. */
export function visibleNeighborhood(data, {search = '', enabledRelations = null, searchLabels = () => []} = {}) {
    const nodes = data.nodes || [], edges = data.edges || [], relations = data.relations || [];
    const enabled = enabledRelations === null ? null : new Set(enabledRelations);
    const allowed = new Set(relations.filter(relation => enabled === null || enabled.has(relation.id)).map(relationKey));
    const eligibleEdges = edges.filter(edge => allowed.has(relationKey(edge)));
    const connected = new Set([data.center]);
    for (const edge of eligibleEdges) { connected.add(edge.source); connected.add(edge.target); }
    const query = search.trim().toLocaleLowerCase();
    const matching = new Set(nodes.filter(node => connected.has(node.id) && (!query ||
        [node.label, node.table, ...searchLabels(node), ...Object.values(node.values || {}).map(valueText)]
            .join(' ').toLocaleLowerCase().includes(query))).map(node => node.id));
    const visible = new Set([...matching, data.center]);
    return {nodes: nodes.filter(node => visible.has(node.id)),
        edges: eligibleEdges.filter(edge => visible.has(edge.source) && visible.has(edge.target)),
        matching, context: new Set(data.center && !matching.has(data.center) ? [data.center] : [])};
}
/** A focused middle column leaves room for readable incoming/outgoing records. */
export function recordPositions(nodes, center) {
    const positions = new Map();
    if (!nodes.length) return {positions, bounds: {x: -160, y: -120, width: 320, height: 240}};
    const focus = nodes.find(node => node.id === center) || nodes[0];
    positions.set(focus.id, {x: 0, y: 0});
    const rest = nodes.filter(node => node.id !== focus.id).slice().sort((a, b) =>
        a.table.localeCompare(b.table) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const rowsPerColumn = Math.min(6, Math.ceil(rest.length / 2));
    let start = 0, column = 0;
    while (start < rest.length) {
        const count = Math.min(rowsPerColumn, rest.length - start);
        const x = (column % 2 ? 1 : -1) * (330 + Math.floor(column / 2) * 260);
        for (let index = 0; index < count; index++) {
            positions.set(rest[start + index].id, {x, y: (index - (count - 1) / 2) * 110});
        }
        start += count; column++;
    }
    const points = [...positions.values()];
    const left = Math.min(...points.map(point => point.x)) - RECORD_WIDTH / 2 - 45;
    const top = Math.min(...points.map(point => point.y)) - RECORD_HEIGHT / 2 - 45;
    const right = Math.max(...points.map(point => point.x)) + RECORD_WIDTH / 2 + 45;
    const bottom = Math.max(...points.map(point => point.y)) + RECORD_HEIGHT / 2 + 45;
    const width = Math.max(720, right - left), height = Math.max(360, bottom - top);
    return {positions, bounds: {x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height}};
}
