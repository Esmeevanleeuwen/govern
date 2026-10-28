/**
 * Browser smoke test against a running local Govern stack.
 *
 * Install Playwright in a separate developer environment, or set
 * PLAYWRIGHT_MODULE to its installed package directory.
 * BASE_URL defaults to http://127.0.0.1:8080.
 * Optional: BROWSER_BIN, BROWSER_ARGS_JSON, SCREENSHOTS_DIR.
 * GOVERN_UI_WRITE_TESTS=1 adds a saved-query create/delete check.
 * Run only on a test copy; phpMyAdmin can update its own UI preferences.
 *
 * node tests/frontend-smoke.mjs
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a local test stack.');
const browserArgs = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
assert.ok(Array.isArray(browserArgs) && browserArgs.every(value => typeof value === 'string'), 'BROWSER_ARGS_JSON must be an array of strings.');
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});

const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {}),
    args: browserArgs,
});
const errors = [];
const trackErrors = page => page.on('pageerror', error => errors.push(error.message));
const shot = async (page, name) => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, name + '.png'), fullPage: true});
};
const waitForPage = async page => {
    await page.waitForFunction(() => !document.querySelector('#page .loading-state'));
};
const apiResponse = (page, action) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const modalDocument = page => page.frames().find(frame => frame.parentFrame() === page.mainFrame());
const waitForModal = async page => {
    await page.locator('#database-dialog[open]').waitFor();
    await page.locator('.frame-message').waitFor({state: 'hidden'});
    assert.match(await modalDocument(page).title(), /phpMyAdmin/i);
};
const switchModalTab = async (page, label) => {
    const response = page.waitForResponse(result =>
        result.url().includes('/phpmyadmin/index.php') && result.request().resourceType() === 'document');
    await page.getByRole('tab', {name: label, exact: true}).click();
    assert.equal((await response).status(), 200);
    await waitForModal(page);
    assert.equal(await page.getByRole('tab', {name: label, exact: true}).getAttribute('aria-selected'), 'true');
};

try {
    const page = await browser.newPage({locale: 'nl-NL', viewport: {width: 1440, height: 1000}});
    trackErrors(page);
    await page.goto(base.href, {waitUntil: 'networkidle'});
    await page.locator('.stats-grid').waitFor();
    const bootstrap = await page.evaluate(async () => (await (await fetch('/api.php?action=bootstrap')).json()).data);
    assert.equal(bootstrap.database.status, 'ready');
    const table = bootstrap.tables.find(item => item.name === 'digital_systems')
        || bootstrap.tables.find(item => item.type === 'table');
    assert.ok(table, 'Seed at least one table before testing.');
    await shot(page, 'overview');

    await page.goto(new URL('/#gegevens?table=' + encodeURIComponent(table.name), base).href);
    await page.getByRole('heading', {name: table.name, exact: true}).waitFor();
    await waitForPage(page);
    assert.equal(await page.locator('.table-heading h2').textContent(), table.name);
    if (table.name === 'digital_systems') {
        const response = apiResponse(page, 'browse');
        await page.getByRole('searchbox', {name: 'Zoek in de gegevens'}).fill('DigiD');
        await response;
        await page.waitForFunction(() => document.querySelectorAll('.data-table tbody tr').length === 1);
        assert.match(await page.locator('.data-table').innerText(), /DigiD/);
    }
    await shot(page, 'data');

    await page.getByRole('link', {name: 'Structuur', exact: true}).click();
    await page.getByRole('heading', {name: 'Verwijzingen naar andere tabellen'}).waitFor();
    assert.ok(await page.locator('.data-table tbody tr').count() > 0);
    await shot(page, 'structure');
    if (await page.getByRole('button', {name: 'Onderzoek koppeling'}).count()) {
        await page.getByRole('button', {name: 'Onderzoek koppeling'}).first().click();
        await page.getByRole('textbox', {name: 'SQL-query'}).waitFor();
        assert.match(await page.locator('#sql-editor').inputValue(), /JOIN/);
    } else {
        await page.getByRole('link', {name: 'Onderzoeken', exact: true}).click();
        await page.getByRole('textbox', {name: 'SQL-query'}).waitFor();
    }

    // Exact integers, duplicate column labels, and unsafe-looking text must
    // survive without truncation, column overwrites, or HTML interpretation.
    const payload = '<img src=x onerror="window.governUnsafe=1">';
    const query = "SELECT CAST('9007199254740993' AS UNSIGNED) AS n, 2 AS n, '" + payload + "' AS safe";
    await page.getByRole('textbox', {name: 'SQL-query'}).fill(query);
    const response = apiResponse(page, 'query');
    await page.getByRole('button', {name: 'Query uitvoeren', exact: true}).click();
    await response;
    await page.locator('.query-result .data-table tbody tr').waitFor();
    assert.deepEqual(await page.locator('.query-result .data-table th').allTextContents(), ['n', 'n', 'safe']);
    assert.deepEqual(await page.locator('.query-result .data-table td').allTextContents(), ['9007199254740993', '2', payload]);
    assert.equal(await page.evaluate(() => window.governUnsafe), undefined);
    await shot(page, 'research');

    if (process.env.GOVERN_UI_WRITE_TESTS === '1') {
        const name = 'UI-test ' + Date.now();
        let id;
        try {
            await page.getByRole('textbox', {name: 'Naam van je onderzoek'}).fill(name);
            const saved = apiResponse(page, 'save-query');
            await page.getByRole('button', {name: 'Onderzoek bewaren', exact: true}).click();
            id = (await (await saved).json()).data.id;
            await page.locator('.saved-item-open').filter({hasText: name}).waitFor();
            const removeButton = page.getByRole('button', {name: 'Verwijder onderzoek ' + name});
            await removeButton.click();
            await page.getByRole('button', {name: 'Annuleren', exact: true}).click();
            await page.locator('.confirm-dialog').waitFor({state: 'detached'});
            assert.equal(await removeButton.evaluate(node => node === document.activeElement), true,
                'Cancelling a confirmation returns focus to its opener.');
            await removeButton.click();
            const removed = apiResponse(page, 'delete-query');
            await page.getByRole('button', {name: 'Onderzoek verwijderen', exact: true}).click();
            assert.equal((await removed).status(), 200);
            await page.locator('.saved-item-open').filter({hasText: name}).waitFor({state: 'detached'});
            id = undefined;
        } finally {
            if (id !== undefined) {
                await page.evaluate(async ({id, csrf}) => {
                    await fetch('/api.php?action=delete-query', {method: 'POST', headers: {
                        'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
                    }, body: JSON.stringify({id})});
                }, {id, csrf: bootstrap.csrf});
            }
        }
    }

    await page.getByRole('link', {name: 'Experimenten', exact: true}).click();
    await page.getByRole('heading', {name: 'Je herstelpunten', exact: true}).waitFor();
    await waitForPage(page);
    await shot(page, 'experiments');

    await page.getByRole('button', {name: 'Database openen', exact: true}).click();
    await waitForModal(page);
    await shot(page, 'modal-browse');
    await switchModalTab(page, 'Structure');
    await shot(page, 'modal-structure');
    await switchModalTab(page, 'SQL');
    await shot(page, 'modal-sql');
    await page.getByRole('tab', {name: 'SQL', exact: true}).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('tab', {name: 'Structure', exact: true}).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', {name: 'Venster vergroten', exact: true}).click();
    assert.equal(await page.locator('#database-dialog').evaluate(node => node.classList.contains('expanded')), true);
    await page.keyboard.press('Escape');
    await page.locator('#database-dialog').waitFor({state: 'hidden'});

    // New browser page avoids carrying a pending catalog refresh into viewport
    // assertions. The navigation itself is exercised with real clicks.
    const mobile = await browser.newPage({locale: 'nl-NL', viewport: {width: 390, height: 844}});
    trackErrors(mobile);
    await mobile.goto(new URL('/#overzicht', base).href, {waitUntil: 'networkidle'});
    await mobile.locator('.stats-grid').waitFor();
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(mobile, 'mobile-overview');
    await mobile.getByRole('button', {name: 'Navigatie openen', exact: true}).click();
    await mobile.getByRole('link', {name: 'Gegevens', exact: true}).click();
    await mobile.getByRole('heading', {name: 'Verken je database.', exact: true}).waitFor();
    await waitForPage(mobile);
    await mobile.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().right <= 1);
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(mobile, 'mobile-data');
    await mobile.getByRole('button', {name: 'Database openen', exact: true}).click();
    await waitForModal(mobile);
    assert.equal(await mobile.locator('#database-dialog').evaluate(node => node.scrollWidth <= innerWidth), true);
    await shot(mobile, 'mobile-modal');
    await mobile.getByRole('button', {name: 'Sluiten', exact: true}).click();
    await mobile.locator('#database-dialog').waitFor({state: 'hidden'});
    assert.deepEqual(errors, []);
    console.log('PASS: exploration, structure, SQL values, phpMyAdmin tabs, keyboard, mobile layout' +
        (process.env.GOVERN_UI_WRITE_TESTS === '1' ? ', saved-query CRUD.' : '.'));
} finally {
    await browser.close();
}
