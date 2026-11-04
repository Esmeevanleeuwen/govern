/** Core database tasks on the real isolated stack. Only the empty PostgreSQL
 * catalog is a response fixture; SELECT and file preflight use the real API. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
import {clickDatabaseView, clickDatabaseTool, openQueryLibrary} from './workspace-tools.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use the isolated local test stack.');
const screenshots = process.env.GOVERN_SCREENSHOT_DIR || process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [], posts = [], phpMyAdmin = [];
const track = current => {
    current.on('pageerror', error => errors.push(error.message));
    current.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api.php' && request.method() === 'POST') posts.push(url.searchParams.get('action'));
        if (url.pathname.startsWith('/phpmyadmin/')) phpMyAdmin.push(url.href);
    });
};
track(page);
const shot = async (current, name) => {
    if (screenshots) await current.screenshot({path: path.join(screenshots, 'simple-' + name + '.png'), fullPage: true});
};
const fits = async (current, label) => assert.equal(await current.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth), true, label + ' fits the viewport.');
const exact = value => new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const tableButton = (current, name) => current.locator('#workspace-context .catalog-item').filter({
    has: current.locator('.catalog-item-name', {hasText: exact(name)}),
});
const responseFor = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const switchScope = async scope => {
    const loading = responseFor('bootstrap');
    await page.locator('#database-select').selectOption(scope);
    await loading;
    await page.waitForFunction(value => document.querySelector('#database-select')?.value === value
        && !document.querySelector('#database-select').disabled, scope);
    await page.locator('#sql-editor').waitFor();
};
const bounded = async promise => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Preview request not intercepted.')), 10000);
        })]);
    } finally { clearTimeout(timer); }
};
let emptyContext, mobileContext, releasePreview;
try {
    await page.goto(new URL('/workspace.php', base).href, {waitUntil: 'networkidle'});
    await page.locator('#database-selected-table').waitFor();
    const catalog = await page.evaluate(async () => (await (await fetch('/api.php?action=bootstrap')).json()).data);
    const first = catalog.scope_key || catalog.database.scope_key || catalog.database.name;
    const second = catalog.databases.find(item => item.connection === 'mariadb' && item.available !== false
        && (item.scope_key || item.name) !== first);
    const postgres = catalog.databases.find(item => item.connection === 'postgres' && item.schema === 'public' && item.available !== false);
    assert.ok(second && postgres && catalog.tables.length > 1, 'Seed two MariaDB scopes, PostgreSQL public and the sample tables.');
    const secondScope = second.scope_key || second.name, pgScope = postgres.scope_key;
    assert.equal(await page.evaluate(() => location.hash.slice(1).split('?')[0]), 'gegevens', 'New work opens Browse.');
    assert.deepEqual(await page.locator('.database-views [data-database-view]').evaluateAll(links => links.map(link => link.dataset.databaseView)),
        ['gegevens', 'structuur', 'onderzoeken']);
    assert.equal(await page.locator('#navigation [data-area="research"]').count(), 0);
    assert.equal(await page.locator('#open-database').isVisible(), false);
    assert.equal(await page.locator('[data-database-tool="import"]').isVisible(), true);
    assert.equal(await page.locator('[data-database-tool="export"]').isVisible(), true);
    assert.equal(await page.locator('.workspace-table-details').evaluate(node => node.open), false);
    await fits(page, 'Desktop Browse');
    await shot(page, 'browse-desktop');
    const selected = await page.locator('#database-selected-table').innerText();
    await clickDatabaseView(page, 'structuur');
    await page.locator('.table-heading h2').waitFor();
    assert.equal(await page.locator('#database-selected-table').innerText(), selected);
    await clickDatabaseView(page, 'onderzoeken');
    assert.equal(await page.locator('#workspace-context .catalog-item').count(), catalog.tables.length);
    assert.equal(await page.locator('.query-builder').evaluate(node => node.open), false);
    assert.equal(await page.locator('#query-library').evaluate(node => node.open), false);
    assert.equal(await page.locator('#sql-editor').evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('.query-builder')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    const draftA = 'SELECT 42 AS simple_workspace_a;', draftB = 'SELECT 73 AS simple_workspace_b;';
    await page.locator('#sql-editor').fill(draftA);
    const alternate = catalog.tables.find(table => table.name !== selected).name;
    await tableButton(page, alternate).click();
    await page.waitForFunction(name => document.querySelector('#database-selected-table')?.textContent === name, alternate);
    assert.equal(await page.locator('#sql-editor').inputValue(), draftA, 'Picking another table preserves written SQL.');
    const query = responseFor('query');
    await page.locator('#run-query').click();
    const executed = await query, result = await executed.json();
    assert.equal(new URL(executed.url()).searchParams.get('database'), catalog.database.name);
    assert.equal(result.ok, true);
    assert.equal(result.data.failed, null);
    await page.locator('.query-result .data-table td').filter({hasText: /^42$/}).waitFor();
    await shot(page, 'sql-desktop');
    await openQueryLibrary(page);
    await page.locator('#query-name').fill('A retained title');
    await page.locator('#query-notes').fill('A retained note');
    await switchScope(secondScope);
    assert.notEqual(await page.locator('#sql-editor').inputValue(), draftA);
    assert.equal(await page.locator('#query-library').evaluate(node => node.open), false);
    assert.equal(await page.locator('.query-result .data-table').count(), 0);
    await page.locator('#sql-editor').fill(draftB);
    await switchScope(first);
    await page.waitForFunction(value => document.querySelector('#sql-editor')?.value === value, draftA);
    assert.equal(await page.locator('#query-library').evaluate(node => node.open), true);
    assert.equal(await page.locator('#query-name').inputValue(), 'A retained title');
    assert.equal(await page.locator('#query-notes').inputValue(), 'A retained note');
    assert.equal(await page.locator('#database-selected-table').innerText(), alternate);
    await page.locator('.query-result .data-table td').filter({hasText: /^42$/}).waitFor();
    await switchScope(secondScope);
    assert.equal(await page.locator('#sql-editor').inputValue(), draftB);
    await switchScope(first);
    const more = page.locator('#database-tools > summary');
    await more.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#database-tools').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#database-tools').evaluate(node => node.open), false);
    assert.equal(await more.evaluate(node => node === document.activeElement), true);
    await clickDatabaseView(page, 'schema');
    await page.locator('#schema-viewport').waitFor();
    await clickDatabaseView(page, 'gegevens');

    // Routine imports use Govern's two tabs and do not contact phpMyAdmin.
    await clickDatabaseTool(page, 'import');
    await page.locator('#database-dialog.native-import-mode').waitFor();
    assert.deepEqual(await page.locator('.database-tabs [role="tab"]:visible').evaluateAll(tabs => tabs.map(tab => tab.id)),
        ['database-tab-native-import', 'database-tab-dataset']);
    assert.equal(await page.locator('#database-frame').isVisible(), false);
    assert.deepEqual(phpMyAdmin, []);
    await page.locator('#database-tab-native-import').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#database-tab-dataset').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#database-tab-native-import').getAttribute('aria-selected'), 'true');
    await page.locator('#native-import-file').setInputFiles({name: 'inspect-only.sql', mimeType: 'text/plain', buffer: Buffer.from('SELECT 1;')});
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { releasePreview = resolve; });
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'native-import-preview', async route => {
        reached(); await gate; await route.continue();
    }, {times: 1});
    const preview = responseFor('native-import-preview');
    await page.locator('#native-import-preview').click();
    await bounded(waiting);
    for (const selector of ['#modal-database', '#database-tab-native-import', '#database-tab-dataset', '#native-import-file', '#native-import-preview', '#advanced-import']) {
        assert.equal(await page.locator(selector).isDisabled(), true, selector + ' is locked during preflight.');
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#database-dialog').isVisible(), true);
    releasePreview(); releasePreview = null;
    const planned = await (await preview).json();
    assert.equal(planned.ok, true);
    await page.locator('#native-import-confirm:not([disabled])').waitFor();
    const confirmation = planned.data.confirmation || catalog.database.name;
    await page.locator('#native-import-confirm').fill(confirmation);
    await page.locator('#database-tab-dataset').click();
    await page.locator('#database-tab-native-import').click();
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.equal(await page.locator('#native-import-file').evaluate(node => node.files.length), 1);
    assert.equal(await page.locator('#native-import-confirm').inputValue(), confirmation);
    assert.equal(await page.locator('#native-import-run').isEnabled(), true);
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    await fits(page, 'Native import'); await shot(page, 'import-desktop');
    await page.locator('#modal-database').selectOption(pgScope);
    assert.equal(await page.locator('#database-tab-native-import').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#native-import-file').evaluate(node => node.files.length), 0);
    assert.equal(await page.locator('#native-import-confirm').inputValue(), '');
    assert.equal(await page.locator('#advanced-import').isVisible(), false);
    assert.equal(await page.locator('#database-frame').isVisible(), false);
    assert.deepEqual(phpMyAdmin, [], 'Normal import and source changes need no phpMyAdmin request.');
    await page.locator('#modal-database').selectOption(first);
    await page.locator('#advanced-import').click();
    await page.frameLocator('#database-frame').locator('#input_import_file').waitFor();
    assert.equal(await page.locator('.native-import').isVisible(), false, 'Advanced import has one official import form.');
    assert.ok(phpMyAdmin.length > 0);
    await page.locator('.database-dialog-header .modal-tools button').last().click();
    await page.locator('#database-dialog').waitFor({state: 'hidden'});

    // The empty-catalog fixture tests UI guidance; it does not create a table.
    emptyContext = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
    const empty = await emptyContext.newPage(); track(empty);
    await empty.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === 'bootstrap', async route => {
        const response = await route.fetch(), payload = await response.json();
        payload.data.tables = [];
        await route.fulfill({response, json: payload});
    });
    await empty.goto(new URL('/workspace.php#gegevens?' + new URLSearchParams({database: pgScope}), base).href, {waitUntil: 'networkidle'});
    await empty.locator('#create-table-sql').click();
    await empty.locator('#sql-editor').waitFor();
    assert.match(await empty.locator('#sql-editor').inputValue(), /CREATE TABLE "public"\."new_table"/);
    assert.match(await empty.locator('#sql-editor').inputValue(), /GENERATED BY DEFAULT AS IDENTITY/);
    assert.equal(await empty.locator('.query-result .data-table').count(), 0);
    assert.equal(await empty.locator('.query-builder, #query-library').count(), 0);
    await shot(empty, 'postgres-empty-sql');

    mobileContext = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 320, height: 760}, isMobile: true, hasTouch: true});
    const mobile = await mobileContext.newPage(); track(mobile);
    await mobile.goto(new URL('/workspace.php', base).href, {waitUntil: 'networkidle'});
    await mobile.locator('#database-selected-table').waitFor();
    await fits(mobile, '320px Browse'); await shot(mobile, 'browse-mobile');
    await clickDatabaseView(mobile, 'onderzoeken');
    await mobile.locator('#sql-editor').fill('SELECT 91 AS mobile_draft;');
    await mobile.locator('#workspace-explorer-open').click();
    await tableButton(mobile, alternate).click();
    await mobile.keyboard.press('Escape');
    assert.equal(await mobile.locator('#workspace-context').isVisible(), false);
    assert.equal(await mobile.locator('#sql-editor').inputValue(), 'SELECT 91 AS mobile_draft;');
    await fits(mobile, '320px SQL'); await shot(mobile, 'sql-mobile');
    await clickDatabaseTool(mobile, 'import');
    await mobile.locator('#native-import-file').waitFor();
    await fits(mobile, '320px native import'); await shot(mobile, 'import-mobile');
    assert.deepEqual(posts, ['query', 'native-import-preview'], 'Navigation, previews and empty-table guidance never execute writes.');
    assert.deepEqual(errors, []);
    console.log('PASS: simple defaults, shared catalog, SQL scope/draft/results, native import/keyboard/language, advanced fallback, empty PostgreSQL guidance and 320px layout.');
} catch (error) {
    await shot(page, 'failure').catch(() => {});
    throw error;
} finally {
    releasePreview?.();
    await mobileContext?.close();
    await emptyContext?.close();
    await context.close();
    await browser.close();
}
