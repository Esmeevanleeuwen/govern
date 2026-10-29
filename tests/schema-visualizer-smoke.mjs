/**
 * Schema visualizer integration against a disposable local Govern stack.
 * Uses the same Playwright environment as the other browser tests. This test
 * reads metadata only; edge-case catalogs are intercepted browser fixtures.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const browserArgs = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true, args: browserArgs,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
const page = await context.newPage();
const errors = [];
const track = page => page.on('pageerror', error => errors.push(error.message));
track(page);
const shot = async (page, name) => {
    if (screenshots) {
        // Chrome full-page capture can paint fixed offscreen elements at the
        // current document offset. Capture from zero, then restore the viewport.
        const scroll = await page.evaluate(() => ({x: scrollX, y: scrollY}));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({path: path.join(screenshots, 'schema-' + name + '.png'), fullPage: true});
        await page.evaluate(({x, y}) => scrollTo(x, y), scroll);
    }
};
const load = async (page, hash = '#schema') => {
    await page.goto(new URL('/' + hash, base).href, {waitUntil: 'networkidle'});
    await page.locator('#schema-search').waitFor({state: 'attached'});
};
const ensureExplorer = async (current = page) => {
    // A resize can precede the matchMedia change handler that refreshes ARIA.
    // Read the responsive drawer state directly before trusting its old label.
    const mobileClosed = await current.evaluate(() => matchMedia('(max-width: 820px)').matches
        && !document.body.classList.contains('sidebar-open'));
    if (mobileClosed || await current.locator('#workspace-explorer-open').getAttribute('aria-expanded') !== 'true') {
        await current.locator('#workspace-explorer-open').click();
    }
    await current.locator('#workspace-context').waitFor();
};
const searchFor = async (value, current = page) => {
    await ensureExplorer(current);
    await current.locator('#schema-search').fill(value);
};
const selectTable = async (name, current = page) => {
    // Selection updates details without replacing the persistent table explorer.
    await ensureExplorer(current);
    await current.locator('#schema-table-panel [data-schema-select=' + JSON.stringify(name) + ']').click();
    assert.equal(await current.locator('#schema-table-panel').isVisible(), true,
        'Selecting a table leaves the table explorer available for a one-click switch.');
};
const node = name => page.locator('[data-schema-node]').filter({has: page.locator('[data-schema-header="' + name + '"]')});
const position = name => node(name).evaluate(element => ({x: parseFloat(element.style.left), y: parseFloat(element.style.top)}));
const noOverflow = async (page, label) => assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth), true, label + ' must not make the document scroll sideways.');
const viewportState = current => current.locator('#schema-viewport').evaluate(canvas => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas.querySelector('.schema-world')).transform);
    const rect = canvas.getBoundingClientRect();
    return {x: matrix.m41, y: matrix.m42, zoom: matrix.a, left: rect.left, top: rect.top,
        width: rect.width, height: rect.height, scrollY};
});
const closeTo = (actual, expected, label, tolerance = .002) => assert.ok(Math.abs(actual - expected) < tolerance,
    label + ': ' + actual + ' versus ' + expected);

try {
    await load(page);
    const schema = await page.evaluate(async () => {
        const response = await fetch('/api.php?action=schema');
        if (!response.ok) throw new Error('Schema metadata HTTP ' + response.status);
        const payload = await response.json();
        if (!payload.ok) throw new Error(payload.error);
        return payload.data;
    });
    const bootstrap = await page.evaluate(async () => (await (await fetch('/api.php?action=bootstrap')).json()).data);
    assert.equal(schema.database, bootstrap.database.name);
    assert.deepEqual(schema.tables.map(table => table.name), bootstrap.tables.map(table => table.name));
    assert.ok(schema.tables.length > 1, 'Seed a linked catalog for integration.');
    assert.ok(schema.tables.every(table => !table.name.startsWith('_govern_')));
    assert.ok(schema.tables.every(table => !Object.hasOwn(table, 'rows') && !Object.hasOwn(table, 'create_sql')),
        'Visualizer metadata contains no table records or unnecessary DDL.');
    assert.equal(await page.locator('[data-schema-node]').count(), schema.tables.length);
    const renderedColumns = await page.locator('[data-schema-node]').evaluateAll(nodes =>
        nodes.map(node => ({name: node.dataset.schemaNode,
            columns: [...node.querySelectorAll('[data-schema-column]')].map(column => column.dataset.schemaColumn)})));
    assert.deepEqual(renderedColumns, schema.tables.map(table => ({name: table.name, columns: table.columns.map(column => column.name)})),
        'Every live catalog column is represented in its table.');
    const expectedPairs = schema.tables.flatMap(table => table.foreign_keys.flatMap(key =>
        key.referenced_schema === schema.database && schema.tables.some(target => target.name === key.referenced_table)
            ? key.columns.map((column, index) => [table.name, column, key.referenced_table, key.referenced_columns[index]].join('\t'))
            : []));
    const edgePairs = await page.locator('path.schema-edge').evaluateAll(edges => edges.map(edge =>
        [edge.dataset.sourceTable, edge.dataset.sourceColumn, edge.dataset.targetTable, edge.dataset.targetColumn].join('\t')));
    assert.deepEqual(edgePairs.sort(), expectedPairs.sort(), 'Every declared FK column pair is drawn, without invented joins.');
    assert.ok(edgePairs.some(edge => edge.startsWith('public_functions\tparent_function_id\tpublic_functions\tid')),
        'Real self references are visible.');
    const placement = await page.locator('#schema-workspace').evaluate(workspace => {
        const toolbar = workspace.querySelector('.schema-toolbar');
        const canvas = workspace.querySelector('#schema-viewport');
        const controls = ['schema-neighborhood', 'schema-columns-toggle', 'schema-reset', 'schema-zoom-out',
            'schema-zoom-value', 'schema-zoom-in', 'schema-actual', 'schema-fit', 'schema-refresh', 'schema-help-open'];
        return {
            toolbarCount: workspace.querySelectorAll('.schema-toolbar').length,
            groupedControls: controls.every(id => {
                const control = workspace.querySelector('#' + id);
                const group = control?.closest('.schema-tool-group[role="group"][aria-label]');
                return group && toolbar.contains(group) && group.getAttribute('aria-label').trim();
            }),
            toolsBeforeCanvas: Boolean(toolbar.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING),
            toolsAboveCanvas: toolbar.getBoundingClientRect().bottom <= canvas.getBoundingClientRect().top + 1,
            repeatedSidebarActions: document.querySelectorAll('#schema-browse, #schema-structure, #schema-focus-connections').length,
            explanationClosed: !workspace.querySelector('#schema-explanation').open,
        };
    });
    assert.equal(placement.toolbarCount, 1, 'Canvas actions have one predictable tool area.');
    assert.equal(placement.groupedControls, true, 'Filter, display, arrangement, zoom, refresh and help stay in labelled groups.');
    assert.equal(placement.toolsBeforeCanvas, true, 'All canvas controls precede the diagram rather than splitting above and below it.');
    assert.equal(placement.toolsAboveCanvas, true, 'The grouped tools sit above the canvas without covering its table fields.');
    assert.equal(placement.repeatedSidebarActions, 0, 'Sidebar details do not repeat Database modes and the connection filter.');
    assert.equal(placement.explanationClosed, true, 'Long explanations stay collapsed until requested.');
    await page.locator('#schema-columns-toggle').click();
    assert.equal(await page.locator('#schema-columns-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.schema-columns:visible').count(), 0, 'Header-only mode hides column rows.');
    assert.equal(await page.locator('path.schema-edge').count(), expectedPairs.length,
        'Header-only mode keeps every declared relationship visible.');
    await page.locator('#schema-columns-toggle').click();
    assert.equal(await page.locator('.schema-columns:visible').count(), schema.tables.length);
    await noOverflow(page, 'Desktop schema');
    await shot(page, 'all-tables-nl');

    // The single navigation context pane gives space back to the canvas while
    // leaving workspace tools and global navigation reachable.
    assert.equal(await page.locator('#schema-tool-rail').count(), 0, 'Schema has no second tool rail.');
    await ensureExplorer();
    assert.equal(await page.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#workspace-explorer-open').isVisible(), false, 'The workspace only offers a table opener when the explorer is collapsed.');
    const expandedViewport = await viewportState(page);
    await page.locator('#workspace-panel-toggle').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), false, 'The shared context pane collapses.');
    assert.equal(await page.locator('#schema-help-open').isVisible(), true, 'Workspace tools remain available.');
    const compactViewport = await viewportState(page);
    closeTo((expandedViewport.width / 2 - expandedViewport.x) / expandedViewport.zoom,
        (compactViewport.width / 2 - compactViewport.x) / compactViewport.zoom, 'Tool collapse retains the diagram center X', .02);
    closeTo((expandedViewport.height / 2 - expandedViewport.y) / expandedViewport.zoom,
        (compactViewport.height / 2 - compactViewport.y) / compactViewport.zoom, 'Tool collapse retains the diagram center Y', .02);
    await page.locator('#workspace-explorer-open').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), true, 'The workspace opener expands the table explorer.');
    assert.equal(await page.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'true');

    // Area help is an actual modal, explains only implemented functions, and
    // leaves catalog data and diagram state untouched.
    const helpPosts = [];
    const collectHelpPost = request => { if (request.method() === 'POST') helpPosts.push(request.url()); };
    page.on('request', collectHelpPost);
    const beforeHelp = await page.locator('.schema-world').evaluate(element => element.style.transform);
    await page.locator('#schema-help-open').click();
    await page.locator('#schema-help-dialog[open]').waitFor();
    assert.equal(await page.locator('#schema-help-dialog').evaluate(dialog => dialog.matches(':modal')), true,
        'Area help is shown as a modal dialog.');
    assert.ok(await page.locator('#schema-help-dialog [data-schema-help-section]').count() >= 5,
        'The guide explains the main available schema tasks.');
    assert.equal(await page.locator('#schema-help-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true,
        'Opening help moves focus inside the guide.');
    for (let index = 0; index < 7; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#schema-help-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true,
            'Tab stays inside the modal guide.');
    }
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#schema-help-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true);
    await shot(page, 'help-light-nl');
    await page.keyboard.press('Escape');
    await page.locator('#schema-help-dialog[open]').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#schema-help-open').evaluate(button => button === document.activeElement), true,
        'Escape returns focus to the area-help button.');
    assert.equal(await page.locator('.schema-world').evaluate(element => element.style.transform), beforeHelp,
        'Closing help leaves diagram position and zoom unchanged.');
    await page.locator('#schema-help-open').click();
    assert.equal(await page.locator('#schema-help-dialog').count(), 1, 'Repeated openings reuse one guide dialog.');
    await page.locator('#schema-help-close').click();
    await page.locator('#schema-help-dialog[open]').waitFor({state: 'hidden'});
    await page.locator('#schema-help-open').click();
    const helpBounds = await page.locator('#schema-help-dialog').boundingBox();
    await page.mouse.click(Math.max(1, helpBounds.x - 12), Math.max(1, helpBounds.y + 12));
    await page.locator('#schema-help-dialog[open]').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#schema-help-open').evaluate(button => button === document.activeElement), true,
        'Closing by backdrop returns focus too.');

    await page.locator('#schema-help-open').click();
    const languagePage = await context.newPage();
    track(languagePage);
    await languagePage.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
    await languagePage.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#schema-help-dialog[open]').waitFor();
    assert.equal(await page.locator('#schema-help-dialog').count(), 1, 'A live language change cannot leave duplicate guide dialogs.');
    const englishHelp = await page.locator('#schema-help-dialog').innerText();
    assert.match(englishHelp, /zoom/i);
    assert.match(englishHelp, /search|find/i);
    assert.match(englishHelp, /connections|foreign keys/i);
    assert.match(englishHelp, /browser|local/i);
    assert.equal(englishHelp.includes('app.schema.'), false, 'The English guide has no untranslated keys.');
    await shot(page, 'help-en');
    await page.locator('#schema-help-close').click();
    assert.equal(await page.locator('#schema-help-open').evaluate(button => button === document.activeElement), true);
    await languagePage.locator('#language-select').selectOption('nl');
    await page.waitForFunction(() => document.documentElement.lang === 'nl');
    await languagePage.close();
    await page.locator('#schema-help-open').click();
    await page.evaluate(() => { location.hash = '#gegevens'; });
    await page.locator('.table-heading').waitFor();
    assert.equal(await page.locator('#schema-help-dialog').count(), 0, 'Leaving Schema removes its help dialog from the document.');
    await load(page);
    assert.equal(await page.locator('#schema-help-dialog[open]').count(), 0, 'Returning to Schema does not reopen old help.');
    assert.equal(await page.locator('.schema-world').evaluate(element => element.style.transform), beforeHelp,
        'A help visit and route round trip retain the diagram viewport.');
    page.off('request', collectHelpPost);
    assert.deepEqual(helpPosts, [], 'Reading the area guide never sends database mutation requests.');

    // Real unmodified wheel events zoom around the cursor instead of scrolling
    // the document or moving the point beneath the pointer.
    await page.locator('#schema-actual').click();
    await page.locator('#schema-viewport').scrollIntoViewIfNeeded();
    const wheelBefore = await viewportState(page);
    // Native input coordinates are integer client pixels in Chrome.
    const cursor = {x: Math.round(wheelBefore.left + wheelBefore.width * .7), y: Math.round(wheelBefore.top + wheelBefore.height * .35)};
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => parseInt(document.querySelector('#schema-zoom-value').textContent, 10) > 100);
    const wheelAfter = await viewportState(page);
    assert.ok(wheelAfter.zoom > wheelBefore.zoom, 'Ordinary wheel-up zooms in without Ctrl.');
    closeTo((cursor.x - wheelBefore.left - wheelBefore.x) / wheelBefore.zoom,
        (cursor.x - wheelAfter.left - wheelAfter.x) / wheelAfter.zoom, 'Wheel zoom keeps cursor world X', .02);
    closeTo((cursor.y - wheelBefore.top - wheelBefore.y) / wheelBefore.zoom,
        (cursor.y - wheelAfter.top - wheelAfter.y) / wheelAfter.zoom, 'Wheel zoom keeps cursor world Y', .02);
    assert.equal(wheelAfter.scrollY, wheelBefore.scrollY, 'Wheel on the diagram does not scroll the page.');
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => parseInt(document.querySelector('#schema-zoom-value').textContent, 10) <= 100);
    closeTo((await viewportState(page)).zoom, wheelBefore.zoom, 'Wheel-down reverses the same wheel distance');
    const pinch = await page.locator('#schema-viewport').evaluate(canvas => {
        const event = new WheelEvent('wheel', {bubbles: true, cancelable: true, ctrlKey: true, deltaY: -30,
            clientX: canvas.getBoundingClientRect().left + 70, clientY: canvas.getBoundingClientRect().top + 80});
        const dispatched = canvas.dispatchEvent(event);
        return {prevented: event.defaultPrevented, dispatched};
    });
    assert.equal(pinch.prevented, true, 'Trackpad-style Ctrl wheel is handled inside the canvas.');
    assert.equal(pinch.dispatched, false);
    assert.ok((await viewportState(page)).zoom > 1, 'Trackpad-style pinch also zooms in.');
    const beforeLineWheel = (await viewportState(page)).zoom;
    await page.locator('#schema-viewport').dispatchEvent('wheel', {deltaY: -3, deltaMode: 1,
        clientX: cursor.x, clientY: cursor.y, bubbles: true, cancelable: true});
    assert.ok((await viewportState(page)).zoom > beforeLineWheel, 'Line-unit wheel devices also zoom in.');
    await page.locator('#schema-viewport').evaluate(canvas => {
        for (let index = 0; index < 6; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 100000, deltaMode: 2, cancelable: true, bubbles: true, clientX: 300, clientY: 400}));
    });
    closeTo((await viewportState(page)).zoom, .12, 'Repeated page-unit wheel-out stops at the minimum zoom');
    await page.locator('#schema-viewport').evaluate(canvas => {
        for (let index = 0; index < 6; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100000, deltaMode: 0, cancelable: true, bubbles: true, clientX: 300, clientY: 400}));
    });
    closeTo((await viewportState(page)).zoom, 1.75, 'Repeated wheel-in stops at the maximum zoom');
    await page.locator('#schema-actual').click();
    await page.evaluate(() => scrollTo(0, 0));
    const originalBodyHeight = await page.evaluate(() => {
        const height = document.body.style.minHeight;
        document.body.style.minHeight = '1800px';
        return height;
    });
    const outsideZoom = (await viewportState(page)).zoom;
    const outside = await page.locator('#breadcrumb-current').boundingBox();
    await page.mouse.move(outside.x + outside.width / 2, outside.y + outside.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => scrollY > 0);
    closeTo((await viewportState(page)).zoom, outsideZoom, 'Wheel outside the canvas remains ordinary page scrolling');
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(height => { document.body.style.minHeight = height; }, originalBodyHeight);

    const table = schema.tables.find(table => table.name === 'sources') || schema.tables[0];
    await searchFor(table.name);
    await selectTable(table.name);
    await page.locator('#schema-actual').click();
    await page.locator('#schema-selected').waitFor();
    assert.match(await page.locator('#schema-selected').innerText(), new RegExp(table.name));
    assert.equal(await page.locator('#schema-table-panel').isVisible(), true,
        'Choosing a table keeps the explorer in place beside its details.');
    assert.equal(await page.locator('#schema-table-panel [aria-pressed="true"]').count(), 1,
        'The table explorer identifies the selected table.');
    const panelViewport = await viewportState(page);
    await page.locator('#workspace-panel-toggle').click();
    assert.equal(await page.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#workspace-context').isVisible(), false, 'Context panel can be collapsed.');
    assert.equal(await page.locator('#schema-help-open').isVisible(), true, 'Area help remains discoverable above the canvas.');
    closeTo((await viewportState(page)).zoom, panelViewport.zoom, 'Collapsing keeps canvas zoom');
    await page.locator('[data-schema-header="' + table.name + '"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'false',
        'A table selection respects a deliberately collapsed panel.');
    await page.locator('#language-select').selectOption('en');
    assert.equal(await page.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'false', 'Language retains a collapsed panel.');
    await page.locator('#language-select').selectOption('nl');
    await page.locator('#workspace-explorer-open').click();
    assert.equal(await page.locator('#schema-table-panel').isVisible(), true, 'Reopening restores the explorer.');
    assert.match(await page.locator('#schema-selected').innerText(), new RegExp(table.name), 'Reopening retains the selected-table details.');
    await page.locator('#schema-column-summary').click();
    assert.deepEqual(await page.locator('.schema-detail-columns li > div > code').allTextContents(),
        table.columns.map(column => column.name), 'The context menu shows every exact column for the selected table.');
    await page.locator('#schema-column-summary').click();
    const panelZoom = (await viewportState(page)).zoom;
    const contextBox = await page.locator('#workspace-context').boundingBox();
    await page.mouse.move(contextBox.x + contextBox.width / 2, contextBox.y + Math.min(contextBox.height / 2, 200));
    await page.mouse.wheel(0, 120);
    closeTo((await viewportState(page)).zoom, panelZoom, 'Scrolling the context menu never zooms the diagram');
    const before = await position(table.name);
    const header = page.locator('[data-schema-header="' + table.name + '"]');
    await header.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const afterKey = await position(table.name);
    assert.ok(afterKey.x > before.x && afterKey.y > before.y, 'Keyboard moves a table in both axes.');
    const box = await header.boundingBox();
    assert.ok(box && box.width > 50 && box.height > 10, 'Selected table header is usable at actual size.');
    await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(40, box.width / 2) + 70, box.y + box.height / 2 + 50, {steps: 8});
    await page.mouse.up();
    let moved = await position(table.name);
    assert.ok(moved.x > afterKey.x && moved.y > afterKey.y, 'Pointer dragging moves a table.');
    await page.waitForFunction(({database, table, moved}) => {
        const value = JSON.parse(localStorage.getItem('govern.schema-layout.v1.' + encodeURIComponent(database)) || 'null');
        return value?.positions?.[table]?.x === moved.x && value?.positions?.[table]?.y === moved.y;
    }, {database: schema.database, table: table.name, moved});
    await page.locator('#schema-zoom-out').click();
    assert.ok(parseInt(await page.locator('#schema-zoom-value').textContent(), 10) < 100, 'Zoom-out changes the viewport scale.');
    await page.locator('#schema-zoom-in').click();
    assert.equal(await page.locator('#schema-zoom-value').textContent(), '100%');
    await page.locator('#schema-neighborhood').check();
    assert.equal(await page.locator('#schema-neighborhood').isChecked(), true, 'The canvas filter focuses the selected table connections.');
    assert.equal(await page.locator('#schema-search').inputValue(), table.name, 'Direct connections leaves the independent explorer search intact.');
    const neighbors = new Set([table.name]);
    schema.tables.forEach(source => source.foreign_keys.forEach(key => {
        if (key.referenced_schema !== schema.database) return;
        if (source.name === table.name) neighbors.add(key.referenced_table);
        if (key.referenced_table === table.name) neighbors.add(source.name);
    }));
    assert.deepEqual((await page.locator('[data-schema-node]').evaluateAll(nodes => nodes.map(node => node.dataset.schemaNode))).sort(),
        [...neighbors].sort(), 'Direct connections reveals the exact one-hop neighborhood independently of explorer search.');
    await selectTable(table.name);
    await page.locator('#schema-actual').click();
    const beforeNeighbor = await position(table.name);
    await header.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await header.evaluate(element => element === document.activeElement), true,
        'Moving in neighborhood mode retains header focus.');
    await page.keyboard.press('ArrowRight');
    assert.ok((await position(table.name)).x >= beforeNeighbor.x + 40, 'Repeated keyboard moves work in neighborhood mode.');
    const neighborBox = await header.boundingBox();
    await page.mouse.move(neighborBox.x + 35, neighborBox.y + neighborBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(neighborBox.x + 85, neighborBox.y + neighborBox.height / 2 + 35, {steps: 6});
    await page.mouse.up();
    moved = await position(table.name);
    assert.ok(moved.x > beforeNeighbor.x + 40 && moved.y > beforeNeighbor.y, 'Dragging works while neighborhood redraws are enabled.');
    const transformBeforePan = await page.locator('.schema-world').evaluate(element => element.style.transform);
    await page.locator('#schema-viewport').focus();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await page.locator('.schema-world').evaluate(element => element.style.transform), transformBeforePan,
        'Keyboard pans the canvas independently of table position.');
    const panned = await page.locator('.schema-world').evaluate(element => element.style.transform);
    await page.locator('#schema-fit').click();
    assert.notEqual(await page.locator('.schema-world').evaluate(element => element.style.transform), panned,
        'Fit changes a previously panned viewport.');
    await searchFor(table.name);
    await header.focus();
    const viewportBeforeLanguage = await page.locator('.schema-world').evaluate(element => element.style.transform);
    await page.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#schema-search').waitFor();
    assert.equal(await page.locator('#schema-search').inputValue(), table.name, 'Language keeps the filter.');
    assert.deepEqual(await position(table.name), moved, 'Language keeps node positions.');
    assert.equal(await header.evaluate(element => element === document.activeElement), true, 'Language restores focused table header.');
    assert.equal(await page.locator('.schema-world').evaluate(element => element.style.transform), viewportBeforeLanguage,
        'Language keeps viewport position and zoom.');
    assert.equal(await page.locator('#schema-neighborhood').isChecked(), true);
    assert.match(await page.locator('#schema-selected').innerText(), new RegExp(table.name), 'Language keeps selection.');
    assert.equal((await page.locator('#page').innerText()).includes('app.schema.'), false, 'No untranslated keys leak.');
    await page.reload({waitUntil: 'networkidle'});
    await page.locator('#schema-search').waitFor();
    assert.deepEqual(await position(table.name), moved, 'Positions are restored on reload.');
    await searchFor('no_such_table_or_column_8237');
    assert.equal(await page.locator('#schema-table-panel [data-schema-select]').count(), 0, 'The explorer has a filtered-empty state.');
    assert.equal(await page.locator('[data-schema-node]').count(), schema.tables.length, 'An empty explorer search leaves the canvas intact.');
    await searchFor('');
    assert.equal(await page.locator('[data-schema-node]').count(), schema.tables.length);
    await searchFor('parent_function_id');
    assert.ok(await page.locator('#schema-table-panel [data-schema-select="public_functions"]').count(), 'Explorer search finds columns as well as tables.');
    await searchFor('');
    await selectTable('public_functions');
    const allCount = await page.locator('[data-schema-node]').count();
    await page.locator('#schema-neighborhood').check();
    assert.ok(await page.locator('[data-schema-node]').count() < allCount, 'Neighborhood filters to related tables.');
    await page.locator('#schema-neighborhood').uncheck();
    await selectTable(table.name);
    await page.locator('[data-database-view="gegevens"]').click();
    await page.waitForFunction(name => location.hash.startsWith('#gegevens') &&
        new URLSearchParams(location.hash.split('?')[1]).get('table') === name, table.name);
    await page.locator('.table-heading').waitFor();
    await load(page);
    await selectTable(table.name);
    await page.locator('[data-database-view="structuur"]').click();
    await page.waitForFunction(name => location.hash.startsWith('#structuur') &&
        new URLSearchParams(location.hash.split('?')[1]).get('table') === name, table.name);
    await page.locator('.structure-section').first().waitFor();

    // Navigating to the diagram does not replace research in progress.
    await page.goto(new URL('/#onderzoeken', base).href);
    await page.locator('#sql-editor').waitFor();
    const draft = 'SELECT 42 AS kept_schema_draft;';
    await page.locator('#sql-editor').fill(draft);
    await load(page);
    await page.locator('#settings-link').click();
    await page.locator('#preference-theme').selectOption('dark');
    await page.goto(new URL('/#schema', base).href);
    await page.locator('#schema-search').waitFor();
    await searchFor('organizations');
    await selectTable('organizations');
    await page.locator('#schema-fit').click();
    await searchFor('');
    assert.equal(await page.locator('#schema-table-panel [data-schema-select]').count(), schema.tables.length,
        'Opening table details keeps every table available in the shared explorer.');
    await page.locator('#schema-column-summary').click();
    assert.equal(await page.locator('#schema-table-panel').isVisible(), true,
        'Expanding columns does not replace the table explorer.');
    await page.locator('#schema-column-summary').click();
    await shot(page, 'selection-dark-en');
    await page.locator('#settings-link').click();
    await page.locator('#preference-reduceTransparency').check();
    await page.goto(new URL('/#schema', base).href);
    await page.locator('#schema-search').waitFor();
    assert.equal(await page.locator('.schema-node, .schema-node-header, #schema-viewport').evaluateAll(nodes =>
        nodes.every(element => getComputedStyle(element).backdropFilter === 'none')), true,
        'Schema materials support reduced transparency.');
    assert.deepEqual(await page.locator('.schema-node,.schema-node-header,#workspace-context,#schema-viewport,.schema-toolbar .button,.schema-toolbar .input,.schema-relation').evaluateAll(nodes =>
        nodes.filter(element => ['top', 'right', 'bottom', 'left'].some(side => {
            const style = getComputedStyle(element);
            return parseFloat(style.getPropertyValue('border-' + side + '-width')) > 0 &&
                style.getPropertyValue('border-' + side + '-style') !== 'none' &&
                !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.getPropertyValue('border-' + side + '-color'));
        })).map(element => element.className)), [], 'Schema surfaces have no hard decorative borders.');
    await page.goto(new URL('/#onderzoeken', base).href);
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), draft, 'Schema/settings navigation retains research.');

    await page.locator('#settings-link').click();
    await page.locator('[data-sidebar-choice="right"]').click();
    await load(page);
    const rightCanvas = await page.locator('#schema-viewport').boundingBox();
    const rightPanel = await page.locator('#workspace-context').boundingBox();
    assert.ok(rightPanel.x > rightCanvas.x, 'Right navigation places the context panel on the right side of the diagram.');
    assert.equal(await page.locator('#schema-table-panel').isVisible(), true);
    assert.match(await page.locator('#schema-selected').innerText(), /organizations/, 'Changing navigation side retains the selected table.');
    await noOverflow(page, 'Right-side context menu');
    await shot(page, 'context-right');
    await page.locator('#settings-link').click();
    await page.locator('[data-sidebar-choice="left"]').click();
    await load(page);

    await page.setViewportSize({width: 375, height: 900});
    await load(page);
    await searchFor('sources');
    await selectTable('sources');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-context').isVisible(), false,
        'Close the retained mobile table drawer before using the canvas tools.');
    await page.locator('#schema-actual').click();
    await noOverflow(page, '375px schema');
    await shot(page, 'mobile');
    await page.setViewportSize({width: 320, height: 800});
    await noOverflow(page, '320px schema');

    const mobilePage = await context.newPage();
    track(mobilePage);
    await mobilePage.setViewportSize({width: 375, height: 900});
    await load(mobilePage);
    assert.equal(await mobilePage.locator('#workspace-explorer-open').getAttribute('aria-expanded'), 'false',
        'A fresh mobile workspace starts with the context menu compact.');
    assert.equal(await mobilePage.locator('#workspace-context').isVisible(), false);
    assert.equal(await mobilePage.locator('#schema-help-open').isVisible(), true, 'Mobile keeps workspace tools available.');
    await mobilePage.locator('#schema-help-open').click();
    await mobilePage.locator('#schema-help-dialog[open]').waitFor();
    const mobileHelp = await mobilePage.locator('#schema-help-dialog').boundingBox();
    assert.ok(mobileHelp.width <= 375 && mobileHelp.height <= 900, 'The area guide fits the mobile viewport.');
    await noOverflow(mobilePage, 'Mobile area guide');
    await mobilePage.keyboard.press('Tab');
    assert.equal(await mobilePage.locator('#schema-help-close').evaluate(button => button === document.activeElement), true);
    await mobilePage.keyboard.press('Tab');
    assert.equal(await mobilePage.locator('.schema-help-body').evaluate(body => body === document.activeElement), true,
        'The scrollable guide body is reachable with the keyboard.');
    await mobilePage.keyboard.press('PageDown');
    await mobilePage.waitForFunction(() => document.querySelector('#schema-help-dialog .schema-help-body').scrollTop > 0);
    await mobilePage.locator('.schema-help-body').evaluate(body => { body.scrollTop = 0; });
    await shot(mobilePage, 'help-mobile');
    await mobilePage.locator('#schema-help-done').click();
    assert.equal(await mobilePage.locator('#schema-help-open').evaluate(button => button === document.activeElement), true);
    await mobilePage.locator('#workspace-explorer-open').click();
    await mobilePage.locator('#workspace-context').waitFor();
    const mobilePanel = await mobilePage.locator('#workspace-context').boundingBox();
    assert.ok(mobilePanel.width <= 375 && mobilePanel.height <= 900,
        'The shared explorer fits the mobile drawer.');
    await selectTable('sources', mobilePage);
    assert.equal(await mobilePage.locator('#schema-table-panel').isVisible(), true,
        'A mobile table choice leaves the explorer available for another choice.');
    assert.match(await mobilePage.locator('#schema-selected').innerText(), /sources/);
    await noOverflow(mobilePage, 'Fresh mobile context menu');
    const mobileFocus = await mobilePage.evaluate(() => ({activeId: document.activeElement?.id,
        activeClass: document.activeElement?.className, skipTop: document.querySelector('.skip-link').getBoundingClientRect().top,
        skipStyleTop: getComputedStyle(document.querySelector('.skip-link')).top, scrollY}));
    assert.notEqual(mobileFocus.activeClass, 'skip-link', 'Mobile context selection does not move focus to the global skip link.');
    assert.ok(mobileFocus.skipTop < 0, 'The unfocused skip link remains outside the actual mobile viewport.');
    console.log('Mobile context focus:', JSON.stringify(mobileFocus));
    if (screenshots) await mobilePage.screenshot({path: path.join(screenshots, 'schema-context-mobile-viewport.png')});
    await shot(mobilePage, 'context-mobile');
    await mobilePage.keyboard.press('Escape');
    assert.equal(await mobilePage.locator('#workspace-context').isVisible(), false);
    assert.equal(await mobilePage.locator('#schema-help-open').isVisible(), true, 'Mobile keeps workspace tools available.');
    await mobilePage.locator('#schema-viewport').scrollIntoViewIfNeeded();
    await shot(mobilePage, 'canvas-mobile');
    await mobilePage.close();

    // The catalog below exists only in this browser response. It covers exact
    // composite pairs, parallel constraints, unavailable targets and identifiers
    // that look like markup without ever creating database objects.
    const fixturePage = await context.newPage();
    track(fixturePage);
    const column = (name, primary = false) => ({name, type: 'int(11)', data_type: 'int', primary, nullable: !primary,
        generated: false, default: null, extra: '', comment: ''});
    const foreignKey = (name, columns, target, targets, referenced_schema = 'schema_fixture') =>
        ({name, columns, referenced_table: target, referenced_columns: targets, referenced_schema});
    const fixture = {database: 'schema_fixture', tables: [
        {name: 'parent', type: 'table', comment: '', columns: [column('a', true), column('b', true)], foreign_keys: []},
        {name: 'child<img>', type: 'table', comment: '<script>unsafe</script>', columns: [column('id', true), column('a'), column('b'), column('parent_id')],
            foreign_keys: [foreignKey('composite', ['a', 'b'], 'parent', ['a', 'b']),
                foreignKey('parallel', ['parent_id'], 'parent', ['a']), foreignKey('self', ['parent_id'], 'child<img>', ['id']),
                foreignKey('external', ['a'], 'remote', ['id'], 'other_database')]},
        {name: 'unrelated', type: 'table', comment: '', columns: [column('id', true)], foreign_keys: []},
        {name: 'report_view', type: 'view', comment: '', columns: [column('a')], foreign_keys: []},
    ]};
    let fixtureMode = 'normal';
    await fixturePage.route('**/api.php?action=schema', async route => {
        assert.equal(route.request().method(), 'GET');
        if (fixtureMode === 'error') return route.fulfill({status: 503, json: {ok: false, error: 'Catalog temporarily unavailable',
            error_code: 'database_action_failed', error_i18n: {en: 'Catalog temporarily unavailable', nl: 'Catalogus tijdelijk niet beschikbaar'}}});
        await route.fulfill({json: {ok: true, data: fixtureMode === 'empty' ? {database: fixture.database, tables: []} : fixture}});
    });
    await load(fixturePage);
    assert.equal(await fixturePage.locator('[data-schema-node]').count(), 4);
    assert.equal(await fixturePage.locator('path.schema-edge').count(), 4, 'Two composite paths, parallel constraint and self reference are rendered.');
    assert.equal(await fixturePage.locator('img').count(), 0, 'Table names are rendered as text, never markup.');
    const fixturePairs = await fixturePage.locator('path.schema-edge').evaluateAll(edges => edges.map(edge =>
        [edge.dataset.sourceColumn, edge.dataset.targetTable, edge.dataset.targetColumn].join(':')));
    assert.ok(fixturePairs.includes('a:parent:a') && fixturePairs.includes('b:parent:b'), 'Composite pair order is exact.');
    assert.equal(fixturePairs.some(pair => pair.includes('remote')), false, 'An unavailable external table is not invented.');
    await searchFor('child<img>', fixturePage);
    await selectTable('child<img>', fixturePage);
    await fixturePage.locator('#schema-relationship-details').evaluate(details => { details.open = true; });
    assert.match(await fixturePage.locator('#schema-selected').innerText(), /other_database/,
        'External relationships remain visible as qualified details.');
    await shot(fixturePage, 'composite-self-external');
    fixtureMode = 'error';
    await fixturePage.reload({waitUntil: 'networkidle'});
    await fixturePage.locator('#page .notice-error').waitFor();
    assert.equal(await fixturePage.locator('#workspace-context-content .loading-state').count(), 0,
        'A failed catalog request cannot leave its table explorer loading forever.');
    await fixturePage.locator('#workspace-context-content .notice-error button').waitFor();
    fixtureMode = 'normal';
    await fixturePage.locator('#page .notice-error button').click();
    await fixturePage.locator('#schema-search').waitFor();
    fixtureMode = 'empty';
    await fixturePage.reload({waitUntil: 'networkidle'});
    await fixturePage.locator('#page .empty-state').waitFor();
    assert.equal(await fixturePage.locator('[data-schema-node]').count(), 0);
    assert.equal(await fixturePage.locator('#workspace-explorer-open').count(), 1, 'An empty schema retains its table opener for a collapsed explorer.');
    assert.equal(await fixturePage.locator('#schema-help-open').isVisible(), true, 'Area help remains available before tables are imported.');
    await fixturePage.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('govern.schema-layout.v1.')) throw new DOMException('Test storage unavailable', 'QuotaExceededError');
            return setItem.call(this, key, value);
        };
    });
    fixtureMode = 'normal';
    await fixturePage.reload({waitUntil: 'networkidle'});
    await fixturePage.locator('#schema-search').waitFor();
    await selectTable('parent', fixturePage);
    const fixtureHeader = fixturePage.locator('[data-schema-header="parent"]');
    const storageBefore = await fixturePage.locator('[data-schema-node="parent"]').evaluate(element => element.style.left);
    await fixtureHeader.focus();
    await fixturePage.keyboard.press('ArrowRight');
    assert.notEqual(await fixturePage.locator('[data-schema-node="parent"]').evaluate(element => element.style.left), storageBefore,
        'A storage failure does not prevent movement in the current session.');
    assert.equal(await fixturePage.locator('#schema-explanation').evaluate(details => details.open), true,
        'A failed position save opens its explanation instead of hiding the failure.');
    assert.equal(await fixturePage.locator('.schema-storage').isVisible(), true);
    assert.match(await fixturePage.locator('.schema-storage').innerText(), /could not be saved|konden niet/,
        'A failed position save is explained.');
    await fixturePage.close();
    assert.deepEqual(errors, [], 'The complete schema flow must be free of browser exceptions.');
    console.log('PASS: live schema/foreign-key metadata, composite/self/external relationships, search, zoom, keyboard, dragging, position persistence, NL/EN continuity, routes, drafts, mobile, failure/retry and empty states.');
} finally {
    await context.close();
    await browser.close();
}
