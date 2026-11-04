/** Browse the optional fictional PostgreSQL dataset through the real workspace. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local test stack.');
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
const key = 'postgres:govern_pg:public';
const bookmark = (view, table = '') => new URL('/workspace.php#' + view + '?' +
    new URLSearchParams({database: key, ...(table ? {table} : {})}), base).href;
const row = text => page.locator('.data-table tbody tr').filter({hasText: text}).first();

try {
    await page.goto(bookmark('gegevens', 'demo_systems'), {waitUntil: 'networkidle'});
    await row('Resident Services Portal').waitFor();
    assert.equal(await page.locator('#database-select').inputValue(), key);
    assert.equal(await page.locator('[data-postgres-editing]').count(), 1);
    assert.equal(await page.locator('#open-database').isEnabled(), true, 'PostgreSQL database tools remain available for SQL.');
    assert.equal(await page.locator('#add-row').count(), 1);
    assert.ok(await page.locator('[data-row-action="edit"]').count() > 0);

    await page.goto(bookmark('schema'), {waitUntil: 'networkidle'});
    for (const name of ['demo_organizations', 'demo_systems', 'demo_projects', 'demo_contacts', 'demo_project_participants']) {
        await page.locator('[data-schema-node="' + name + '"]').waitFor();
    }
    const links = await page.locator('path.schema-edge').evaluateAll(edges => edges.filter(edge =>
        edge.dataset.sourceTable?.startsWith('demo_')).map(edge =>
        [edge.dataset.sourceTable, edge.dataset.sourceColumn, edge.dataset.targetTable, edge.dataset.targetColumn].join(':')));
    assert.deepEqual(links.sort(), [
        'demo_systems:owner_organization_id:demo_organizations:id',
        'demo_projects:system_id:demo_systems:id',
        'demo_projects:lead_organization_id:demo_organizations:id',
        'demo_contacts:organization_id:demo_organizations:id',
        'demo_project_participants:project_id:demo_projects:id',
        'demo_project_participants:organization_id:demo_organizations:id',
    ].sort(), 'All six real foreign-key links appear in the diagram.');

    await page.goto(bookmark('gegevens', 'demo_project_overview'), {waitUntil: 'networkidle'});
    await row('Accessible online applications').waitFor();
    const overview = await row('Accessible online applications').textContent();
    assert.ok(overview.includes('Resident Services Portal') && overview.includes('Northbridge Council'),
        'The actual SQL view joins project, system and lead-organization records.');
    await page.reload({waitUntil: 'networkidle'});
    await row('Accessible online applications').waitFor();
    assert.equal(await page.locator('#database-select').inputValue(), key);
    assert.deepEqual(failedApis, [], 'Example browsing never requests an unsupported action.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: PostgreSQL sample records, five linked tables, six diagram links, joined overview and reload.');
} finally {
    await context.close();
    await browser.close();
}
