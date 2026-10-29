/**
 * Real browser check of Govern language, appearance and dashboard continuity.
 * Run against an isolated local stack seeded with Bestuursatlas.
 * Uses BASE_URL, PLAYWRIGHT_MODULE, BROWSER_BIN, BROWSER_ARGS_JSON and
 * SCREENSHOTS_DIR. No extra production dependency. Normal checks do not write application records.
 * phpMyAdmin can save its own interface preferences in the test database.
 * GOVERN_UI_WRITE_TESTS=1 adds a temporary saved-query discard check and cleanup.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a local test stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'), 'BROWSER_ARGS_JSON must be an array of strings.');
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

const shot = async name => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, name + '.png'), fullPage: true});
};
const responseFor = action => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const navigate = async route => {
    if (['gegevens', 'structuur', 'schema'].includes(route)) {
        const current = await page.evaluate(() => location.hash.slice(1).split('?')[0]);
        if (!['gegevens', 'structuur', 'schema'].includes(current)) {
            await page.locator('#navigation [data-area="database"]').click();
        }
        await page.locator('[data-database-view="' + route + '"]').click();
    } else await page.locator('#navigation [data-route="' + route + '"]').click();
    await page.waitForFunction(expected => location.hash.split('?')[0] === '#' + expected, route);
};
const settings = async () => {
    const needsMobileMenu = await page.evaluate(() => window.matchMedia('(max-width: 820px)').matches &&
        !document.body.classList.contains('sidebar-open'));
    if (needsMobileMenu) await page.locator('#menu-toggle').click();
    await page.locator('#settings-link').click();
    await page.locator('#preference-theme').waitFor();
};
const language = async value => {
    await page.locator('#language-select').selectOption(value);
    await page.waitForFunction(expected => document.documentElement.lang === expected, value);
};
const order = () => page.locator('.dashboard-block[data-block-id]').evaluateAll(nodes => nodes.map(node => node.dataset.blockId));
const storedLayout = () => page.evaluate(() => JSON.parse(localStorage.getItem('govern.dashboard.v1')));
const storedPreferences = () => page.evaluate(() => JSON.parse(localStorage.getItem('govern.preferences.v1')).preferences);
const noOverflow = async label => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label + ' overflows the viewport.');
};
const noHardBorders = async () => {
    const borders = await page.locator('#page, #sidebar, .topbar').evaluateAll(roots => {
        const selector = '.card,.catalog,.snapshot-card,.input,.button,.sidebar,.topbar,.dashboard-block,.builder-section,.data-table th,.data-table td';
        const nodes = new Set(roots.flatMap(root => [root, ...root.querySelectorAll(selector)]));
        return [...nodes].filter(node => node.matches(selector) && node.getClientRects().length).filter(node => {
            const style = getComputedStyle(node);
            return ['top', 'right', 'bottom', 'left'].some(side => {
                const colour = style.getPropertyValue('border-' + side + '-color');
                return parseFloat(style.getPropertyValue('border-' + side + '-width')) > 0 &&
                    style.getPropertyValue('border-' + side + '-style') !== 'none' &&
                    colour !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(colour);
            });
        }).map(node => node.className || node.tagName);
    });
    assert.deepEqual(borders, [], 'Shared panels and controls must not have hard decorative borders.');
};

const verifyRestoreGuard = async () => {
    const restorePage = await context.newPage();
    restorePage.on('pageerror', error => errors.push(error.message));
    const snapshots = ['a', 'b'].map((id, index) => ({id: 'ui-restore-guard-' + id,
        label: 'Restore guard ' + (index + 1), created_at: '2026-10-28 00:00:00', size_bytes: 1024, sha256: id.repeat(64)}));
    let releaseRestore, markSeen;
    const release = new Promise(resolve => { releaseRestore = resolve; });
    const seen = new Promise(resolve => { markSeen = resolve; });
    let restoreCalls = 0, createCalls = 0;
    await restorePage.route('**/api.php?action=snapshots', async route => {
        assert.equal(route.request().method(), 'GET');
        await route.fulfill({json: {ok: true, data: snapshots}});
    });
    await restorePage.route('**/api.php?action=create-snapshot', async route => {
        // A regression must not create a real export either.
        createCalls += 1;
        await route.fulfill({json: {ok: true, data: snapshots[0]}});
    });
    await restorePage.route('**/api.php?action=restore-snapshot', async route => {
        // Deliberately never route.fetch(): this check cannot restore real data.
        assert.equal(route.request().method(), 'POST');
        restoreCalls += 1;
        const body = route.request().postDataJSON();
        markSeen(body);
        await release;
        if (!restorePage.isClosed()) await route.fulfill({json: {ok: true, data: {
            restored: body.id, safety_snapshot: null, message: 'Restoration fixture complete.',
            message_i18n: {nl: 'Herstelvoorbeeld voltooid.', en: 'Restoration fixture complete.'},
        }}});
    });
    let sibling;
    try {
        await restorePage.goto(new URL('/#experimenten', base).href, {waitUntil: 'networkidle'});
        await restorePage.locator('#language-select').selectOption('en');
        await restorePage.locator('[data-snapshot-action="restore"]').nth(1).waitFor();
        const database = await restorePage.evaluate(async () => (await (await fetch('/api.php?action=bootstrap')).json()).data.database.name);
        await restorePage.locator('[data-snapshot-action="restore"]').first().click();
        await restorePage.locator('.confirm-dialog input').fill(database);
        await restorePage.locator('.confirm-dialog button[type="submit"]').click();
        const submitted = await seen;
        assert.equal(submitted.confirmation, database);
        assert.equal(submitted.id, snapshots[0].id);
        const actionsDisabled = async () => {
            assert.equal(await restorePage.locator('[data-snapshot-action="restore"]').count(), 2);
            assert.equal(await restorePage.locator('#create-snapshot').isDisabled(), true);
            for (const action of await restorePage.locator('[data-snapshot-action="restore"]').all()) assert.equal(await action.isDisabled(), true);
        };
        await actionsDisabled();
        await restorePage.locator('[data-snapshot-action="restore"]').nth(1).dispatchEvent('click');
        assert.equal(await restorePage.locator('.confirm-dialog').count(), 0, 'A second restore cannot open another confirmation while pending.');
        assert.equal(restoreCalls, 1);

        // A real cross-tab preference event forces the pending screen to render
        // again; all snapshot actions must remain disabled in the new DOM.
        sibling = await context.newPage();
        sibling.on('pageerror', error => errors.push(error.message));
        await sibling.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
        const translatedList = restorePage.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api.php' && url.searchParams.get('action') === 'snapshots';
        });
        await sibling.locator('#preference-language').selectOption('nl');
        await restorePage.waitForFunction(() => document.documentElement.lang === 'nl');
        await translatedList;
        await restorePage.locator('[data-snapshot-action="restore"]').nth(1).waitFor();
        await actionsDisabled();
        await restorePage.locator('[data-snapshot-action="restore"]').nth(1).dispatchEvent('click');
        await restorePage.locator('#create-snapshot').dispatchEvent('click');
        assert.equal(await restorePage.locator('.confirm-dialog').count(), 0);
        assert.equal(restoreCalls, 1, 'A translated rerender must not queue another restore.');
        assert.equal(createCalls, 0, 'Restore progress blocks creation as well.');
        if (screenshots) await restorePage.screenshot({path: path.join(screenshots, 'settings-restore-pending.png'), fullPage: true});
        const completed = restorePage.waitForResponse(response => new URL(response.url()).searchParams.get('action') === 'restore-snapshot');
        releaseRestore();
        await completed;
        await restorePage.waitForFunction(() => !document.getElementById('create-snapshot').disabled &&
            [...document.querySelectorAll('[data-snapshot-action="restore"]')].length === 2 &&
            [...document.querySelectorAll('[data-snapshot-action="restore"]')].every(button => !button.disabled));
        assert.equal(restoreCalls, 1);
    } finally {
        releaseRestore();
        await sibling?.close();
        await restorePage.close();
    }
};

