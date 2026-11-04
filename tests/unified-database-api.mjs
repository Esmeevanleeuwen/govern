/** HTTP -> durable worker -> fresh isolated databases -> catalog readback. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {authenticatedContext} from './auth-session.mjs';
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable isolated stack.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_BIN,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox']});
const context = await authenticatedContext(browser, base);
let checks = 0, csrf;
const verify = (condition, message) => { assert.ok(condition, message); checks++; };
const endpoint = (action, params = {}) => new URL('/api.php?' + new URLSearchParams({action, ...params}), base).href;
async function call(action, {body, params, multipart, status = ['import-plan', 'import-source'].includes(action) ? 201 : 200} = {}) {
    const options = {headers: {'X-CSRF-Token': csrf || ''}};
    if (multipart) options.multipart = multipart;
    else if (body !== undefined) options.data = body;
    const response = await context.request[body !== undefined || multipart ? 'post' : 'get'](endpoint(action, params), options);
    const value = await response.json();
    assert.equal(response.status(), status, `${action}: ${JSON.stringify(value)}`);
    if (status < 400) assert.equal(value.ok, true, `${action}: ${JSON.stringify(value)}`);
    return status < 400 ? value.data : value;
}
async function upload(kind, name, value, settings = {}) {
    return call('import-source', {multipart: {kind, settings: JSON.stringify(settings),
        file: {name, mimeType: kind === 'backup' ? 'application/sql' : 'text/csv', buffer: Buffer.from(value)}}});
}
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled', 'unknown']);
async function finished(id) {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
        const {job} = await call('import-job', {params: {id}});
        if (terminal.has(job.state)) return job;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for durable import job ' + id);
}
async function submit(plan) {
    const body = {plan_id: plan.plan_id, submission_key: randomUUID()};
    const first = await call('import-submit', {body, status: 202});
    const duplicate = await call('import-submit', {body, status: 202});
    verify(first.job.id === duplicate.job.id, 'Repeated submission identifies the same accepted attempt.');
    return finished(first.job.id);
}
const prefix = 'zz_unified_' + Date.now().toString(16);
try {
    csrf = (await call('bootstrap')).csrf;
    const capabilities = await call('database-workflows');
    verify(capabilities.worker_available === true, 'A live durable worker advertises readiness.');
    for (const engine of ['mariadb', 'postgres']) {
        verify(capabilities.engines.some(e => (e.id || e.engine) === engine && e.available && e.can_create), engine + ' creation is available.');
        const name = prefix + (engine === 'postgres' ? '_pg' : '_ma');
        const plan = await call('import-plan', {body: {kind: 'empty', engine, name, target_mode: 'new_database'}});
        verify(plan.summary.database === name && plan.summary.tables.length === 0, 'An empty plan needs no dummy source.');
        verify(!(await call('databases')).databases.some(d => d.name === name), 'Review creates no database.');
        const job = await submit(plan);
        verify(job.state === 'completed' && job.created_database === true, `Verified empty ${engine} result: ${JSON.stringify(job)}`);
        verify(!/import_password|import_user/.test(JSON.stringify(job)), 'Import credentials stay server-side.');
        const found = (await call('databases')).databases.filter(d => d.name === name && d.engine === engine);
        verify(found.length === 1 && found[0].available, 'A new database appears once without editing configuration.');
        const key = found[0].scope_key;
        await call('import-plan', {body: {kind: 'empty', engine, name}, status: 409}); checks++;
        verify((await call('bootstrap', {params: {database: key}})).tables.length === 0, 'Empty creation remains an empty result.');
        const definition = {name: 'notes', columns: [
            {name: 'id', type: 'whole', nullable: false, primary: true, generated: true, default: {mode: 'none'}},
            {name: 'label', type: 'text', nullable: true, primary: false, generated: false, default: {mode: 'literal', value: "O'Reilly\\path"}},
            {name: 'amount', type: 'decimal', precision: 30, scale: 2, nullable: false, primary: false, generated: false, default: {mode: 'literal', value: '123456789012345678901234.12'}},
            {name: 'big_value', type: 'whole', nullable: false, primary: false, generated: false, default: {mode: 'literal', value: '9007199254740993'}},
        ]};
        const preview = await call('table-definition-preview', {params: {database: key}, body: definition});
        verify((await call('bootstrap', {params: {database: key}})).tables.length === 0 && /CREATE TABLE/i.test(preview.sql), 'Table review is side-effect free.');
        const built = await call('table-definition-create', {params: {database: key}, body: {definition: preview.definition, definition_token: preview.definition_token}, status: 201});
        verify(built.created && built.table === 'notes', 'The native builder creates a real table.');
        verify((await call('structure', {params: {database: key, table: 'notes'}})).columns.some(c => c.name === 'label'), 'The live catalog reads the native table.');
        await call('query', {params: {database: key}, body: {sql: engine === 'postgres' ? 'INSERT INTO notes DEFAULT VALUES' : 'INSERT INTO notes () VALUES ()', confirm: true}});
        const defaults = (await call('browse', {params: {database: key, table: 'notes'}})).rows[0];
        verify(defaults.label === "O'Reilly\\path" && defaults.amount === '123456789012345678901234.12' && defaults.big_value === '9007199254740993', 'Literal defaults preserve quotes, backslashes and exact decimal/BIGINT values.');
    }
    for (const engine of ['mariadb', 'postgres']) {
        const name = prefix + (engine === 'postgres' ? '_data_pg' : '_data_ma');
        const source = await upload('dataset', 'contacts.csv', 'contact_id,full_name,postal_code,organization_id\n001,Alex Example,02108,\n002,Sam Example,00123,10\n');
        verify(source.datasets[0].rows[0][0] === '001', 'File-first preview preserves a leading zero.');
        const mapping = ['contact_id', 'full_name', 'postal_code', 'organization_id'].map(n =>
            ({source: n, target: n, empty_as_null: n === 'organization_id'}));
        const plan = await call('import-plan', {body: {kind: 'dataset', source_id: source.source_id, engine,
            name, target_mode: 'new_database', tables: [{dataset: 0, table: 'contacts', mode: 'create', mapping}]}});
        const job = await submit(plan);
        verify(job.state === 'completed', `The ${engine} dataset completes: ${JSON.stringify(job)}`);
        const rows = await call('browse', {params: {database: job.scope_key, table: 'contacts'}});
        verify(rows.rows.length === 2 && rows.rows[0].contact_id === '001' && rows.rows[0].postal_code === '02108'
            && rows.rows[0].organization_id === null, 'Exact text and explicit empty-to-NULL survive database readback.');
        const more = await upload('dataset', 'more.csv', 'source_id,person,zip,org\n003,Robin Example,00001,\n');
        const targets = await call('import-targets', {body: {source_id: more.source_id, scope_key: job.scope_key}});
        const candidate = targets.targets.find(t => t.name === 'contacts' && t.eligible);
        verify(Boolean(candidate), 'Add data lists the actual eligible append target.');
        const appendMapping = [['source_id', 'contact_id'], ['person', 'full_name'], ['zip', 'postal_code'], ['org', 'organization_id']]
            .map(([source, target]) => ({source, target, empty_as_null: target === 'organization_id'}));
        const append = await call('import-plan', {body: {kind: 'dataset', source_id: more.source_id, engine,
            name, scope_key: job.scope_key, target_mode: 'append', tables: [{dataset: 0, table: 'contacts', mode: 'append',
                version: candidate.version, mapping: appendMapping}]}});
        const appended = await submit(append);
        verify(appended.state === 'completed' && !appended.created_database, `Append retains database identity: ${JSON.stringify(appended)}`);
        const after = await call('browse', {params: {database: job.scope_key, table: 'contacts'}});
        verify(after.rows.length === 3 && after.rows.some(r => r.contact_id === '003' && r.full_name === 'Robin Example'
            && r.postal_code === '00001'), 'Different source headings map explicitly and original rows remain.');
        await call('import-plan', {body: {kind: 'dataset', source_id: more.source_id,
            engine: engine === 'postgres' ? 'mariadb' : 'postgres', name, scope_key: job.scope_key,
            target_mode: 'append', tables: []}, status: 409}); checks++;
    }
    const maria = await upload('backup', 'research.sql', '-- MariaDB dump\nCREATE TABLE `example` (`id` INTEGER PRIMARY KEY, `label` TEXT); INSERT INTO `example` VALUES(1,\'preserved\');');
    verify(maria.engine === 'mariadb', 'Backup evidence identifies a source dialect.');
    await call('import-plan', {body: {kind: 'backup', source_id: maria.source_id, engine: 'postgres', name: prefix + '_wrong'}, status: 422}); checks++;
    const mariaPlan = await call('import-plan', {body: {kind: 'backup', source_id: maria.source_id, engine: 'mariadb', name: prefix + '_backup_ma'}});
    const mariaJob = await submit(mariaPlan);
    verify(mariaJob.state === 'completed', `MariaDB backup completes: ${JSON.stringify(mariaJob)}`);
    verify((await call('browse', {params: {database: mariaJob.scope_key, table: 'example'}})).rows[0].label === 'preserved', 'Backup objects reach the normal table browser.');
    const portable = await upload('backup', 'portable.sql', 'CREATE TABLE example (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO example VALUES(1,\'pg value\');');
    verify(portable.engine === null && portable.requires_engine, 'An ambiguous SQL extension asks for its source engine.');
    await call('import-plan', {body: {kind: 'backup', source_id: portable.source_id, engine: 'postgres', name: prefix + '_backup_pg'}, status: 422}); checks++;
    const pgPlan = await call('import-plan', {body: {kind: 'backup', source_id: portable.source_id, source_engine: 'postgres', engine: 'postgres', name: prefix + '_backup_pg'}});
    const pgJob = await submit(pgPlan);
    verify(pgJob.state === 'completed', `Confirmed PostgreSQL backup completes: ${JSON.stringify(pgJob)}`);
    verify((await call('browse', {params: {database: pgJob.scope_key, table: 'example'}})).rows[0].label === 'pg value', 'Reader grants expose real PostgreSQL importer-owned objects.');
    const partial = await upload('backup', 'partial.sql', '-- MariaDB dump\nCREATE TABLE `kept` (`id` INTEGER PRIMARY KEY); INSERT INTO `kept` VALUES(1); INSERT INTO `does_not_exist` VALUES(2);');
    const partialPlan = await call('import-plan', {body: {kind: 'backup', source_id: partial.source_id, engine: 'mariadb', name: prefix + '_partial'}});
    const partialJob = await submit(partialPlan);
    verify(partialJob.state === 'partial' && partialJob.action_required, 'Known incomplete committed SQL effects are Partial.');
    verify((await call('browse', {params: {database: partialJob.scope_key, table: 'kept'}})).rows.length === 1, 'Partial work is neither replayed nor deleted.');
    const marked = (await call('databases')).databases.find(d => d.name === partialJob.database);
    verify(marked.action_required === true && marked.import_job_id === partialJob.id, 'A new partial database stays visible with its durable job marker.');
    const noCsrf = await context.request.post(endpoint('import-plan'), {data: {kind: 'empty', engine: 'mariadb', name: prefix + '_denied'}});
    verify(noCsrf.status() === 403, 'Creation mutations retain CSRF protection.');
    const recent = await call('import-jobs');
    verify(recent.jobs.some(j => j.id === partialJob.id) && recent.jobs.some(j => j.id === pgJob.id), 'Reconnect reads retained outcomes.');
    console.log(`PASS: ${checks} unified database HTTP/worker/readback checks across both engines.`);
} finally {
    await context.close(); await browser.close();
}
