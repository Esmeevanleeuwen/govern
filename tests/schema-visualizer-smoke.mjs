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
    if (screenshots) await page.screenshot({path: path.join(screenshots, 'schema-' + name + '.png'), fullPage: true});
};
const load = async (page, hash = '#schema') => {
    await page.goto(new URL('/' + hash, base).href, {waitUntil: 'networkidle'});
    await page.locator('#schema-search').waitFor();
};
const selectTable = async (name, current = page) => {
    // This is the accessible index, also useful when a table is outside the canvas.
    await current.locator('[data-schema-select=' + JSON.stringify(name) + ']').first().click();
};
const node = name => page.locator('[data-schema-node]').filter({has: page.locator('[data-schema-header="' + name + '"]')});
const position = name => node(name).evaluate(element => ({x: parseFloat(element.style.left), y: parseFloat(element.style.top)}));
const noOverflow = async (page, label) => assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth), true, label + ' must not make the document scroll sideways.');

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
    await noOverflow(page, 'Desktop schema');
    await shot(page, 'all-tables-nl');

    const table = schema.tables.find(table => table.name === 'sources') || schema.tables[0];
    await page.locator('#schema-search').fill(table.name);
    await selectTable(table.name);
    await page.locator('#schema-actual').click();
    await page.locator('#schema-selected').waitFor();
    assert.match(await page.locator('#schema-selected').innerText(), new RegExp(table.name));
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
    assert.equal(await page.locator('#schema-search').inputValue(), '', 'Direct connections clears a narrowed search.');
    const neighbors = new Set([table.name]);
    schema.tables.forEach(source => source.foreign_keys.forEach(key => {
        if (key.referenced_schema !== schema.database) return;
        if (source.name === table.name) neighbors.add(key.referenced_table);
        if (key.referenced_table === table.name) neighbors.add(source.name);
    }));
    assert.deepEqual((await page.locator('[data-schema-node]').evaluateAll(nodes => nodes.map(node => node.dataset.schemaNode))).sort(),
        [...neighbors].sort(), 'Searching, selecting and Direct connections reveals the exact one-hop neighborhood.');
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
    await page.locator('#schema-search').fill(table.name);
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
    await page.locator('#schema-search').fill('no_such_table_or_column_8237');
    assert.equal(await page.locator('[data-schema-node]').count(), 0, 'Search has a filtered-empty state.');
    await page.locator('#schema-search').fill('');
    assert.equal(await page.locator('[data-schema-node]').count(), schema.tables.length);
    await page.locator('#schema-search').fill('parent_function_id');
    assert.ok(await page.locator('[data-schema-node="public_functions"]').count(), 'Search finds columns as well as tables.');
    await page.locator('#schema-search').fill('');
    await selectTable('public_functions');
    const allCount = await page.locator('[data-schema-node]').count();
    await page.locator('#schema-neighborhood').check();
    assert.ok(await page.locator('[data-schema-node]').count() < allCount, 'Neighborhood filters to related tables.');
    await page.locator('#schema-neighborhood').uncheck();
    await selectTable(table.name);
    await page.locator('#schema-browse').click();
    await page.waitForFunction(name => location.hash.startsWith('#gegevens') &&
        new URLSearchParams(location.hash.split('?')[1]).get('table') === name, table.name);
    await page.locator('.table-heading').waitFor();
    await load(page);
    await selectTable(table.name);
    await page.locator('#schema-structure').click();
    await page.waitForFunction(name => location.hash.startsWith('#structuur') &&
        new URLSearchParams(location.hash.split('?')[1]).get('table') === name, table.name);
    await page.locator('.structure-section').first().waitFor();

    // Navigating to the diagram does not replace research in progress.
    await page.goto(new URL('/#onderzoeken', base).href);
    await page.locator('#sql-editor').waitFor();
    const draft = 'SELECT 42 AS kept_schema_draft;';
    await page.locator('#sql-editor').fill(draft);
    await load(page);
    await page.locator('#settings-shortcut').click();
    await page.locator('#preference-theme').selectOption('dark');
    await page.goto(new URL('/#schema', base).href);
    await page.locator('#schema-search').waitFor();
    await page.locator('#schema-search').fill('organizations');
    await selectTable('organizations');
    await page.locator('#schema-fit').click();
    await shot(page, 'selection-dark-en');
    await page.locator('#settings-shortcut').click();
    await page.locator('#preference-reduceTransparency').check();
    await page.goto(new URL('/#schema', base).href);
    await page.locator('#schema-search').waitFor();
    assert.equal(await page.locator('.schema-node, .schema-node-header, #schema-viewport').evaluateAll(nodes =>
        nodes.every(element => getComputedStyle(element).backdropFilter === 'none')), true,
        'Schema materials support reduced transparency.');
    assert.deepEqual(await page.locator('.schema-node,.schema-node-header,.schema-aside,#schema-viewport,.schema-toolbar .button,.schema-toolbar .input,.schema-relation').evaluateAll(nodes =>
        nodes.filter(element => ['top', 'right', 'bottom', 'left'].some(side => {
            const style = getComputedStyle(element);
            return parseFloat(style.getPropertyValue('border-' + side + '-width')) > 0 &&
                style.getPropertyValue('border-' + side + '-style') !== 'none' &&
                !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.getPropertyValue('border-' + side + '-color'));
        })).map(element => element.className)), [], 'Schema surfaces have no hard decorative borders.');
    await page.goto(new URL('/#onderzoeken', base).href);
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), draft, 'Schema/settings navigation retains research.');

    await page.setViewportSize({width: 375, height: 900});
    await load(page);
    await page.locator('#schema-search').fill('sources');
    await selectTable('sources');
    await page.locator('#schema-actual').click();
    await noOverflow(page, '375px schema');
    await shot(page, 'mobile');
    await page.setViewportSize({width: 320, height: 800});
    await noOverflow(page, '320px schema');

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
    await fixturePage.locator('#schema-search').fill('child<img>');
    await selectTable('child<img>', fixturePage);
    assert.match(await fixturePage.locator('#schema-selected').innerText(), /other_database/,
        'External relationships remain visible as qualified details.');
    await shot(fixturePage, 'composite-self-external');
    fixtureMode = 'error';
    await fixturePage.reload({waitUntil: 'networkidle'});
    await fixturePage.locator('#page .notice-error').waitFor();
    fixtureMode = 'normal';
    await fixturePage.locator('#page .notice-error button').click();
    await fixturePage.locator('#schema-search').waitFor();
    fixtureMode = 'empty';
    await fixturePage.reload({waitUntil: 'networkidle'});
    await fixturePage.locator('#page .empty-state').waitFor();
    assert.equal(await fixturePage.locator('[data-schema-node]').count(), 0);
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
    assert.match(await fixturePage.locator('.schema-storage').innerText(), /could not be saved|konden niet/,
        'A failed position save is explained.');
    await fixturePage.close();
    assert.deepEqual(errors, [], 'The complete schema flow must be free of browser exceptions.');
    console.log('PASS: live schema/foreign-key metadata, composite/self/external relationships, search, zoom, keyboard, dragging, position persistence, NL/EN continuity, routes, drafts, mobile, failure/retry and empty states.');
} finally {
    await context.close();
    await browser.close();
}
