/** Live local-code retrieval and isolated provider UI fixtures; no model is run. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local stack.');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const browserContext = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}, serviceWorkers: 'block'});
const externalRequests = [];
await browserContext.route(url => url.origin !== base.origin, async route => {
    externalRequests.push(route.request().url());
    await route.abort();
});
const page = await browserContext.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const panel = page.locator('#ai-workspace-panel');
const prompt = page.locator('#ai-prompt');
const send = page.locator('#ai-send');
const searchButton = page.locator('#ai-search-project');
const apiRoute = action => url => url.pathname === '/api.php' && url.searchParams.get('action') === action;
const previews = new Map();
const chatRequests = [];
const queryRequests = [];
let database = '';
let fixtureMode = 'answer';
let markDelayed;
let releaseDelayed;
let delayedSeen;
let delayedGate;
const query = 'How does switching databases work?';
const marker = 'UNTRUSTED_BROWSER_SOURCE_DO_NOT_ACCEPT';
const unsafeAnswer = 'Local project explanation. <img src=x onerror="window.projectUnsafe=1">';

page.on('request', request => {
    if (apiRoute('query')(new URL(request.url()))) queryRequests.push(request);
});
page.on('response', async response => {
    if (!apiRoute('ai-context')(new URL(response.url())) || !response.ok()) return;
    try {
        const payload = await response.json();
        if (payload.ok && payload.data.scope === 'project') previews.set(payload.data.database, payload.data);
    } catch { /* Switching scopes intentionally aborts old context requests. */ }
});
const api = async (action, body, csrf, explicitDatabase = database) => page.evaluate(async ({action, body, csrf, database}) => {
    const response = await fetch('/api.php?' + new URLSearchParams({action, ...(database ? {database} : {})}), body === undefined ? undefined : {
        method: 'POST', headers: {'Content-Type': 'application/json', ...(csrf ? {'X-CSRF-Token': csrf} : {})},
        body: JSON.stringify(body),
    });
    return {status: response.status, payload: await response.json()};
}, {action, body, csrf, database: explicitDatabase});
const waitContext = async () => page.waitForFunction(() => {
    const context = document.querySelector('#ai-context');
    return context && context.getAttribute('aria-busy') !== 'true'
        && !document.querySelector('#ai-retry-context:not([hidden])');
});
const waitReady = async () => {
    await page.waitForFunction(() => document.querySelector('#ai-status .ai-status-dot')?.classList.contains('ready')
        && !document.querySelector('#ai-pending:not([hidden])'));
    await waitContext();
};
const setScope = async scope => {
    await page.locator('#ai-scope-' + scope).click();
    await page.waitForFunction(value => document.querySelector('#ai-scope-' + value)?.getAttribute('aria-pressed') === 'true', scope);
    await waitContext();
};
const search = async value => {
    await prompt.fill(value);
    const response = page.waitForResponse(response => {
        if (!apiRoute('ai-context')(new URL(response.url()))) return false;
        const body = response.request().postDataJSON();
        return body.scope === 'project' && body.message === value;
    });
    await searchButton.click();
    const result = await (await response).json();
    assert.equal(result.ok, true);
    await waitContext();
    return result.data;
};
const beginDelayed = () => {
    fixtureMode = 'delay';
    delayedSeen = new Promise(resolve => { markDelayed = resolve; });
    delayedGate = new Promise(resolve => { releaseDelayed = resolve; });
};
const shot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'ai-project-' + name + '.png'), fullPage: true});
};
const verifySources = async sources => {
    assert.ok(sources.length > 0 && sources.length <= 3);
    for (const source of sources) {
        assert.match(source.id, /^S[1-9][0-9]*$/);
        assert.match(source.path, /^(app|docs)\/[A-Za-z0-9_./-]+\.(php|js|css|md)$/);
        assert.equal(source.path.includes('..'), false);
        assert.equal(source.path.split('/').some(part => part.startsWith('.')), false);
        assert.equal(/(?:password|credential|secret|\.env)/i.test(source.path), false);
        assert.ok(Number.isInteger(source.start_line) && source.start_line >= 1);
        assert.ok(Number.isInteger(source.end_line) && source.end_line >= source.start_line);
        assert.match(source.sha256, /^[0-9a-f]{64}$/);
        const original = (await readFile(path.join(projectRoot, source.path), 'utf8')).replace(/\r\n?/g, '\n').split('\n');
        assert.equal(source.content, original.slice(source.start_line - 1, source.end_line).join('\n'),
            'Each displayed passage contains exact lines from the local source snapshot.');
    }
};

