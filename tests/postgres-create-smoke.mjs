/** Real PG creation, new-database SQL/CSV imports and independent workspace state. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
import {openDatabaseTask, selectWorkspaceLanguage} from './workspace-tools.mjs';
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable stack.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1050}});
const page = await context.newPage();
const errors = [], preparations = [], phpMyAdmin = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api.php' && url.searchParams.get('action') === 'prepare-database') preparations.push(request);
    if (url.pathname.startsWith('/phpmyadmin/')) phpMyAdmin.push(url.href);
});
const stamp = Date.now().toString(16) + Math.random().toString(16).slice(2, 6);
const names = ['govern_ui_pg_create_' + stamp, 'govern_ui_pg_import_' + stamp];
const keys = names.map(name => 'postgres:' + name + ':public');
const table = 'govern_create_shared', csvTable = 'govern_create_csv';
const manager = page.locator('#database-manager-dialog'), modal = page.locator('#database-dialog');
const ready = database => page.waitForFunction(database => {
    const picker = document.querySelector('#database-select');
    return picker?.value === database && !picker.disabled && !document.querySelector('#page .loading-state');
}, database);
const waitApi = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
}, {timeout: 120000});
const read = async response => {
    const result = await response.json();
    assert.equal(response.ok() && result.ok, true, JSON.stringify(result));
    return result.data;
};
const api = (action, database, params = {}) => page.evaluate(async ({action, database, params}) => {
    const response = await fetch('/api.php?' + new URLSearchParams({action, database, ...params}));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error_code || 'HTTP ' + response.status);
    return result.data;
}, {action, database, params});
const scope = (response, index) => {
    const url = new URL(response.url());
    assert.equal(url.searchParams.get('connection'), 'postgres');
    assert.equal(url.searchParams.get('database'), names[index]);
    assert.equal(url.searchParams.get('schema'), 'public');
};
const run = async (statement, index) => {
    await page.locator('#sql-editor').fill(statement);
    const pending = waitApi('query'); await page.locator('#run-query').click();
    const response = await pending; scope(response, index);
    const result = await read(response); assert.equal(result.failed, null, JSON.stringify(result));
    await page.locator('#run-query:not([disabled])').waitFor();
};
const view = name => page.locator('[data-database-view="' + name + '"]').click();
const closeModal = async () => {
    await modal.locator('.database-dialog-header .modal-tools button').last().click();
    await modal.waitFor({state: 'hidden'});
};
const shot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), fullPage: true, animations: 'disabled'});
};
try {
    await page.goto(new URL('/workspace.php#gegevens?database=postgres%3Agovern_pg%3Apublic', base).href, {waitUntil: 'networkidle'});
    await ready('postgres:govern_pg:public'); await selectWorkspaceLanguage(page, 'en');
    await openDatabaseTask(page, {task: 'create', engine: 'postgres', name: names[0]});
    assert.equal(await manager.locator('#database-manager-name').getAttribute('maxlength'), '63');
    assert.equal(await manager.locator('#database-manager-unavailable').count(), 0);
    assert.equal(preparations.length, 0, 'Choosing an engine and typing creates nothing.');
    await shot('postgres-create-database');
    await manager.locator('#database-manager-name').evaluate(input => {input.focus(); input.setSelectionRange(4, 12);});
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.equal(await manager.locator('#database-manager-name').inputValue(), names[0]);
    assert.deepEqual(await manager.locator('#database-manager-name').evaluate(input => [input.selectionStart, input.selectionEnd]), [4, 12]);
    const creating = waitApi('prepare-database'); await manager.locator('#database-manager-name').press('Enter');
    const createdResponse = await creating, created = await read(createdResponse);
    assert.equal(createdResponse.status(), 201); assert.equal(created.database, keys[0]); assert.equal(created.created, true);
    assert.deepEqual(preparations[0].postDataJSON(), {name: names[0]});
    assert.equal(new URL(preparations[0].url()).searchParams.get('connection'), 'postgres');
    await manager.waitFor({state: 'hidden'}); await ready(keys[0]); await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('[data-database-view="onderzoeken"]').getAttribute('aria-current'), 'page');
    assert.deepEqual((await api('schema', keys[0])).tables, [], 'Create opens Queries in a real empty new DB.');
    assert.equal(await modal.isVisible(), false);
    assert.match(await page.locator('#sql-editor').inputValue(), /CREATE TABLE "public"\."my_table"/);
    await shot('postgres-created-queries');
    await run(`CREATE TABLE public.${table}(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,label text NOT NULL); INSERT INTO public.${table}(label) VALUES('Created database A');`, 0);
    for (const name of ['gegevens', 'verkennen', 'schema', 'onderzoeken']) {
        await view(name); await page.locator('.catalog-item[title="' + table + '"]').waitFor();
        if (name === 'gegevens') {
            await page.locator('.catalog-item[title="' + table + '"]').click();
            await page.locator('.data-table tbody tr').filter({hasText: 'Created database A'}).waitFor();
        } else if (name === 'verkennen') await page.locator('#record-map-table').waitFor({state: 'attached'});
        else if (name === 'schema') {
            await page.locator('[data-schema-node="' + table + '"]').waitFor();
            assert.match(await page.locator('[data-schema-node="' + table + '"]').innerText(), /label/);
        } else await page.locator('#sql-editor').waitFor();
    }
    const draftA = `SELECT 'draft A' AS label FROM public.${table};`;
    await page.locator('#sql-editor').fill(draftA); await selectWorkspaceLanguage(page, 'en');
    await openDatabaseTask(page, {task: 'database', engine: 'postgres', targetMode: 'new', name: names[1]});
    const preparingImport = waitApi('prepare-database'); await manager.locator('#database-manager-continue').click();
    const prepared = await read(await preparingImport); assert.equal(prepared.database, keys[1]);
    await manager.waitFor({state: 'hidden'}); await modal.locator('#native-import-file').waitFor();
    assert.match(await modal.locator('.modal-import-source').innerText(), new RegExp(names[1] + '\\.public'));
    assert.equal(await modal.locator('#modal-full-import').isVisible(), false);
    const script = `CREATE TABLE public.${table}(id integer PRIMARY KEY,label text); INSERT INTO public.${table} VALUES(1,'Imported database B');`;
    await modal.locator('#native-import-file').setInputFiles({name: 'new-database.sql', mimeType: 'application/sql', buffer: Buffer.from(script)});
    const preflight = waitApi('native-import-preview'); await modal.locator('#native-import-preview').click();
    const previewResponse = await preflight; scope(previewResponse, 1); const plan = await read(previewResponse);
    assert.equal(plan.confirmation, names[1] + '.public');
    assert.equal(await modal.locator('#native-import-run').isDisabled(), true);
    assert.deepEqual((await api('schema', keys[1])).tables, [], 'SQL preview creates no table.');
    await modal.locator('#native-import-confirm').fill(plan.confirmation);
    const importing = waitApi('native-import-execute'); await modal.locator('#native-import-run').click();
    const importResponse = await importing; scope(importResponse, 1); assert.equal((await read(importResponse)).completed, true);
    await closeModal(); await ready(keys[1]);
    await view('gegevens'); await page.locator('.catalog-item[title="' + table + '"]').click();
    await page.locator('.data-table tbody tr').filter({hasText: 'Imported database B'}).waitFor();
    assert.equal((await page.locator('.data-table').innerText()).includes('Created database A'), false);
    await page.locator('#data-search').fill('Imported'); await view('onderzoeken'); await page.locator('#sql-editor').waitFor();
    const draftB = `SELECT 'draft B' AS label FROM public.${table};`;
    await page.locator('#sql-editor').fill(draftB);
    await page.locator('#database-select').selectOption(keys[0]); await ready(keys[0]);
    await page.locator('#sql-editor').waitFor(); assert.equal(await page.locator('#sql-editor').inputValue(), draftA);
    await view('gegevens'); await page.locator('#data-search').waitFor();
    assert.equal(await page.locator('#data-search').inputValue(), '');
    await page.locator('.data-table tbody tr').filter({hasText: 'Created database A'}).waitFor();
    await openDatabaseTask(page, {task: 'table', engine: 'postgres', database: keys[0], submit: true});
    await modal.locator('#dataset-file').setInputFiles({name: 'new-table.csv', mimeType: 'text/csv', buffer: Buffer.from('code,label\n001,CSV new database\n')});
    const csvPreview = waitApi('dataset-preview'); await modal.locator('#dataset-preview').click();
    const csvResponse = await csvPreview; scope(csvResponse, 0); const csvPlan = await read(csvResponse);
    assert.equal(csvPlan.confirmation, names[0] + '.public');
    await modal.getByRole('cell', {name: '001', exact: true}).waitFor();
    await modal.locator('#dataset-table').fill(csvTable);
    await modal.locator('#dataset-confirmation').fill(csvPlan.confirmation);
    const committing = waitApi('dataset-import'); await modal.locator('#dataset-commit').click();
    const csvCommitted = await committing; scope(csvCommitted, 0); assert.equal((await read(csvCommitted)).imported, 1);
    await modal.locator('#dataset-open-table').click(); await modal.waitFor({state: 'hidden'}); await ready(keys[0]);
    await page.locator('.data-table tbody tr').filter({hasText: 'CSV new database'}).waitFor();
    assert.equal((await api('browse', keys[0], {table: csvTable})).rows[0].code, '001');
    await view('onderzoeken'); await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), draftA, 'CSV import/view changes preserve SQL.');
    await page.locator('#database-select').selectOption(keys[1]); await ready(keys[1]);
    await page.locator('#sql-editor').waitFor(); assert.equal(await page.locator('#sql-editor').inputValue(), draftB);
    await view('gegevens'); await page.locator('#data-search').waitFor();
    assert.equal(await page.locator('#data-search').inputValue(), 'Imported', 'Searches remain separate by actual database.');
    await page.locator('.data-table tbody tr').filter({hasText: 'Imported database B'}).waitFor();
    assert.deepEqual(phpMyAdmin, [], 'PG creation/import/design never requests phpMyAdmin.');
    await shot('postgres-imported-records');
    assert.deepEqual(errors, []);
    console.log('PASS: real PostgreSQL create → Queries → design, shared Records/Explore/Schema/Queries catalog, new-database SQL import, CSV commit/readback, and two-database SQL/search isolation.');
} finally { await browser.close(); }
