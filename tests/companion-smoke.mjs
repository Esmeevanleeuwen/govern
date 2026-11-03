/** Actual paired browser windows: read-only comparison, radar and scope isolation. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use the isolated fixture stack.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const errors = [], mutations = [], reads = [];
const screenshots = process.env.SCREENSHOTS_DIR;
const deadline = (promise, message) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 10000); })])
        .finally(() => clearTimeout(timer));
};
let phase = 'initial paired windows', companion;
const track = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname !== '/api.php') return;
        if (request.method() !== 'GET') mutations.push(url.searchParams.get('action'));
        if (url.searchParams.get('action') === 'explore') reads.push({page, params: Object.fromEntries(url.searchParams)});
    });
};
context.on('page', track);
const page = await context.newPage();
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (database, table) => new URL('/workspace.php#verkennen?' + new URLSearchParams({database, table}), base).href;
const ready = source => source.waitForFunction(() => document.querySelector('[data-record-explorer]')?.getAttribute('aria-busy') === 'false');
const opened = async source => {
    const popup = source.waitForEvent('popup');
    await source.locator('#explorer-companion-open').click();
    const result = await popup;
    await result.waitForLoadState('networkidle');
    await result.locator('#companion-connection[data-status="connected"]').waitFor();
    return result;
};
const pinCount = (target, count) => target.waitForFunction(count => document.querySelectorAll('th[data-companion-record]').length === count, count);
const loadedPins = target => target.waitForFunction(() => {
    const pins = [...document.querySelectorAll('th[data-companion-record]')];
    return pins.length > 0 && pins.every(pin => pin.dataset.loading !== 'true') && document.querySelector('[data-comparison-field]');
});
const candidate = async (source, value) => { await source.locator('#explorer-record').selectOption(value); await ready(source); };
const responseFor = (source, table) => source.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === 'explore' && url.searchParams.get('table') === table;
});
const shot = async (target, name) => {
    if (!screenshots) return;
    await mkdir(screenshots, {recursive: true});
    await target.screenshot({path: path.join(screenshots, name + '.png'), animations: 'disabled'});
};
const radarReady = (target, scope, table, id) => target.waitForFunction(({scope, table, id}) => {
    const root = document.querySelector('#companion-radar');
    return root?.dataset.radarScope === scope && root.dataset.radarTable === table
        && root.getAttribute('aria-busy') === 'false' && (!id || JSON.parse(root.dataset.radarKey || '{}').id === id);
}, {scope, table, id});

try {
    const response = responseFor(page, 'demo_systems');
    await page.goto(bookmark(publicKey, 'demo_systems'), {waitUntil: 'networkidle'});
    const initial = (await (await response).json()).data;
    await ready(page);
    const portal = initial.candidates.find(item => item.label === 'Resident Services Portal');
    const reporter = initial.candidates.find(item => item.label === 'Public Space Reporter');
    assert.ok(portal && reporter, 'Load the optional fictional PostgreSQL sample records.');
    await page.evaluate(() => { window.companionSmokeOpen = window.open; window.open = () => null; });
    await page.locator('#explorer-companion-open').click();
    await page.locator('#open-companion[data-companion-status="blocked"]').waitFor({state: 'attached'});
    assert.equal(await page.locator('#companion-launch-notice').isVisible(), true, 'Blocked popups have a visible retry path.');
    await page.evaluate(() => { window.open = window.companionSmokeOpen; });
    companion = await opened(page);
    assert.match(companion.url(), /\/companion\.php#[A-Za-z0-9-]+$/);
    assert.ok(await companion.locator('#companion-tab-compare').isVisible());

    phase = 'real record comparison';
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 1); await loadedPins(companion);
    await companion.locator('#companion-differences').check();
    assert.doesNotMatch(await companion.locator('#companion-compare').innerText(), /No proven differences/,
        'One record does not prove that a comparison has no differences.');
    let releasePin, pinIntercepted;
    const pinGate = new Promise(resolve => { releasePin = resolve; });
    const pinWaiting = new Promise(resolve => { pinIntercepted = resolve; });
    const delayPin = async route => {
        const url = new URL(route.request().url());
        if (url.pathname !== '/api.php' || url.searchParams.get('action') !== 'explore'
            || url.searchParams.get('table') !== 'demo_systems' || JSON.parse(url.searchParams.get('key') || '{}').id !== '5') return route.continue();
        const response = await route.fetch(); pinIntercepted(); await pinGate; await route.fulfill({response});
    };
    await companion.route('**/api.php?*', delayPin);
    await candidate(page, reporter.id);
    await page.locator('#explorer-companion-pin').click();
    await deadline(pinWaiting, 'The second pin did not start its captured read.');
    assert.doesNotMatch(await companion.locator('#companion-compare').innerText(), /No proven differences/,
        'A pending second record does not become a false no-differences result.');
    releasePin();
    await pinCount(companion, 2); await loadedPins(companion);
    await companion.unroute('**/api.php?*', delayPin);
    await companion.locator('#companion-differences').uncheck();
    const headers = companion.locator('th[data-companion-record]');
    const sources = await headers.evaluateAll(nodes => nodes.map(node => ({
        scope: node.dataset.recordScope, table: node.dataset.recordTable, key: JSON.parse(node.dataset.recordKey),
    })));
    assert.deepEqual(sources.map(source => source.key.id).sort(), ['1', '5']);
    assert.ok(sources.every(source => source.scope === publicKey && source.table === 'demo_systems'));
    const budget = companion.locator('tr[data-comparison-field="annual_budget"]');
    await budget.waitFor();
    assert.equal(await budget.getAttribute('data-different'), 'true');
    assert.ok((await budget.innerText()).includes('125000.00') && (await budget.innerText()).includes('65000.00'), 'The comparison preserves actual numeric strings.');
    const technical = companion.locator('#companion-technical');
    assert.equal(await technical.isChecked(), false, 'Guided comparison starts with technical identifiers hidden.');
    await technical.check();
    assert.equal(await companion.locator('tr[data-comparison-field="owner_organization_id"]').getAttribute('data-different'), 'false');
    await companion.locator('#companion-differences').check();
    assert.equal(await companion.locator('tr[data-comparison-field="owner_organization_id"]').isVisible(), false);
    assert.equal(await budget.isVisible(), true);
    await companion.locator('#companion-differences').uncheck();
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 2);
    const pinnedBeforeLanguage = await headers.evaluateAll(nodes => nodes.map(node => node.dataset.companionRecord));
    const readCount = reads.filter(read => read.page === companion).length;
    await companion.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('nl'));
    await companion.waitForFunction(() => document.documentElement.lang === 'nl');
    assert.deepEqual(await headers.evaluateAll(nodes => nodes.map(node => node.dataset.companionRecord)), pinnedBeforeLanguage);
    assert.equal(await technical.isChecked(), true, 'Language changes preserve the technical-details choice.');
    assert.equal(reads.filter(read => read.page === companion).length, readCount, 'Translating comparisons does not reread their records.');
    await companion.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    await companion.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}));
        window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    });
    await companion.locator('#companion-connection[data-status="connected"]').waitFor();
    assert.deepEqual(await headers.evaluateAll(nodes => nodes.map(node => node.dataset.companionRecord)), pinnedBeforeLanguage,
        'A persisted page transition keeps the paired view and pinned records alive.');
    await technical.uncheck();
    await shot(page, 'companion-main'); await shot(companion, 'comparison-desktop');

    phase = 'bounded pin set';
    for (const id of ['2', '3', '4']) {
        await candidate(page, initial.candidates.find(item => item.key.id === id).id);
        await page.locator('#explorer-companion-pin').click();
        await pinCount(companion, id === '2' ? 3 : 4);
        await loadedPins(companion);
    }
    assert.equal(await companion.locator('#companion-notice').isVisible(), true, 'A fifth record explains the comparison limit.');
    assert.deepEqual((await headers.evaluateAll(nodes => nodes.map(node => JSON.parse(node.dataset.recordKey).id))).sort(), ['1', '2', '3', '5']);
    for (const id of ['2', '3']) {
        const index = await headers.evaluateAll((nodes, id) => nodes.findIndex(node => JSON.parse(node.dataset.recordKey).id === id), id);
        await headers.nth(index).locator('[data-companion-remove]').click();
    }
    await pinCount(companion, 2);
    await candidate(page, reporter.id);

    phase = 'radar follows and freezes';
    await companion.locator('#companion-tab-radar').click();
    await radarReady(companion, publicKey, 'demo_systems', '5');
    await candidate(page, portal.id);
    await radarReady(companion, publicKey, 'demo_systems', '1');
    assert.ok((await companion.locator('#companion-radar').innerText()).includes('Resident Services Portal'));
    await companion.locator('#companion-radar-freeze').click();
    assert.equal(await companion.locator('#companion-radar').getAttribute('data-following'), 'false');
    const frozenKey = await companion.locator('#companion-radar').getAttribute('data-radar-key');
    await candidate(page, reporter.id);
    assert.equal(await companion.locator('#companion-radar').getAttribute('data-radar-key'), frozenKey);
    await companion.locator('#companion-radar-follow').click();
    await radarReady(companion, publicKey, 'demo_systems', '5');
    const graphNode = companion.locator('[data-radar-node]').first();
    await graphNode.focus(); await graphNode.press('Enter');
    await companion.locator('#companion-radar-detail h3').waitFor();
    await shot(companion, 'radar-desktop');

    phase = 'inspect and pin a stored neighbour';
    const owner = initial.nodes.find(node => node.table === 'demo_organizations' && node.key.id === '1');
    const ownerNode = companion.locator('[data-radar-node="' + owner.id + '"]');
    await ownerNode.focus(); await ownerNode.press('Enter');
    assert.equal(await companion.locator('#companion-radar-detail h3').textContent(), 'Northbridge Council');
    await companion.locator('#companion-radar-pin').click();
    await pinCount(companion, 3); await loadedPins(companion);
    assert.equal(await companion.locator('th[data-record-table="demo_organizations"]').count(), 1);
    await companion.locator('#companion-radar-explore').click();
    await radarReady(companion, publicKey, 'demo_organizations', '1');
    assert.equal(await companion.locator('#companion-radar').getAttribute('data-following'), 'false',
        'Exploring a neighbour freezes a local root without replacing the main-screen selection.');
    assert.equal(await page.locator('#explorer-record').inputValue(), reporter.id);
    const shownOnMain = responseFor(page, 'demo_organizations');
    await companion.locator('#companion-radar-main').click();
    const mainRecord = (await (await shownOnMain).json()).data;
    await ready(page);
    assert.equal(mainRecord.nodes.find(node => node.id === mainRecord.center).key.id, '1');
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_organizations',
        'Show on main screen navigates the paired workspace to the exact neighbour.');
    const returnToSystems = responseFor(page, 'demo_systems');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(publicKey, 'demo_systems')).hash);
    await returnToSystems; await ready(page);
    await candidate(page, reporter.id);
    await companion.locator('#companion-radar-follow').click();
    await radarReady(companion, publicKey, 'demo_systems', '5');
    await companion.locator('#companion-tab-compare').click();
    await companion.locator('th[data-record-table="demo_organizations"] [data-companion-remove]').click();
    await pinCount(companion, 2);
    await companion.locator('#companion-tab-radar').click();

    phase = 'captured database scopes';
    await companion.locator('#companion-radar-freeze').click();
    const archiveResponse = responseFor(page, 'govern_pg_values');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(archiveKey, 'govern_pg_values')).hash);
    await archiveResponse; await ready(page);
    assert.equal(await companion.locator('#companion-radar').getAttribute('data-radar-scope'), publicKey);
    await companion.locator('#companion-radar-follow').click();
    await radarReady(companion, archiveKey, 'govern_pg_values', '1');
    assert.ok((await companion.locator('#companion-radar').innerText()).includes('Archive-only row'));
    await companion.locator('#companion-tab-compare').click();
    assert.equal(await headers.count(), 2, 'Changing main-screen scope retains captured comparison records.');
    assert.ok((await headers.evaluateAll(nodes => nodes.map(node => node.dataset.recordScope))).every(scope => scope === publicKey));
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 3); await loadedPins(companion);
    assert.equal(await companion.locator('th[data-record-scope="' + archiveKey + '"]').count(), 1);

    phase = 'refresh and remove captured records';
    const refresh = companion.locator('th[data-record-scope="' + publicKey + '"] [data-companion-refresh]').first();
    const refreshed = responseFor(companion, 'demo_systems');
    await refresh.click();
    const refreshUrl = new URL((await refreshed).url());
    assert.equal(refreshUrl.searchParams.get('schema'), 'public');
    await loadedPins(companion);
    await companion.locator('th[data-record-scope="' + archiveKey + '"] [data-companion-remove]').click();
    await pinCount(companion, 2);

    phase = 'MariaDB and exact PostgreSQL identities';
    const mariaRead = responseFor(page, 'organizations');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark('bestuursatlas', 'organizations')).hash);
    const mariaData = (await (await mariaRead).json()).data;
    await ready(page);
    const mariaNode = mariaData.nodes.find(node => node.id === mariaData.center);
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 3); await loadedPins(companion);
    const mariaPin = companion.locator('th[data-record-scope="bestuursatlas"]');
    assert.deepEqual(JSON.parse(await mariaPin.getAttribute('data-record-key')), mariaNode.key);
    assert.equal(await mariaPin.getAttribute('data-record-table'), 'organizations');
    const exactRead = responseFor(page, 'govern_pg_values');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(publicKey, 'govern_pg_values')).hash);
    const exactData = (await (await exactRead).json()).data;
    await ready(page);
    const exact = exactData.candidates.find(node => node.key.id === '9007199254740993');
    assert.ok(exact, 'The PostgreSQL fixture includes a BIGINT beyond JavaScript safe integers.');
    if (await page.locator('#explorer-record').inputValue() !== exact.id) await candidate(page, exact.id);
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 4); await loadedPins(companion);
    const exactPin = companion.locator('th[data-record-scope="' + publicKey + '"][data-record-table="govern_pg_values"]');
    assert.equal(JSON.parse(await exactPin.getAttribute('data-record-key')).id, '9007199254740993');
    await companion.locator('#companion-technical').check();
    assert.ok((await companion.locator('tr[data-comparison-field="id"]').innerText()).includes('9007199254740993'));
    assert.ok((await companion.locator('tr[data-comparison-field="amount"]').innerText()).includes('123456789012345678901234.12'));
    assert.equal(await companion.locator('tr[data-comparison-field="missing"] [data-cell-value="null"]').count(), 1,
        'A PostgreSQL NULL stays distinct from fields absent in the other records.');
    await exactPin.locator('[data-companion-remove]').click();
    await mariaPin.locator('[data-companion-remove]').click();
    await pinCount(companion, 2);
    await companion.locator('#companion-technical').uncheck();
    const archiveReturn = responseFor(page, 'govern_pg_values');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(archiveKey, 'govern_pg_values')).hash);
    await archiveReturn; await ready(page);

    phase = 'failed captured pin and retry';
    const archiveRequest = url => url.pathname === '/api.php' && url.searchParams.get('action') === 'explore'
        && url.searchParams.get('schema') === 'archive' && url.searchParams.get('table') === 'govern_pg_values';
    const failPin = async route => {
        if (!archiveRequest(new URL(route.request().url()))) return route.continue();
        return route.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({ok: false, error: 'Isolated expired-session read failure'})});
    };
    await companion.route('**/api.php?*', failPin);
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 3);
    const failedPin = companion.locator('th[data-record-scope="' + archiveKey + '"]');
    await failedPin.locator('[data-companion-error]').waitFor();
    await companion.locator('#companion-notice a[href="/auth.php?mode=login"]').waitFor();
    assert.equal(await companion.locator('th[data-record-scope="' + publicKey + '"]').count(), 2,
        'A failed pin preserves the other records and its own source.');
    await companion.unroute('**/api.php?*', failPin);
    const retryRead = responseFor(companion, 'govern_pg_values');
    await failedPin.locator('[data-companion-error] button').click();
    assert.equal(new URL((await retryRead).url()).searchParams.get('schema'), 'archive');
    await loadedPins(companion);
    assert.equal(await failedPin.locator('[data-companion-error]').count(), 0);
    assert.equal(await companion.locator('#companion-notice a[href="/auth.php?mode=login"]').count(), 0,
        'A successful captured retry clears the expired-session recovery notice.');
    assert.ok((await companion.locator('#companion-compare').innerText()).includes('Archive-only row'));
    await failedPin.locator('[data-companion-remove]').click();
    await pinCount(companion, 2);

    phase = 'late radar answer';
    await companion.locator('#companion-tab-radar').click();
    await radarReady(companion, archiveKey, 'govern_pg_values', '1');
    let releaseRadar;
    const radarGate = new Promise(resolve => { releaseRadar = resolve; });
    let radarIntercepted;
    const radarWaiting = new Promise(resolve => { radarIntercepted = resolve; });
    let finishRadar;
    const radarFinished = new Promise(resolve => { finishRadar = resolve; });
    const delayRadar = async route => {
        const url = new URL(route.request().url());
        if (url.pathname !== '/api.php' || url.searchParams.get('action') !== 'explore'
            || url.searchParams.get('table') !== 'demo_systems' || JSON.parse(url.searchParams.get('key') || '{}').id !== '1') return route.continue();
        const response = await route.fetch();
        radarIntercepted(); await radarGate;
        await route.fulfill({response}).catch(() => {}); // The superseded request may already be aborted.
        finishRadar();
    };
    await companion.route('**/api.php?*', delayRadar);
    const systemsResponse = responseFor(page, 'demo_systems');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(publicKey, 'demo_systems')).hash);
    await systemsResponse; await ready(page);
    // The main screen remembers its last record, so explicitly choose the delayed root.
    await candidate(page, portal.id);
    await deadline(radarWaiting, 'No delayed radar read.');
    await candidate(page, reporter.id);
    await radarReady(companion, publicKey, 'demo_systems', '5');
    releaseRadar();
    await deadline(radarFinished, 'The superseded radar read was not released.');
    await companion.unroute('**/api.php?*', delayRadar);
    await companion.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(JSON.parse(await companion.locator('#companion-radar').getAttribute('data-radar-key')).id, '5');
    assert.ok((await companion.locator('#companion-radar-detail').innerText()).includes('Public Space Reporter'),
        'A delayed old root does not replace the newer selection.');
    await companion.locator('#companion-tab-compare').click();
    // Restore the archive context for the reopen assertion below.
    const archiveAgain = responseFor(page, 'govern_pg_values');
    await page.evaluate(hash => { location.hash = hash; }, new URL(bookmark(archiveKey, 'govern_pg_values')).hash);
    await archiveAgain; await ready(page);

    await companion.setViewportSize({width: 320, height: 800});
    await companion.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    await shot(companion, 'comparison-mobile');
    await companion.evaluate(async () => (await import('/assets/preferences.js')).updatePreferences({theme: 'dark', reduceTransparency: true}, {persist: false}));
    await companion.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await shot(companion, 'comparison-dark-mobile');
    await companion.setViewportSize({width: 1440, height: 1000});

    phase = 'separate main-window pairing';
    const other = await context.newPage();
    await other.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'}); await ready(other);
    const second = await opened(other);
    assert.notEqual(new URL(second.url()).hash, new URL(companion.url()).hash, 'Each main window owns a distinct companion channel.');
    await other.locator('#explorer-companion-pin').click();
    await pinCount(second, 1); await loadedPins(second);
    await pinCount(companion, 2);
    assert.equal(await second.locator('th[data-record-table="demo_organizations"]').count(), 1);
    await other.close();
    await second.locator('#companion-connection[data-status="disconnected"]').waitFor({timeout: 20000});
    assert.equal(await second.locator('th[data-companion-record]').count(), 1, 'A disconnected source does not erase pinned data.');
    await second.close();

    phase = 'closed companion can reopen';
    await companion.close();
    companion = await opened(page);
    assert.equal(await companion.locator('th[data-companion-record]').count(), 0, 'Closed companion records were temporary.');
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 1); await loadedPins(companion);
    assert.equal(await companion.locator('th[data-record-scope="' + archiveKey + '"]').count(), 1);

    phase = 'explicit reopen restores a navigated companion';
    await companion.goto(new URL('/', base).href, {waitUntil: 'networkidle'});
    await page.locator('#explorer-companion-open').click();
    await companion.waitForURL(url => url.pathname === '/companion.php' && url.hash.length > 1);
    await companion.locator('#companion-connection[data-status="connected"]').waitFor();
    assert.equal(await companion.locator('th[data-companion-record]').count(), 0);
    await page.locator('#explorer-companion-pin').click();
    await pinCount(companion, 1); await loadedPins(companion);
    for (const current of [page, companion]) {
        const stored = await current.evaluate(() => JSON.stringify({...localStorage}));
        assert.doesNotMatch(stored, /Resident Services Portal|Public Space Reporter|Archive-only row|9007199254740993/, 'Companion record values and keys are not saved in browser preferences.');
    }
    assert.deepEqual(mutations, [], 'Companion interactions use only read requests.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: paired comparison desk and radar, exact values, pin deduplication, scoped refresh, follow/freeze, isolated channels, source loss, reopen, NL/EN, keyboard and mobile.');
} catch (error) {
    console.error('Companion phase:', phase);
    if (errors.length) console.error('Browser errors:', errors);
    await shot(page, 'failure-main').catch(() => {});
    if (companion && !companion.isClosed()) await shot(companion, 'failure-companion').catch(() => {});
    throw error;
} finally { await context.close(); await browser.close(); }
