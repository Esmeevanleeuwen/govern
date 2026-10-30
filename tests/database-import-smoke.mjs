/** Real database creation and official phpMyAdmin SQL-file import, isolated stack only. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable stack and set GOVERN_UI_WRITE_TESTS=1.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1050}});
const page = await context.newPage();
const errors = [];
context.on('page', current => current.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
const suffix = Date.now().toString(16) + Math.random().toString(16).slice(2, 7);
const created = 'govern_ui_import_' + suffix;
const emptyDatabase = 'govern_ui_empty_' + suffix;
const owned = new Set();
const manager = page.locator('#database-manager-dialog');
const nameInput = manager.locator('#database-manager-name');
const nativeDialog = page.locator('#database-dialog');
const frame = page.frameLocator('#database-frame');
let first = '', csrf = '', releaseRequest;
const beforeDraft = "SELECT 'original database draft' AS before_import;";
const importedDraft = "SELECT 'imported database draft' AS after_import;";
const literal = '<img src=x onerror="window.importUnsafe=1">';

const actionIs = action => value => {
    const url = value instanceof URL ? value : new URL(value.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
};
const responseFor = action => page.waitForResponse(actionIs(action));
const api = async (action, database = first, {body, token = csrf, params = {}} = {}) => page.evaluate(async ({action, database, body, token, params}) => {
    const url = new URL('/api.php', location.origin);
    url.search = new URLSearchParams({action, ...(database ? {database} : {}), ...params}).toString();
    const response = await fetch(url, body === undefined ? undefined : {method: 'POST', headers: {
        'Content-Type': 'application/json', ...(token ? {'X-CSRF-Token': token} : {}),
    }, body: JSON.stringify(body)});
    return {status: response.status, payload: await response.json()};
}, {action, database, body, token, params});
const data = result => {
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.payload));
    assert.equal(result.payload.ok, true, result.payload.error);
    return result.payload.data;
};
const sql = async (database, query, confirm = false) => {
    const result = data(await api('query', database, {body: {sql: query, confirm}}));
    assert.equal(result.confirm_required, false, query);
    assert.equal(result.failed, null, JSON.stringify(result.failed));
    return result;
};
const waitWorkspace = async (database = null) => page.waitForFunction(database => {
    const picker = document.querySelector('#database-select');
    return picker && (!database || picker.value === database) && !picker.disabled && !document.querySelector('#page .loading-state');
}, database);
const switchDatabase = async name => {
    await page.locator('#database-select').selectOption(name);
    await waitWorkspace(name);
};
const openManager = async () => {
    await page.locator('#manage-databases').click();
    await manager.waitFor({state: 'visible'});
};
const closeManager = async () => {
    await manager.locator('#database-manager-cancel').click();
    await manager.waitFor({state: 'hidden'});
};
const language = async value => page.evaluate(async value => {
    const {setLanguage} = await import('/assets/i18n.js');
    setLanguage(value);
}, value);
const shot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'database-import-' + name + '.png'), fullPage: true});
};
const waitImport = async database => {
    await nativeDialog.waitFor({state: 'visible'});
    await frame.locator('#input_import_file').waitFor({state: 'visible'});
    await page.waitForFunction(database => {
        const node = document.querySelector('#database-frame');
        if (!node?.contentWindow) return false;
        const url = new URL(node.contentWindow.location.href);
        return url.pathname.startsWith('/phpmyadmin/') && url.searchParams.get('db') === database
            && url.searchParams.get('route') === '/database/import';
    }, database);
    assert.equal(await page.locator('#database-tab-import').getAttribute('aria-selected'), 'true');
};

try {
    await page.goto(new URL('/#onderzoeken', base).href, {waitUntil: 'networkidle'});
    await page.locator('#sql-editor').waitFor();
    const bootstrap = data(await api('bootstrap', ''));
    first = bootstrap.database.name;
    csrf = bootstrap.csrf;
    assert.equal(bootstrap.can_create_database, true, 'The private manager is available in this disposable stack.');
    const atlas = data(await api('import-inspection', first));
    assert.equal(atlas.template, 'bestuursatlas');
    assert.equal(atlas.sections.length, 5);
    assert.deepEqual(atlas.missing_tables, []);
    assert.deepEqual(atlas.missing_views, []);
    assert.deepEqual(atlas.missing_foreign_keys, []);
    assert.ok(atlas.foreign_keys >= 54, 'Bestuursatlas foreign keys are present.');
    const listing = data(await api('databases'));
    assert.equal(listing.can_create, true);
    assert.ok(listing.databases.some(item => item.name === first));
    assert.equal((await api('prepare-database', first, {body: {name: created}, token: ''})).status, 403,
        'Database preparation requires CSRF, including for new names.');
    for (const invalid of ['mysql', 'information_schema', 'sys', 'a;DROP DATABASE ignored', '../outside', 'spaces invalid']) {
        const result = await api('prepare-database', first, {body: {name: invalid}});
        assert.equal(result.status, 422);
        assert.equal(result.payload.error_code, 'database_create_invalid');
    }
    const forged = await api('prepare-database', first, {body: {name: created, sql: 'DROP DATABASE mysql'}});
    assert.equal(forged.status, 422, 'The public API cannot turn the manager into a generic SQL interface.');
    await page.locator('#sql-editor').fill(beforeDraft);
    await openManager();
    await nameInput.fill(created);
    await nameInput.evaluate(node => { node.focus(); node.setSelectionRange(4, 9); });
    await language('en');
    assert.equal(await nameInput.inputValue(), created, 'Language switching retains the database name draft.');
    assert.deepEqual(await nameInput.evaluate(node => [node.selectionStart, node.selectionEnd]), [4, 9]);
    assert.equal(await nameInput.evaluate(node => node === document.activeElement), true);
    await shot('manager');

    // Delay the real request, without replacing its response, to exercise busy UI.
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    const gate = new Promise(resolve => { releaseRequest = resolve; });
    const preparationRoute = actionIs('prepare-database');
    const holdPreparation = async route => { requestStarted(); await gate; await route.continue(); };
    await page.route(preparationRoute, holdPreparation);
    const pending = responseFor('prepare-database');
    await manager.locator('#database-manager-create-import').click();
    await started;
    assert.equal(await manager.locator('#database-manager-create-import').isDisabled(), true);
    assert.equal(await manager.locator('#database-manager-cancel').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await manager.isVisible(), true, 'An in-flight preparation cannot silently lose its result.');
    releaseRequest(); releaseRequest = null;
    const preparedResponse = await pending;
    const prepared = await preparedResponse.json();
    assert.equal(prepared.ok, true, prepared.error);
    assert.equal(prepared.data.database, created);
    assert.equal(prepared.data.created, true);
    owned.add(created);
    assert.ok(prepared.data.databases.some(item => item.name === created && item.available));
    await page.unroute(preparationRoute, holdPreparation);
    await manager.waitFor({state: 'hidden'});
    await waitImport(created);
    assert.equal(await page.locator('#database-select').inputValue(), created);
    const beforeImport = data(await api('import-inspection', created));
    assert.deepEqual(beforeImport.tables, []);
    assert.deepEqual(beforeImport.views, []);
    assert.equal(beforeImport.foreign_keys, 0);
    assert.equal(beforeImport.total_records, 0);
    await page.locator('#import-inspection').waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('#import-inspection .import-inspection-summary')?.textContent.includes('0 tables'));

    const dump = `-- Govern isolated native import fixture\nSET NAMES utf8mb4;\n`
        + 'CREATE TABLE imported_people (id INT PRIMARY KEY, name VARCHAR(100)) ENGINE=InnoDB;\n'
        + 'CREATE TABLE imported_notes (id INT PRIMARY KEY, person_id INT NOT NULL, body TEXT, '
        + 'CONSTRAINT imported_person FOREIGN KEY(person_id) REFERENCES imported_people(id)) ENGINE=InnoDB;\n'
        + "INSERT INTO imported_people VALUES (1,'Local person');\n"
        + "INSERT INTO imported_notes VALUES (1,1,'" + literal + "');\n";
    await frame.locator('#input_import_file').setInputFiles({name: 'govern-import.sql', mimeType: 'application/sql', buffer: Buffer.from(dump)});
    const uploaded = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.startsWith('/phpmyadmin/') && url.searchParams.get('route') === '/import'
            && response.request().method() === 'POST';
    });
    await frame.locator('#buttonGo').click();
    const uploadedResponse = await uploaded;
    assert.equal(uploadedResponse.status(), 200, 'The official phpMyAdmin upload accepts the SQL file.');
    await page.waitForFunction(async ({database}) => {
        const response = await fetch('/api.php?' + new URLSearchParams({action: 'schema', database}));
        const payload = await response.json();
        return payload.ok && payload.data.tables.some(table => table.name === 'imported_notes');
    }, {database: created});
    const importReport = data(await api('import-inspection', created));
    assert.deepEqual(importReport.tables.sort(), ['imported_notes', 'imported_people']);
    assert.equal(importReport.foreign_keys, 1);
    assert.equal(importReport.total_records, 2);
    await page.waitForFunction(() => document.querySelector('#import-inspection .import-inspection-summary')?.textContent.includes('After import: 2 tables'));
    const schema = data(await api('schema', created));
    assert.deepEqual(schema.tables.map(table => table.name).sort(), ['imported_notes', 'imported_people']);
    const notes = schema.tables.find(table => table.name === 'imported_notes');
    assert.ok(notes.foreign_keys.some(key => key.referenced_table === 'imported_people'
        && key.referenced_schema === created), 'The imported relationship is visible to Govern.');
    const browse = data(await api('browse', created, {params: {table: 'imported_notes'}}));
    assert.equal(browse.rows.length, 1);
    assert.equal(browse.rows[0].body, literal, 'Uploaded SQL has created real rows, rather than a preview-only result.');
    await shot('native-result');
    await nativeDialog.locator('.database-dialog-header .button').click();
    await nativeDialog.waitFor({state: 'hidden'});
    await waitWorkspace(created);
    await page.locator('#sql-editor').fill(importedDraft);
    await page.goto(new URL('/#gegevens?' + new URLSearchParams({database: created, table: 'imported_notes'}), base).href);
    await page.locator('.table-heading h2').filter({hasText: 'imported_notes'}).waitFor();
    assert.ok((await page.locator('.table-workspace .data-table').innerText()).includes(literal));
    assert.equal(await page.evaluate(() => window.importUnsafe), undefined, 'Imported text is rendered safely in the custom workspace.');
    await shot('workspace-readback');

    // Existing-name preparation must retain the imported tables and data.
    const repeated = data(await api('prepare-database', created, {body: {name: created}}));
    assert.equal(repeated.created, false);
    assert.equal(data(await api('browse', created, {params: {table: 'imported_people'}})).rows[0].name, 'Local person');
    await openManager();
    await manager.locator('#database-manager-existing').selectOption(first);
    await manager.locator('#database-manager-switch').click();
    await manager.waitFor({state: 'hidden'});
    await waitWorkspace(first);
    await page.goto(new URL('/#onderzoeken?' + new URLSearchParams({database: first}), base).href);
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), beforeDraft, 'The original database query draft survives create/import and switching back.');
    await switchDatabase(created);
    assert.equal(await page.locator('#sql-editor').inputValue(), importedDraft, 'The imported database keeps its own query draft.');

    // Create without importing, then reopen native import for an existing target.
    await openManager();
    await nameInput.fill(emptyDatabase);
    const emptyPending = responseFor('prepare-database');
    await manager.locator('#database-manager-create').click();
    const emptyPayload = await (await emptyPending).json();
    assert.equal(emptyPayload.ok, true, emptyPayload.error);
    assert.equal(emptyPayload.data.created, true); owned.add(emptyDatabase);
    await manager.waitFor({state: 'hidden'});
    await waitWorkspace(emptyDatabase);
    assert.equal(await nativeDialog.isVisible(), false, 'Create-only does not open a file upload automatically.');
    assert.deepEqual(data(await api('schema', emptyDatabase)).tables, []);

    // First-party import: plan, exact database confirmation, execution and postflight.
    await openManager();
    await manager.locator('#database-manager-existing').selectOption(emptyDatabase);
    await manager.locator('#database-manager-import-existing').click();
    await manager.waitFor({state: 'hidden'});
    await waitImport(emptyDatabase);
    const ownSql = 'CREATE TABLE govern_native_import (id INT PRIMARY KEY, value VARCHAR(30));\n'
        + "INSERT INTO govern_native_import VALUES (1,'verified');\n";
    const ownFile = nativeDialog.locator('#native-import-file');
    await ownFile.setInputFiles({name: 'govern-native.sql', mimeType: 'application/sql', buffer: Buffer.from(ownSql)});
    const ownPlanResponse = responseFor('native-import-preview');
    await nativeDialog.locator('.native-import button').first().click();
    const ownPlan = await (await ownPlanResponse).json();
    assert.equal(ownPlan.ok, true, JSON.stringify(ownPlan));
    assert.equal(ownPlan.data.database, emptyDatabase);
    assert.equal(ownPlan.data.before.tables.length, 0);
    assert.equal(await nativeDialog.locator('.native-import button').last().isDisabled(), true,
        'Import requires confirmation.');
    await nativeDialog.locator('#native-import-confirm').fill(emptyDatabase);
    const ownExecuteResponse = responseFor('native-import-execute');
    await nativeDialog.locator('.native-import button').last().click();
    const ownResult = await (await ownExecuteResponse).json();
    assert.equal(ownResult.ok, true, JSON.stringify(ownResult));
    assert.equal(ownResult.data.completed, true, JSON.stringify(ownResult.data.failed));
    assert.ok(ownResult.data.added_tables.includes('govern_native_import'));
    const nativeRows = data(await api('browse', emptyDatabase, {params: {table: 'govern_native_import'}}));
    assert.equal(nativeRows.rows[0].value, 'verified');
    await nativeDialog.locator('.database-dialog-header .button').click();
    await nativeDialog.waitFor({state: 'hidden'});
    await openManager();
    await manager.locator('#database-manager-existing').selectOption(created);
    await manager.locator('#database-manager-import-existing').click();
    await manager.waitFor({state: 'hidden'});
    await waitImport(created);
    await page.waitForFunction(() => document.querySelector('#import-inspection .import-inspection-warnings')?.textContent.includes('already contains 2 tables'));
    const frameSrc = await page.locator('#database-frame').getAttribute('src');
    await language('nl');
    assert.equal(await page.locator('#database-frame').getAttribute('src'), frameSrc,
        'Changing Govern language does not reload an active native import form.');
    await nativeDialog.locator('.database-dialog-header .button').click();
    await nativeDialog.waitFor({state: 'hidden'});
    await waitWorkspace(created);
    await openManager();
    await nameInput.fill('retained_cancel_draft');
    await closeManager();
    await page.waitForFunction(() => document.activeElement?.id === 'manage-databases');

    const mobile = await context.newPage();
    await mobile.setViewportSize({width: 320, height: 900});
    await mobile.goto(new URL('/#overzicht?' + new URLSearchParams({database: first}), base).href, {waitUntil: 'networkidle'});
    await mobile.locator('#manage-databases:not([disabled])').waitFor();
    await mobile.locator('#manage-databases').click();
    await mobile.locator('#database-manager-dialog[open]').waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await mobile.locator('#database-manager-dialog').evaluate(node => node.scrollWidth <= innerWidth), true);
    await mobile.locator('#database-manager-name').fill('mobile_name_draft');
    await mobile.evaluate(async () => { const {setLanguage} = await import('/assets/i18n.js'); setLanguage('en'); });
    assert.equal(await mobile.locator('#database-manager-name').inputValue(), 'mobile_name_draft');
    if (process.env.SCREENSHOTS_DIR) await mobile.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'database-import-mobile.png'), fullPage: true});
    await mobile.keyboard.press('Escape');
    await mobile.locator('#database-manager-dialog').waitFor({state: 'hidden'});
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log('PASS: preflight/post-import schema and exact records, Bestuursatlas completeness, native SQL import, database safety and navigation.');
} finally {
    releaseRequest?.();
    if (first && csrf) for (const fixture of owned) {
        if (!fixture.startsWith('govern_ui_') || !fixture.endsWith(suffix)) continue;
        try { await sql(first, 'DROP DATABASE IF EXISTS `' + fixture + '`', true); }
        catch { /* Report the test failure without hiding it behind fixture cleanup. */ }
    }
    await browser.close();
}
