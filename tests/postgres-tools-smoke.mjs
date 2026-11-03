/** SQL, both import paths and real schema restore in the disposable govern_pg fixture. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {authenticatedContext} from './auth-session.mjs';
import {selectWorkspaceLanguage} from './workspace-tools.mjs';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use an isolated stack and GOVERN_UI_WRITE_TESTS=1.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use the disposable local govern_pg database.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [], unsupported = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api.php' && url.searchParams.get('connection') === 'postgres'
        && ['queries', 'save-query', 'build-query'].includes(url.searchParams.get('action'))) unsupported.push(url.href);
});
const scope = 'postgres:govern_pg:public';
const stamp = Date.now().toString(16);
const marker = 'PG tools UI ' + stamp;
const sqlTable = 'govern_ui_sql_' + stamp, importTable = 'govern_ui_import_' + stamp, csvTable = 'govern_ui_csv_' + stamp;
const exact = '123456789012345678901234.12';
const originalKey = '9007199254740993';
const href = (view, table = '') => new URL('/workspace.php#' + view + '?' + new URLSearchParams({database: scope, ...(table ? {table} : {})}), base).href;
const waitApi = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
}, {timeout: 120000});
const scoped = response => {
    const url = new URL(response.url());
    assert.equal(url.searchParams.get('connection'), 'postgres');
    assert.equal(url.searchParams.get('database'), 'govern_pg');
    assert.equal(url.searchParams.get('schema'), 'public');
};
const read = async response => {
    scoped(response);
    const result = await response.json();
    assert.equal(response.ok() && result.ok, true, JSON.stringify(result));
    return result.data;
};
const api = (action, parameters = {}) => page.evaluate(async ({action, parameters}) => {
    const url = new URL('/api.php', location.origin);
    for (const [name, value] of Object.entries({action, connection: 'postgres', database: 'govern_pg', schema: 'public', ...parameters})) url.searchParams.set(name, String(value));
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(JSON.stringify(result));
    return result.data;
}, {action, parameters});
const browse = table => api('browse', {table});
const run = async sql => {
    await page.locator('#sql-editor').fill(sql);
    const pending = waitApi('query');
    await page.locator('#run-query').click();
    const result = await read(await pending);
    assert.equal(result.failed, null, JSON.stringify(result));
    await page.locator('#run-query:not([disabled])').waitFor();
    return result;
};
const openImports = async () => {
    await page.goto(href('gegevens', 'govern_pg_values'), {waitUntil: 'networkidle'});
    await page.locator('#database-tools > summary').click();
    await page.locator('[data-database-tool="import"]').click();
    await page.locator('#native-import-file').waitFor();
    assert.equal(await page.locator('#database-select').isDisabled(), true);
    assert.equal(await page.locator('#modal-database').isDisabled(), true);
    assert.equal(await page.locator('#database-frame').isVisible(), false);
    assert.equal(await page.locator('#database-tab-sql').isVisible(), false);
};
let snapshot;
try {
    await page.goto(href('gegevens', 'govern_pg_values'), {waitUntil: 'networkidle'});
    const before = await browse('govern_pg_values');
    assert.equal(before.rows.find(row => row.id === originalKey).label, 'literal%_value');
    const archiveBefore = await api('browse', {schema: 'archive', table: 'govern_pg_values'});

    await page.goto(href('experimenten'), {waitUntil: 'networkidle'});
    await page.locator('#snapshot-label').fill(marker);
    const created = waitApi('create-snapshot');
    await page.locator('#create-snapshot').click();
    snapshot = await read(await created);
    await page.locator('#snapshot-' + snapshot.id).waitFor();
    assert.ok((await page.locator('#snapshot-' + snapshot.id).innerText()).includes('PostgreSQL archive'));
    const download = await context.request.get(new URL(await page.locator('#snapshot-' + snapshot.id + ' a').getAttribute('href'), base).href);
    assert.ok(download.ok());
    assert.ok((download.headers()['content-disposition'] || '').includes('.dump'));
    assert.equal((await download.body()).subarray(0, 5).toString(), 'PGDMP');

    await page.goto(href('onderzoeken', 'govern_pg_values'), {waitUntil: 'networkidle'});
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('.query-builder').count(), 0);
    assert.equal(await page.locator('#save-research').count(), 0);
    assert.match(await page.locator('#sql-editor').inputValue(), /"public"\."govern_pg_values"/);
    const result = await run(`CREATE TABLE public."${sqlTable}" (id bigint PRIMARY KEY, amount numeric(30,2), label text);\nINSERT INTO public."${sqlTable}" VALUES (9007199254740993, ${exact}, 'literal <pg>');\nSELECT id::text, amount::text, label FROM public."${sqlTable}";\nUPDATE public.govern_pg_values SET label='${marker}' WHERE id=${originalKey};`);
    assert.equal(result.statements.length, 4);
    assert.equal(result.statements[2].rows[0][0], originalKey);
    assert.equal(result.statements[2].rows[0][1], exact);
    assert.ok((await page.locator('.query-result').textContent()).includes('literal <pg>'));
    assert.equal(await page.locator('.query-result pg').count(), 0, 'SQL results remain literal text.');

    await page.setViewportSize({width: 375, height: 900});
    await openImports();
    await page.locator('#native-import-file').setInputFiles({name: 'govern-ui.sql', mimeType: 'text/plain',
        buffer: Buffer.from(`CREATE TABLE public."${importTable}" (id bigint PRIMARY KEY, label text);\nINSERT INTO public."${importTable}" VALUES (1, 'native import ${stamp}');`)});
    const planResponse = waitApi('native-import-preview');
    await page.locator('#native-import-preview').click();
    const plan = await read(await planResponse);
    assert.equal(plan.confirmation, 'govern_pg.public');
    await page.locator('#native-import-confirm').fill('govern_pg');
    assert.equal(await page.locator('#native-import-run').isDisabled(), true);
    await page.locator('#native-import-confirm').fill(plan.confirmation);
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.equal(await page.locator('#native-import-confirm').inputValue(), plan.confirmation);
    assert.equal(await page.locator('#native-import-file').evaluate(input => input.files.length), 1);
    assert.equal(await page.locator('#native-import-run').isEnabled(), true);
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    const imported = waitApi('native-import-execute');
    await page.locator('#native-import-run').click();
    const native = await read(await imported);
    assert.equal(native.completed, true);
    assert.ok(native.safety_snapshots.some(point => point.schema === 'public'));
    assert.ok(native.safety_snapshots.some(point => point.schema === 'archive'));
    assert.equal((await browse(importTable)).rows[0].label, 'native import ' + stamp);

    await page.locator('#database-tab-dataset').click();
    await page.locator('#dataset-file').setInputFiles({name: 'govern-ui.csv', mimeType: 'text/csv',
        buffer: Buffer.from('code,label\n9007199254740993,CSV literal <record>\n')});
    const csvPreview = waitApi('dataset-preview');
    await page.locator('#dataset-preview').click();
    assert.equal((await read(await csvPreview)).confirmation, 'govern_pg.public');
    await page.locator('#dataset-table').fill(csvTable);
    await page.locator('#dataset-confirmation').fill('govern_pg.public');
    const csvImport = waitApi('dataset-import');
    await page.locator('#dataset-commit').click();
    assert.equal((await read(await csvImport)).imported, 1);
    assert.ok(Object.values((await browse(csvTable)).rows[0]).includes('9007199254740993'));
    await page.locator('.database-dialog-header .modal-tools button').last().click();
    await page.locator('#database-dialog').waitFor({state: 'hidden'});

    await page.goto(href('experimenten'), {waitUntil: 'networkidle'});
    await selectWorkspaceLanguage(page, 'nl');
    await page.setViewportSize({width: 375, height: 900});
    await page.locator('#snapshot-' + snapshot.id + ' [data-snapshot-action="restore"]').click();
    const confirm = page.locator('.confirm-dialog');
    await confirm.waitFor();
    assert.ok((await confirm.innerText()).includes('govern_pg.public'));
    await confirm.locator('input').fill('govern_pg');
    assert.equal(await confirm.locator('button[type="submit"]').isDisabled(), true);
    await confirm.locator('input').fill('govern_pg.public');
    const restored = waitApi('restore-snapshot');
    await confirm.locator('button[type="submit"]').click();
    await read(await restored);
    await page.locator('#create-snapshot:not([disabled])').waitFor();
    const after = await browse('govern_pg_values');
    assert.deepEqual(after.rows, before.rows, 'Real restore reads the original records back.');
    const boot = await api('bootstrap');
    for (const name of [sqlTable, importTable, csvTable]) assert.equal(boot.tables.some(table => table.name === name), false, 'Restore removes objects created after the point.');
    assert.deepEqual((await api('browse', {schema: 'archive', table: 'govern_pg_values'})).rows, archiveBefore.rows, 'Restoring public leaves archive records untouched.');
    assert.deepEqual(unsupported, [], 'Free SQL never calls PostgreSQL saved-query or builder APIs.');
    assert.deepEqual(errors, [], 'No browser JavaScript exceptions.');
    console.log('PASS: PostgreSQL Free SQL, native SQL/CSV import, scoped archive download and real schema restore/readback in Dutch/mobile.');
} finally {
    // The successful restore removes the test's own tables and row edit. A failed
    // restore deliberately keeps its diagnostic state in this isolated database.
    await context.close();
    await browser.close();
}
