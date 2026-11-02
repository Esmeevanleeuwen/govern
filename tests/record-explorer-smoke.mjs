/** Real read-only graph/table/explanation interaction against isolated fixtures. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local fixture stack.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [], failedApis = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    if (new URL(request.url()).pathname === '/api.php' && request.method() !== 'GET') mutations.push(request.method());
});
page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api.php' && response.status() >= 400) failedApis.push(url.searchParams.get('action'));
});
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (database, table = '') => new URL('/workspace.php#verkennen?' +
    new URLSearchParams({database, ...(table ? {table} : {})}), base).href;
const explorer = page.locator('[data-record-explorer]');
const node = label => page.locator('[data-explorer-node]').filter({hasText: label}).first();
const responseFor = condition => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === 'explore' && condition(url.searchParams);
});
const rootRecord = async label => {
    const value = await page.locator('#explorer-record option').evaluateAll((options, text) =>
        options.find(option => option.textContent.includes(text))?.value, label);
    assert.ok(value, 'A real candidate record is available: ' + label);
    await page.locator('#explorer-record').selectOption(value);
};
const loaded = async (database, label) => {
    await page.waitForFunction(key => document.getElementById('database-select')?.value === key, database);
    await node(label).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-record-explorer]')?.getAttribute('aria-busy') !== 'true');
};
const screenshot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), fullPage: true});
};

try {
    const first = responseFor(params => params.get('table') === 'demo_organizations');
    await page.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'});
    const initialResponse = await first;
    assert.equal(initialResponse.status(), 200);
    const initial = (await initialResponse.json()).data;
    await loaded(publicKey, 'Northbridge Council');
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_organizations');
    assert.equal(await page.locator('#open-database').isDisabled(), true);
    assert.equal(await page.locator('#add-row, [data-row-action]').count(), 0);
    assert.ok(await page.locator('[data-explorer-row]').count() > 1, 'Linked records are listed beneath the graph.');

    const portal = initial.nodes.find(item => item.table === 'demo_systems' && item.key.id === '1');
    assert.ok(portal, 'The returned neighborhood includes the actual portal record.');
    await node('Resident Services Portal').click();
    assert.equal(await page.locator(`[data-explorer-node="${portal.id}"]`).getAttribute('data-selected'), 'true');
    assert.equal(await page.locator(`[data-explorer-row="${portal.id}"]`).getAttribute('data-selected'), 'true');
    assert.equal(await page.locator(`[data-explorer-row="${portal.id}"]`).evaluate(row => {
        const scroller = row.closest('.table-scroll'), record = row.getBoundingClientRect();
        const frame = scroller.getBoundingClientRect(), header = scroller.querySelector('thead').getBoundingClientRect();
        return record.top >= frame.top + header.height - 1 && record.bottom <= frame.bottom + 1;
    }), true, 'Graph selection reveals the selected record within the scrollable list.');
    await page.locator('#explorer-detail').getByText('Resident Services Portal', {exact: true}).first().waitFor();
    assert.ok((await page.locator('#explorer-detail').textContent()).includes('annual_budget'), 'Selected record fields are inspectable.');

    const center = initial.nodes.find(item => item.id === initial.center);
    await page.locator(`[data-explorer-row="${center.id}"] button`).first().click();
    assert.equal(await page.locator(`[data-explorer-node="${center.id}"]`).getAttribute('data-selected'), 'true',
        'Selecting a row selects the corresponding graph record.');
    const ownership = initial.edges.find(edge => edge.source === portal.id && edge.target === center.id);
    assert.ok(ownership, 'The portal ownership edge is real.');
    const edge = page.locator(`[data-explorer-edge="${ownership.id}"]`);
    await edge.focus();
    await edge.press('Enter');
    const evidence = page.locator(`[data-explorer-evidence="${ownership.id}"]`);
    await evidence.waitFor();
    assert.ok((await evidence.textContent()).includes('owner_organization_id')
        && (await evidence.textContent()).includes('demo_organizations'), 'Keyboard edge selection explains the actual foreign-key columns.');
    assert.ok((await evidence.textContent()).includes('1'), 'Relationship evidence shows the matching record-key value.');

    const relation = initial.relations.find(item => item.source_table === 'demo_systems'
        && item.target_table === 'demo_organizations' && item.columns.includes('owner_organization_id'));
    assert.ok(relation, 'Ownership is an available relationship filter.');
    const relationshipPanel = page.locator('#explorer-relationships');
    if (await relationshipPanel.count() && !(await relationshipPanel.evaluate(element => element.open))) {
        await relationshipPanel.locator('summary').click();
    }
    await page.locator(`[data-explorer-relation="${relation.id}"]`).uncheck();
    assert.equal(await page.locator(`[data-explorer-edge="${ownership.id}"]`).count(), 0, 'A relationship filter updates the graph.');
    assert.equal(await page.locator(`[data-explorer-node="${center.id}"]`).getAttribute('data-selected'), 'true',
        'Hiding the selected relationship leaves a valid focus-record selection.');
    await page.locator(`[data-explorer-relation="${relation.id}"]`).check();
    await page.locator(`[data-explorer-edge="${ownership.id}"]`).waitFor();

    const unfilteredRows = await page.locator('[data-explorer-row]').count();
    await page.locator('#explorer-filter').fill('Resident Services Portal');
    assert.equal(await page.locator('[data-explorer-row]').count(), 2,
        'Text filtering keeps the matching record and its focus context.');
    await node('Resident Services Portal').waitFor();
    await node('Northbridge Council').waitFor();
    await page.locator('#explorer-filter').fill('');
    assert.equal(await page.locator('[data-explorer-row]').count(), unfilteredRows);

    await node('Resident Services Portal').click();
    const expanded = responseFor(params => params.get('table') === 'demo_systems' && params.has('key'));
    await page.locator('#explorer-expand').click();
    assert.equal((await expanded).status(), 200);
    await loaded(publicKey, 'Resident Services Portal');
    await node('Plain-language service pages').waitFor();
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_systems', 'Expanding follows a selected record into its own table.');
    await screenshot('record-explorer-desktop');

    const organizations = responseFor(params => params.get('table') === 'demo_organizations');
    await page.locator('#explorer-table').selectOption('demo_organizations');
    await organizations;
    await loaded(publicKey, 'Northbridge Council');
    await rootRecord('Riverside Council');
    await loaded(publicKey, 'Riverside Council');
    const selectedBeforeLanguage = await page.locator('#explorer-record').inputValue();
    await page.getByLabel('Starting table', {exact: true}).waitFor();
    await page.locator('#language-select').selectOption('nl');
    await loaded(publicKey, 'Riverside Council');
    assert.equal(await page.locator('#explorer-record').inputValue(), selectedBeforeLanguage, 'Language changes preserve the selected root record.');
    await page.getByLabel('Begintabel', {exact: true}).waitFor();
    await page.locator('#language-select').selectOption('en');
    await loaded(publicKey, 'Riverside Council');

    // Each scope remembers its database tab. Establish Explore for archive in
    // the same document before the picker restores that scope during the race.
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(archiveKey, 'govern_pg_values')).hash);
    await loaded(archiveKey, 'Archive-only row');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(publicKey, 'demo_organizations')).hash);
    await loaded(publicKey, 'Riverside Council');

    // Hold a completed public read beyond a schema switch. The released result
    // must never replace the archive graph or its selected record.
    let markHeld, releaseOld;
    const held = new Promise(resolve => { markHeld = resolve; });
    const release = new Promise(resolve => { releaseOld = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'explore'
        && url.searchParams.get('schema') === 'public' && url.searchParams.get('table') === 'demo_organizations'
        && JSON.parse(url.searchParams.get('key') || '{}').id === '1', async route => {
        const response = await route.fetch();
        markHeld();
        await release;
        try { await route.fulfill({response}); } catch { /* Scope changes can abort the held read. */ }
    });
    await rootRecord('Northbridge Council');
    await held;
    await page.locator('#database-select').selectOption(archiveKey);
    await loaded(archiveKey, 'Archive-only row');
    releaseOld();
    await page.waitForLoadState('networkidle');
    assert.equal((await explorer.textContent()).includes('Northbridge Council'), false,
        'Late results from another schema do not replace the active graph.');
    await page.unrouteAll({behavior: 'wait'});

    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark('bestuursatlas', 'organizations')).hash);
    await page.waitForFunction(() => document.getElementById('database-select')?.value === 'bestuursatlas');
    await page.locator('[data-explorer-node]').first().waitFor();
    assert.equal((await explorer.textContent()).includes('Archive-only row'), false, 'MariaDB has its own graph selection.');
    assert.equal(await page.locator('#open-database').isEnabled(), true);

    await page.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'});
    await loaded(publicKey, 'Riverside Council');
    await rootRecord('Northbridge Council');
    await loaded(publicKey, 'Northbridge Council');
    await page.setViewportSize({width: 320, height: 800});
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    await node('Resident Services Portal').focus();
    await page.keyboard.press('Enter');
    await page.locator('#explorer-detail').getByText('Resident Services Portal', {exact: true}).first().waitFor();
    await screenshot('record-explorer-mobile');
    await page.reload({waitUntil: 'networkidle'});
    await loaded(publicKey, 'Northbridge Council');
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_organizations', 'The Explore bookmark survives reload.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The explorer fits a 320px viewport.');

    const empty = responseFor(params => params.get('table') === 'demo_project_overview');
    await page.locator('#explorer-table').selectOption('demo_project_overview');
    assert.equal((await empty).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-record-explorer]')?.getAttribute('aria-busy') !== 'true');
    assert.equal(await page.locator('[data-explorer-node]').count(), 0, 'A view without a stable key has an honest empty graph.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    assert.deepEqual(failedApis, [], 'The read-only UI makes no rejected API calls.');
    assert.deepEqual(mutations, [], 'Every data request from Explore is a GET.');
    console.log('PASS: record graph/table synchronization, exact relationship evidence, filters, expansion, scope isolation, language, keyboard and mobile.');
} finally {
    await context.close();
    await browser.close();
}
