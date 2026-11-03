/** Real record comparison plus shared dialog movement, dismissal and load isolation. */
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
const errors = [], mutations = [], recordRequests = [];
let phase = 'initial explorer';
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname !== '/api.php') return;
    if (request.method() !== 'GET' && url.searchParams.get('action') !== 'record-map') mutations.push(url.searchParams.get('action'));
    if (url.searchParams.get('action') === 'explore') recordRequests.push(Object.fromEntries(url.searchParams));
});
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (database, table) => new URL('/workspace.php#verkennen?' + new URLSearchParams({database, table}), base).href;
const ready = async () => {
    await page.locator('[data-flexible-explorer]').waitFor();
    if (!await page.locator('[data-record-node][aria-pressed="true"]').count()) {
        if (!await page.locator('#record-map-sources').isVisible()) {
            const toggle = page.locator('#record-map-sources-toggle'); await toggle.focus(); await toggle.press('Enter');
        }
        const first = page.locator('#record-map-records [data-map-record]').first();
        await first.waitFor(); await first.focus(); await first.press('Enter');
    }
    await page.locator('#explorer-open-window').waitFor();
};
const countWindows = count => page.waitForFunction(count => document.querySelectorAll('dialog.record-window[open]').length === count, count);
const fitsViewport = locator => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
});
const moveWindow = async (locator, x, y) => {
    await locator.locator('.modal-shell-header').focus();
    const box = await locator.boundingBox(), handle = await locator.locator('.modal-shell-header').boundingBox();
    await page.mouse.move(handle.x + 24, handle.y + 18); await page.mouse.down();
    await page.mouse.move(handle.x + 24 + x - box.x, handle.y + 18 + y - box.y, {steps: 8}); await page.mouse.up();
};
const screenshot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), animations: 'disabled'});
};

