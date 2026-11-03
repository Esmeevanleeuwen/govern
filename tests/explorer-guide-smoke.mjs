import {selectWorkspaceLanguage} from './workspace-tools.mjs';
/** Coworkers explore actual records through plain choices, without SQL or keys. */
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
const errors = [], failedApis = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    if (new URL(request.url()).pathname === '/api.php' && request.method() !== 'GET') mutations.push(request.method());
});
page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname === '/api.php' && response.status() >= 400) failedApis.push(url.searchParams.get('action'));
});
const publicKey = 'postgres:govern_pg:public', archiveKey = 'postgres:govern_pg:archive';
const bookmark = (database, table) => new URL('/workspace.php#verkennen?' + new URLSearchParams({database, table}), base).href;
const explorer = page.locator('[data-record-explorer]');
const node = id => page.locator(`[data-explorer-node="${id}"]`);
const row = id => page.locator(`[data-explorer-row="${id}"]`);
const responseFor = condition => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === 'explore' && condition(url.searchParams);
});
const ready = async () => {
    await explorer.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-record-explorer]')?.getAttribute('aria-busy') === 'false');
};
const mode = async value => {
    await page.locator('#explorer-mode-' + value).click();
    await page.waitForFunction(expected => document.querySelector('[data-record-explorer]')?.dataset.experience === expected, value);
};
const screenshot = async name => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), fullPage: true, animations: 'disabled'});
};

