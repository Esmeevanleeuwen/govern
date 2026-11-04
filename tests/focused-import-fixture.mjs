/** Real modal modules with isolated API fixtures; no database is contacted. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../app/public/', import.meta.url));
const errors = [];
const calls = [];
let releasePreview;
let previewSeenResolve;
const previewSeen = new Promise(resolve => { previewSeenResolve = resolve; });
const report = {tables: [], views: [], foreign_keys: 0, total_records: 0, unchecked_rows: [], template: null};
const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/database-manager.css">
<link rel="stylesheet" href="/assets/dataset-import.css"></head><body><button id="launch">Import</button></body></html>`;
const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/') {
            response.writeHead(200, {'content-type': 'text/html'}).end(html);
            return;
        }
        if (url.pathname.startsWith('/phpmyadmin/')) {
            calls.push({native: true});
            response.writeHead(200, {'content-type': 'text/html'}).end('<title>phpMyAdmin fixture</title><h1>Native import fixture</h1>');
            return;
        }
        if (url.pathname === '/api.php') {
            let raw = '';
            for await (const chunk of request) raw += chunk;
            const action = url.searchParams.get('action');
            calls.push({action, database: url.searchParams.get('database')});
            let data;
            if (action === 'import-inspection') data = report;
            else if (action === 'dataset-preview') {
                await new Promise(resolve => { releasePreview = resolve; previewSeenResolve(); });
                data = {database: url.searchParams.get('database'), sha256: 'fixture-hash', datasets: [{name: 'rows.csv',
                    count: 2, duplicate_rows: 0, formulas: 0, targets: [],
                    columns: [{source: 'Code', name: 'code', suggestion: 'text', empty: 0, unique: true}], rows: [['001'], ['002']]}]};
            } else throw new Error('Unexpected API action: ' + action);
            response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({ok: true, data}));
            return;
        }
        const filename = path.join(root, url.pathname);
        if (!filename.startsWith(root) || !url.pathname.startsWith('/assets/')) {
            response.writeHead(404).end();
            return;
        }
        const content = await readFile(filename);
        const type = filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'image/svg+xml';
        response.writeHead(200, {'content-type': type}).end(content);
    } catch (error) {
        errors.push(error.message);
        if (!response.headersSent) response.writeHead(500);
        response.end('Fixture request failed');
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true, args: ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});

try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}, locale: 'en-GB'});
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(async () => {
        const {DatabaseModal} = await import('/assets/database-modal.js');
        const {setLanguage} = await import('/assets/i18n.js');
        const {setDatabase, setCsrf} = await import('/assets/api.js');
        setLanguage('en'); setDatabase('alpha'); setCsrf('fixture-only');
        window.events = [];
        window.modal = new DatabaseModal(context => events.push({closed: context}),
            open => events.push({open}), context => events.push({destinationChange: context}));
        window.items = [{name: 'alpha', available: true}, {name: 'beta', available: true},
            {name: 'govern_pg', schema: 'analytics', connection: 'postgres', scope_key: 'postgres:govern_pg:analytics', available: true}];
        modal.configure('alpha', [], items);
        document.getElementById('launch').addEventListener('click', () => modal.open('', 'dataset', {workflow: 'import-table'}));
        window.changeLanguage = setLanguage;
        window.addEventListener('govern:languagechange', () => modal.refreshLanguage());
    });
    await page.locator('#launch').click();
    assert.equal(await page.locator('#database-title').textContent(), 'Import table');
    assert.equal(await page.locator('.database-toolbar').isVisible(), false);
    assert.equal(await page.locator('#modal-source-hint').isVisible(), false);
    assert.equal(await page.locator('#database-panel').isVisible(), false);
    assert.equal(await page.locator('.modal-tools a').isVisible(), false);
    assert.equal(await page.locator('#dataset-file').evaluate(node => document.activeElement === node), true);
    assert.equal(await page.locator('#dataset-import-panel').getAttribute('role'), 'region');
    assert.match(await page.locator('.modal-import-source').textContent(), /MariaDBalpha/);
    assert.equal(calls.filter(call => call.native).length, 0, 'Focused mode never loads a hidden native application.');

    await page.locator('#dataset-file').setInputFiles({name: 'rows.csv', mimeType: 'text/csv', buffer: Buffer.from('Code\n001\n002')});
    await page.locator('#dataset-preview').click();
    await previewSeen;
    await page.waitForFunction(() => document.querySelector('#modal-change-destination').disabled);
    assert.equal(await page.locator('#modal-change-destination').isDisabled(), true);
    await page.evaluate(() => modal.configure('postgres:govern_pg:analytics', [], items));
    assert.equal(await page.evaluate(() => modal.database), 'alpha', 'Pending requests keep the captured destination.');
    releasePreview();
    await page.locator('#dataset-table').waitFor();
    await page.locator('#dataset-table').fill('imported_rows');
    await page.locator('#dataset-confirmation').fill('alpha');
    await page.evaluate(() => changeLanguage('nl'));
    assert.equal(await page.locator('#database-title').textContent(), 'Tabel importeren');
    assert.equal(await page.locator('#dataset-table').inputValue(), 'imported_rows');
    assert.equal(await page.locator('#dataset-confirmation').inputValue(), 'alpha');
    assert.equal(await page.locator('.database-toolbar').isVisible(), false);
    assert.equal(calls.filter(call => call.native).length, 0);
    await page.locator('#modal-change-destination').click();
    await page.waitForFunction(() => events.some(event => event.destinationChange));
    assert.deepEqual(await page.evaluate(() => events.find(event => event.destinationChange).destinationChange),
        {workflow: 'import-table', database: 'alpha', tab: 'dataset'});
    assert.equal(await page.evaluate(() => events.some(event => event.closed)), false, 'The handoff does not race an ordinary close refresh.');

    await page.evaluate(() => {
        changeLanguage('en'); modal.configure('postgres:govern_pg:analytics', [], items);
        modal.open('', 'import', {workflow: 'import-database'});
    });
    assert.match(await page.locator('.modal-import-source').textContent(), /PostgreSQLgovern_pg.analytics/);
    assert.equal(await page.locator('#modal-full-import').isVisible(), false, 'PostgreSQL never offers MariaDB tools.');
    assert.equal(await page.locator('#native-import-file').evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => modal.dialog.close());
    await page.waitForFunction(() => events.some(event => event.closed));
    await page.evaluate(() => {
        modal.configure('beta', [], items); modal.open('', 'import', {workflow: 'import-database'});
    });
    await page.locator('#modal-full-import').waitFor({state: 'visible'});
    assert.equal(await page.locator('#database-panel').isVisible(), false);
    assert.equal(calls.filter(call => call.native).length, 0);
    await page.setViewportSize({width: 320, height: 740});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#modal-change-destination').isVisible(), true);
    await page.locator('#modal-full-import').click();
    await page.locator('#database-panel').waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('#database-frame').contentDocument?.body?.textContent.includes('Native import fixture'));
    assert.equal(await page.locator('.database-toolbar').isVisible(), true);
    assert.equal(await page.evaluate(() => modal.workflow), null, 'Explicit fallback restores the normal native modal.');
    assert.ok(calls.some(call => call.native));
    assert.ok(calls.filter(call => call.action === 'dataset-preview').every(call => call.database === 'alpha'));
    assert.deepEqual(errors, []);
    console.log('PASS: focused import task, exact engine/destination, busy guards, focus, language retention, handoff, native fallback and 320px layout. No database execution.');
} finally {
    releasePreview?.();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