try {
    const initialResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api.php' && url.searchParams.get('action') === 'record-map-records'
            && url.searchParams.get('table') === 'demo_organizations';
    });
    await page.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'});
    const initialUrl = new URL((await initialResponse).url());
    initialUrl.searchParams.set('action', 'explore');
    const metadataResponse = await context.request.get(initialUrl.href);
    const metadata = await metadataResponse.json();
    assert.ok(metadataResponse.ok() && metadata.ok, 'Read floating-window fixture metadata from the same actual scope.');
    const initial = metadata.data;
    await ready();
    const center = initial.nodes.find(node => node.id === initial.center);
    const portal = initial.nodes.find(node => node.table === 'demo_systems' && node.key.id === '1');
    assert.equal(center.label, 'Northbridge Council');
    assert.equal(portal.label, 'Resident Services Portal');

    // A single row action opens the next comparison without dismissing a peer.
    phase = 'record comparison';
    await page.locator('#explorer-open-window').click();
    await countWindows(1);
    const first = page.locator('dialog.record-window').first();
    await first.getByText('Northbridge Council', {exact: true}).first().waitFor();
    const firstId = await first.getAttribute('id');
    assert.equal(await first.getAttribute('data-record-scope'), publicKey);
    assert.equal(await first.getAttribute('data-record-table'), center.table);
    assert.deepEqual(JSON.parse(await first.getAttribute('data-record-key')), center.key);

    const peerLauncher = first.locator(`[data-record-window-link="${portal.id}"]`);
    await peerLauncher.focus();
    await peerLauncher.press('Enter');
    await countWindows(2);
    const second = page.locator('dialog.record-window').last();
    await second.getByText('Resident Services Portal', {exact: true}).first().waitFor();
    assert.deepEqual(JSON.parse(await second.getAttribute('data-record-key')), portal.key);
    assert.equal(await second.getAttribute('data-record-table'), portal.table);
    assert.equal(await page.locator('#' + firstId).isVisible(), true);
    assert.ok((await page.locator('#' + firstId).innerText()).includes('Northbridge Council'), 'A new window keeps its peer’s original record.');
    const firstBox = await first.boundingBox(), secondBox = await second.boundingBox();
    await page.mouse.click(firstBox.x + 12, firstBox.y + 18);
    await countWindows(2);
    assert.ok(Number(await first.evaluate(element => element.style.zIndex)) > Number(await second.evaluate(element => element.style.zIndex)),
        'Clicking a peer brings it forward without dismissing another window.');
    await page.mouse.click(secondBox.x + secondBox.width - 12, secondBox.y + 18);
    await countWindows(2);
    const peerReadsBeforeLanguage = recordRequests.filter(request => request.table === portal.table).length;
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    await page.waitForFunction(() => document.documentElement.lang === 'nl');
    assert.ok((await second.innerText()).includes('Resident Services Portal'), 'Translating chrome preserves source data.');
    await ready();
    assert.equal(recordRequests.filter(request => request.table === portal.table).length, peerReadsBeforeLanguage,
        'Translating an independent record window does not refetch its record.');
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    await ready();
    await moveWindow(first, 390, 12);
    await moveWindow(second, 900, 12);
    await page.evaluate(() => window.scrollTo(0, 0));
    await screenshot('record-comparison-windows');
    if (process.env.SCREENSHOTS_DIR) await page.screenshot({path: '/tmp/govern-modal-comparison.png', animations: 'disabled'});
    await page.setViewportSize({width: 320, height: 800});
    await page.waitForFunction(() => [...document.querySelectorAll('dialog.record-window[open]')].every(element => {
        const box = element.getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    }));
    assert.equal(await fitsViewport(first), true);
    assert.equal(await fitsViewport(second), true);
    if (process.env.SCREENSHOTS_DIR) await page.screenshot({path: '/tmp/govern-modal-mobile.png', animations: 'disabled'});
    await page.setViewportSize({width: 1440, height: 1000});

    // Switching the workspace never silently repoints an already opened record.
    phase = 'scope switch';
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(archiveKey, 'govern_pg_values')).hash);
    await ready();
    await page.locator('#record-map-inspector h3').filter({hasText: 'Archive-only row'}).waitFor();
    await countWindows(2);
    for (const window of await page.locator('dialog.record-window').all()) {
        assert.equal(await window.getAttribute('data-record-scope'), publicKey);
        assert.ok((await window.innerText()).includes('govern_pg') && (await window.innerText()).includes('public'));
    }
    assert.ok(recordRequests.some(request => request.connection === 'postgres' && request.database === 'govern_pg'
        && request.schema === 'public' && request.table === portal.table && JSON.parse(request.key || '{}').id === '1'),
    'A record window fetches the exact clicked key in its captured schema.');
    await page.mouse.click(2, 2);
    await countWindows(1);
    await page.keyboard.press('Escape');
    await countWindows(0);

    phase = 'mismatched response';
    const wrongScope = url => url.pathname === '/api.php' && url.searchParams.get('action') === 'explore'
        && url.searchParams.get('table') === portal.table && url.searchParams.get('schema') === 'public';
    await page.route(wrongScope, async route => {
        const response = await route.fetch();
        const payload = await response.json(); payload.data.scope_key = archiveKey;
        await route.fulfill({response, json: payload});
    });
    await page.evaluate(async ({database, table, key}) => {
        (await import('/assets/record-window.js')).openRecordWindow({database, table, key});
    }, {database: publicKey, table: portal.table, key: portal.key});
    await page.locator('dialog.record-window [role="alert"]').waitFor();
    assert.equal(await page.locator('dialog.record-window .record-window-content').count(), 0,
        'A mismatched response scope never appears as the clicked record.');
    await page.locator('dialog.record-window .modal-shell-close').click();
    await countWindows(0);
    await page.unroute(wrongScope);

    // Public shell API lifecycle checks independent of a particular content type.
    phase = 'generic shell movement';
    await page.evaluate(async () => {
        const {createModal} = await import('/assets/modal-shell.js');
        const opener = document.createElement('button');
        opener.id = 'window-smoke-opener'; opener.textContent = 'Open detail'; document.body.append(opener); opener.focus();
        const source = {name: 'Captured original', key: {id: '9007199254740993'}};
        window.modalSmoke = {renders: 0, aborted: false, loads: 0};
        const shell = createModal({title: 'Movable details', context: source,
            render: (_data, {body, context}) => {
                const field = document.createElement('input'); field.value = context.name; field.id = 'window-smoke-input'; body.append(field);
            }});
        shell.dialog.id = 'window-smoke'; window.modalSmoke.shell = shell;
        source.name = 'Changed elsewhere'; source.key.id = '1'; shell.open();
    });
    const shell = page.locator('#window-smoke');
    await page.locator('#window-smoke-input').waitFor();
    assert.equal(await page.locator('#window-smoke-input').inputValue(), 'Captured original', 'The opening context is isolated from later mutations.');
    const header = shell.locator('.modal-shell-header');
    const originalBox = await shell.boundingBox(), handleBox = await header.boundingBox();
    await page.mouse.move(handleBox.x + 24, handleBox.y + 18); await page.mouse.down();
    const verticalMove = originalBox.y > 100 ? -68 : 68;
    await page.mouse.move(handleBox.x + 120, handleBox.y + 18 + verticalMove, {steps: 8}); await page.mouse.up();
    const draggedBox = await shell.boundingBox();
    assert.ok(Math.abs(draggedBox.x - originalBox.x) > 40 && Math.abs(draggedBox.y - originalBox.y) > 35, 'Dragging the heading moves the complete window.');
    assert.equal(await fitsViewport(shell), true);
    await header.focus();
    const beforeKeyboard = await shell.boundingBox();
    await header.press('Alt+ArrowLeft');
    assert.ok((await shell.boundingBox()).x < beforeKeyboard.x, 'A focused heading supports keyboard movement.');
    await page.locator('#window-smoke-input').fill('Local draft stays here');
    assert.equal(await page.locator('#window-smoke-input').inputValue(), 'Local draft stays here');

    // A gesture starting inside content is not an outside dismissal.
    const inputBox = await page.locator('#window-smoke-input').boundingBox();
    await page.mouse.move(inputBox.x + 10, inputBox.y + 10); await page.mouse.down();
    await page.mouse.move(2, 2, {steps: 5}); await page.mouse.up();
    assert.equal(await shell.isVisible(), true);
    await page.setViewportSize({width: 320, height: 800});
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    // ResizeObserver constrains the fixed window on the next rendering turn.
    await page.waitForFunction(() => {
        const box = document.getElementById('window-smoke').getBoundingClientRect();
        return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    });
    assert.equal(await fitsViewport(shell), true, 'Moved windows remain reachable after a viewport resize.');
    await screenshot('record-window-mobile');
    await shell.locator('.modal-shell-close').click();
    await shell.waitFor({state: 'detached'});
    assert.equal(await page.locator('#window-smoke-opener').evaluate(element => element === document.activeElement), true, 'Closing returns focus to the opener.');
    await page.setViewportSize({width: 1440, height: 1000});

    phase = 'pending load';
    await page.evaluate(async () => {
        const {createModal} = await import('/assets/modal-shell.js');
        const pending = createModal({title: 'Delayed detail', context: {id: 'kept'},
            load: (_context, {signal}) => new Promise(resolve => {
                window.modalSmoke.loads++;
                window.modalSmoke.release = resolve;
                signal.addEventListener('abort', () => { window.modalSmoke.aborted = true; });
            }),
            render: data => { window.modalSmoke.renders++; return document.createTextNode(data); }});
        pending.dialog.id = 'window-smoke-pending'; window.modalSmoke.pending = pending; pending.open();
    });
    await page.waitForFunction(() => typeof window.modalSmoke.release === 'function');
    const pendingStatus = page.locator('#window-smoke-pending [role="status"]');
    const loadingEnglish = await pendingStatus.textContent();
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.notEqual(await pendingStatus.textContent(), loadingEnglish, 'Pending status translates without replacing its request.');
    assert.equal(await page.evaluate(() => window.modalSmoke.loads), 1);
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    await page.locator('#window-smoke-pending .modal-shell-close').click();
    await page.locator('#window-smoke-pending').waitFor({state: 'detached'});
    await page.evaluate(() => window.modalSmoke.release('A late answer must not return'));
    await page.waitForFunction(() => window.modalSmoke.aborted);
    assert.equal(await page.evaluate(() => window.modalSmoke.renders), 0, 'A late load never renders after its window closes.');
    assert.equal(await page.getByText('A late answer must not return', {exact: true}).count(), 0);

    phase = 'failed load retry';
    await page.evaluate(async () => {
        const {createModal} = await import('/assets/modal-shell.js');
        window.modalSmoke.failedLoads = 0;
        const retry = createModal({title: 'Retry detail', load: async () => {
            if (++window.modalSmoke.failedLoads === 1) throw new Error('Test failure');
            return 'Recovered record content';
        }, render: value => document.createTextNode(value)});
        retry.dialog.id = 'window-smoke-retry'; retry.open();
    });
    const alert = page.locator('#window-smoke-retry [role="alert"]');
    await alert.waitFor();
    const errorEnglish = await alert.textContent();
    await alert.locator('button').evaluate(element => { window.modalSmoke.retryButton = element; });
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    assert.notEqual(await alert.textContent(), errorEnglish, 'Errors and retry labels translate together.');
    assert.equal(await page.evaluate(() => window.modalSmoke.retryButton.isConnected && window.modalSmoke.failedLoads === 1), true,
        'Translation retains the working retry control and does not restart a failed load.');
    await alert.locator('button').click();
    await page.locator('#window-smoke-retry').getByText('Recovered record content', {exact: true}).waitFor();
    await page.locator('#window-smoke-retry .modal-shell-close').click();
    await page.locator('#window-smoke-retry').waitFor({state: 'detached'});
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));

    // Actual editor: outside clicks follow its dirty-field confirmation path.
    phase = 'dirty editor protection';
    await page.evaluate(async () => {
        const {createRowEditor} = await import('/assets/row-editor.js');
        window.modalSmoke.editor = createRowEditor({getDatabase: () => 'bestuursatlas'});
        await window.modalSmoke.editor.open({table: 'organizations', mode: 'insert'});
    });
    const editor = page.locator('#row-editor-dialog');
    await editor.locator('[data-row-mode="name"]').selectOption('value');
    await editor.locator('[data-row-field="name"]').fill('Unsaved local test draft');
    await page.mouse.click(2, 2);
    const confirmation = page.locator('dialog.confirm-dialog[open]');
    await confirmation.waitFor();
    assert.equal(await editor.locator('[data-row-field="name"]').inputValue(), 'Unsaved local test draft');
    await page.mouse.click(2, 2);
    await confirmation.waitFor({state: 'detached'});
    await page.waitForFunction(() => !window.modalSmoke.editor.busy);
    assert.equal(await editor.isVisible(), true, 'Cancelling discard keeps the dirty editor open.');
    await page.mouse.click(2, 2);
    await confirmation.waitFor();
    await confirmation.locator('button[type="submit"]').click();
    await editor.waitFor({state: 'detached'});

    assert.deepEqual(mutations, [], 'Comparison, window operations and discarded editing make no database writes.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: concurrent scoped record windows, translation, dragging/keyboard movement, outside/Escape dismissal, mobile constraints, focus, context/load isolation and dirty-editor protection.');
} catch (error) {
    console.error('Modal smoke phase:', phase);
    if (process.env.SCREENSHOTS_DIR) await screenshot('modal-window-failure').catch(() => {});
    if (errors.length) console.error('Browser errors:', errors);
    throw error;
} finally {
    await context.close();
    await browser.close();
}
