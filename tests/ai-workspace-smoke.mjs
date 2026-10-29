/** Real schema context with isolated provider-response fixtures; never calls a model. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
const page = await context.newPage();
const errors = [];
const track = current => current.on('pageerror', error => errors.push(error.message));
track(page);
const panel = page.locator('#ai-workspace-panel');
const prompt = page.locator('#ai-prompt');
const send = page.locator('#ai-send');
const apiRoute = action => url => url.pathname === '/api.php' && url.searchParams.get('action') === action;
const apiResponses = new Map();
const queryRequests = [];
let queryBaseline = 0;
const chatRequests = [];
let selectedDatabase = '';
let fixtureMode = 'answer';
let fixtureStatus = 'ready';
let releaseDelayed;
let markDelayed;
let delayedSeen;
let delayedGate;
const answer = 'Fixture-uitleg over de echte geselecteerde structuur. <img src=x onerror="window.aiUnsafe=1">';
const proposedSql = 'SELECT `id`, `name` FROM `organizations` LIMIT 5;';

page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api.php' && url.searchParams.get('action') === 'query') queryRequests.push(request);
});
page.on('response', async response => {
    const url = new URL(response.url());
    if (!apiRoute('ai-context')(url) || !response.ok()) return;
    try {
        const payload = await response.json();
        if (payload.ok) apiResponses.set(payload.data.database, payload.data);
    } catch { /* An intentionally aborted context request may have no readable response. */ }
});
const api = async (action, body, csrf) => page.evaluate(async ({action, body, csrf}) => {
    const response = await fetch('/api.php?' + new URLSearchParams({action}), body === undefined ? undefined : {
        method: 'POST', headers: {'Content-Type': 'application/json', ...(csrf ? {'X-CSRF-Token': csrf} : {})},
        body: JSON.stringify(body),
    });
    return {status: response.status, payload: await response.json()};
}, {action, body, csrf});
const waitContext = async () => {
    await page.waitForFunction(() => {
        const context = document.querySelector('#ai-context');
        return context && context.getAttribute('aria-busy') !== 'true'
            && !document.querySelector('#ai-retry-context:not([hidden])');
    });
};
const waitReady = async () => {
    await page.waitForFunction(() => {
        const status = document.querySelector('#ai-status .ai-status-dot');
        return status?.classList.contains('ready') && !document.querySelector('#ai-pending:not([hidden])');
    });
    await waitContext();
};
const open = async () => {
    if (!await panel.isVisible()) await page.locator('#ai-toggle').click();
    await panel.waitFor({state: 'visible'});
};
const close = async () => {
    if (await panel.isVisible()) {
        await page.locator('#ai-close').click();
        await panel.waitFor({state: 'hidden'});
    }
};
const reviewSelection = async () => {
    await page.locator('#selection-pointer-count').click();
    if (!await page.locator('#selection-pointer-dialog').isVisible()) {
        await page.locator('#selection-pointer-tag').waitFor();
        await page.locator('#selection-pointer-more').click();
    }
    await page.locator('#selection-pointer-dialog[open]').waitFor();
};
const shot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'ai-' + name + '.png'), fullPage: true});
};
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
const beginDelayed = () => {
    fixtureMode = 'delay';
    delayedSeen = new Promise(resolve => { markDelayed = resolve; });
    delayedGate = new Promise(resolve => { releaseDelayed = resolve; });
};
const switchDatabase = async database => {
    await page.locator('#database-select').selectOption(database);
    await page.waitForFunction(value => document.querySelector('#database-select')?.value === value
        && !document.querySelector('#database-select').disabled && !document.querySelector('#page .loading-state'), database);
    selectedDatabase = database;
    await waitReady();
};