try {
    const first = responseFor(params => params.get('table') === 'demo_organizations');
    await page.goto(bookmark(publicKey, 'demo_organizations'), {waitUntil: 'networkidle'});
    const response = await first;
    assert.equal(response.status(), 200);
    const initial = (await response.json()).data;
    await ready();
    assert.equal(await explorer.getAttribute('data-experience'), 'guided', 'New coworkers start in Guided mode.');
    await page.locator('[data-explorer-guide]').waitFor();
    assert.doesNotMatch(await page.locator('.record-explorer-summary').textContent(), /\bnull\b/,
        'Guided summary contains only user-facing counts, with no empty technical placeholder.');
    await page.getByLabel('Choose a category', {exact: true}).waitFor();
    await page.getByLabel('Choose an item', {exact: true}).waitFor();
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_organizations');
    assert.equal(await page.locator('#explorer-table option:checked').textContent(), 'Demo organizations');
    assert.equal(await explorer.locator('textarea').count(), 0, 'Exploration requires no SQL entry.');
    assert.equal(await page.locator('#add-row, [data-row-action]').count(), 0);

    const center = initial.nodes.find(item => item.id === initial.center);
    const portal = initial.nodes.find(item => item.table === 'demo_systems' && item.key.id === '1');
    const ownership = initial.edges.find(edge => edge.source === portal.id && edge.target === center.id);
    assert.equal(center.label, 'Northbridge Council');
    assert.ok(portal && ownership, 'Guidance uses actual records and declared links.');
    assert.ok((await page.locator('[data-guide-group="demo_systems"]').textContent()).includes('2'));
    await page.locator('[data-guide-group="demo_systems"]').click();
    assert.equal(await page.locator('[data-explorer-node]').count(), 3, 'The group question shows two systems and their starting item.');
    await node(portal.id).waitFor();
    await node(center.id).waitFor();
    assert.equal(await page.locator('[data-explorer-row]').count(), 3);
    await page.locator('[data-guide-all]').click();
    assert.equal(await page.locator('[data-explorer-node]').count(), initial.nodes.length);
    await page.locator('#explorer-filter').fill('Demo systems');
    assert.equal(await page.locator('[data-explorer-node]').count(), 3, 'Coworkers can search the readable category name instead of its database identifier.');
    await page.locator('#explorer-filter').fill('');

    const questions = page.locator('#explorer-guide-questions');
    await questions.locator('summary').click();
    await page.locator('#explorer-guide-item').selectOption(portal.id);
    await page.locator('#explorer-guide-explain').click();
    const evidence = page.locator(`[data-explorer-evidence="${ownership.id}"]`);
    await evidence.waitFor();
    assert.ok((await evidence.innerText()).includes('Resident Services Portal')
        && (await evidence.innerText()).includes('Northbridge Council'));
    const technical = evidence.locator('[data-explorer-technical]');
    assert.equal(await technical.evaluate(element => element.open), false, 'Original keys and fields are optional.');
    assert.equal(await evidence.locator('.record-explorer-constraint').isVisible(), false);
    await technical.locator('summary').click();
    assert.equal(await evidence.locator('.record-explorer-constraint').textContent(), ownership.name);
    assert.ok((await technical.textContent()).includes('owner_organization_id'));
    await technical.locator('summary').click();

    const followed = responseFor(params => params.get('table') === 'demo_systems' && params.has('key'));
    await page.locator('#explorer-guide-follow').click();
    const followedResponse = await followed;
    assert.equal(followedResponse.status(), 200);
    const followedData = (await followedResponse.json()).data;
    await ready();
    assert.equal(await page.locator('#explorer-table').inputValue(), 'demo_systems');
    const project = followedData.nodes.find(item => item.label === 'Plain-language service pages');
    assert.ok(project, 'Following an item reveals actual connected projects.');
    await node(project.id).click();
    await page.locator('#explorer-filter').fill('Plain-language');
    const rootBeforeMode = await page.locator('#explorer-record').inputValue();
    await mode('detailed');
    assert.equal(await page.locator('#explorer-record').inputValue(), rootBeforeMode);
    assert.equal(await page.locator('#explorer-filter').inputValue(), 'Plain-language');
    assert.equal(await row(project.id).getAttribute('data-selected'), 'true');
    await page.getByLabel('Starting table', {exact: true}).waitFor();
    assert.equal(await page.locator('#explorer-table option:checked').textContent(), 'demo_systems');
    assert.equal(await page.evaluate(() => localStorage.getItem('govern.explorer.mode.v1')), 'detailed');
    await mode('guided');
    assert.equal(await row(project.id).getAttribute('data-selected'), 'true');
    assert.equal(await page.locator('#explorer-filter').inputValue(), 'Plain-language');
    assert.equal(await page.evaluate(() => localStorage.getItem('govern.explorer.mode.v1')), 'guided');
    await screenshot('explorer-guide-desktop');

    const englishLabel = await page.locator('#explorer-table').getAttribute('aria-label');
    await selectWorkspaceLanguage(page, 'nl');
    await ready();
    assert.equal(await explorer.getAttribute('data-experience'), 'guided');
    assert.equal(await page.locator('#explorer-record').inputValue(), rootBeforeMode);
    assert.equal(await page.locator('#explorer-filter').inputValue(), 'Plain-language');
    assert.notEqual(await page.locator('#explorer-table').getAttribute('aria-label'), englishLabel);
    await selectWorkspaceLanguage(page, 'en');
    await ready();
    await page.reload({waitUntil: 'networkidle'});
    await ready();
    assert.equal(await explorer.getAttribute('data-experience'), 'guided', 'The experience preference survives reload.');
    await page.setViewportSize({width: 320, height: 800});
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    await page.locator('[data-guide-all]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await explorer.getAttribute('data-experience'), 'guided');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot('explorer-guide-mobile');

    await page.goto(bookmark(archiveKey, 'govern_pg_values'), {waitUntil: 'networkidle'});
    await ready();
    assert.equal(await explorer.getAttribute('data-experience'), 'guided');
    assert.ok((await explorer.innerText()).includes('Archive-only row'));
    assert.equal(await page.locator('[data-guide-group]').count(), 0, 'Questions do not reuse another schema’s groups.');
    assert.equal((await explorer.innerText()).includes('Northbridge Council'), false);
    assert.deepEqual(mutations, [], 'Guided exploration makes GET-only data requests.');
    assert.deepEqual(failedApis, [], 'Choices do not cause rejected requests.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: Guided questions, friendly labels, real explanations, technical disclosure, following items, mode/language preservation, scope isolation and mobile.');
} finally {
    await context.close();
    await browser.close();
}