try {
    await page.goto(new URL('/#overzicht', base).href, {waitUntil: 'networkidle'});
    await page.locator('#ai-toggle').waitFor();
    const bootstrap = await api('bootstrap');
    assert.equal(bootstrap.payload.ok, true);
    database = bootstrap.payload.data.database.name;
    const csrf = bootstrap.payload.data.csrf;
    const status = await api('ai-status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.data.status, 'disabled', 'This suite requires AI disabled in the disposable server.');
    assert.equal(status.payload.data.ready, false);
    assert.equal(status.payload.data.capabilities.project, true);
    assert.equal(status.payload.data.project.status, 'ready');
    assert.deepEqual(status.payload.data.project.roots, ['app', 'docs']);
    assert.equal((await api('ai-context', {scope: 'project', message: query})).status, 403,
        'Local source preview still requires the application CSRF token.');
    const live = await api('ai-context', {scope: 'project', message: query}, csrf);
    assert.equal(live.status, 200);
    assert.equal(live.payload.data.database, database);
    assert.equal(live.payload.data.scope, 'project');
    assert.equal(live.payload.data.records_included, false);
    assert.equal(live.payload.data.project.status, 'ready');
    assert.ok(live.payload.data.project.files_scanned > 0);
    assert.deepEqual(live.payload.data.targets, []);
    await verifySources(live.payload.data.sources);
    assert.ok(live.payload.data.sources.some(source => /DatabaseScope\.php|assets\/app\.js/.test(source.path)),
        'A real database-switch question retrieves implementation sources.');
    const forged = await api('ai-context', {scope: 'project', message: query, path: '../../.env', root: '/',
        sources: [{id: 'S99', path: '/etc/passwd', content: marker}], targets: [{kind: 'row', table: marker, value: marker}]}, csrf);
    assert.equal(forged.status, 200);
    assert.deepEqual(forged.payload.data.sources, live.payload.data.sources,
        'Browser supplied file paths and fake sources never replace server-owned retrieval.');
    assert.equal(JSON.stringify(forged.payload.data).includes(marker), false);
    const noMatch = await api('ai-context', {scope: 'project', message: 'zzqxvnotpresent987 zzyypostulated654'}, csrf);
    assert.equal(noMatch.status, 200);
    assert.deepEqual(noMatch.payload.data.sources, []);
    assert.equal((await api('ai-chat', {scope: 'project', message: query}, csrf)).payload.error_code, 'ai_disabled');

    await page.locator('#ai-toggle').click();
    await panel.waitFor({state: 'visible'});
    await waitContext();
    await page.waitForFunction(() => document.querySelector('#ai-status .ai-status-dot')?.classList.contains('disabled'));
    const databaseDraft = 'Keep my database question separate.';
    await prompt.fill(databaseDraft);
    await setScope('project');
    assert.equal(await prompt.inputValue(), '', 'A project question starts in its own scope.');
    assert.equal(await searchButton.isVisible(), true);
    const preview = await search(query);
    await verifySources(preview.sources);
    assert.equal(await send.isDisabled(), true, 'Reading local files does not pretend a model is connected.');
    assert.equal(await page.locator('#ai-thread .ai-message').count(), 0);
    await page.locator('#ai-context').evaluate(node => { node.open = true; });
    const passage = page.locator('#ai-context .ai-source-passage').first();
    await passage.waitFor();
    await passage.locator('summary').click();
    assert.ok((await passage.innerText()).includes(preview.sources[0].path));
    assert.equal(await passage.locator('pre code').textContent(), preview.sources[0].content);
    assert.equal(await passage.locator('pre script, pre img').count(), 0, 'Source code is displayed as text.');
    assert.equal(await passage.locator('a[href^="http"]').count(), 0, 'Sources open local snapshots without sending code to a website.');
    await shot('offline-sources');
    await setScope('database');
    assert.equal(await prompt.inputValue(), databaseDraft);
    await setScope('project');
    assert.equal(await prompt.inputValue(), query);
    const emptyPreview = await search('zzqxvnotpresent987 zzyypostulated654');
    assert.deepEqual(emptyPreview.sources, []);
    assert.equal(await page.locator('#ai-context .ai-source-passage').count(), 0, 'A new search removes old source passages.');
    await search(query);

    // Only the provider-facing status/chat responses below are fixtures. Source
    // retrieval above and below continues through the actual PHP/local files.
    await page.route(apiRoute('ai-status'), route => route.fulfill({json: {ok: true, data: {
        enabled: true, provider: 'ollama', model: 'qwen3:4b-instruct', status: 'ready', ready: true,
        models: ['qwen3:4b-instruct'], capabilities: {schema: true, project: true, records: false, execution: false},
        project: status.payload.data.project,
    }}}));
    await page.route(apiRoute('ai-chat'), async route => {
        const currentDatabase = new URL(route.request().url()).searchParams.get('database');
        const body = route.request().postDataJSON();
        chatRequests.push({database: currentDatabase, body});
        const mode = fixtureMode;
        if (mode === 'delay') { markDelayed?.(); await delayedGate; }
        const snapshot = previews.get(currentDatabase) || live.payload.data;
        const source = snapshot.sources[0];
        const sourceLines = source.content.split('\n');
        const quoteIndex = Math.max(0, sourceLines.findIndex(line => line.trim()));
        const quote = sourceLines[quoteIndex];
        try {
            await route.fulfill({json: {ok: true, data: {
                database: currentDatabase, model: 'qwen3:4b-instruct', scope: 'project',
                answer: mode === 'delay' ? 'LATE_OLD_SCOPE_REPLY' : unsafeAnswer, sql: null,
                grounded: true, context: snapshot, history_truncated: false,
                citations: [{source_id: source.id, path: source.path, start_line: source.start_line + quoteIndex,
                    end_line: source.start_line + quoteIndex, quote, sha256: source.sha256}],
            }}});
        } catch { /* Scope switching intentionally aborts this provider fixture. */ }
    });
    await page.locator('#ai-retry-status').click();
    await waitReady();
    await send.click();
    await page.locator('#ai-thread .assistant').waitFor();
    await waitReady();
    assert.equal(chatRequests[0].database, database);
    assert.equal(chatRequests[0].body.scope, 'project');
    assert.deepEqual(chatRequests[0].body.history, [], 'Previous prose cannot become local project evidence.');
    assert.ok(!chatRequests[0].body.targets || chatRequests[0].body.targets.length === 0);
    assert.ok((await page.locator('#ai-thread').innerText()).includes(unsafeAnswer));
    assert.equal(await page.locator('#ai-thread img').count(), 0);
    assert.equal(await page.evaluate(() => window.projectUnsafe), undefined);
    assert.equal(await page.locator('#ai-thread .ai-open-sql').count(), 0, 'Project explanations never become SQL actions.');
    const citations = page.locator('#ai-thread .assistant .ai-citations');
    await citations.locator('summary').first().click();
    const cited = citations.locator('.ai-source-passage').first();
    await cited.locator('summary').click();
    assert.ok((await cited.innerText()).includes(preview.sources[0].path));
    assert.ok((await cited.locator('pre code').textContent()).trim());
    await shot('cited-answer');

    const projectDraft = 'Project draft survives language and scope changes.';
    await prompt.fill(projectDraft);
    await prompt.focus();
    await prompt.evaluate(node => node.setSelectionRange(3, 11));
    await page.locator('#language-select').selectOption('en');
    assert.equal(await prompt.inputValue(), projectDraft);
    assert.deepEqual(await prompt.evaluate(node => [node.selectionStart, node.selectionEnd]), [3, 11]);
    assert.equal((await panel.innerText()).includes('app.ai.'), false);
    assert.match(await page.locator('#ai-scope-project').innerText(), /project/i);
    assert.match(await searchButton.innerText(), /search/i);
    await setScope('database');
    assert.equal(await prompt.inputValue(), databaseDraft);
    assert.equal(await page.locator('#ai-thread .ai-message').count(), 0, 'The database scope has its own conversation.');
    await setScope('project');
    assert.equal(await prompt.inputValue(), projectDraft);
    assert.ok((await page.locator('#ai-thread').innerText()).includes(unsafeAnswer));

    beginDelayed();
    await prompt.fill(query);
    await send.click();
    await delayedSeen;
    await setScope('database');
    assert.equal(await prompt.inputValue(), databaseDraft);
    releaseDelayed(); releaseDelayed = null;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await page.locator('#ai-thread').innerText()).includes('LATE_OLD_SCOPE_REPLY'), false);
    await setScope('project');
    assert.equal(await prompt.inputValue(), query, 'An interrupted project question remains editable.');
    assert.equal((await page.locator('#ai-thread').innerText()).includes('LATE_OLD_SCOPE_REPLY'), false);
    fixtureMode = 'answer';

    if (process.env.GOVERN_TEST_SECOND_DATABASE && process.env.GOVERN_TEST_SECOND_DATABASE !== database) {
        const firstDatabase = database;
        await prompt.fill(projectDraft);
        await page.locator('#database-select').selectOption(process.env.GOVERN_TEST_SECOND_DATABASE);
        await page.waitForFunction(value => document.querySelector('#database-select')?.value === value
            && !document.querySelector('#database-select')?.disabled, process.env.GOVERN_TEST_SECOND_DATABASE);
        await waitReady();
        await setScope('project');
        assert.equal(await prompt.inputValue(), '', 'Project drafts also remain separate per database.');
        await prompt.fill('Second database project draft.');
        await page.locator('#database-select').selectOption(firstDatabase);
        await page.waitForFunction(value => document.querySelector('#database-select')?.value === value
            && !document.querySelector('#database-select')?.disabled, firstDatabase);
        await waitReady();
        await setScope('project');
        assert.equal(await prompt.inputValue(), projectDraft);
    }

    await page.setViewportSize({width: 320, height: 900});
    await page.waitForFunction(() => document.querySelector('#ai-workspace-panel')?.matches(':modal'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await panel.evaluate(node => node.scrollWidth <= innerWidth), true);
    await search(query);
    await page.locator('#ai-context').evaluate(node => { node.open = true; });
    await page.locator('#ai-context .ai-source-passage').first().locator('summary').click();
    assert.equal(await panel.evaluate(node => node.scrollWidth <= innerWidth), true, 'Long code stays inside its own reading area on mobile.');
    await shot('mobile-sources');
    await page.keyboard.press('Escape');
    await panel.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.id === 'ai-toggle');
    assert.deepEqual(queryRequests, [], 'Local code search and explanation never execute SQL.');
    assert.deepEqual(externalRequests, [], 'The browser performs this complete flow without external requests.');
    assert.deepEqual(errors, [], 'The local project flow has no uncaught browser errors.');
    console.log('PASS: live offline local-source search, exact file/line snapshots, CSRF and path isolation, safe cited provider UI fixture, scope/draft isolation, stale response protection, NL/EN and mobile.');
} finally {
    releaseDelayed?.();
    await browser.close();
}