try {
    await page.goto(new URL('/#gegevens?table=organizations', base).href, {waitUntil: 'networkidle'});
    await page.locator('.table-workspace .data-table tbody tr').first().waitFor();
    const bootstrap = await api('bootstrap');
    assert.equal(bootstrap.payload.ok, true);
    selectedDatabase = bootstrap.payload.data.database.name;
    const first = selectedDatabase;
    const csrf = bootstrap.payload.data.csrf;
    const status = await api('ai-status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.data.status, 'disabled', 'This suite requires AI disabled in the disposable server.');
    assert.equal(status.payload.data.ready, false);
    assert.equal(status.payload.data.capabilities.records, false);
    assert.equal(status.payload.data.capabilities.execution, false);
    assert.equal((await api('ai-context', {targets: []})).status, 403, 'AI context still requires the application CSRF token.');
    const missing = await api('ai-context', {targets: [{kind: 'table', table: '__govern_ai_missing_table__'}]}, csrf);
    assert.equal(missing.status, 404, 'A fabricated selected table is not accepted as AI context.');
    const disabled = await api('ai-chat', {message: 'test', targets: []}, csrf);
    assert.equal(disabled.status, 503);
    assert.equal(disabled.payload.error_code, 'ai_disabled');

    const previewResponse = page.waitForResponse(response => apiRoute('ai-context')(new URL(response.url())));
    await open();
    const preview = (await (await previewResponse).json()).data;
    assert.equal(preview.database, first);
    assert.equal(preview.records_included, false);
    assert.ok(preview.sources.some(source => source.table === 'organizations'));
    await page.waitForFunction(() => document.querySelector('#ai-status .ai-status-dot')?.classList.contains('disabled'));
    await prompt.fill('Mijn vraag blijft staan terwijl Ollama uit staat.');
    assert.equal(await send.isDisabled(), true, 'An unconnected model never produces a demonstration answer.');
    assert.equal(await page.locator('#ai-thread .ai-message').count(), 0);
    assert.match(await page.locator('#ai-status').innerText(), /nog niet ingeschakeld|not enabled yet/i);
    await page.locator('#ai-context summary').click();
    assert.match(await page.locator('#ai-context').innerText(), /organizations/);
    await shot('disabled-live-context');
    await page.keyboard.press('Escape');
    await panel.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.id === 'ai-toggle');
    await open();
    assert.equal(await prompt.inputValue(), 'Mijn vraag blijft staan terwijl Ollama uit staat.');

    // Only these provider-facing API responses are fixtures. Context continues
    // through the live PHP API and disposable MariaDB metadata reader.
    await page.route(apiRoute('ai-status'), route => route.fulfill({json: {ok: true, data: {
        enabled: true, provider: 'ollama', model: 'qwen3:4b-instruct', status: fixtureStatus,
        ready: fixtureStatus === 'ready', models: ['qwen3:4b-instruct'],
        capabilities: {schema: true, records: false, execution: false},
    }}}));
    await page.route(apiRoute('ai-chat'), async route => {
        const database = new URL(route.request().url()).searchParams.get('database');
        const body = route.request().postDataJSON();
        chatRequests.push({database, body});
        const mode = fixtureMode;
        if (mode === 'delay') { markDelayed?.(); await delayedGate; }
        try {
            if (mode === 'error') return await route.fulfill({status: 503, json: {ok: false,
                error: 'Lokale testverbinding niet bereikbaar.', error_code: 'ai_unreachable',
                error_i18n: {nl: 'Lokale testverbinding niet bereikbaar.', en: 'Local test connection unavailable.'}}});
            await route.fulfill({json: {ok: true, data: {database, model: 'qwen3:4b-instruct',
                answer: mode === 'delay' ? 'LATE_OLD_DATABASE_REPLY' : answer,
                sql: mode === 'delay' ? null : proposedSql, context: apiResponses.get(database)
                    || {database, sources: [], targets: [], records_included: false, truncated: false}}}});
        } catch { /* Stop and database switching intentionally abort this response. */ }
    });
    await page.locator('#ai-retry-status').click();
    await waitReady();
    await prompt.fill('Leg de organisaties en hun verbindingen uit.');
    await send.click();
    await page.locator('#ai-thread .assistant').waitFor();
    await waitReady();
    assert.equal(chatRequests[0].database, first);
    assert.equal(chatRequests[0].body.language, 'nl');
    assert.equal(chatRequests[0].body.history.length, 0);
    assert.ok(chatRequests[0].body.targets.every(target => Object.keys(target).every(key => ['kind', 'table', 'column', 'label', 'tag'].includes(key))));
    assert.ok((await page.locator('#ai-thread').innerText()).includes(answer));
    assert.equal(await page.locator('#ai-thread img').count(), 0, 'Model text is rendered as text rather than HTML.');
    assert.equal(await page.evaluate(() => window.aiUnsafe), undefined);
    assert.equal(queryRequests.length, 0, 'Generating an answer and SQL proposal never executes SQL.');
    await shot('answer-and-proposal');

    await page.locator('#navigation [data-area="research"]').click();
    await page.locator('#sql-editor').waitFor();
    const originalDraft = 'SELECT 101 AS original_draft;';
    await page.locator('#sql-editor').fill(originalDraft);
    await page.locator('.ai-open-sql').click();
    const confirmation = page.locator('dialog.confirm-dialog[open]');
    await confirmation.waitFor();
    await confirmation.getByRole('button', {name: /^(Annuleren|Cancel)$/}).click();
    await confirmation.waitFor({state: 'detached'});
    assert.equal(await page.locator('#sql-editor').inputValue(), originalDraft, 'Cancelling keeps the existing SQL draft.');
    await page.locator('.ai-open-sql').click();
    await confirmation.waitFor();
    await confirmation.locator('button[type="submit"]').click();
    await page.waitForFunction(sql => document.querySelector('#sql-editor')?.value === sql, proposedSql);
    assert.equal(queryRequests.length, 0, 'Opening AI SQL populates the editor without running it.');
    await panel.waitFor({state: 'hidden'});

    // Existing selection inspection passes only the selected table/column to AI.
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('[data-database-view="gegevens"]').click();
    const table = page.locator('.table-workspace .data-table');
    await table.locator('tbody tr').first().waitFor();
    const nameIndex = await table.locator('thead th').evaluateAll(cells => cells.findIndex(cell => cell.textContent.trim() === 'name'));
    assert.ok(nameIndex >= 0);
    await page.locator('#selection-pointer-toggle').click();
    await table.locator('tbody tr').first().locator('td').nth(nameIndex).click();
    await reviewSelection();
    await page.locator('#selection-ask-ai').click();
    await panel.waitFor({state: 'visible'});
    await waitReady();
    await page.locator('#ai-context').evaluate(node => { node.open = true; });
    await page.waitForFunction(() => document.querySelector('#ai-context')?.textContent.includes('organizations.name'));
    assert.equal(await page.locator('#selection-pointer-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(queryRequests.length, 0);

    // A query result is a snapshot, with no reliable source table. Its visible
    // record text must not be sent as schema context when asking about it.
    await close();
    await page.locator('#navigation [data-area="research"]').click();
    const privateSnapshot = 'PRIVATE_QUERY_SNAPSHOT_DO_NOT_FORWARD';
    await page.locator('#sql-editor').fill("SELECT '" + privateSnapshot + "' AS snapshot;");
    const explicitQuery = page.waitForResponse(response => apiRoute('query')(new URL(response.url())));
    await page.locator('#run-query').click();
    assert.equal((await explicitQuery).status(), 200);
    const resultCell = page.locator('.query-result .data-table tbody td').first();
    await resultCell.waitFor();
    assert.equal(await resultCell.innerText(), privateSnapshot);
    queryBaseline = queryRequests.length;
    await page.locator('#selection-pointer-toggle').click();
    await resultCell.click();
    await reviewSelection();
    const snapshotPreview = page.waitForResponse(response => apiRoute('ai-context')(new URL(response.url())));
    await page.locator('#selection-ask-ai').click();
    const snapshotContext = (await (await snapshotPreview).json()).data;
    await panel.waitFor({state: 'visible'}); await waitReady();
    assert.equal(snapshotContext.sources.length, 0);
    assert.equal(JSON.stringify(snapshotContext).includes(privateSnapshot), false,
        'A selected query-result value cannot become an AI schema or UI label.');
    assert.equal(snapshotContext.records_included, false);

    await prompt.fill('Blijvend concept bij een taalwisseling.');
    await prompt.focus();
    await prompt.evaluate(node => node.setSelectionRange(3, 12));
    await page.locator('#language-select').selectOption('en');
    assert.equal(await prompt.inputValue(), 'Blijvend concept bij een taalwisseling.');
    assert.equal(await panel.evaluate(node => node.open), true);
    assert.equal((await panel.innerText()).includes('app.ai.'), false);
    assert.match(await page.locator('#ai-panel-title').innerText(), /assistant/i);
    assert.equal((await prompt.evaluate(node => [node.selectionStart, node.selectionEnd])).join(','), '3,12');
    await page.setViewportSize({width: 320, height: 900});
    await page.waitForFunction(() => {
        const panel = document.querySelector('#ai-workspace-panel');
        return panel?.matches(':modal') && panel.getAttribute('aria-modal') === 'true';
    }, undefined, {timeout: 5000});
    await noOverflow();
    assert.equal(await panel.evaluate(node => node.matches(':modal')), true, 'The compact AI panel is a native modal sheet.');
    assert.equal(await panel.evaluate(node => node.scrollWidth <= innerWidth), true);
    await page.evaluate(async () => {
        const {updatePreferences} = await import('/assets/preferences.js');
        updatePreferences({theme: 'dark', reduceTransparency: true});
    });
    await shot('mobile-dark-solid');
    await page.keyboard.press('Escape');
    await panel.waitFor({state: 'hidden'});
    await page.setViewportSize({width: 1440, height: 1100});
    await page.locator('#settings-link').click();
    await page.locator('#ai-settings').waitFor();
    assert.match(await page.locator('#ai-settings').innerText(), /qwen3:4b-instruct/);
    assert.equal(await page.locator('#ai-settings input').count(), 0, 'The browser cannot replace the server-owned model endpoint.');
    await page.locator('#ai-test-connection').click();
    await page.waitForFunction(() => !document.querySelector('#ai-test-connection')?.disabled);
    await open(); await waitReady();

    fixtureMode = 'error';
    await prompt.fill('Retain this question after a connection error.');
    await send.click();
    await page.locator('#ai-error:not([hidden])').waitFor();
    assert.equal(await prompt.inputValue(), 'Retain this question after a connection error.');
    fixtureMode = 'answer';
    beginDelayed();
    await prompt.fill('Retain this question after Stop.');
    await send.click();
    await delayedSeen;
    await page.locator('#ai-stop').click();
    assert.equal(await prompt.inputValue(), 'Retain this question after Stop.');
    assert.equal(await page.locator('#ai-stop').isVisible(), false);
    releaseDelayed(); releaseDelayed = null;
    await waitReady();
    assert.equal((await page.locator('#ai-thread').innerText()).includes('LATE_OLD_DATABASE_REPLY'), false);

    const second = process.env.GOVERN_TEST_SECOND_DATABASE;
    if (second && second !== first) {
        await prompt.fill('A unsent draft');
        await switchDatabase(second);
        assert.equal(await prompt.inputValue(), '');
        assert.equal(await page.locator('#ai-thread .ai-message').count(), 0, 'Another database has its own chat history.');
        await prompt.fill('B unsent draft');
        await switchDatabase(first);
        assert.equal(await prompt.inputValue(), 'A unsent draft');
        assert.ok((await page.locator('#ai-thread').innerText()).includes(answer));
        beginDelayed();
        await prompt.fill('Delayed question in A');
        await send.click();
        await delayedSeen;
        await switchDatabase(second);
        assert.equal(await prompt.inputValue(), 'B unsent draft');
        releaseDelayed(); releaseDelayed = null;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal((await page.locator('#ai-thread').innerText()).includes('LATE_OLD_DATABASE_REPLY'), false,
            'A delayed answer cannot appear in a different database.');
        await switchDatabase(first);
        assert.equal(await prompt.inputValue(), 'Delayed question in A');
        assert.equal((await page.locator('#ai-thread').innerText()).includes('LATE_OLD_DATABASE_REPLY'), false);
    }
    fixtureMode = 'answer';
    fixtureStatus = 'offline';
    await page.evaluate(async () => {
        const {getPreferences, updatePreferences} = await import('/assets/preferences.js');
        const current = getPreferences();
        updatePreferences({...current, theme: 'light', reduceTransparency: false});
    });
    await close(); await open();
    await page.waitForFunction(() => document.querySelector('#ai-status .ai-status-dot')?.classList.contains('offline'));
    assert.equal(await send.isDisabled(), true);
    assert.equal(queryRequests.length, queryBaseline, 'AI never executes SQL; only the explicit snapshot query above was run.');
    assert.deepEqual(errors, [], 'The AI frontend has no uncaught browser errors.');
    console.log('PASS: honest disabled status, real schema-only context, CSRF, provider UI fixtures, safe text and SQL draft proposals, selection integration, Stop/errors, database isolation, NL/EN, settings and mobile focus.');
} finally {
    releaseDelayed?.();
    await browser.close();
}
