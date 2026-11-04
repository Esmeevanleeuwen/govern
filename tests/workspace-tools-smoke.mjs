/** Real disclosure, keyboard, focus, scoped actions and popup behavior. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
import {ensureWorkspaceTools, clickWorkspaceTool, closeWorkspaceTools, clickDatabaseView} from './workspace-tools.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local fixture stack.');
const browser = await chromium.launch({headless: true,
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'],
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [], mutations = [];
const track = target => {
    target.on('pageerror', error => errors.push(error.message));
    target.on('request', request => {
        const url = new URL(request.url());
        // These existing POST endpoints build read-only selection metadata.
        const readOnlyPost = ['ai-context', 'ai-project-context'].includes(url.searchParams.get('action'));
        if (url.pathname === '/api.php' && request.method() !== 'GET' && !readOnlyPost) mutations.push(url.searchParams.get('action'));
    });
};
track(page);
const trigger = page.locator('#workspace-tools-toggle'), menu = page.locator('#workspace-tools');
const ready = target => target.waitForFunction(() => document.querySelector('#database-select')
    && !document.querySelector('#database-select').disabled && !document.querySelector('#page .loading-state'));
const fits = locator => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
});
const shot = async (target, name) => {
    if (!process.env.SCREENSHOTS_DIR) return;
    await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
    await target.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, name + '.png'), animations: 'disabled'});
};
let phase = 'startup', mobileContext;
try {
    await page.goto(new URL('/workspace.php#overzicht', base).href, {waitUntil: 'networkidle'});
    await page.locator('.stats-grid').waitFor(); await ready(page);
    assert.equal(await trigger.isVisible(), true);
    assert.equal(await page.locator('#open-database').isVisible(), false);
    assert.equal(await page.locator('#refresh-app').isVisible(), true);
    assert.equal(await page.locator('#manage-databases').isVisible(), true);
    assert.equal(await menu.isVisible(), false);
    for (const id of ['open-database', 'open-companion', 'ai-toggle', 'selection-pointer-toggle', 'context-export', 'language-select', 'workspace-account']) {
        assert.equal(await page.locator('#' + id).count(), 1, 'Original unique control: ' + id);
        assert.equal(await page.locator('#' + id).isVisible(), false, 'Secondary action starts inside Tools: ' + id);
    }
    assert.ok(await page.locator('.topbar').evaluate(element => element.getBoundingClientRect().height <= 90));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, 'tools-header-desktop');

    phase = 'keyboard and dismissal';
    await trigger.focus(); await trigger.press('Enter'); await menu.waitFor({state: 'visible'});
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true);
    assert.equal(await fits(menu), true);
    await page.keyboard.press('Escape'); await menu.waitFor({state: 'hidden'});
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    await trigger.click(); await menu.waitFor({state: 'visible'});
    await page.mouse.click(2, 2); await menu.waitFor({state: 'hidden'});
    await trigger.click(); await menu.waitFor({state: 'visible'});
    for (let step = 0; step < 20 && await menu.isVisible(); step++) await page.keyboard.press('Tab');
    assert.equal(await menu.isVisible(), false, 'Tab leaves without trapping focus.');

    phase = 'actions and focus';
    const refresh = page.waitForResponse(response => new URL(response.url()).searchParams.get('action') === 'bootstrap');
    await clickWorkspaceTool(page, '#refresh-app'); await refresh; await ready(page);
    assert.equal(await menu.isVisible(), false);
    await clickWorkspaceTool(page, '#manage-databases');
    await page.locator('#database-manager-dialog[open]').waitFor();
    assert.equal(await menu.isVisible(), false);
    await page.locator('#database-manager-close').click();
    await page.locator('#database-manager-dialog').waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.id === 'manage-databases');
    await clickWorkspaceTool(page, '#ai-toggle'); await page.locator('#ai-workspace-panel[open]').waitFor();
    await page.locator('#ai-prompt').fill('Keep this local assistant draft.');
    await page.locator('#ai-close').click(); await page.locator('#ai-workspace-panel').waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.id === 'workspace-tools-toggle');
    await clickWorkspaceTool(page, '#ai-toggle');
    assert.equal(await page.locator('#ai-prompt').inputValue(), 'Keep this local assistant draft.');
    await page.locator('#ai-close').click(); await page.locator('#ai-workspace-panel').waitFor({state: 'hidden'});

    phase = 'selection remains escapable';
    await clickWorkspaceTool(page, '#selection-pointer-toggle');
    assert.equal(await page.locator('#selection-pointer-toggle').getAttribute('aria-pressed'), 'true');
    await ensureWorkspaceTools(page, '#selection-pointer-toggle');
    await page.keyboard.press('Escape'); await menu.waitFor({state: 'hidden'});
    assert.equal(await page.locator('#selection-pointer-toggle').getAttribute('aria-pressed'), 'true', 'Escape closes Tools first.');
    await clickWorkspaceTool(page, '#selection-pointer-toggle');
    assert.equal(await page.locator('#selection-pointer-toggle').getAttribute('aria-pressed'), 'false');

    phase = 'language and drafts';
    await clickDatabaseView(page, 'onderzoeken'); await page.locator('#sql-editor').waitFor();
    const draft = 'SELECT 42 AS compact_menu_draft;';
    await page.locator('#sql-editor').fill(draft);
    const language = await ensureWorkspaceTools(page, '#language-select');
    await language.selectOption('nl'); await page.waitForFunction(() => document.documentElement.lang === 'nl');
    assert.equal(await menu.isVisible(), true);
    assert.equal(await page.locator('#sql-editor').inputValue(), draft);
    await language.selectOption('en'); await page.waitForFunction(() => document.documentElement.lang === 'en');
    await closeWorkspaceTools(page);

    phase = 'companion popup gesture';
    const popupPromise = page.waitForEvent('popup');
    await clickWorkspaceTool(page, '#open-companion');
    const popup = await popupPromise; track(popup);
    await popup.waitForURL(url => url.pathname === '/companion.php'); await popup.locator('#companion-tab-compare').waitFor();
    assert.equal(await menu.isVisible(), false);
    await popup.close();

    phase = 'scoped capabilities and dark appearance';
    await clickDatabaseView(page, 'gegevens');
    await page.locator('#database-select').selectOption('postgres:govern_pg:public'); await ready(page);
    await ensureWorkspaceTools(page, '#language-select');
    assert.equal(await page.locator('#context-export').isVisible(), false, 'PostgreSQL export stays unavailable even inside the open menu.');
    assert.equal(await page.locator('#open-database').isDisabled(), true);
    await page.evaluate(async () => (await import('/assets/preferences.js')).updatePreferences({theme: 'dark', reduceTransparency: true}, {persist: false}));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await fits(menu), true); await shot(page, 'tools-menu-dark'); await closeWorkspaceTools(page);

    phase = 'mobile';
    mobileContext = await authenticatedContext(browser, base, {locale: 'en-GB', viewport: {width: 320, height: 800}, isMobile: true, hasTouch: true});
    const mobile = await mobileContext.newPage(); track(mobile);
    await mobile.goto(new URL('/workspace.php#overzicht', base).href, {waitUntil: 'networkidle'}); await ready(mobile);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await mobile.locator('.topbar').evaluate(element => element.getBoundingClientRect().height <= 100));
    await ensureWorkspaceTools(mobile, '#language-select');
    assert.equal(await fits(mobile.locator('#workspace-tools')), true);
    assert.ok(await mobile.locator('#workspace-tools-toggle').evaluate(element => element.getBoundingClientRect().height >= 44));
    await shot(mobile, 'tools-menu-mobile'); await closeWorkspaceTools(mobile);
    assert.deepEqual(mutations, [], 'The menu does not write database records.');
    assert.deepEqual(errors, [], 'No browser exceptions.');
    console.log('PASS: compact Tools, keyboard/outside close, focus, real actions, selection escape, language/drafts, popup, scope and mobile/dark.');
} catch (error) {
    console.error('Workspace Tools smoke phase:', phase);
    await shot(page, 'tools-menu-failure').catch(() => {});
    if (errors.length) console.error('Browser errors:', errors);
    throw error;
} finally {
    await mobileContext?.close(); await context.close(); await browser.close();
}
