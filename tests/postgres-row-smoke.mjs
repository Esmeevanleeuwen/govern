/** The shared row editor writes only disposable PostgreSQL fixtures. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {authenticatedContext} from './auth-session.mjs';
import {selectWorkspaceLanguage} from './workspace-tools.mjs';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use an isolated stack and set GOVERN_UI_WRITE_TESTS=1.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const table = 'govern_pg_edit';
const marker = 'PG UI ' + Date.now().toString(16);
const exact = '123456789012345678901234.12';
const dialog = page.locator('#row-editor-dialog');
const field = name => dialog.locator('[data-row-field=' + JSON.stringify(name) + ']');
const mode = name => dialog.locator('[data-row-mode=' + JSON.stringify(name) + ']');
const row = label => page.locator('.table-workspace .data-table tbody tr').filter({hasText: label});
const bookmark = (database = publicKey, name = table) => new URL('/workspace.php#gegevens?' +
    new URLSearchParams({database, table: name}), base).href;
const api = (action, {schema = 'public', params = {}, body} = {}) => page.evaluate(async ({action, schema, params, body}) => {
    const endpoint = new URL('/api.php', location.origin);
    for (const [key, value] of Object.entries({action, connection: 'postgres', database: 'govern_pg', schema, ...params})) {
        endpoint.searchParams.set(key, String(value));
    }
    const bootstrap = body === undefined ? null : await (await fetch('/api.php?action=bootstrap')).json();
    const response = await fetch(endpoint, body === undefined ? undefined : {method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-CSRF-Token': bootstrap.data.csrf,
    }, body: JSON.stringify(body)});
    return {status: response.status, payload: await response.json()};
}, {action, schema, params, body});
const data = result => {
    assert.equal(result.status >= 200 && result.status < 300, true, JSON.stringify(result.payload));
    assert.equal(result.payload.ok, true, JSON.stringify(result.payload));
    return result.payload.data;
};
const responseFor = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const assertScope = response => {
    const url = new URL(response.url());
    assert.equal(url.searchParams.get('connection'), 'postgres');
    assert.equal(url.searchParams.get('database'), 'govern_pg');
    assert.equal(url.searchParams.get('schema'), 'public');
};
const setField = async (name, value) => {
    await mode(name).selectOption('value');
    await field(name).fill(value);
};
const save = async action => {
    const pending = responseFor(action);
    await dialog.locator('#row-editor-save').click();
    const response = await pending;
    assertScope(response);
    return {status: response.status(), payload: await response.json()};
};
const edit = async label => {
    await row(label).locator('[data-row-action="edit"]').click();
    await field('label').waitFor();
};
const waitRows = label => row(label).first().waitFor();
let insertedKey;

try {
    await page.goto(bookmark(), {waitUntil: 'networkidle'});
    await waitRows('Original public row');
    assert.equal(await page.locator('[data-postgres-editing]').count(), 1);
    assert.equal(await page.locator('#open-database').isEnabled(), true, 'PostgreSQL database tools remain available for SQL.');
    await page.locator('#add-row').click();
    await field('label').waitFor();
    assert.equal(await page.locator('#database-select').isDisabled(), true,
        'An open PostgreSQL editor holds its complete database/schema scope.');
    assert.ok((await dialog.locator('.row-editor-context').textContent()).includes('schema public'));
    assert.equal(await field('generated_label').getAttribute('readonly') !== null, true);
    assert.equal(await mode('id').inputValue(), 'default', 'Identity generation is the insertion default.');
    await setField('label', marker + ' <literal>');
    await page.evaluate(href => { location.hash = new URL(href).hash; }, bookmark(archiveKey));
    await page.waitForFunction(key => new URLSearchParams(location.hash.split('?')[1]).get('database') === key, publicKey);
    assert.equal(await field('label').inputValue(), marker + ' <literal>',
        'A navigation attempt cannot discard the captured PostgreSQL edit.');
    await setField('amount', exact);
    await mode('nullable_text').selectOption('null');
    await mode('default_text').selectOption('default');
    await setField('payload', '00ff41');
    const inserted = data(await save('insert-row'));
    insertedKey = inserted.key;
    assert.equal(inserted.row.amount, exact);
    assert.equal(inserted.row.payload, '00ff41');
    assert.equal(inserted.row.nullable_text, null);
    assert.equal(inserted.row.default_text, 'server default');
    await dialog.waitFor({state: 'hidden'});
    await waitRows(marker);
    assert.equal(await row(marker).locator('literal').count(), 0, 'Record text is never interpreted as HTML.');

    await edit(marker);
    assert.equal(await field('amount').inputValue(), exact);
    await setField('label', marker + ' unsaved');
    const current = data(await api('row-editor', {params: {table, key: JSON.stringify(insertedKey)}}));
    data(await api('update-row', {body: {table, key: current.key, version: current.version,
        values: {label: {mode: 'value', value: marker + ' concurrent'}}}}));
    const conflict = await save('update-row');
    assert.equal(conflict.status, 409);
    assert.equal(conflict.payload.error_code, 'row_stale');
    assert.equal(await field('label').inputValue(), marker + ' unsaved');
    assert.equal(await dialog.locator('#row-editor-reload').isVisible(), true);
    await dialog.locator('#row-editor-reload').click();
    await page.locator('dialog.confirm-dialog[open] button[type="submit"]').click();
    await page.waitForFunction(value => document.querySelector('[data-row-field="label"]')?.value === value, marker + ' concurrent');
    await setField('label', marker + ' edited');
    await mode('nullable_text').selectOption('value');
    await field('nullable_text').fill('');
    const updated = data(await save('update-row'));
    assert.equal(updated.row.nullable_text, '', 'Empty text remains different from NULL.');
    assert.equal(updated.row.payload, '00ff41', 'Unchanged binary data is preserved.');
    await dialog.waitFor({state: 'hidden'});
    await waitRows(marker + ' edited');

    await page.locator('#database-select').selectOption(archiveKey);
    await page.waitForFunction(key => document.querySelector('#database-select')?.value === key
        && !document.querySelector('#database-select').disabled, archiveKey);
    await page.locator('.catalog-item[title="govern_pg_edit"]').click();
    await waitRows('Archive row');
    assert.equal((await page.locator('.table-workspace .data-table').innerText()).includes(marker), false);
    await page.locator('#database-select').selectOption(publicKey);
    await waitRows(marker + ' edited');
    await selectWorkspaceLanguage(page, 'nl');
    await page.setViewportSize({width: 360, height: 800});
    await edit(marker);
    await setField('label', marker + ' mobiel');
    assert.ok((await dialog.locator('#row-editor-title').textContent()).includes('bewerken'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobile = data(await save('update-row'));
    assert.equal(mobile.row.label, marker + ' mobiel');
    await dialog.waitFor({state: 'hidden'});
    await waitRows(marker + ' mobiel');
    await row(marker).locator('[data-row-action="delete"]').click();
    await field('label').waitFor();
    const deletion = responseFor('delete-row');
    await dialog.locator('#row-editor-save').click();
    const confirmation = page.locator('dialog.confirm-dialog[open]');
    assert.ok((await confirmation.textContent()).includes('govern_pg.public.' + table));
    await confirmation.locator('button[type="submit"]').click();
    const response = await deletion;
    assertScope(response);
    data({status: response.status(), payload: await response.json()});
    insertedKey = null;
    await dialog.waitFor({state: 'hidden'});
    await row(marker).waitFor({state: 'hidden'});
    await page.goto(bookmark(publicKey, 'govern_pg_edit_view'), {waitUntil: 'networkidle'});
    await page.locator('.table-workspace .data-table').waitFor();
    assert.equal(await page.locator('#add-row, [data-row-action]').count(), 0,
        'PostgreSQL views do not imply support for direct row writes.');
    assert.equal(await page.getByRole('button', {name: /phpMyAdmin/}).count(), 0);
    await page.goto(bookmark(publicKey, 'govern_pg_edit_keyless'), {waitUntil: 'networkidle'});
    await page.locator('.table-workspace .empty-state').waitFor();
    assert.equal(await page.locator('#add-row').count(), 1, 'A keyless base table can still accept inserts.');
    assert.equal(await page.locator('[data-row-action]').count(), 0, 'A keyless table offers no guessed update/delete.');
    assert.equal(await page.getByRole('button', {name: /phpMyAdmin/}).count(), 0);
    assert.deepEqual(errors, [], 'No JavaScript exceptions along the real CRUD flow.');
    console.log('PASS: PostgreSQL editor add/exact readback/update/conflict/reload/delete, schema isolation, NL and mobile.');
} finally {
    if (insertedKey) {
        const current = await api('row-editor', {params: {table, key: JSON.stringify(insertedKey)}}).catch(() => null);
        if (current?.status === 200) await api('delete-row', {body: {table, key: current.payload.data.key,
            version: current.payload.data.version}}).catch(() => {});
    }
    await context.close();
    await browser.close();
}
