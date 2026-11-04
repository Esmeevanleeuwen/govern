/** Screen -> multipart API -> isolated MariaDB -> visible preview/readback. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {authenticatedContext} from './auth-session.mjs';
import {clickWorkspaceTool} from './workspace-tools.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable local stack.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args, ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'nl-NL'});
const page = await context.newPage();
const database = 'bestuursatlas';
const name = 'zz_dataset_ui_' + Date.now().toString(16);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let scope, releasePreview;
const bounded = async promise => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('The dataset preview request was not intercepted.')), 10000);
        })]);
    } finally { clearTimeout(timer); }
};
try {
    await page.goto(new URL('/workspace.php#gegevens?' + new URLSearchParams({database}), base).href);
    await page.locator('#open-database:not([disabled])').waitFor({state: 'attached'});
    scope = await page.evaluate(async database => (await (await fetch('/api.php?' + new URLSearchParams({action: 'bootstrap', database}))).json()).data, database);
    assert.equal(scope.database.name, database);
    assert.equal(scope.database.engine, 'mariadb');
    await clickWorkspaceTool(page, '#open-database');
    await page.locator('#database-tab-dataset').click();
    await page.locator('#dataset-file').setInputFiles({name: 'media.csv', mimeType: 'text/csv', buffer: Buffer.from('ID;Title\n001;First\n002;Second\n')});
    let intercepted;
    const previewWaiting = new Promise(resolve => { intercepted = resolve; });
    const previewGate = new Promise(resolve => { releasePreview = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'dataset-preview', async route => {
        const request = route.request();
        intercepted({url: request.url(), method: request.method(), contentType: request.headers()['content-type']});
        await previewGate; await route.continue();
    }, {times: 1});
    await page.getByRole('button', {name: 'Importvoorbeeld bekijken', exact: true}).click();
    const captured = await bounded(previewWaiting);
    assert.equal(new URL(captured.url).searchParams.get('database'), database, 'The held upload keeps its explicit MariaDB scope.');
    assert.equal(new URL(captured.url).searchParams.get('connection') || 'mariadb', 'mariadb');
    assert.equal(captured.method, 'POST');
    assert.match(captured.contentType, /^multipart\/form-data;/);
    const dialog = page.locator('#database-dialog');
    for (const selector of ['#modal-database', '#modal-table']) {
        assert.equal(await dialog.locator(selector).isDisabled(), true, 'The source cannot change during a dataset preview.');
    }
    assert.equal(await dialog.getByRole('button', {name: 'Sluiten', exact: true}).isDisabled(), true);
    for (const tab of await dialog.locator('[role="tab"]').all()) assert.equal(await tab.isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true, 'Escape cannot dismiss an active upload.');
    assert.equal(await page.locator('#database-tab-dataset').getAttribute('aria-selected'), 'true');
    releasePreview(); releasePreview = null;
    await page.locator('#dataset-table').waitFor();
    assert.match(await page.locator('#dataset-import-panel').innerText(), /2 rijen · 2 kolommen/);
    assert.ok(await page.getByRole('cell', {name: '001', exact: true}).count());
    await page.locator('#dataset-table').fill(name);
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    assert.equal(await page.locator('#dataset-table').inputValue(), name);
    await page.locator('#dataset-confirmation').fill(scope.database.name);
    await dialog.getByRole('button', {name: 'Import', exact: true}).click();
    await page.getByText('2 rows imported into', {exact: false}).waitFor();
    const readback = await page.evaluate(async ({name, database}) => (await (await fetch('/api.php?' + new URLSearchParams({action: 'browse', database, table: name}))).json()), {name, database: scope.database.name});
    assert.equal(readback.ok, true);
    assert.equal(readback.data.rows.length, 2);
    assert.equal(readback.data.rows[0].id, '001');
    const csrfStatus = await page.evaluate(async database => {
        const body = new FormData(); body.append('file', new File(['id\n1\n'], 'a.csv'));
        return (await fetch('/api.php?' + new URLSearchParams({action: 'dataset-preview', database}), {method: 'POST', body})).status;
    }, scope.database.name);
    assert.equal(csrfStatus, 403);
    await page.setViewportSize({width: 320, height: 750});
    assert.equal(await page.locator('#database-tab-dataset').isVisible(), true);
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page.locator('#database-dialog').waitFor({state: 'hidden'});
    assert.deepEqual(errors, []);
    console.log('PASS: upload, preview, retained draft/language, create, readback, CSRF and modal exit.');
} finally {
    releasePreview?.();
    if (scope) await page.evaluate(async ({name, scope}) => {
        await fetch('/api.php?' + new URLSearchParams({action: 'query', database: scope.database.name}), {
            method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': scope.csrf},
            body: JSON.stringify({sql: 'DROP TABLE IF EXISTS `' + name + '`', confirm: true}),
        });
    }, {name, scope});
    await context.close();
    await browser.close();
}
