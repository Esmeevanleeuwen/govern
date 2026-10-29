/** Real multi-database navigation and row writes in a disposable local stack. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable stack and set GOVERN_UI_WRITE_TESTS=1.');
const second = process.env.GOVERN_TEST_SECOND_DATABASE;
assert.ok(second, 'Provision GOVERN_TEST_SECOND_DATABASE in the isolated stack.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
const page = await context.newPage();
const errors = [];
const track = page => page.on('pageerror', error => errors.push(error.message));
track(page);
const name = 'zz_govern_ui_rows_' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
const table = '`' + name + '`';
const numericName = name + '_numeric';
const numericTable = '`' + numericName + '`';
let first, csrf, releaseDelayed;
const saved = [];

const api = async (action, database, {params = {}, body} = {}) => page.evaluate(async ({action, database, params, body, csrf}) => {
    const url = new URL('/api.php', location.origin);
    url.searchParams.set('action', action);
    if (database) url.searchParams.set('database', database);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let token = csrf;
    if (body !== undefined && !token) {
        const initial = await (await fetch('/api.php?action=bootstrap')).json();
        token = initial.data.csrf;
    }
    const response = await fetch(url, body === undefined ? undefined : {method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-CSRF-Token': token,
    }, body: JSON.stringify(body)});
    return {status: response.status, payload: await response.json(), url: url.href};
}, {action, database, params, body, csrf});
const data = result => {
    assert.equal(result.status >= 200 && result.status < 300, true, JSON.stringify(result.payload));
    assert.equal(result.payload.ok, true, result.payload.error);
    return result.payload.data;
};
const sql = async (database, text, confirm = false) => {
    const result = data(await api('query', database, {body: {sql: text, confirm}}));
    assert.equal(result.confirm_required, false, text);
    assert.equal(result.failed, null, JSON.stringify(result.failed));
    return result;
};
const queryRows = async (database, text) => (await sql(database, text)).statements[0].rows;
const responseFor = (action, current = page) => current.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const picker = current => current.locator('#database-select');
const dialog = page.locator('#row-editor-dialog');
const field = column => dialog.locator('[data-row-field=' + JSON.stringify(column) + ']');
const mode = column => dialog.locator('[data-row-mode=' + JSON.stringify(column) + ']');
const setField = async (column, value) => {
    await mode(column).selectOption('value');
    await field(column).fill(value);
};
const waitTable = async (database, current = page) => {
    await current.waitForFunction(({database, name}) => {
        const select = document.querySelector('#database-select');
        return select?.value === database && !select.disabled
            && document.querySelector('.table-heading h2')?.textContent === name
            && !document.querySelector('.table-workspace .loading-state');
    }, {database, name});
};
const openTable = async (database, current = page) => {
    await current.goto(new URL('/#gegevens?' + new URLSearchParams({database, table: name}), base).href, {waitUntil: 'networkidle'});
    await waitTable(database, current);
};
const switchDatabase = async (database, current = page) => {
    await picker(current).selectOption(database);
    await current.waitForFunction(database => document.querySelector('#database-select')?.value === database
        && !document.querySelector('#database-select').disabled && !document.querySelector('#page .loading-state'), database);
};
const row = text => page.locator('.table-workspace .data-table tbody tr').filter({hasText: text});
const edit = async text => {
    await row(text).locator('[data-row-action="edit"]').click();
    await dialog.waitFor();
    await dialog.locator('#row-editor-save').waitFor({state: 'visible'});
};
const save = async action => {
    const pending = responseFor(action);
    await dialog.locator('#row-editor-save').click();
    const response = await pending;
    const payload = await response.json();
    return {status: response.status(), payload, url: response.url(), body: response.request().postDataJSON()};
};
const closeEditor = async () => {
    await dialog.locator('#row-editor-cancel').click();
    const confirmation = page.locator('dialog.confirm-dialog[open]');
    if (await confirmation.isVisible()) await confirmation.locator('button[type="submit"]').click();
    await dialog.waitFor({state: 'hidden'});
};
const noOverflow = async current => assert.equal(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const shot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'multidatabase-' + name + '.png'), fullPage: true});
};

try {
    await page.goto(base.href, {waitUntil: 'networkidle'});
    const bootstrap = data(await api('bootstrap'));
    first = bootstrap.database.name;
    csrf = bootstrap.csrf;
    assert.notEqual(first, second, 'The fixture requires two distinct databases.');
    const databases = data(await api('databases'));
    assert.ok(databases.databases.some(item => item.name === first && item.available));
    assert.ok(databases.databases.some(item => item.name === second && item.available));
    assert.equal(databases.databases.some(item => ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(item.name)), false);

    // Numeric column names are valid SQL identifiers. PHP must serialize
    // records and keys as JSON objects even when their keys are 0 and 1.
    await sql(first, `CREATE TABLE ${numericTable} (\`0\` BIGINT UNSIGNED PRIMARY KEY, \`1\` VARCHAR(40)) ENGINE=InnoDB;`);
    const numericKey = {'0': '9007199254740997'};
    const numericInserted = data(await api('insert-row', first, {body: {table: numericName,
        values: {'0': {mode: 'value', value: numericKey['0']}, '1': {mode: 'value', value: 'numeric identifiers'}}}}));
    assert.deepEqual(numericInserted.key, numericKey);
    assert.deepEqual(numericInserted.row, {...numericKey, '1': 'numeric identifiers'});
    assert.equal(Array.isArray(numericInserted.key) || Array.isArray(numericInserted.row), false);
    const numericBrowse = data(await api('browse', first, {params: {table: numericName}}));
    assert.deepEqual(numericBrowse.row_keys, [numericKey]);
    assert.deepEqual(numericBrowse.rows, [{...numericKey, '1': 'numeric identifiers'}]);
    assert.equal(Array.isArray(numericBrowse.row_keys[0]) || Array.isArray(numericBrowse.rows[0]), false);
    const numericDescribed = data(await api('row-editor', first, {params: {table: numericName, key: JSON.stringify(numericKey)}}));
    assert.deepEqual(numericDescribed.key, numericKey);
    assert.deepEqual(numericDescribed.row, {...numericKey, '1': 'numeric identifiers'});
    assert.deepEqual(numericDescribed.key_columns, ['0']);
    const arrayKey = await api('row-editor', first, {params: {table: numericName, key: JSON.stringify([numericKey['0']])}});
    assert.equal(arrayKey.status, 422, 'A JSON array is not a valid column-key object.');
    assert.equal(arrayKey.payload.error_code, 'row_key_invalid');
    const nextNumericKey = {'0': '9007199254740999'};
    const numericUpdated = data(await api('update-row', first, {body: {table: numericName,
        key: numericDescribed.key, version: numericDescribed.version,
        values: {'0': {mode: 'value', value: nextNumericKey['0']}, '1': {mode: 'value', value: 'numeric changed'}}}}));
    assert.deepEqual(numericUpdated.key, nextNumericKey);
    assert.deepEqual(numericUpdated.row, {...nextNumericKey, '1': 'numeric changed'});
    assert.deepEqual(await queryRows(first, `SELECT \`0\`,\`1\` FROM ${numericTable};`), [[nextNumericKey['0'], 'numeric changed']]);
    const numericDeleted = data(await api('delete-row', first, {body: {table: numericName,
        key: numericUpdated.key, version: numericUpdated.version}}));
    assert.deepEqual(numericDeleted.key, nextNumericKey);
    assert.deepEqual(await queryRows(first, `SELECT COUNT(*) FROM ${numericTable};`), [['0']]);

    for (const [database, marker] of [[first, 'A'], [second, 'B']]) {
        await sql(database, `CREATE TABLE ${table} (
id BIGINT UNSIGNED PRIMARY KEY,
label VARCHAR(80) NOT NULL,
amount DECIMAL(30,2) NOT NULL DEFAULT 0,
nullable_text TEXT NULL,
default_text VARCHAR(40) NOT NULL DEFAULT 'server default',
generated_label VARCHAR(100) GENERATED ALWAYS AS (CONCAT(label, '!')) STORED
) ENGINE=InnoDB;
INSERT INTO ${table} (id,label,amount) VALUES (1,'${marker} seed',10.10);`);
    }
    // Fixtures are created through a direct API call outside the UI query
    // workspace. Reload its catalog before hash-only navigation to the probe.
    await page.reload({waitUntil: 'networkidle'});
    await openTable(first);
    assert.ok((await page.locator('.table-workspace .data-table').innerText()).includes('A seed'));
    assert.ok((await picker(page).locator('option').allTextContents()).some(label => label.includes(second)));

    await edit('A seed');
    assert.equal(await picker(page).isDisabled(), true, 'An open row editor cannot silently change its target database.');
    assert.equal(await dialog.locator('[data-row-field="generated_label"]:not([disabled]):not([readonly])').count(), 0,
        'A generated value is never an ordinary editable field.');
    assert.ok((await dialog.innerText()).includes('generated_label'));
    await setField('label', 'A edited <literal>');
    await setField('amount', '123456789012345678901234.12');
    await mode('nullable_text').selectOption('null');
    await mode('default_text').selectOption('default');
    const updated = await save('update-row');
    data(updated);
    assert.equal(new URL(updated.url).searchParams.get('database'), first);
    assert.equal(updated.body.values.amount.value, '123456789012345678901234.12');
    assert.equal(updated.body.values.default_text.mode, 'default');
    assert.equal(Object.hasOwn(updated.body.values, 'generated_label'), false);
    await dialog.waitFor({state: 'hidden'});
    await waitTable(first);
    assert.deepEqual(await queryRows(first, `SELECT label,amount,nullable_text,default_text,generated_label FROM ${table} WHERE id=1;`),
        [['A edited <literal>', '123456789012345678901234.12', null, 'server default', 'A edited <literal>!']]);
    assert.deepEqual(await queryRows(second, `SELECT label,amount FROM ${table} WHERE id=1;`), [['B seed', '10.10']],
        'An A-row save cannot alter the same table and key in B.');

    await page.locator('#add-row').click();
    await dialog.waitFor();
    await setField('id', '9007199254740993');
    await setField('label', 'inserted A');
    await setField('amount', '9007199254740993.25');
    await mode('nullable_text').selectOption('null');
    await mode('default_text').selectOption('default');
    const inserted = await save('insert-row');
    data(inserted);
    assert.equal(new URL(inserted.url).searchParams.get('database'), first);
    assert.equal(inserted.body.values.id.value, '9007199254740993');
    assert.equal(inserted.body.values.nullable_text.mode, 'null');
    await dialog.waitFor({state: 'hidden'});
    await waitTable(first);
    assert.deepEqual(await queryRows(first, `SELECT id,amount,nullable_text,default_text FROM ${table} WHERE id=9007199254740993;`),
        [['9007199254740993', '9007199254740993.25', null, 'server default']]);
    assert.deepEqual(await queryRows(second, `SELECT COUNT(*) FROM ${table} WHERE id=9007199254740993;`), [['0']]);

    await edit('A edited <literal>');
    await setField('label', 'unsaved user draft');
    await sql(first, `UPDATE ${table} SET label='A changed elsewhere' WHERE id=1;`);
    const stale = await save('update-row');
    assert.equal(stale.status, 409, JSON.stringify(stale.payload));
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await field('label').inputValue(), 'unsaved user draft', 'A conflict keeps the user’s unsaved field values.');
    assert.deepEqual(await queryRows(first, `SELECT label FROM ${table} WHERE id=1;`), [['A changed elsewhere']]);
    await closeEditor();

    await row('inserted A').locator('[data-row-action="delete"]').click();
    await dialog.waitFor();
    await dialog.locator('#row-editor-save').click();
    const removeDialog = page.locator('dialog.confirm-dialog[open]');
    await removeDialog.waitFor();
    await removeDialog.getByRole('button', {name: /^(Annuleren|Cancel)$/}).click();
    assert.deepEqual(await queryRows(first, `SELECT COUNT(*) FROM ${table} WHERE id=9007199254740993;`), [['1']]);
    assert.equal(await dialog.isVisible(), true, 'Cancelling deletion preserves the exact record review.');
    await dialog.locator('#row-editor-save').click();
    await removeDialog.waitFor();
    const deleting = responseFor('delete-row');
    await removeDialog.locator('button[type="submit"]').click();
    const deleted = await deleting;
    assert.equal(deleted.status(), 200);
    assert.equal(new URL(deleted.url()).searchParams.get('database'), first);
    await dialog.waitFor({state: 'hidden'});
    assert.deepEqual(await queryRows(first, `SELECT COUNT(*) FROM ${table} WHERE id=9007199254740993;`), [['0']]);

    // Saved SQL and unfinished editor content belong to their own database.
    const savedA = data(await api('save-query', first, {body: {name: 'A saved ' + name, sql: 'SELECT 111 AS saved_a;', notes: ''}}));
    saved.push({database: first, id: savedA.id});
    await page.locator('#navigation [data-area="research"]').click();
    await page.locator('#sql-editor').fill('SELECT 111 AS draft_a;');
    await page.locator('#query-name').fill('A unfinished title');
    await page.locator('#query-notes').fill('A unfinished notes');
    await page.locator('.saved-item-open').filter({hasText: 'A saved ' + name}).waitFor();
    await switchDatabase(second);
    await page.locator('#sql-editor').waitFor();
    assert.notEqual(await page.locator('#sql-editor').inputValue(), 'SELECT 111 AS draft_a;');
    assert.equal(await page.locator('.saved-item-open').filter({hasText: 'A saved ' + name}).count(), 0);
    await page.locator('#sql-editor').fill('SELECT 222 AS draft_b;');
    await page.locator('#query-name').fill('B unfinished title');
    await page.locator('#query-notes').fill('B unfinished notes');
    await switchDatabase(first);
    await page.waitForFunction(() => document.querySelector('#sql-editor')?.value === 'SELECT 111 AS draft_a;');
    assert.equal(await page.locator('#query-name').inputValue(), 'A unfinished title');
    assert.equal(await page.locator('#query-notes').inputValue(), 'A unfinished notes');
    await switchDatabase(second);
    await page.waitForFunction(() => document.querySelector('#sql-editor')?.value === 'SELECT 222 AS draft_b;');
    assert.equal(await page.locator('#query-name').inputValue(), 'B unfinished title');
    assert.equal(await page.locator('#query-notes').inputValue(), 'B unfinished notes');
    const href = await page.locator('#context-export').getAttribute('href');
    assert.equal(new URL(href, base).searchParams.get('database'), second);
    const exported = await page.evaluate(async href => (await fetch(href)).json(), href);
    assert.equal(exported.database, second);
    assert.equal(exported.saved_queries.some(item => String(item.id) === String(savedA.id) && item.name === savedA.name), false);
    const unknown = await api('bootstrap', '__govern_unknown_database_' + name);
    assert.equal(unknown.status, 403, 'An unknown target never silently falls back to the active database.');

    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('[data-database-view="gegevens"]').click();
    await waitTable(second);
    assert.ok((await page.locator('.table-workspace .data-table').innerText()).includes('B seed'));
    await edit('B seed');
    await setField('label', 'B editor draft');
    // The native modal keeps the background inert, while another tab can
    // legitimately change the shared language preference.
    const languagePage = await context.newPage();
    track(languagePage);
    await languagePage.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
    await languagePage.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await field('label').inputValue(), 'B editor draft', 'Changing language leaves row input intact.');
    assert.equal((await dialog.innerText()).includes('app.'), false);
    await languagePage.close();
    await page.setViewportSize({width: 320, height: 900});
    await noOverflow(page);
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= innerWidth), true);
    await shot('row-editor-mobile');
    await closeEditor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'row-edit-0',
        'Closing after a language change restores the replacement row action.');
    await page.setViewportSize({width: 1440, height: 1100});

    await page.locator('[data-database-view="schema"]').click();
    await page.locator('#schema-viewport').waitFor();
    await page.locator('#schema-actual').click();
    await page.locator('#schema-zoom-in').click();
    const bZoom = await page.locator('#schema-zoom-value').innerText();
    await page.locator('#selection-pointer-toggle').click();
    await page.locator('[data-schema-header=' + JSON.stringify(name) + ']').click();
    await page.locator('#selection-pointer-toggle').click();
    await switchDatabase(first);
    await waitTable(first);
    assert.equal(await page.locator('[data-database-view="gegevens"]').getAttribute('aria-current'), 'page',
        'The picker restores the database’s own previous data view.');
    assert.equal(await page.locator('#selection-pointer-count').isVisible(), false, 'Database switching clears data-object selection from the previous schema.');
    await page.locator('[data-database-view="schema"]').click();
    await page.locator('#schema-viewport').waitFor();
    await page.locator('#schema-actual').click();
    await switchDatabase(second);
    await page.waitForFunction(value => document.querySelector('#schema-zoom-value')?.textContent === value, bZoom);

    // Delay a real A response until B is already active, then release it.
    const delayedPage = await context.newPage();
    track(delayedPage);
    await openTable(first, delayedPage);
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const release = new Promise(resolve => { releaseDelayed = resolve; });
    let intercepted = false;
    await delayedPage.route('**/api.php?**', async route => {
        const url = new URL(route.request().url());
        if (intercepted || url.searchParams.get('action') !== 'browse' || url.searchParams.get('database') !== first
            || url.searchParams.get('table') !== name || url.searchParams.get('q') !== 'A') return route.continue();
        intercepted = true;
        const response = await route.fetch();
        reached();
        await release;
        try { await route.fulfill({response}); } catch { /* An intentionally aborted old request is expected. */ }
    });
    await delayedPage.locator('#data-search').fill('A');
    await waiting;
    await switchDatabase(second, delayedPage);
    await waitTable(second, delayedPage);
    releaseDelayed(); releaseDelayed = null;
    await delayedPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok((await delayedPage.locator('.table-workspace .data-table').innerText()).includes('B seed'));
    assert.equal((await delayedPage.locator('.table-workspace .data-table').innerText()).includes('A changed elsewhere'), false,
        'A late response cannot replace the active B catalog or data.');
    await delayedPage.close();

    // The official tool receives B, performs a real SQL update there, and
    // Govern rereads B without changing the same-named record in A.
    await page.locator('[data-database-view="gegevens"]').click();
    await waitTable(second);
    await page.locator('#open-database').click();
    await page.locator('#database-dialog[open]').waitFor();
    await page.locator('#database-dialog .frame-message').waitFor({state: 'hidden'});
    await page.locator('#database-tab-sql').click();
    await page.locator('#database-dialog .frame-message').waitFor({state: 'hidden'});
    const frame = page.frameLocator('#database-frame');
    await frame.locator('#sqlquery').waitFor({state: 'attached'});
    assert.equal(await page.locator('#database-frame').evaluate(node => new URL(node.contentWindow.location.href).searchParams.get('db')), second);
    const pmaSql = `UPDATE ${table} SET label='B from phpMyAdmin' WHERE id=1;`;
    await frame.locator('#sqlquery').evaluate((textarea, sql) => {
        const editor = textarea.parentElement.querySelector('.CodeMirror')?.CodeMirror
            || document.querySelector('.CodeMirror')?.CodeMirror;
        if (editor) { editor.setValue(sql); editor.save(); }
        else { textarea.value = sql; textarea.dispatchEvent(new Event('input', {bubbles: true})); }
    }, pmaSql);
    // phpMyAdmin also POSTs the editor contents to /lint. Wait for its actual
    // SQL import, including the exact submitted SQL, rather than a lint reply.
    const pmaRequest = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST' && url.pathname.startsWith('/phpmyadmin/')
            && url.searchParams.get('route') === '/import'
            && new URLSearchParams(response.request().postData() || '').get('sql_query') === pmaSql;
    });
    await frame.locator('#button_submit_query').click();
    const pmaResponse = await pmaRequest;
    assert.equal(pmaResponse.status(), 200);
    const pmaSubmission = new URLSearchParams(pmaResponse.request().postData() || '');
    assert.equal(pmaSubmission.get('db'), second, 'The official SQL form submits to B.');
    assert.equal(pmaSubmission.get('table'), name, 'The official SQL form submits the disposable table.');
    const pmaResult = await pmaResponse.json();
    assert.equal(pmaResult.success, true, JSON.stringify({success: pmaResult.success, error: pmaResult.error,
        message: String(pmaResult.message || '').slice(0, 2000)}));
    assert.equal(Boolean(pmaResult.error), false, String(pmaResult.error));
    let pmaRows;
    for (let attempt = 0; attempt < 50; attempt++) {
        pmaRows = await queryRows(second, `SELECT label FROM ${table} WHERE id=1;`);
        if (pmaRows[0]?.[0] === 'B from phpMyAdmin') break;
        await page.waitForTimeout(100);
    }
    assert.deepEqual(pmaRows, [['B from phpMyAdmin']], 'Govern rereads the completed official SQL update from B.');
    assert.deepEqual(await queryRows(first, `SELECT label FROM ${table} WHERE id=1;`), [['A changed elsewhere']]);
    await page.locator('#database-dialog').getByRole('button', {name: /^(Close|Sluiten)$/}).click();
    await waitTable(second);
    await row('B from phpMyAdmin').waitFor();
    await noOverflow(page);
    await shot('data-second-database');
    assert.deepEqual(errors, [], 'Multi-database editing has no uncaught browser errors.');
    console.log('PASS: two real databases, direct row insert/update/delete, exact values, NULL/default/generated fields, stale-edit conflict, per-database drafts/queries/schema, late response isolation, languages/mobile and a real phpMyAdmin write in the selected database.');
} finally {
    releaseDelayed?.();
    try {
        for (const item of saved) await api('delete-query', item.database, {body: {id: item.id}});
        for (const database of [first, second].filter(Boolean)) await sql(database, `DROP TABLE IF EXISTS ${numericTable}, ${table};`, true);
    } finally { await browser.close(); }
}
