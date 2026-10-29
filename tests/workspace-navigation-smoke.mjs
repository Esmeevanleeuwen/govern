/**
 * Follow the unified navigation with real catalog data on a disposable local
 * stack. This test does not write database records or create restore points.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const errors = [];
const track = page => page.on('pageerror', error => errors.push(error.message));
const currentRoute = page => page.evaluate(() => location.hash.slice(1).split('?')[0]);
const exactText = value => new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const noOverflow = async (page, label) => assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth), true, label + ' must fit the viewport.');
const shot = async (page, name) => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, 'navigation-' + name + '.png'), fullPage: true});
};
const waitForTable = async (page, name) => {
    await page.locator('.table-heading h2').filter({hasText: name}).waitFor();
    assert.equal(await page.locator('.table-heading h2').innerText(), name);
};
const mode = async (page, name) => {
    await page.locator('[data-database-view="' + name + '"]').click();
    await page.waitForFunction(expected => location.hash.slice(1).split('?')[0] === expected, name);
};
const schemaSelection = (page, name) => page.locator('.schema-index [data-schema-select=' + JSON.stringify(name) + ']');
const databasePlacement = async (page, schema = false) => {
    const title = page.locator('.database-heading h1');
    await title.waitFor();
    assert.equal(await title.innerText(), 'Database');
    const titleBounds = await title.boundingBox();
    const viewbarBounds = await page.locator('.database-viewbar').boundingBox();
    assert.ok(viewbarBounds.y >= titleBounds.y + titleBounds.height - 1,
        'Database views have a consistent row below the compact workspace heading.');
    assert.equal(await page.locator('#workspace-explorer-open').count(), 1,
        'Every Database view uses the same table explorer opener.');
    const contextFits = await page.locator('.database-views, #database-selected-table').evaluateAll(nodes =>
        nodes.every(node => { const box = node.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }));
    assert.equal(contextFits, true, 'View navigation and selected table fit the available workspace.');
    if (!schema) return;
    const toolbar = page.locator('#schema-workspace .schema-toolbar');
    const toolbarBounds = await toolbar.boundingBox();
    const canvasBounds = await page.locator('#schema-viewport').boundingBox();
    assert.ok(toolbarBounds.y >= viewbarBounds.y + viewbarBounds.height - 1,
        'Schema tools follow the Database view row.');
    assert.ok(toolbarBounds.y + toolbarBounds.height <= canvasBounds.y + 1,
        'The grouped tools sit above the canvas instead of covering table fields.');
    const grouped = await toolbar.evaluate(element => [
        'schema-neighborhood', 'schema-columns-toggle', 'schema-reset', 'schema-refresh',
        'schema-zoom-out', 'schema-zoom-value', 'schema-zoom-in', 'schema-actual', 'schema-fit', 'schema-help-open',
    ].every(id => element.contains(document.getElementById(id))));
    assert.equal(grouped, true, 'Filters, layout, zoom, refresh and help share the canvas tool area.');
    assert.equal(await page.locator('#schema-browse, #schema-structure, #schema-focus-connections').count(), 0,
        'The selection details do not repeat Database view navigation and canvas filtering.');
};

try {
    const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
    const page = await context.newPage();
    track(page);
    await page.goto(new URL('/#overzicht', base).href, {waitUntil: 'networkidle'});
    await page.locator('.stats-grid').waitFor();
    const bootstrap = await page.evaluate(async () => (await (await fetch('/api.php?action=bootstrap')).json()).data);
    for (const name of ['organizations', 'digital_systems', 'sources']) {
        assert.ok(bootstrap.tables.some(table => table.name === name), 'Seed ' + name + ' for the navigation flow.');
    }
    const tableCount = bootstrap.tables.length;
    assert.deepEqual(await page.locator('#navigation [data-area]').evaluateAll(links => links.map(link => link.dataset.area)),
        ['overview', 'database', 'research', 'experiments']);
    assert.equal(await page.locator('#workspace-context').isVisible(), false,
        'Overview opens directly, without another menu of the main areas.');
    assert.equal(await page.locator('#navigation [data-area="research"]').count(), 1);
    assert.equal(await page.locator('#navigation [data-area="experiments"]').count(), 1);
    await shot(page, 'overview');

    // Direct links remain valid and populate the same persistent explorer.
    await page.goto(new URL('/#gegevens?table=organizations', base).href, {waitUntil: 'networkidle'});
    await waitForTable(page, 'organizations');
    await databasePlacement(page);
    assert.equal(await page.locator('#workspace-context .catalog-item').count(), tableCount);
    const tableButton = name => page.locator('#workspace-context .catalog-item').filter({
        has: page.locator('.catalog-item-name', {hasText: exactText(name)}),
    });
    await tableButton('digital_systems').click();
    await waitForTable(page, 'digital_systems');
    assert.equal(await page.locator('#workspace-context .catalog-item').count(), tableCount,
        'Selecting a table keeps all other tables available for the next click.');
    await page.locator('#data-search').fill('DigiD');
    await page.waitForFunction(() => document.querySelectorAll('.data-table tbody tr').length === 1 &&
        document.querySelector('.data-table')?.textContent.includes('DigiD'));
    const catalogList = page.locator('#workspace-context .catalog-list');
    await catalogList.evaluate(list => { list.scrollTop = list.scrollHeight; });
    await tableButton('sources').scrollIntoViewIfNeeded();
    const beforeTableSwitch = await catalogList.evaluate(list => ({list: list.scrollTop,
        outer: document.getElementById('workspace-context-content').scrollTop}));
    assert.ok(beforeTableSwitch.list > 0, 'Exercise a scrolled table explorer, not its initial position.');
    await tableButton('sources').click();
    await waitForTable(page, 'sources');
    const afterTableSwitch = await catalogList.evaluate(list => ({list: list.scrollTop,
        outer: document.getElementById('workspace-context-content').scrollTop}));
    assert.ok(Math.abs(afterTableSwitch.list - beforeTableSwitch.list) <= 1,
        'Selecting a table retains the scrolled table list.');
    assert.ok(Math.abs(afterTableSwitch.outer - beforeTableSwitch.outer) <= 1,
        'Selecting a table retains the outer explorer position.');
    const selectedRowIsVisible = await tableButton('sources').evaluate(row => {
        const rowBox = row.getBoundingClientRect(), listBox = row.closest('.catalog-list').getBoundingClientRect();
        return rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1;
    });
    assert.equal(selectedRowIsVisible, true, 'The newly selected row remains visible for fast neighboring-table switches.');
    await tableButton('digital_systems').click();
    await waitForTable(page, 'digital_systems');
    assert.equal(await page.locator('#data-search').inputValue(), 'DigiD',
        'Each table keeps its data search when another table is inspected.');

    await page.locator('#catalog-search').fill('org');
    await mode(page, 'structuur');
    await waitForTable(page, 'digital_systems');
    assert.equal(await page.locator('#catalog-search').inputValue(), 'org');
    await mode(page, 'schema');
    await page.locator('#schema-viewport').waitFor();
    await databasePlacement(page, true);
    assert.equal(await page.locator('#schema-search').inputValue(), 'org',
        'Database view changes use one explorer search.');
    assert.equal(await page.locator('[data-schema-node]').count(), tableCount,
        'Searching the explorer does not silently filter the canvas.');
    await schemaSelection(page, 'organizations').click();
    await page.locator('#schema-search').fill('');
    assert.equal(await page.locator('.schema-index [data-schema-select]').count(), tableCount);
    await schemaSelection(page, 'sources').click();
    assert.match(await page.locator('#schema-selected').innerText(), /sources/);
    assert.equal(await page.locator('.schema-index [data-schema-select]').count(), tableCount,
        'Schema selection details do not replace the table explorer.');
    await page.locator('#schema-zoom-in').click();
    const zoom = await page.locator('#schema-zoom-value').innerText();
    const positions = await page.locator('[data-schema-node]').evaluateAll(nodes =>
        nodes.map(node => [node.dataset.schemaNode, node.style.left, node.style.top]));
    await mode(page, 'gegevens');
    await waitForTable(page, 'sources');
    assert.equal(await page.locator('#catalog-search').inputValue(), '');
    await mode(page, 'schema');
    await page.locator('#schema-viewport').waitFor();
    assert.equal(await page.locator('#schema-zoom-value').innerText(), zoom);
    assert.deepEqual(await page.locator('[data-schema-node]').evaluateAll(nodes =>
        nodes.map(node => [node.dataset.schemaNode, node.style.left, node.style.top])), positions);
    assert.match(await page.locator('#schema-selected').innerText(), /sources/);

    await page.locator('#workspace-panel-toggle').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), false);
    assert.equal(await page.locator('#schema-viewport').isVisible(), true);
    assert.equal(await page.locator('#schema-help-open').isVisible(), true);
    assert.equal(await page.locator('#schema-fit').isVisible(), true);
    assert.equal(await page.locator('#schema-zoom-value').innerText(), zoom,
        'Closing the explorer leaves the canvas tools and zoom intact.');
    const hash = await currentRoute(page);
    await page.locator('#navigation [data-area="database"]').click();
    assert.equal(await currentRoute(page), hash, 'Clicking the active area only expands its context.');
    assert.equal(await page.locator('#workspace-context').isVisible(), true);
    await page.locator('#navigation [data-area="overview"]').click();
    await page.locator('.stats-grid').waitFor();
    assert.equal(await page.locator('#workspace-context').isVisible(), false);
    assert.match(await page.locator('#navigation [data-area="database"]').getAttribute('href'), /^#schema/,
        'The Database area remembers its last view.');
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('#schema-viewport').waitFor();
    assert.match(await page.locator('#schema-selected').innerText(), /sources/);
    assert.equal(await page.locator('#schema-zoom-value').innerText(), zoom);
    await shot(page, 'schema-persistent-explorer');

    // A different area changes the single panel while preserving unsaved work.
    await page.locator('#navigation [data-area="research"]').click();
    await page.locator('#sql-editor').fill('SELECT 42 AS navigation_draft;');
    assert.equal(await page.locator('#workspace-context .saved-list').count(), 1);
    assert.equal(await page.locator('#page .saved-list').count(), 0, 'Saved research has one home in the context panel.');
    await page.locator('#workspace-panel-toggle').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), false);
    assert.equal(await page.locator('#navigation [data-area="research"]').evaluate(link => link === document.activeElement), true,
        'Collapsing Research returns focus to its active area in the rail.');
    assert.equal(await page.locator('#sql-editor').inputValue(), 'SELECT 42 AS navigation_draft;');
    await page.locator('#navigation [data-area="research"]').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), true);
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('#schema-viewport').waitFor();
    await page.locator('#navigation [data-area="research"]').click();
    assert.equal(await page.locator('#sql-editor').inputValue(), 'SELECT 42 AS navigation_draft;');
    await page.locator('#settings-link').click();
    await page.locator('#preference-theme').waitFor();
    assert.equal(await page.locator('#workspace-context').isVisible(), false, 'Settings is its own screen.');
    await page.locator('[data-sidebar-choice="right"]').click();
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('#schema-viewport').waitFor();
    const explorerBounds = await page.locator('#workspace-context').boundingBox();
    const canvasBounds = await page.locator('#schema-viewport').boundingBox();
    assert.ok(explorerBounds.x > canvasBounds.x, 'The unified explorer follows the saved right-side preference.');
    await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#schema-viewport').waitFor();
    assert.match(await page.locator('#schema-selected').innerText(), /sources/);
    assert.equal(await page.locator('#schema-zoom-value').innerText(), zoom);
    await noOverflow(page, 'Desktop unified workspace');
    await shot(page, 'right-side-en');

    // A same-named table in another catalog cannot become a local navigation
    // target. Keep those metadata boundaries visible without adding fake joins.
    const boundary = await context.newPage();
    track(boundary);
    await boundary.route('**/api.php?action=structure*', async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('table') !== 'organizations') return route.continue();
        const response = await route.fetch();
        const payload = await response.json();
        assert.equal(payload.ok, true);
        payload.data.foreign_keys = [
            {name: 'external_fixture', columns: ['evidence_id'], referenced_schema: 'external_catalog',
                referenced_table: 'sources', referenced_columns: ['id']},
            {name: 'unavailable_fixture', columns: ['evidence_id'], referenced_schema: bootstrap.database.name,
                referenced_table: 'missing_catalog_table', referenced_columns: ['id']},
        ];
        await route.fulfill({response, json: payload});
    });
    await boundary.goto(new URL('/#gegevens?table=organizations', base).href, {waitUntil: 'networkidle'});
    await waitForTable(boundary, 'organizations');
    await boundary.locator('#workspace-selected .workspace-detail').nth(1).locator('summary').click();
    const externalTarget = boundary.locator('#workspace-selected .workspace-related').filter({
        has: boundary.locator('code', {hasText: exactText('external_catalog.sources')}),
    });
    await externalTarget.waitFor();
    assert.equal(await externalTarget.evaluate(node => node.tagName), 'DIV');
    assert.match(await boundary.locator('#workspace-selected').innerText(), /missing_catalog_table/);
    assert.equal(await boundary.locator('#workspace-selected button.workspace-related').count(), 0,
        'External and unavailable relationships are labelled, without an incorrect local-table button.');
    await boundary.close();

    // The mobile menu is one drawer. Table selection updates its workspace
    // without closing the table list; Escape gives the workspace its full width.
    const mobileContext = await browser.newContext({locale: 'nl-NL', viewport: {width: 390, height: 900}});
    const mobile = await mobileContext.newPage();
    track(mobile);
    await mobile.goto(new URL('/#schema', base).href, {waitUntil: 'networkidle'});
    await mobile.locator('#schema-viewport').waitFor();
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    await mobile.locator('#workspace-explorer-open').click();
    await schemaSelection(mobile, 'sources').click();
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'false');
    assert.equal(await mobile.locator('.schema-index [data-schema-select]').count(), tableCount);
    await mobile.keyboard.press('Escape');
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    await mode(mobile, 'gegevens');
    await waitForTable(mobile, 'sources');
    await mobile.locator('#workspace-explorer-open').click();
    await mobile.locator('#workspace-context .catalog-item').filter({
        has: mobile.locator('.catalog-item-name', {hasText: exactText('digital_systems')}),
    }).click();
    await waitForTable(mobile, 'digital_systems');
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'false');
    assert.equal(await mobile.locator('#workspace-context .catalog-item').count(), tableCount);
    await mobile.keyboard.press('Escape');
    for (const width of [390, 375, 320]) {
        await mobile.setViewportSize({width, height: 900});
        await noOverflow(mobile, 'Mobile workspace ' + width);
        await mobile.locator('#workspace-explorer-open').click();
        await noOverflow(mobile, 'Mobile table explorer ' + width);
        await shot(mobile, 'mobile-explorer-' + width);
        await mobile.keyboard.press('Escape');
        await mode(mobile, 'schema');
        await mobile.locator('#schema-viewport').waitFor();
        await databasePlacement(mobile, true);
        assert.equal(await mobile.locator('#schema-help-open').isVisible(), true);
        await noOverflow(mobile, 'Mobile schema ' + width);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: one area rail, persistent table explorer, shared Database views/search/selection, ordered workspace controls, schema state and tools, research draft continuity, right-side and 320/375/390px mobile navigation.');
} finally {
    await browser.close();
}
