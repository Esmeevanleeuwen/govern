/** A pre-upgrade cached API module must not break PostgreSQL selection. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
// Keep the actual module shipped at d213824, not a mock of today's URL builder.
const legacyApi = await readFile(new URL('./fixtures/api-before-postgres.js', import.meta.url), 'utf8');
await context.route(url => url.pathname === '/assets/api.js', route => route.fulfill({contentType: 'text/javascript', body: legacyApi}));
const page = await context.newPage();
const errors = [], failedApis = [], packedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname !== '/api.php') return;
    if (response.status() >= 400) failedApis.push(url.searchParams.get('action'));
    if (url.searchParams.get('database')?.startsWith('postgres:')) packedRequests.push(url);
});
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (view, database, table = '') => new URL('/workspace.php#' + view + '?' +
    new URLSearchParams({database, ...(table ? {table} : {})}), base).href;
const loaded = async (key, text) => {
    await page.waitForFunction(value => document.querySelector('#database-select')?.value === value, key);
    await page.locator('.data-table tbody tr').filter({hasText: text}).first().waitFor();
};

try {
    await page.goto(bookmark('gegevens', 'bestuursatlas', 'organizations'), {waitUntil: 'networkidle'});
    await page.locator('#data-search').waitFor();
    const selected = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'bootstrap'
            && url.searchParams.get('database') === publicKey;
    });
    await page.locator('#database-select').selectOption(publicKey);
    const bootstrap = await selected;
    assert.equal(bootstrap.status(), 200, 'A cached client can open the PostgreSQL picker entry.');
    assert.equal((await bootstrap.json()).data.database.connection, 'postgres');
    await page.goto(bookmark('gegevens', publicKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await loaded(publicKey, 'literal%_value');
    await page.evaluate(async database => {
        const {openRecordWindow} = await import('/assets/record-window.js');
        openRecordWindow({database, table: 'govern_pg_values', key: {id: '9007199254740993'}});
    }, publicKey);
    const recordWindow = page.locator('dialog.record-window').last();
    await recordWindow.locator('.record-window-content').waitFor();
    assert.equal(await recordWindow.getAttribute('data-record-scope'), publicKey);
    assert.ok((await recordWindow.locator('.record-window-scope').textContent()).includes('public'),
        'A new record window decodes its captured scope while the pre-upgrade request module is cached.');
    assert.ok((await recordWindow.textContent()).includes('literal%_value'), 'The old client still reads the exact captured record.');
    await recordWindow.locator('.modal-shell-close').click();
    assert.equal(await page.locator('#open-database').isEnabled(), true, 'PostgreSQL database tools remain available for SQL.');
    await page.goto(bookmark('schema', publicKey), {waitUntil: 'networkidle'});
    await page.locator('[data-schema-node="govern_pg_child"]').waitFor();
    await page.goto(bookmark('gegevens', publicKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await loaded(publicKey, 'literal%_value');
    await page.locator('#database-select').selectOption(archiveKey);
    await page.waitForFunction(key => document.querySelector('#database-select')?.value === key
        && !document.querySelector('#database-select').disabled, archiveKey);
    await page.locator('.catalog-item[title="govern_pg_values"]').click();
    await loaded(archiveKey, 'Archive-only row');
    assert.equal((await page.locator('.data-table').textContent()).includes('literal%_value'), false);
    await page.locator('#database-select').selectOption(publicKey);
    await loaded(publicKey, 'literal%_value');
    await page.reload({waitUntil: 'networkidle'});
    await loaded(publicKey, 'literal%_value');
    const returned = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'bootstrap'
            && url.searchParams.get('database') === 'bestuursatlas';
    });
    await page.locator('#database-select').selectOption('bestuursatlas');
    assert.equal((await (await returned).json()).data.database.connection, 'mariadb');
    await page.locator('#data-search').waitFor();
    assert.equal(await page.locator('#open-database').isEnabled(), true);
    assert.ok(['bootstrap', 'browse', 'schema'].every(action => packedRequests.some(url => url.searchParams.get('action') === action)),
        'The frozen client exercised real PostgreSQL bootstrap, data and metadata reads.');
    assert.ok(packedRequests.every(url => !url.searchParams.has('connection') && !url.searchParams.has('schema')),
        'The regression uses the previous module format rather than current explicit scopes.');
    assert.deepEqual(failedApis, [], 'Cached-client reads do not cause rejected API calls.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: cached pre-PostgreSQL API selection, real rows, schema switching, reload and MariaDB recovery.');
} finally {
    await context.close();
    await browser.close();
}
