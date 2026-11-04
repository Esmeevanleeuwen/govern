import {selectWorkspaceSchema} from './workspace-tools.mjs';
/** PostgreSQL browsing and schema switching against disposable fixtures. */
import assert from 'node:assert/strict';
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
const page = await context.newPage();
const errors = [], failedApis = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api.php' && response.status() >= 400) failedApis.push(url.searchParams.get('action'));
});
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (view, database, table = '') => new URL('/workspace.php#' + view + '?' +
    new URLSearchParams({database, ...(table ? {table} : {})}), base).href;
const row = text => page.locator('.data-table tbody tr').filter({hasText: text});
const loaded = async (key, text) => {
    await page.waitForFunction(value => document.querySelector('#database-select')?.value === value, key);
    await page.locator('#data-search').waitFor();
    await row(text).first().waitFor();
};
try {
    await page.goto(bookmark('gegevens', publicKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await loaded(publicKey, 'literal%_value');
    assert.equal(await page.locator('[data-postgres-editing]').count(), 1);
    assert.equal(await page.locator('#open-database').isVisible(), false, 'Advanced MariaDB tools stay hidden for PostgreSQL.');
    assert.equal(await page.locator('#add-row').count(), 1);
    assert.ok(await page.locator('[data-row-action="edit"]').count() > 0);
    assert.equal(await page.locator('#context-export').evaluate(link => link.hidden), true,
        'PostgreSQL disables export independently of whether Tools is open.');
    assert.equal(await page.locator('[data-area="research"]').isVisible(), true);
    assert.equal(await page.locator('[data-area="experiments"]').isVisible(), false);
    assert.ok((await row('literal%_value').first().textContent()).includes('123456789012345678901234.12'));
    const searched = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'browse'
            && url.searchParams.get('schema') === 'public' && url.searchParams.get('q') === '%_';
    });
    await page.locator('#data-search').fill('%_');
    await searched;
    await row('literal%_value').first().waitFor();
    await selectWorkspaceSchema(page, 'archive');
    await page.waitForFunction(key => document.querySelector('#database-select')?.value === key
        && !document.querySelector('#database-select').disabled, archiveKey);
    await page.locator('.catalog-item[title="govern_pg_values"]').click();
    await loaded(archiveKey, 'Archive-only row');
    assert.equal(await page.locator('#data-search').inputValue(), '', 'Schema searches stay separate.');
    assert.equal((await page.locator('.data-table').textContent()).includes('literal%_value'), false);
    await selectWorkspaceSchema(page, 'public');
    await loaded(publicKey, 'literal%_value');
    assert.equal(await page.locator('#data-search').inputValue(), '%_', 'Returning restores the public search draft.');
    // A completed public-schema read held beyond a switch must not replace
    // the archive rows when its old response is released.
    let releaseOld, markHeld;
    const held = new Promise(resolve => { markHeld = resolve; });
    const release = new Promise(resolve => { releaseOld = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'browse'
        && url.searchParams.get('schema') === 'public' && url.searchParams.get('q') === 'Second', async route => {
        const response = await route.fetch();
        markHeld();
        await release;
        try { await route.fulfill({response}); } catch { /* Aborted old reads can already be closed. */ }
    });
    await page.locator('#data-search').fill('Second');
    await held;
    await selectWorkspaceSchema(page, 'archive');
    await loaded(archiveKey, 'Archive-only row');
    releaseOld();
    await page.waitForLoadState('networkidle');
    assert.equal((await page.locator('.data-table').textContent()).includes('Second row'), false,
        'Late public-schema results cannot overwrite archive records.');
    await page.unrouteAll({behavior: 'wait'});
    await page.goto(bookmark('schema', publicKey), {waitUntil: 'networkidle'});
    await page.locator('[data-schema-node="govern_pg_child"]').waitFor();
    const pairs = await page.locator('path.schema-edge').evaluateAll(edges => edges.filter(edge =>
        edge.dataset.sourceTable === 'govern_pg_child').map(edge =>
        [edge.dataset.sourceColumn, edge.dataset.targetTable, edge.dataset.targetColumn].join(':')));
    assert.deepEqual(pairs.sort(), ['parent_id:govern_pg_parent:id', 'tenant_id:govern_pg_parent:tenant_id'].sort());
    await page.reload({waitUntil: 'networkidle'});
    assert.equal(await page.locator('#database-select').inputValue(), publicKey, 'Scoped bookmarks survive reload.');
    await page.goto(bookmark('onderzoeken', publicKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('.query-builder').count(), 0);
    assert.equal(await page.locator('#save-research').count(), 0);
    assert.equal(await page.locator('[data-capability-unavailable]').count(), 0);
    await page.goto(bookmark('experimenten', publicKey), {waitUntil: 'networkidle'});
    await page.locator('#create-snapshot').waitFor();
    assert.equal(await page.locator('[data-capability-unavailable]').count(), 0);
    await page.goto(bookmark('gegevens', 'bestuursatlas', 'organizations'), {waitUntil: 'networkidle'});
    await page.locator('#data-search').waitFor();
    assert.equal(await page.locator('#database-select').inputValue(), 'bestuursatlas');
    assert.equal(await page.locator('#open-database').isEnabled(), true);
    assert.equal(await page.locator('#add-row').count(), 1);
    await page.setViewportSize({width: 360, height: 800});
    await page.goto(bookmark('gegevens', archiveKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await loaded(archiveKey, 'Archive-only row');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, [], 'No browser exceptions.');
    assert.deepEqual(failedApis, [], 'The UI never calls unsupported PostgreSQL APIs.');
    console.log('PASS: PostgreSQL values, schema/search isolation, diagram, capability controls, mobile and MariaDB switching.');
} finally {
    await context.close();
    await browser.close();
}
