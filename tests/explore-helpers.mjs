/** Browser helpers shared by the integrated Explore acceptance suites. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

export async function exploreHarness(options = {}) {
    const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
    const browser = await chromium.launch({headless: true,
        args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
        ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
    const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}, ...options});
    const page = await context.newPage();
    const errors = [], failedApis = [], writeActions = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api.php' && request.method() !== 'GET' && url.searchParams.get('action') !== 'record-map') {
            writeActions.push(url.searchParams.get('action'));
        }
    });
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname === '/api.php' && response.status() >= 400) failedApis.push(url.searchParams.get('action'));
    });
    const bookmark = (database, table, route = 'verkennen') => new URL('/workspace.php#' + route + '?' +
        new URLSearchParams({database, ...(table ? {table} : {})}), base).href;
    const node = id => page.locator('[data-record-node="' + id + '"]');
    const source = page.locator('#record-map-sources');
    const inspector = page.locator('#record-map-inspector');
    const ensureSources = async () => {
        // A hash-only schema navigation can resolve before the new canvas mounts.
        // Measure its panel state only after the requested scope has finished loading.
        await page.waitForFunction(() => {
            const params = new URLSearchParams(location.hash.split('?')[1] || '');
            const database = document.querySelector('#database-select');
            return document.querySelector('#record-map-sources') && database && !database.disabled
                && !document.querySelector('#refresh-app')?.disabled
                && (!params.get('database') || database.value === params.get('database'));
        });
        if (!await source.isVisible()) await page.locator('#record-map-sources-toggle').click();
        await source.waitFor({state: 'visible'});
    };
    const chooseTable = async table => {
        await ensureSources();
        if (await page.locator('#record-map-table').inputValue() !== table) await page.locator('#record-map-table').selectOption(table);
    };
    const seed = label => page.locator('#record-map-records [data-map-record]').filter({hasText: label}).first();
    const selectSeed = async label => {
        await ensureSources();
        await seed(label).waitFor();
        const id = await seed(label).getAttribute('data-map-record');
        await seed(label).click();
        await node(id).waitFor();
        await inspector.locator('[data-map-open-table]').waitFor();
        await page.waitForFunction(value => document.querySelector('#record-map-inspector h3')?.textContent.includes(value), label);
        return id;
    };
    const api = async (action, scope, body) => {
        const url = new URL('/api.php', base);
        url.search = new URLSearchParams({action, ...scope});
        const response = body ? await context.request.post(url.href, {
            headers: {'X-CSRF-Token': (await (await context.request.get(new URL('/auth-api.php?action=status', base).href)).json()).data.csrf}, data: body,
        }) : await context.request.get(url.href);
        const result = await response.json();
        assert.ok(response.ok() && result.ok, 'Fixture metadata must be readable through the real scoped API.');
        return result.data;
    };
    const mapResponse = (scope, relation, key) => page.waitForResponse(response => {
        const url = new URL(response.url());
        if (url.pathname !== '/api.php' || url.searchParams.get('action') !== 'record-map') return false;
        const payload = response.request().postDataJSON();
        return (url.searchParams.get('connection') || 'mariadb') === scope && payload?.relation === relation
            && (!key || JSON.stringify(payload?.key) === JSON.stringify(key));
    });
    const screenshot = async name => {
        if (!process.env.SCREENSHOTS_DIR) return;
        await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), fullPage: true, animations: 'disabled'});
    };
    const clean = () => {
        assert.deepEqual(errors, [], 'Explore has no browser exceptions.');
        assert.deepEqual(failedApis, [], 'Explore uses supported, explicitly scoped APIs.');
        assert.deepEqual(writeActions, [], 'Canvas presentation controls invoke no database write endpoint.');
    };
    return {base, browser, context, page, errors, failedApis, writeActions, bookmark, node, source, inspector,
        ensureSources, chooseTable, seed, selectSeed, api, mapResponse, screenshot, clean,
        close: async () => { await context.close(); await browser.close(); }};
}

export async function bounded(promise) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('An intercepted Explore response was not reached.')), 15000);
        })]);
    } finally { clearTimeout(timer); }
}
