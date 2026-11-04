/** Real engine/task handoffs; the final disabled-engine case is a UI fixture. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
import {clickWorkspaceTool, openDatabaseTask, selectWorkspaceLanguage} from './workspace-tools.mjs';

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
context.on('page', current => current.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api.php' && url.searchParams.get('action') === 'prepare-database') preparations.push(request);
    if (url.pathname.startsWith('/phpmyadmin/')) phpMyAdmin.push(url);
});
const pg = 'postgres:govern_pg:public';
const suffix = Date.now().toString(16) + Math.random().toString(16).slice(2, 6);
const created = 'govern_ui_engine_' + suffix, previewTable = 'govern_ui_preview_' + suffix;
const manager = page.locator('#database-manager-dialog'), modal = page.locator('#database-dialog');
let original = '', csrf = '', owned = false;
const href = database => new URL('/workspace.php#gegevens?' + new URLSearchParams({database}), base).href;
const ready = database => page.waitForFunction(database => {
    const picker = document.querySelector('#database-select');
    return picker?.value === database && !picker.disabled && !document.querySelector('#page .loading-state');
}, database);
const api = (action, database, body) => page.evaluate(async ({action, database, body, csrf}) => {
    const response = await fetch('/api.php?' + new URLSearchParams({action, database}), body === undefined ? undefined : {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error_code || 'HTTP ' + response.status);
    return payload.data;
}, {action, database, body, csrf});
const waitApi = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const assertPgScope = response => {
    const url = new URL(response.url());
    assert.equal(url.searchParams.get('connection'), 'postgres');
    assert.equal(url.searchParams.get('database'), 'govern_pg');
    assert.equal(url.searchParams.get('schema'), 'public');
};
const closeModal = async () => {
    await modal.locator('.database-dialog-header .modal-tools button').last().click();
    await modal.waitFor({state: 'hidden'});
};
const shot = async (name, current = page) => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await current.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), fullPage: true, animations: 'disabled'});
};

try {
    await page.goto(href(pg), {waitUntil: 'networkidle'}); await ready(pg);
    const bootstrap = await api('bootstrap', pg);
    original = bootstrap.default_database; csrf = bootstrap.csrf;
    assert.ok(original && !original.startsWith('postgres:'));
    assert.equal(bootstrap.engines.find(engine => engine.id === 'mariadb').capabilities.create_database, true);
    assert.equal(bootstrap.engines.find(engine => engine.id === 'postgres').configured, true);
    assert.equal(bootstrap.engines.find(engine => engine.id === 'postgres').capabilities.create_database, false);
    await selectWorkspaceLanguage(page, 'en');
    await clickWorkspaceTool(page, '#manage-databases'); await manager.waitFor(); await shot('manager-tasks');
    await manager.locator('#database-manager-task-create').click(); await shot('manager-engines');
    await manager.locator('#database-manager-engine-mariadb').click();
    await manager.locator('#database-manager-name').fill(created); await shot('create-maria-from-pg');
    assert.equal(await page.locator('#database-select').inputValue(), pg, 'Choosing an engine keeps the workspace unchanged.');
    assert.equal(preparations.length, 0, 'Choosing an engine creates nothing.');
    await manager.locator('#database-manager-back').click();
    await manager.locator('#database-manager-engine-mariadb').click();
    assert.equal(await manager.locator('#database-manager-name').inputValue(), created, 'Back preserves the name.');
    await manager.locator('#database-manager-name').evaluate(input => {input.focus(); input.setSelectionRange(4, 11);});
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.equal(await manager.locator('#database-manager-name').inputValue(), created);
    assert.deepEqual(await manager.locator('#database-manager-name').evaluate(input => [input.selectionStart, input.selectionEnd]), [4, 11]);
    assert.equal(await manager.locator('#database-manager-name').evaluate(input => input === document.activeElement), true);
    assert.equal(await page.locator('#database-select').inputValue(), pg);
    const preparing = waitApi('prepare-database'); await manager.locator('#database-manager-name').press('Enter');
    const prepared = await preparing, result = await prepared.json();
    owned = result.ok && result.data?.created === true && result.data.database === created;
    assert.equal(prepared.status(), 201, JSON.stringify(result));
    assert.equal(result.ok, true); assert.equal(result.data.created, true); assert.equal(result.data.database, created); owned = true;
    assert.equal(preparations.length, 1);
    assert.equal(new URL(preparations[0].url()).searchParams.get('database'), original, 'MariaDB creation from PostgreSQL uses the default MariaDB scope.');
    assert.notEqual(new URL(preparations[0].url()).searchParams.get('connection'), 'postgres');
    assert.deepEqual(preparations[0].postDataJSON(), {name: created});
    await manager.waitFor({state: 'hidden'}); await modal.waitFor();
    await page.frameLocator('#database-frame').locator('#createTableMinimalForm').waitFor();
    assert.equal(await page.locator('#database-select').inputValue(), created);
    assert.equal(await page.locator('#database-tab-structure').getAttribute('aria-selected'), 'true');
    assert.deepEqual((await api('schema', created)).tables, [], 'Enter opens official Structure in the new database.');
    assert.equal(phpMyAdmin.some(url => url.searchParams.get('db')?.startsWith('postgres:')), false);
    await closeModal(); await ready(created); await page.locator('#database-select').selectOption(pg); await ready(pg);
    await selectWorkspaceLanguage(page, 'en');
    await openDatabaseTask(page, {task: 'create', engine: 'postgres', database: pg});
    assert.match(await manager.locator('#database-manager-unavailable').innerText(), /cannot create a new PostgreSQL database/);
    assert.equal(await manager.locator('#database-manager-name').count(), 0, 'Unsupported creation offers no misleading name field.');
    assert.equal(await manager.locator('#database-manager-continue').isEnabled(), true, 'An existing schema can open SQL.');
    await shot('pg-create-capability');
    await manager.locator('#database-manager-continue').click();
    await manager.waitFor({state: 'hidden'}); await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('[data-database-view="onderzoeken"]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#database-select').inputValue(), pg);
    assert.equal(preparations.length, 1, 'Opening PostgreSQL SQL never calls the MariaDB broker.');

    const nativeBeforePg = phpMyAdmin.length;
    await openDatabaseTask(page, {task: 'database', engine: 'postgres', database: pg, targetMode: 'existing'});
    assert.deepEqual(await manager.locator('#database-manager-target-mode option').evaluateAll(options => options.map(option => option.value)), ['existing']);
    assert.ok((await manager.locator('#database-manager-existing option').evaluateAll(options => options.map(option => option.value)))
        .every(value => value.startsWith('postgres:')), 'Only destinations for the chosen engine are listed.');
    await manager.locator('#database-manager-continue').click(); await manager.waitFor({state: 'hidden'});
    await modal.locator('#native-import-file').waitFor();
    assert.equal(await modal.locator('.database-toolbar').isVisible(), false);
    assert.equal(await modal.locator('#modal-full-import').isVisible(), false, 'PostgreSQL never offers phpMyAdmin.');
    assert.equal(await page.locator('#database-frame').getAttribute('src'), 'about:blank');
    assert.match(await modal.locator('.modal-import-source').innerText(), /PostgreSQL.*govern_pg\.public/s);
    await shot('pg-sql-import');
    await modal.locator('#native-import-file').setInputFiles({name: 'pg-preview.sql', mimeType: 'application/sql',
        buffer: Buffer.from('CREATE TABLE ' + previewTable + ' (id INTEGER);\n')});
    const sqlPreview = waitApi('native-import-preview'); await modal.locator('#native-import-preview').click();
    const sqlResponse = await sqlPreview; assertPgScope(sqlResponse);
    assert.equal((await sqlResponse.json()).ok, true);
    assert.equal(await modal.locator('#native-import-run').isDisabled(), true, 'Preview requires exact target confirmation.');
    assert.equal((await api('schema', pg)).tables.some(table => table.name === previewTable), false, 'SQL preview creates no table.');
    assert.equal(phpMyAdmin.length, nativeBeforePg);
    await modal.locator('#modal-change-destination').click(); await manager.waitFor();
    assert.equal(await manager.locator('#database-manager-existing').inputValue(), pg);
    assert.equal(await manager.locator('#database-manager-target-mode').inputValue(), 'existing');
    await manager.locator('#database-manager-cancel').click(); await manager.waitFor({state: 'hidden'});

    await openDatabaseTask(page, {task: 'table', engine: 'postgres', database: pg, submit: true});
    await modal.locator('#dataset-file').waitFor();
    await modal.locator('#dataset-file').setInputFiles({name: 'pg-preview.csv', mimeType: 'text/csv', buffer: Buffer.from('id,label\n001,Engine preview\n')});
    const csvPreview = waitApi('dataset-preview'); await modal.locator('#dataset-preview').click();
    const csvResponse = await csvPreview; assertPgScope(csvResponse);
    assert.equal((await csvResponse.json()).ok, true); await modal.locator('#dataset-table').waitFor();
    assert.ok(await modal.getByRole('cell', {name: '001', exact: true}).count());
    assert.equal(await modal.locator('#dataset-commit').isDisabled(), true);
    assert.equal(await page.locator('#database-frame').getAttribute('src'), 'about:blank');
    assert.equal(phpMyAdmin.length, nativeBeforePg); await closeModal();

    // UI-only metadata fixture: the real PostgreSQL server remains configured.
    const fixture = await context.newPage(); await fixture.setViewportSize({width: 320, height: 850});
    let fixtureMode = 'off';
    await fixture.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'bootstrap', async route => {
        const response = await route.fetch(), payload = await response.json();
        payload.data.engines = payload.data.engines.map(engine => engine.id === 'postgres'
            ? {...engine, configured: fixtureMode !== 'off', capabilities: {create_database: false, import: false, query: false, phpmyadmin: false}} : engine);
        await route.fulfill({response, json: payload});
    });
    await fixture.goto(href(original), {waitUntil: 'networkidle'});
    await fixture.locator('#manage-databases:not([disabled])').waitFor(); await selectWorkspaceLanguage(fixture, 'en');
    await fixture.goto(new URL('/workspace.php#instellingen?' + new URLSearchParams({database: original}), base).href);
    await fixture.locator('#preference-theme').selectOption('dark');
    await fixture.locator('#preference-reduceTransparency').check();
    await fixture.goto(href(original), {waitUntil: 'networkidle'});
    const unavailable = await openDatabaseTask(fixture, {task: 'database', engine: 'postgres'});
    assert.match(await unavailable.locator('#database-manager-unavailable').innerText(), /PostgreSQL is not connected/);
    assert.equal(await unavailable.locator('#database-manager-continue').isDisabled(), true);
    assert.equal(await unavailable.locator('#database-manager-existing').count(), 0);
    assert.equal(await fixture.locator('#database-select').inputValue(), original);
    assert.equal(await unavailable.evaluate(node => node.scrollWidth <= innerWidth), true);
    await shot('engine-not-configured-mobile', fixture);
    await fixture.keyboard.press('Escape'); await unavailable.waitFor({state: 'hidden'});
    fixtureMode = 'read-only';
    await fixture.reload({waitUntil: 'networkidle'});
    const readOnly = await openDatabaseTask(fixture, {task: 'table', engine: 'postgres'});
    assert.match(await readOnly.locator('#database-manager-unavailable').innerText(), /No import connection is configured/);
    assert.equal(await readOnly.locator('#database-manager-continue').isDisabled(), true);
    assert.equal(await fixture.locator('#database-select').inputValue(), original);
    assert.equal(await readOnly.evaluate(node => node.scrollWidth <= innerWidth), true);
    await shot('engine-read-only-mobile', fixture);
    await fixture.keyboard.press('Escape'); await readOnly.waitFor({state: 'hidden'}); await fixture.close();
    assert.deepEqual(errors, []);
    console.log('PASS: explicit engines, deferred changes, Back/language drafts, PG-to-MariaDB creation scope, Enter to official Structure, PG SQL/table previews and off/read-only UI metadata.');
} finally {
    if (owned && original && csrf && created.startsWith('govern_ui_engine_') && created.endsWith(suffix)) {
        try {await api('query', original, {sql: 'DROP DATABASE IF EXISTS `' + created + '`;', confirm: true});}
        catch { /* Keep the primary assertion visible; this fixture is isolated. */ }
    }
    await browser.close();
}