const verifyExampleDraft = async () => {
    if (process.env.GOVERN_UI_WRITE_TESTS !== '1') return;
    const draftPage = await context.newPage();
    draftPage.on('pageerror', error => errors.push(error.message));
    let savedId;
    try {
        await draftPage.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
        await draftPage.locator('#language-select').selectOption('en');
        const name = 'Example draft UI-test ' + Date.now();
        const originalSql = "SELECT 'original saved question' AS source;";
        savedId = await draftPage.evaluate(async ({name, sql}) => {
            const {csrf} = (await (await fetch('/api.php?action=bootstrap')).json()).data;
            const response = await fetch('/api.php?action=save-query', {method: 'POST', headers: {
                'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
            }, body: JSON.stringify({name, sql, notes: 'Temporary browser test.'})});
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error);
            return payload.data.id;
        }, {name, sql: originalSql});
        await draftPage.locator('#navigation [data-route="onderzoeken"]').click();
        await draftPage.locator('.saved-item-open').filter({hasText: name}).click();
        assert.equal(await draftPage.locator('#sql-editor').inputValue(), originalSql);
        await draftPage.locator('.learning-help details').first().locator('summary').click();
        await draftPage.getByRole('button', {name: 'Use an example', exact: true}).click();
        const exampleSql = await draftPage.locator('#sql-editor').inputValue();
        assert.notEqual(exampleSql, originalSql);
        await draftPage.getByRole('button', {name: 'New', exact: true}).click();
        await draftPage.locator('.confirm-dialog[open]').waitFor();
        assert.equal(await draftPage.locator('#sql-editor').inputValue(), exampleSql);
        await draftPage.locator('.confirm-dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
        await draftPage.locator('.confirm-dialog').waitFor({state: 'detached'});
        assert.equal(await draftPage.locator('#sql-editor').inputValue(), exampleSql, 'Cancelling discard keeps the applied example draft.');
        const storedSql = await draftPage.evaluate(async id => {
            const queries = (await (await fetch('/api.php?action=queries')).json()).data;
            return queries.find(query => String(query.id) === String(id))?.sql;
        }, savedId);
        assert.equal(storedSql, originalSql, 'Applying an example does not silently overwrite saved research.');
    } finally {
        if (savedId !== undefined) await draftPage.evaluate(async id => {
            const {csrf} = (await (await fetch('/api.php?action=bootstrap')).json()).data;
            const response = await fetch('/api.php?action=delete-query', {method: 'POST', headers: {
                'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
            }, body: JSON.stringify({id})});
            if (!response.ok) throw new Error('Failed to remove the temporary browser investigation.');
        }, savedId);
        await draftPage.close();
    }
};

