/** Native UI -> real preview/create API -> MariaDB/PostgreSQL -> catalog,
 * structure, row editor and independent readback on the isolated test stack.
 * One post-create catalog response is deliberately emptied to test read retry. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
import {clickDatabaseView, selectWorkspaceLanguage} from './workspace-tools.mjs';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use the isolated stack and GOVERN_UI_WRITE_TESTS=1.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Table creation tests require a local disposable stack.');
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [], requests = [], phpMyAdmin = [], pendingCreates = [], cleanup = [], releases = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/phpmyadmin/')) phpMyAdmin.push(url.href);
    if (url.pathname === '/api.php' && request.method() === 'POST') {
        requests.push({action: url.searchParams.get('action'), url: url.href, body: request.postDataJSON()});
    }
});
const dialog = page.locator('#table-builder-dialog');
const stamp = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
const exactDefault = '1234567890123456789012.12345678';
const screenshots = process.env.GOVERN_SCREENSHOT_DIR || process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const shot = async name => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, 'native-table-' + name + '.png'),
        fullPage: page.viewportSize().width > 820, animations: 'disabled'});
};
const key = source => source.scope_key || source.name;
const parameters = source => ({database: source.name,
    ...(source.connection === 'postgres' ? {connection: 'postgres', schema: source.schema} : {})});
const matchesScope = (url, source) => url.searchParams.get('database') === source.name
    && (url.searchParams.get('connection') || 'mariadb') === source.connection
    && (source.connection !== 'postgres' || url.searchParams.get('schema') === source.schema);
const endpoint = (action, source, params = {}) => new URL('/api.php?' + new URLSearchParams({action, ...parameters(source), ...params}), base).href;
const api = async (action, source, params = {}) => {
    const response = await context.request.get(endpoint(action, source, params));
    const payload = await response.json();
    assert.equal(response.ok() && payload.ok, true, JSON.stringify(payload));
    return payload.data;
};
const responseFor = (action, source, table = null) => {
    const pending = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === action && matchesScope(url, source)
            && (table === null || url.searchParams.get('table') === table);
    }, {timeout: 45000});
    // Preserve the first assertion if cleanup closes a page before another
    // expected response arrives; awaiting this promise still reports its error.
    pending.catch(() => {});
    return pending;
};
const read = async (response, source) => {
    assert.equal(matchesScope(new URL(response.url()), source), true, 'The request keeps its complete database/schema scope.');
    const result = await response.json();
    assert.equal(response.ok() && result.ok, true, JSON.stringify(result));
    return result.data;
};
const bounded = async promise => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Expected real API request was not intercepted.')), 10000);
        })]);
    } finally { clearTimeout(timer); }
};
const holdNext = async (action, source, respond = route => route.continue()) => {
    let reached, resume;
    const entered = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    const release = () => { resume(); releases.delete(release); };
    releases.add(release);
    await page.route(url => url.pathname === '/api.php' && url.searchParams.get('action') === action && matchesScope(url, source), async route => {
        reached(route.request()); await gate; await respond(route);
    }, {times: 1});
    return {entered, release};
};
const ready = async source => page.waitForFunction(scope => {
    const picker = document.querySelector('#database-select');
    return picker?.value === scope && !picker.disabled && !document.querySelector('#page > .loading-state');
}, key(source));
const closeSidebar = async () => {
    if (!await page.locator('body').evaluate(node => node.classList.contains('sidebar-open'))) return;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
        const box = document.querySelector('#sidebar').getBoundingClientRect();
        return box.right <= 1 || box.left >= innerWidth - 1;
    });
};
const switchSource = async source => {
    await closeSidebar();
    const loaded = responseFor('bootstrap', source);
    await page.locator('#database-select').selectOption(key(source));
    await loaded; await ready(source); await page.locator('#sql-editor').waitFor();
};
const openBuilder = async () => {
    const entry = page.locator('#workspace-create-table');
    await entry.waitFor({state: 'attached'});
    if (await page.locator('#sidebar').getAttribute('aria-hidden') === 'true' || !await entry.isVisible()) {
        await page.locator('#workspace-explorer-open').click();
    }
    await entry.click(); await dialog.waitFor();
    assert.equal(await page.locator('#database-select').isDisabled(), true, 'An open definition keeps the source picker fixed.');
    assert.equal(await page.locator('#table-builder-name').evaluate(node => node === document.activeElement), true);
};
const cancelBuilder = async source => {
    await page.locator('#table-builder-back').click(); await dialog.waitFor({state: 'hidden'});
    await closeSidebar(); await ready(source);
};
const column = index => dialog.locator('.table-builder-column').nth(index);
const columnInput = (index, suffix) => column(index).locator('[id$="-' + suffix + '"]');
const fillDefinition = async name => {
    await page.locator('#table-builder-name').fill(name);
    await columnInput(0, 'name').fill('label');
    await columnInput(0, 'nullable').uncheck();
    await page.locator('#table-builder-add-identifier').click();
    await page.locator('#table-builder-add-column').click();
    await columnInput(2, 'name').fill('amount');
    await columnInput(2, 'type').selectOption('decimal');
    await columnInput(2, 'precision').fill('30');
    await columnInput(2, 'scale').fill('8');
    await columnInput(2, 'default').selectOption('literal');
    await columnInput(2, 'literal').fill(exactDefault);
};
const definitionValues = () => dialog.locator('.table-builder-column').evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('[id$="-name"]').value, type: node.querySelector('[id$="-type"]').value,
    nullable: node.querySelector('[id$="-nullable"]').checked, primary: node.querySelector('[id$="-primary"]').checked,
    generated: node.querySelector('[id$="-generated"]')?.checked || false, literal: node.querySelector('[id$="-literal"]')?.value || '',
})));
const assertLocked = async () => {
    assert.equal(await dialog.getAttribute('aria-busy'), 'true');
    assert.equal(await dialog.locator('input, select, button').evaluateAll(nodes => nodes.every(node => node.disabled)), true);
    assert.equal(await page.locator('#database-select').isDisabled(), true);
    assert.equal(await page.locator('#manage-databases').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true, 'Escape cannot dismiss pending preview/create work.');
};
const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'The native form fits 320px without horizontal scrolling.');
};
let localePage, csrf;
try {
    await page.goto(new URL('/workspace.php', base).href, {waitUntil: 'networkidle'});
    const initialResponse = await context.request.get(new URL('/api.php?action=bootstrap', base).href);
    const initial = (await initialResponse.json()).data;
    csrf = initial.csrf;
    const maria = initial.databases.find(source => source.connection === 'mariadb' && source.name === initial.database.name && source.available !== false);
    const postgres = initial.databases.find(source => source.connection === 'postgres' && source.schema === 'public' && source.available !== false);
    assert.ok(maria && postgres, 'The test stack provides the default MariaDB database and PostgreSQL public schema.');
    const sources = [maria, postgres], names = ['zz_native_maria_' + stamp, 'zz_native_pg_' + stamp];
    const drafts = ['SELECT 17 AS retained_maria_draft;', 'SELECT 23 AS retained_pg_draft;'];
    for (let index = 0; index < sources.length; index++) cleanup.push({source: sources[index], table: names[index]});
    for (const source of sources) assert.equal((await api('bootstrap', source)).capabilities.create_table, true);

    await clickDatabaseView(page, 'onderzoeken'); await page.locator('#sql-editor').fill(drafts[0]);
    await openBuilder(); await fillDefinition(names[0]);
    const mariaDefinition = await definitionValues();
    await columnInput(2, 'literal').evaluate(node => { node.focus(); node.setSelectionRange(4, 8); });
    localePage = await context.newPage(); localePage.on('pageerror', error => errors.push(error.message));
    await localePage.goto(new URL('/workspace.php#instellingen', base).href, {waitUntil: 'networkidle'});
    await selectWorkspaceLanguage(localePage, 'nl');
    await page.waitForFunction(() => document.documentElement.lang === 'nl');
    assert.deepEqual(await definitionValues(), mariaDefinition, 'An actual cross-tab language change preserves the native draft.');
    assert.equal(await columnInput(2, 'literal').evaluate(node => node === document.activeElement && node.selectionStart === 4 && node.selectionEnd === 8), true);
    await selectWorkspaceLanguage(localePage, 'en'); await page.waitForFunction(() => document.documentElement.lang === 'en');
    await localePage.close(); localePage = null;
    await cancelBuilder(maria);
    assert.equal(requests.filter(request => request.action.startsWith('table-definition-')).length, 0, 'Filling and cancelling a form performs no preview or write.');
    assert.equal((await api('bootstrap', maria)).tables.some(table => table.name === names[0]), false);
    assert.equal(await page.locator('#sql-editor').inputValue(), drafts[0]);

    await switchSource(postgres); await page.locator('#sql-editor').fill(drafts[1]); await openBuilder();
    assert.equal(await page.locator('#table-builder-name').inputValue(), '', 'A different source starts with its own definition.');
    await fillDefinition(names[1]); const pgDefinition = await definitionValues(); await cancelBuilder(postgres);
    await switchSource(maria); await openBuilder();
    assert.equal(await page.locator('#table-builder-name').inputValue(), names[0]);
    assert.deepEqual(await definitionValues(), mariaDefinition, 'Returning to MariaDB restores only its own draft.');
    await cancelBuilder(maria);

    for (let index = 0; index < sources.length; index++) {
        const source = sources[index], table = names[index], mobile = index === 1;
        if (index) await switchSource(source);
        assert.equal(await page.locator('#sql-editor').inputValue(), drafts[index]);
        if (mobile) await page.setViewportSize({width: 320, height: 800});
        else await page.locator('#catalog-search').fill('organizations');
        await openBuilder();
        assert.equal(await page.locator('#table-builder-name').inputValue(), table);
        assert.deepEqual(await definitionValues(), mobile ? pgDefinition : mariaDefinition);
        if (mobile) await noOverflow();
        await shot(mobile ? 'postgres-mobile-edit' : 'mariadb-edit');

        const previewGate = await holdNext('table-definition-preview', source), previewReply = responseFor('table-definition-preview', source);
        await page.locator('#table-builder-review').click();
        const previewRequest = await bounded(previewGate.entered); await assertLocked();
        assert.equal(previewRequest.postDataJSON().name, table);
        assert.equal(previewRequest.postDataJSON().columns[2].default.value, exactDefault);
        assert.equal(Object.hasOwn(previewRequest.postDataJSON(), 'sql'), false, 'The native form sends a definition, never free SQL.');
        assert.ok(previewRequest.headers()['x-csrf-token']);
        const other = sources[1 - index];
        await page.evaluate(scope => { location.hash = '#onderzoeken?' + new URLSearchParams({database: scope}); }, key(other));
        await page.waitForFunction(scope => new URLSearchParams(location.hash.split('?')[1]).get('database') === scope, key(source));
        assert.equal(await dialog.isVisible(), true, 'A pending definition cannot move into another source through a URL change.');
        previewGate.release(); const preview = await read(await previewReply, source);
        await page.locator('#table-builder-create:not([disabled])').waitFor();
        assert.equal(preview.table, table); assert.match(preview.sql, /^CREATE TABLE /);
        assert.equal((await api('bootstrap', source)).tables.some(item => item.name === table), false, 'Review alone creates no table.');
        await shot(mobile ? 'postgres-mobile-review' : 'mariadb-review');

        const createGate = await holdNext('table-definition-create', source), createReply = responseFor('table-definition-create', source);
        pendingCreates.push(createReply);
        const newBrowse = responseFor('browse', source, table);
        await page.locator('#table-builder-create').click();
        const createRequest = await bounded(createGate.entered); await assertLocked();
        assert.deepEqual(createRequest.postDataJSON(), {definition: preview.definition, definition_token: preview.definition_token});
        // CREATE still reaches the real database. Only its first catalog readback
        // is made empty, so a recovery action must re-read rather than re-create.
        const refreshGate = !mobile ? await holdNext('bootstrap', source, async route => {
            const response = await route.fetch(), payload = await response.json();
            assert.equal(response.ok() && payload.ok, true, JSON.stringify(payload));
            assert.equal(payload.data.tables.some(item => item.name === table), true, 'The table exists before the one-shot empty catalog fixture.');
            payload.data.tables = [];
            await route.fulfill({response, json: payload});
        }) : null;
        createGate.release(); const created = await read(await createReply, source);
        assert.equal(created.created, true); assert.equal(created.table, table); assert.equal(created.database, source.name);
        if (source.connection === 'postgres') assert.equal(created.schema, source.schema);
        if (refreshGate) {
            await bounded(refreshGate.entered); await dialog.waitFor({state: 'hidden'});
            assert.equal(await page.locator('#database-select').isDisabled(), true, 'The host keeps the source fixed until post-create catalog refresh finishes.');
            assert.equal(await page.locator('.app-shell').evaluate(node => node.inert), true);
            refreshGate.release();
            await page.locator('#table-builder-open').waitFor();
            assert.equal(await dialog.isVisible(), true);
            const success = await dialog.locator('h3[role="status"]').innerText();
            assert.ok(success.includes(table)); assert.match(success, /\bcreated\b/i);
            assert.equal(await page.locator('#table-builder-create').count(), 0, 'A failed readback never offers a second CREATE.');
            await page.locator('#table-builder-error').waitFor();
            assert.equal(await page.locator('.app-shell').evaluate(node => node.inert), false, 'A failed catalog refresh releases the outer refresh lock.');
            assert.equal(await page.locator('#database-select').isDisabled(), true, 'The reopened result dialog still keeps its source fixed.');
            assert.equal((await api('bootstrap', source)).tables.some(item => item.name === table), true);
            const createsBeforeRetry = requests.filter(request => request.action === 'table-definition-create').length;
            await shot('mariadb-readback-retry');
            await page.locator('#table-builder-open').click();
            await read(await newBrowse, source);
            assert.equal(requests.filter(request => request.action === 'table-definition-create').length, createsBeforeRetry, 'Retry opening the created table only reads the database.');
        }
        assert.deepEqual((await read(await newBrowse, source)).rows, []);
        await dialog.waitFor({state: 'hidden'}); await ready(source); await closeSidebar();
        await page.locator('.table-workspace .empty-state').waitFor();
        assert.equal(await page.locator('.app-shell').evaluate(node => node.inert), false, 'The outer refresh lock releases after opening the created table.');
        assert.equal(await page.locator('#database-select').isDisabled(), false);
        assert.equal(await page.evaluate(() => location.hash.slice(1).split('?')[0]), 'gegevens', 'Successful creation opens Browse.');
        assert.equal(await page.locator('#database-selected-table').innerText(), table);
        assert.equal(await page.locator('#catalog-search').inputValue(), '', 'A prior sidebar filter cannot hide the created table.');
        assert.equal(await page.locator('#workspace-context .catalog-item-name').filter({hasText: new RegExp('^' + table + '$')}).count(), 1);
        assert.equal((await api('bootstrap', source)).tables.some(item => item.name === table), true);
        assert.equal((await api('bootstrap', other)).tables.some(item => item.name === table), false, 'Creation does not leak into another connection.');
        if (source.connection === 'postgres') {
            const archive = initial.databases.find(item => item.connection === 'postgres' && item.schema === 'archive');
            assert.ok(archive); assert.equal((await api('bootstrap', archive)).tables.some(item => item.name === table), false, 'Creation stays in the selected PostgreSQL schema.');
        }

        await clickDatabaseView(page, 'structuur'); await page.locator('.table-heading h2').waitFor();
        const structure = await api('structure', source, {table});
        assert.deepEqual(structure.columns.map(item => item.name), ['id', 'label', 'amount']);
        assert.equal(structure.columns.find(item => item.name === 'id').primary, true);
        assert.match(structure.columns.find(item => item.name === 'amount').type, /decimal|numeric/i);
        assert.ok(String(structure.columns.find(item => item.name === 'amount').default).includes(exactDefault));
        for (const name of ['id', 'label', 'amount']) await page.locator('.table-workspace .column-name').filter({hasText: new RegExp('^' + name + '$')}).waitFor();
        await clickDatabaseView(page, 'gegevens'); await page.locator('#add-row').click();
        const editor = page.locator('#row-editor-dialog'); await editor.waitFor();
        const field = name => editor.locator('[data-row-field="' + name + '"]');
        const mode = name => editor.locator('[data-row-mode="' + name + '"]');
        assert.equal(await mode('id').inputValue(), 'default', 'The generated identifier is used by the normal row editor.');
        assert.equal(await mode('amount').inputValue(), 'default'); await mode('label').selectOption('value');
        const label = source.connection + ' native <record> ' + stamp;
        await field('label').fill(label);
        const insertedReply = responseFor('insert-row', source); await editor.locator('#row-editor-save').click();
        const inserted = await read(await insertedReply, source);
        assert.match(String(inserted.row.id), /^\d+$/); assert.equal(inserted.row.label, label); assert.equal(inserted.row.amount, exactDefault);
        await editor.waitFor({state: 'hidden'});
        await page.locator('.table-workspace .data-table tbody tr').filter({hasText: label}).waitFor();
        assert.equal(await page.locator('.table-workspace record').count(), 0, 'New records are rendered as literal text.');
        const beforeCollision = await api('browse', source, {table});
        assert.equal(beforeCollision.rows.length, 1); assert.equal(beforeCollision.rows[0].amount, exactDefault);
        await shot(mobile ? 'postgres-mobile-created' : 'mariadb-created');

        await clickDatabaseView(page, 'onderzoeken');
        assert.equal(await page.locator('#sql-editor').inputValue(), drafts[index], 'Create, refresh and insert preserve previously written SQL.');
        await openBuilder();
        assert.equal(await page.locator('#table-builder-name').inputValue(), '', 'A completed creation starts a fresh next definition.');
        await page.locator('#table-builder-name').fill(table); await columnInput(0, 'name').fill('replacement');
        const countBeforeCollision = requests.filter(request => request.action === 'table-definition-create').length;
        const collisionReply = responseFor('table-definition-preview', source); await page.locator('#table-builder-review').click();
        const collisionResponse = await collisionReply, collision = await collisionResponse.json();
        assert.equal(collisionResponse.status(), 409); assert.equal(collision.error_code, 'table_definition_exists');
        await page.locator('#table-builder-error').waitFor();
        assert.equal(await page.locator('#table-builder-name').inputValue(), table); assert.equal(await page.locator('#table-builder-create').count(), 0);
        assert.equal(requests.filter(request => request.action === 'table-definition-create').length, countBeforeCollision);
        assert.deepEqual((await api('browse', source, {table})).rows, beforeCollision.rows, 'A collision preserves the existing records.');
        assert.deepEqual((await api('structure', source, {table})).columns.map(item => item.name), ['id', 'label', 'amount']);
        await cancelBuilder(source); assert.equal(await page.locator('#sql-editor').inputValue(), drafts[index]);
    }
    assert.equal(requests.filter(request => request.action === 'table-definition-create').length, 2, 'Only the two explicitly confirmed definitions are created.');
    assert.deepEqual(phpMyAdmin, [], 'Native table creation and row editing need no phpMyAdmin request.');
    assert.deepEqual(errors, []);
    console.log('PASS: real MariaDB/PostgreSQL native creation, explicit review/token, pending scope/refresh guards, one-shot empty-readback recovery without duplicate CREATE, language and per-source drafts, cancel/no-write, exact defaults, structure/insert/readback, collision preservation and 320px mobile.');
} finally {
    for (const release of releases) release();
    await Promise.allSettled(pendingCreates);
    const cleanupErrors = [];
    for (const {source, table} of cleanup) {
        const quote = name => source.connection === 'postgres' ? '"' + name.replaceAll('"', '""') + '"' : '`' + name.replaceAll('`', '``') + '`';
        const sql = 'DROP TABLE IF EXISTS ' + quote(source.connection === 'postgres' ? source.schema : source.name) + '.' + quote(table) + ';';
        try {
            const response = await context.request.post(endpoint('query', source), {headers: {'X-CSRF-Token': csrf}, data: {sql, confirm: true}});
            const payload = await response.json();
            if (!response.ok() || !payload.ok || payload.data.failed) cleanupErrors.push(JSON.stringify(payload));
        } catch (error) { cleanupErrors.push(error.message); }
    }
    await localePage?.close(); await context.close(); await browser.close();
    if (cleanupErrors.length) throw new Error('Disposable table cleanup failed: ' + cleanupErrors.join('; '));
}
