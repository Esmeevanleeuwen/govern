/** Real record graph, source inspector and state isolation in a disposable stack. */
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
let releaseHeld;
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api.php' && response.status() >= 400) failedApis.push(url.searchParams.get('action'));
});
const rootKey = {id: '9007199254740993'};
const pgPublic = 'postgres:govern_pg:public', pgArchive = 'postgres:govern_pg:archive';
const bookmark = new URL('/workspace.php#verbanden?' + new URLSearchParams({database: 'bestuursatlas', table: 'zz_record_map_people'}), base);
const inspection = page.locator('#record-map-inspector');
const graphNodes = page.locator('[data-record-node]');
const graphEdges = page.locator('[data-record-edge]');
const count = async (locator, value, message) => {
    await page.waitForFunction(({selector, expected}) => document.querySelectorAll(selector).length === expected,
        {selector: locator === graphNodes ? '[data-record-node]' : '[data-record-edge]', expected: value});
    assert.equal(await locator.count(), value, message);
};
const api = async (action, scope, body) => {
    const url = new URL('/api.php', base);
    url.search = new URLSearchParams({action, ...scope});
    const response = body ? await context.request.post(url.href, {
        headers: {'X-CSRF-Token': (await (await context.request.get(new URL('/auth-api.php?action=status', base).href)).json()).data.csrf}, data: body,
    }) : await context.request.get(url.href);
    const result = await response.json();
    assert.ok(response.ok() && result.ok, 'Fixture metadata must be readable through the real API.');
    return result.data;
};
const mapResponse = (scope, relation) => page.waitForResponse(response => {
    const url = new URL(response.url());
    if (url.pathname !== '/api.php' || url.searchParams.get('action') !== 'record-map') return false;
    const payload = response.request().postDataJSON();
    return (url.searchParams.get('connection') || 'mariadb') === scope && payload?.relation === relation;
});
const selectScope = async value => {
    await page.locator('#database-select').selectOption(value);
    try {
        await page.waitForFunction(key => document.querySelector('#database-select')?.value === key
            && !document.querySelector('#database-select')?.disabled && !document.querySelector('#refresh-app')?.disabled, value);
        // Each database restores its own last Database view; a new scope starts in Data.
        if (!await page.locator('#record-map-table').count()) await page.locator('[data-database-view="verbanden"]').click();
        await page.locator('#record-map-table').waitFor();
    } catch (error) {
        console.error('Record-map scope navigation failed:', {expected: value, ...await page.evaluate(() => ({
            url: location.href, selected: document.querySelector('#database-select')?.value,
            switching: document.querySelector('#database-select')?.disabled,
            refreshing: document.querySelector('#refresh-app')?.disabled,
            mapPresent: Boolean(document.querySelector('#record-map-table')),
        }))});
        throw error;
    }
};
const seed = label => page.locator('#record-map-records [data-map-record]').filter({hasText: label}).first();
const selectSeed = async label => {
    await seed(label).waitFor();
    await seed(label).click();
    await inspection.locator('[data-map-open-table]').waitFor();
    await page.waitForFunction(text => document.querySelector('#record-map-inspector h3')?.textContent.includes(text), label);
};
const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A held map response was never reached.')), 15000); })]); }
    finally { clearTimeout(timer); }
};
try {
    const scope = {database: 'bestuursatlas'};
    const info = await api('record-map', scope, {table: 'zz_record_map_people', key: rootKey});
    const incoming = info.relations.find(item => item.constraint === 'zz_record_map_project_lead' && item.direction === 'incoming');
    const external = info.relations.find(item => item.constraint === 'zz_record_map_people_external');
    await page.goto(bookmark.href, {waitUntil: 'networkidle'});
    await page.locator('#record-map-search').fill('%_');
    await selectSeed('Atlas%_');
    await count(graphNodes, 1);
    assert.equal(await page.locator('[data-record-node="' + info.focus.id + '"]').count(), 1);
    assert.ok((await inspection.textContent()).includes('123456789012345678901234.12'));
    assert.ok((await inspection.textContent()).includes('<img src=x onerror="window.mapInjected=1">'));
    assert.equal(await inspection.locator('img').count(), 0, 'Source values never become HTML elements.');
    assert.equal(await page.evaluate(() => window.mapInjected), undefined);
    assert.equal(await page.locator('[data-record-relation="' + external.id + '"]').isDisabled(), true, 'External-schema links are visible without enabling a scope escape.');
    const expanded = mapResponse('mariadb', incoming.id);
    await page.locator('[data-record-relation="' + incoming.id + '"]').click();
    const relationPayload = (await (await expanded).json()).data;
    await count(graphNodes, 3);
    await count(graphEdges, 2);
    assert.equal(await page.locator('[data-record-relation="' + incoming.id + '"]').isDisabled(), true);
    const edge = relationPayload.edges[0];
    await page.locator('[data-record-edge="' + edge.id + '"]').focus();
    await page.locator('[data-record-edge="' + edge.id + '"]').press('Enter');
    await inspection.locator('[data-map-sql]').waitFor();
    await inspection.locator('[data-map-sql] summary').click();
    assert.ok((await inspection.textContent()).includes('zz_record_map_project_lead'));
    assert.ok((await inspection.textContent()).includes('lead_id'));
    assert.ok((await inspection.locator('[data-map-sql]').textContent()).includes('SELECT'));
    assert.ok((await inspection.locator('[data-map-sql]').textContent()).includes(rootKey.id));
    await page.locator('[data-map-entity-filter="zz_record_map_projects"]').uncheck();
    await count(graphNodes, 1);
    await count(graphEdges, 0);
    await page.locator('[data-map-entity-filter="zz_record_map_projects"]').check();
    await count(graphNodes, 3);
    await count(graphEdges, 2);
    await page.locator('[data-record-node="' + info.focus.id + '"]').focus();
    await page.locator('[data-record-node="' + info.focus.id + '"]').press('Enter');
    await page.locator('[data-map-open-table="zz_record_map_people"]').click();
    await page.locator('#selected-source-record .data-table').waitFor();
    assert.ok((await page.locator('#selected-source-record').textContent()).includes(rootKey.id), 'The source table opens with the exact selected record.');
    await page.locator('[data-database-view="verbanden"]').click();
    await count(graphNodes, 3);
    assert.equal(await page.locator('#record-map-search').inputValue(), '%_', 'View switching preserves the graph search.');
    await page.locator('#language-select').selectOption('nl');
    await page.waitForFunction(() => document.querySelector('[data-database-view="verbanden"]')?.textContent.includes('Verbanden'));
    await count(graphNodes, 3);
    await page.locator('#language-select').selectOption('en');
    await selectScope(pgPublic);
    await page.locator('#record-map-table').selectOption('zz_record_map_people');
    await count(graphNodes, 0, 'A PostgreSQL scope starts with a separate graph.');
    await selectSeed('Atlas%_');
    const pgId = await graphNodes.first().getAttribute('data-record-node');
    assert.notEqual(pgId, info.focus.id, 'Equal table/key names across engines are distinct nodes.');
    await selectScope(pgArchive);
    await page.locator('#record-map-table').selectOption('zz_record_map_people');
    await selectSeed('Archive-only record');
    const archiveId = await graphNodes.first().getAttribute('data-record-node');
    assert.notEqual(archiveId, pgId, 'Equal table/key names across schemas remain distinct.');
    await selectScope(pgPublic);
    await page.locator('#record-map-search').fill('');
    await seed('Beta').waitFor();
    let releaseOld, markHeld;
    const held = new Promise(resolve => { markHeld = resolve; });
    const released = new Promise(resolve => { releaseOld = releaseHeld = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
        && url.searchParams.get('schema') === 'public', async route => {
        const payload = route.request().postDataJSON();
        if (payload?.key?.id !== '9007199254740994') return route.continue();
        const response = await route.fetch(); markHeld(); await released;
        try { await route.fulfill({response}); } catch { /* The original read may already be aborted. */ }
    });
    await seed('Beta').click();
    await bounded(held);
    await selectScope(pgArchive);
    releaseOld();
    await page.unrouteAll({behavior: 'wait'});
    await count(graphNodes, 1);
    assert.equal(await graphNodes.first().getAttribute('data-record-node'), archiveId, 'An old inspection cannot overwrite a different schema.');
    await selectScope('bestuursatlas');
    await count(graphNodes, 3);
    assert.equal(await page.locator('#record-map-search').inputValue(), '%_');
    await page.locator('#record-map-table').selectOption('zz_record_map_projects');
    await page.locator('[data-database-view="gegevens"]').click();
    await page.locator('.table-heading h2').filter({hasText: 'zz_record_map_projects'}).waitFor();
    assert.equal(await page.locator('.table-heading h2').innerText(), 'zz_record_map_projects', 'Changing the map table updates the shared Data destination.');
    assert.equal(await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('table')), 'zz_record_map_projects');
    await page.locator('[data-database-view="verbanden"]').click();
    assert.equal(await page.locator('#record-map-table').inputValue(), 'zz_record_map_projects');
    await page.locator('#record-map-table').selectOption('zz_record_map_people');
    await page.locator('[data-record-node="' + info.focus.id + '"]').focus();
    await page.locator('[data-record-node="' + info.focus.id + '"]').press('Enter');
    const refreshSource = () => inspection.getByRole('button', {name: 'Read source again', exact: true});
    let reread = mapResponse('mariadb', undefined);
    await refreshSource().click();
    await reread;
    await count(graphEdges, 0, 'Re-reading a source removes its previously expanded evidence.');
    await page.waitForFunction(id => !document.querySelector('[data-record-relation="' + id + '"]')?.disabled, incoming.id);
    let releaseExpansion, markExpansionHeld;
    const expansionHeld = new Promise(resolve => { markExpansionHeld = resolve; });
    const expansionReleased = new Promise(resolve => { releaseExpansion = releaseHeld = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map'
        && url.searchParams.get('database') === 'bestuursatlas', async route => {
        if (route.request().postDataJSON()?.relation !== incoming.id) return route.continue();
        const response = await route.fetch(); markExpansionHeld(); await expansionReleased;
        try { await route.fulfill({response}); } catch { /* Re-reading may already have aborted this expansion. */ }
    });
    await page.locator('[data-record-relation="' + incoming.id + '"]').click();
    await bounded(expansionHeld);
    reread = mapResponse('mariadb', undefined);
    await refreshSource().click();
    await reread;
    await page.waitForFunction(id => !document.querySelector('[data-record-relation="' + id + '"]')?.disabled, incoming.id);
    releaseExpansion();
    await page.unrouteAll({behavior: 'wait'});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await count(graphEdges, 0, 'A held expansion cannot restore evidence after the source is re-read.');
    assert.equal(await page.locator('[data-record-relation="' + incoming.id + '"]').isDisabled(), false,
        'An obsolete expansion cannot mark the refreshed relation as complete.');
    await page.locator('#record-map-table').selectOption('zz_record_map_no_identity');
    await page.locator('#record-map-records .notice').waitFor();
    assert.equal(await page.locator('#record-map-records [data-map-record]').count(), 0);
    await page.setViewportSize({width: 360, height: 800});
    await page.locator('#record-map-table').selectOption('zz_record_map_people');
    await page.locator('#record-map-fit').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Map, controls and source inspector fit a mobile screen.');
    await page.locator('#record-map-clear').click();
    await count(graphNodes, 0);
    await count(graphEdges, 0);
    assert.deepEqual(errors, [], 'Map workflows have no browser exceptions.');
    assert.deepEqual(failedApis, [], 'Map UI calls only supported scoped endpoints.');
    console.log('PASS: record map seeds, real connections, evidence, exact source rows, filters, scope isolation, delayed reads, language and mobile.');
} finally {
    releaseHeld?.();
    await context.close();
    await browser.close();
}