try {
    await page.goto(new URL('/#onderzoeken?table=digital_systems', base).href, {waitUntil: 'networkidle'});
    await page.locator('.builder-actions button').waitFor();
    assert.equal(await page.locator('#language-select').inputValue(), 'nl');
    await page.getByRole('button', {name: 'Kolomkeuze wissen voor de basistabel', exact: true}).click();
    await page.getByRole('checkbox', {name: 'Basiskolom code', exact: true}).check();
    await page.getByRole('checkbox', {name: 'Basiskolom name', exact: true}).check();
    await page.getByRole('button', {name: 'Voorwaarde toevoegen', exact: true}).click();
    await page.getByRole('combobox', {name: 'Kolom voor voorwaarde 1', exact: true}).selectOption(JSON.stringify(['base', 'name']));
    await page.getByRole('combobox', {name: 'Vergelijking voor voorwaarde 1', exact: true}).selectOption('contains');
    await page.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).fill(' DigiD ');
    await page.locator('.builder-limit input').fill('17');
    const sql = "SELECT 'draft : exact 9007199254740993' AS label;";
    await page.locator('#sql-editor').fill(sql);
    await page.locator('#query-name').fill('Language continuity');
    await page.locator('#query-notes').fill('Keep these unsaved notes.');
    const checkDraft = async () => {
        await page.locator('.builder-actions button').waitFor();
        assert.equal(await page.locator('#sql-editor').inputValue(), sql);
        assert.equal(await page.locator('#query-name').inputValue(), 'Language continuity');
        assert.equal(await page.locator('#query-notes').inputValue(), 'Keep these unsaved notes.');
        assert.equal(await page.locator('.builder-filter-row input').inputValue(), ' DigiD ');
        assert.equal(await page.locator('.builder-filter-row select').nth(0).inputValue(), JSON.stringify(['base', 'name']));
        assert.equal(await page.locator('.builder-filter-row select').nth(1).inputValue(), 'contains');
        assert.equal(await page.locator('.builder-limit input').inputValue(), '17');
        assert.deepEqual(await page.locator('.builder-column input:checked').evaluateAll(nodes => nodes.map(node => node.parentElement.querySelector('span').textContent).sort()), ['code', 'name']);
    };
    await language('en');
    await page.getByRole('button', {name: 'Create query', exact: true}).waitFor();
    await checkDraft();
    assert.match(await page.locator('.query-builder summary').innerText(), /Query builder/);
    await language('nl');
    await checkDraft();
    await settings();
    await navigate('onderzoeken');
    await checkDraft();
    await shot('settings-research-continuity');

    // A preference change from another tab must translate the shell without
    // navigating an actively used phpMyAdmin document and losing its draft.
    await page.locator('#open-database').click();
    await page.locator('#database-dialog[open]').waitFor();
    await page.locator('.frame-message').waitFor({state: 'hidden'});
    await page.getByRole('tab', {name: 'SQL', exact: true}).click();
    await page.locator('.frame-message').waitFor({state: 'hidden'});
    const frame = page.frames().find(candidate => candidate.parentFrame() === page.mainFrame());
    assert.ok(frame, 'The official phpMyAdmin iframe is loaded.');
    const frameUrl = frame.url();
    await frame.evaluate(() => { window.governUnsavedDocument = 'keep-this-active-document'; });
    const sibling = await page.context().newPage();
    sibling.on('pageerror', error => errors.push(error.message));
    await sibling.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
    await sibling.locator('#preference-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#database-title').filter({hasText: 'Database workspace'}).waitFor();
    assert.equal(frame.url(), frameUrl, 'An open database document does not reload on a language preference update.');
    assert.equal(await frame.evaluate(() => window.governUnsavedDocument), 'keep-this-active-document');
    await sibling.close();
    await page.locator('#database-dialog').getByRole('button', {name: 'Close', exact: true}).click();
    await page.locator('#database-dialog').waitFor({state: 'hidden'});
    await page.locator('#open-database').click();
    await page.locator('.frame-message').waitFor({state: 'hidden'});
    assert.equal(new URL(await page.locator('#database-frame').getAttribute('src'), base).searchParams.get('lang'), 'en',
        'The next explicit opening uses the newly selected language.');
    await page.locator('#database-dialog').getByRole('button', {name: 'Close', exact: true}).click();
    await page.locator('#database-dialog').waitFor({state: 'hidden'});
    await checkDraft();

    await navigate('gegevens');
    await page.locator('#data-search').waitFor();
    let response = responseFor('browse');
    await page.locator('#data-search').fill('DigiD');
    await response;
    response = responseFor('browse');
    await page.locator('#data-page-size').selectOption('50');
    await response;
    await page.waitForFunction(() => document.querySelectorAll('.data-table tbody tr').length === 1);
    await settings();
    await navigate('gegevens');
    await page.locator('#data-search').waitFor();
    assert.equal(await page.locator('#data-search').inputValue(), 'DigiD');
    assert.equal(await page.locator('#data-page-size').inputValue(), '50');
    await page.locator('.data-table tbody tr').waitFor();
    assert.match(await page.locator('.data-table').innerText(), /DigiD/);
    await noHardBorders();

    await settings();
    await page.locator('#preference-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('[data-accent="#6651c6"]').click();
    await page.locator('#preference-accent').fill('#315ee8');
    await page.locator('#preference-accent').dispatchEvent('change');
    await page.locator('#preference-backgroundTint').fill('#c6b3d9');
    await page.locator('#preference-backgroundTint').dispatchEvent('change');
    await page.locator('#preference-theme').selectOption('dark');
    await page.locator('#preference-reduceTransparency').check();
    await page.locator('[data-sidebar-choice="right"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-sidebar'), 'right');
    assert.equal(await page.locator('html').getAttribute('data-reduce-transparency'), 'true');
    await page.reload({waitUntil: 'networkidle'});
    await page.locator('#preference-theme').waitFor();
    assert.equal(await page.locator('#language-select').inputValue(), 'en');
    assert.equal(await page.locator('#preference-theme').inputValue(), 'dark');
    assert.equal(await page.locator('#preference-accent').inputValue(), '#315ee8');
    assert.equal(await page.locator('#preference-backgroundTint').inputValue(), '#c6b3d9');
    assert.equal(await page.locator('#preference-reduceTransparency').isChecked(), true);
    assert.equal(await page.locator('[data-sidebar-choice="right"]').getAttribute('aria-pressed'), 'true');
    await noHardBorders();
    await shot('settings-dark-persisted');

    await navigate('overzicht');
    await page.locator('#edit-layout').waitFor();
    const initialOrder = await order();
    assert.ok(initialOrder.includes('overview.tables') && initialOrder.includes('overview.learning'));
    const initialSize = await page.locator('[data-block-id="overview.tables"]').getAttribute('data-size');
    await page.locator('#edit-layout').click();
    await page.locator('[data-block-move="overview.tables"][data-direction="1"]').click();
    await page.locator('[data-block-size="overview.tables"]').selectOption('full');
    await page.locator('[data-block-hide="overview.learning"]').click();
    assert.notDeepEqual(await order(), initialOrder);
    assert.equal(await page.locator('[data-block-id="overview.learning"]').count(), 0);
    await language('nl');
    await page.locator('#save-layout').waitFor();
    assert.equal(await page.locator('[data-block-size="overview.tables"]').inputValue(), 'full');
    assert.equal(await page.locator('[data-block-id="overview.learning"]').count(), 0);
    await noHardBorders();
    await page.locator('#cancel-layout').click();
    assert.deepEqual(await order(), initialOrder);
    assert.equal(await page.locator('[data-block-id="overview.tables"]').getAttribute('data-size'), initialSize);
    assert.equal(await page.locator('#language-select').inputValue(), 'nl', 'Cancel layout must not revert a language change.');

    await page.locator('#edit-layout').click();
    await page.locator('[data-block-move="overview.tables"][data-direction="1"]').click();
    await page.locator('[data-block-size="overview.tables"]').selectOption('full');
    await page.locator('[data-block-hide="overview.learning"]').click();
    await page.locator('[data-block-show="overview.learning"]').click();
    assert.equal(await page.locator('[data-block-id="overview.learning"]').count(), 1);
    await page.locator('[data-block-hide="overview.learning"]').click();
    const savedOrder = await order();
    await page.locator('#save-layout').click();
    await page.locator('#edit-layout').waitFor();
    const savedLayout = await storedLayout();
    assert.equal(savedLayout.blocks['overview.tables'].size, 'full');
    assert.equal(savedLayout.blocks['overview.learning'].hidden, true);
    await page.reload({waitUntil: 'networkidle'});
    await page.locator('#edit-layout').waitFor();
    assert.deepEqual(await order(), savedOrder);
    assert.equal(await page.locator('[data-block-id="overview.tables"]').getAttribute('data-size'), 'full');
    assert.equal(await page.locator('[data-block-id="overview.learning"]').count(), 0);
    await shot('settings-saved-dashboard');

    await settings();
    await page.locator('#preference-language').selectOption('en');
    await page.locator('#reset-appearance').click();
    assert.equal(await page.locator('#language-select').inputValue(), 'en');
    assert.equal(await page.locator('#preference-accent').inputValue(), '#0b7476');
    assert.equal(await page.locator('#preference-theme').inputValue(), 'light');
    assert.equal(await page.locator('html').getAttribute('data-sidebar'), 'right');
    assert.deepEqual(await storedLayout(), savedLayout, 'Reset appearance must not change dashboard preferences.');
    assert.equal((await storedPreferences()).language, 'en');
    await noHardBorders();
    await shot('settings-light-reset');

    for (const width of [375, 320]) {
        await page.setViewportSize({width, height: 900});
        await settings();
        await noOverflow('Mobile settings at ' + width);
        await page.locator('#menu-toggle').click();
        await navigate('overzicht');
        await page.locator('#edit-layout').waitFor();
        await noOverflow('Mobile dashboard at ' + width);
        assert.equal(await page.locator('#sidebar').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('html').getAttribute('data-sidebar'), 'right');
        await page.locator('#edit-layout').click();
        await noOverflow('Mobile layout editor at ' + width);
        await page.locator('#cancel-layout').click();
        await shot('settings-mobile-' + width);
        await page.locator('#menu-toggle').click();
        await navigate('gegevens');
        await page.locator('#data-search').waitFor();
        await noOverflow('Mobile data at ' + width);
    }
    await verifyRestoreGuard();
    await verifyExampleDraft();
    assert.deepEqual(errors, []);
    console.log('PASS: language and draft continuity, data navigation state, persisted appearance, layout Save/Cancel, independent reset, border-free light/dark views, 320/375px mobile layouts and restore concurrency guards' +
        (process.env.GOVERN_UI_WRITE_TESTS === '1' ? ', saved-research example discard.' : '.'));
} finally {
    await browser.close();
}
