/** Browser checks with deterministic API fixtures; no database writes or running stack. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({executablePath: process.env.BROWSER_BIN || '/usr/bin/chromium', args: ['--no-sandbox']});
const columns = [{name: 'id', data_type: 'int', type: 'int', primary: true}, {name: 'name', data_type: 'varchar', type: 'varchar(100)'}];
const tables = Array.from({length: 40}, (_, i) => ({name: `table_${String(i).padStart(2, '0')}`, type: 'table', columns: 2, rows_estimate: 1}));
const errors = [];
let releaseBrowse;
let holdBrowse = false;
const context = await browser.newContext({locale: 'en-GB', viewport: {width: 1440, height: 900}});
await context.route('http://govern.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api.php') {
        const action = url.searchParams.get('action');
        let data;
        if (action === 'databases') data = {databases: [{name: 'ux_test', available: true}], default: 'ux_test'};
        else if (action === 'bootstrap') data = {database: {name: 'ux_test', status: 'ready'}, tables, csrf: 'fixture'};
        else if (action === 'structure') data = {columns, foreign_keys: [], indexes: [], create_sql: ''};
        else if (action === 'queries') data = [];
        else if (action === 'browse') {
            if (holdBrowse) await new Promise(resolve => { releaseBrowse = resolve; });
            data = {columns, rows: [{id: 1, name: url.searchParams.get('q') || 'Original row'}], key_columns: ['id'], row_keys: [{id: 1}], total: 1, page: 1, page_size: 25, sql: 'SELECT * FROM table_00', params: []};
        } else if (action === 'query') {
            const set = {columns: ['name'], rows: [{name: 'Result row'}], returned_rows: 1, truncated: false};
            data = {statements: [1, 2].map(() => ({sql: 'SELECT name FROM table_00', duration_ms: 1, affected_rows: null, result_sets: [set, set]})), schema_refresh_needed: false};
        } else data = {enabled: false, status: 'disabled'};
        await route.fulfill({json: {ok: true, data}});
    } else {
        const relative = url.pathname === '/' ? 'index.php' : url.pathname.slice(1);
        const body = await readFile(new URL('../app/public/' + relative, import.meta.url));
        await route.fulfill({body, contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html'});
    }
});
try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://govern.test/#gegevens?table=table_00');
    await page.locator('.data-table').waitFor();
    assert.equal(await page.locator('#database-selected-table').count(), 1);
    assert.equal(await page.locator('.database-selection').count(), 0);
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('#navigation [data-area="database"]').click();
    assert.equal(await page.locator('#workspace-context').isVisible(), true);
    assert.equal(await page.locator('.catalog-list').evaluate(list => getComputedStyle(list).overflowY), 'visible');
    await page.locator('#workspace-context-content').evaluate(node => { node.scrollTop = 400; });
    assert.ok(await page.locator('#catalog-search').evaluate(node => { const box = node.getBoundingClientRect(); const panel = document.getElementById('workspace-context-content').getBoundingClientRect(); return box.top >= panel.top && box.bottom <= panel.bottom; }), 'Search stays within the scrolled explorer.');
    holdBrowse = true;
    await page.locator('#data-search').fill('Filtered row');
    await page.waitForFunction(() => document.querySelector('[aria-busy="true"] .data-table'));
    assert.match(await page.locator('.data-table').innerText(), /Original row/);
    assert.equal(await page.locator('.data-table').evaluate(node => Boolean(node.closest('[inert]'))), true);
    assert.match(await page.locator('.data-update-status').innerText(), /Updating/);
    holdBrowse = false; releaseBrowse();
    await page.waitForFunction(() => document.querySelector('.data-table')?.textContent.includes('Filtered row'));
    assert.equal(await page.locator('.data-table').evaluate(node => Boolean(node.closest('[inert]'))), false);
    for (const width of [768, 320]) {
        await page.setViewportSize({width, height: 900});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Records fit at ${width}px`);
    }
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('http://govern.test/#onderzoeken');
    await page.locator('#sql-editor').fill('SELECT name FROM table_00; SELECT name FROM table_00;');
    await page.locator('#run-query').click();
    await page.locator('.query-result > .card').nth(1).waitFor();
    const cards = await page.locator('.query-result > .card').evaluateAll(nodes => nodes.map(n => ({top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom})));
    assert.ok(cards[1].top - cards[0].bottom >= 24, 'Independent result cards have breathing room.');
    assert.equal(await page.locator('.query-result-set').first().evaluate(node => getComputedStyle(node.nextElementSibling).marginTop), '24px');
    for (const width of [768, 320]) {
        await page.setViewportSize({width, height: 900});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}px`);
    }
    await page.setViewportSize({width: 1440, height: 900});
    assert.deepEqual(errors, []);
    console.log('PASS: explorer navigation, single scrolling list, retained rows during loading, result spacing, and responsive widths (fixture API).');
} finally { await browser.close(); }
