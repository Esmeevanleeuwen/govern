/** Serializable view model; files and requests stay in the controller. */
export const ACTIVE_JOB_STATES = new Set(['queued', 'provisioning', 'importing', 'verifying']);
export const JOB_STATES = new Set([...ACTIVE_JOB_STATES, 'completed', 'partial', 'failed', 'unknown', 'cancelled']);
export function engineId(value) {
    const id = String(value || '').toLowerCase();
    return id === 'postgresql' || id === 'postgres' ? 'postgres' : id === 'mariadb' || id === 'mysql' ? 'mariadb' : '';
}
export function engineLabel(value) { return engineId(value) === 'postgres' ? 'PostgreSQL' : 'MariaDB'; }
export function fixedScope(scope) {
    if (!scope) return null;
    if (typeof scope === 'string') {
        if (!scope.startsWith('postgres:')) return {database: scope, name: scope, engine: 'mariadb', connection: 'mariadb', schema: scope, scope_key: scope};
        const parts = scope.split(':');
        if (parts.length !== 3) throw new Error('Invalid workspace scope');
        const database = decodeURIComponent(parts[1]), schema = decodeURIComponent(parts[2]);
        return {database, name: database, engine: 'postgres', connection: 'postgres', schema, scope_key: scope};
    }
    const engine = engineId(scope.engine || scope.connection) || 'mariadb';
    const database = scope.name || scope.database || '';
    const schema = scope.schema || (engine === 'postgres' ? 'public' : database);
    const scope_key = scope.scope_key || (engine === 'postgres'
        ? 'postgres:' + encodeURIComponent(database) + ':' + encodeURIComponent(schema) : database);
    return {...scope, engine, connection: engine, database, name: database, schema, scope_key};
}
export function blankDraft(options = {}) {
    const scope = fixedScope(options.scope);
    return {task: scope ? 'dataset' : options.task || '', step: scope || options.task ? (options.task === 'empty' ? 'destination' : 'source') : 'choose',
        scope, source: null, sourceEngine: '', file: null, name: '', engine: scope?.engine || '', tables: [],
        settings: {delimiter: 'auto', header: true, skip_blank_rows: true}, sourceStale: false,
        targetMode: options.table ? 'append' : 'new_table', suggestedTable: options.table || '',
        plan: null, submissionKey: '', job: null, error: null, errorField: '', operation: '', notifiedJob: ''};
}
export function datasetDrafts(source, suggestedTable = '') {
    const datasets = Array.isArray(source?.datasets) ? source.datasets : [];
    const first = datasets.findIndex(d => d.hidden !== true && d.count !== 0);
    return datasets.map((dataset, position) => ({dataset: Number.isInteger(dataset.index) ? dataset.index : position,
        selected: position === (first < 0 ? 0 : first), table: suggestedTable || dataset.table || dataset.suggested_name || dataset.name || 'import_data',
        mode: suggestedTable ? 'append' : 'create', version: '', targets: [],
        mapping: (dataset.columns || []).map(column => ({source: column.name, target: column.name, empty_as_null: false, skip: false}))}));
}
export function planPayload(draft) {
    const engine = draft.scope?.engine || (draft.task === 'backup' ? engineId(draft.source?.engine) || draft.sourceEngine : draft.engine);
    const payload = {kind: draft.task, engine, name: draft.scope?.database || draft.name.trim(),
        target_mode: draft.scope ? draft.targetMode : 'new_database'};
    if (draft.source) payload.source_id = draft.source.source_id;
    if (draft.task === 'backup' && draft.sourceEngine) payload.source_engine = draft.sourceEngine;
    if (draft.scope) { payload.scope_key = draft.scope.scope_key; if (draft.scope.engine === 'postgres') payload.schema = draft.scope.schema; }
    if (draft.task === 'dataset') payload.tables = draft.tables.filter(table => table.selected).map(table => ({dataset: table.dataset,
        table: draft.scope && draft.targetMode === 'append' ? table.table : table.table.trim(), mode: draft.scope && draft.targetMode === 'append' ? 'append' : 'create',
        ...(table.version ? {version: table.version} : {}),
        mapping: table.mapping.map(({source, target, empty_as_null, skip}) => ({source, target: skip ? null : draft.scope && draft.targetMode === 'append' ? target : target.trim(), empty_as_null: !skip && empty_as_null === true}))}));
    return payload;
}
export function identifierIssue(value, engine = 'mariadb', table = false) {
    const name = String(value || '').trim();
    if (!name) return 'required';
    if (table) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(name) || name.startsWith('_govern_')) return 'invalidTableName';
    } else {
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(name) || name.startsWith('pg_')
            || ['mysql', 'information_schema', 'performance_schema', 'sys', 'postgres', 'template0', 'template1'].includes(name)) return 'invalidDatabaseName';
        if (engineId(engine) === 'mariadb' && name.replaceAll('_', '\\_').length > 64) return 'databasePatternLength';
    }
    return '';
}
export function nameCollision(name, engine, databases) {
    return (databases || []).some(database => engineId(database.engine || database.connection || 'mariadb') === engineId(engine)
        && String(database.name || '').toLowerCase() === name.trim().toLowerCase());
}
export function jobState(job) { const state = String(job?.state || '').toLowerCase(); return JOB_STATES.has(state) ? state : 'unknown'; }
export function jobScopeKey(job) {
    if (job?.scope_key) return job.scope_key;
    if (job?.result?.scope_key) return job.result.scope_key;
    const database = job?.database || job?.result?.database;
    if (!database) return '';
    return engineId(job.engine) === 'postgres'
        ? 'postgres:' + encodeURIComponent(database) + ':' + encodeURIComponent(job.schema || 'public') : database;
}
