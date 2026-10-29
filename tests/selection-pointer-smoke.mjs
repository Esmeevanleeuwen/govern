/** Inspect real database data and arbitrary interface elements without activating them. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const screenshots = process.env.SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, {recursive: true});
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const context = await browser.newContext({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
const page = await context.newPage();
const errors = [];
const mutations = [];
const bootstrapRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
    if (request.method() === 'POST') mutations.push(request.url());
    const url = new URL(request.url());
    if (url.pathname === '/api.php' && url.searchParams.get('action') === 'bootstrap') bootstrapRequests.push(request.url());
});
const toggle = page.locator('#selection-pointer-toggle');
const tag = page.locator('#selection-pointer-tag');
const more = page.locator('#selection-pointer-more');
const dialog = page.locator('#selection-pointer-dialog');
const count = async expected => {
    await page.waitForFunction(value => Number(document.querySelector('#selection-pointer-count')?.textContent.match(/\d+/)?.[0]) === value, expected);
};
const closeDialog = async () => {
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'hidden'});
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Closing the explanation keeps the selection pointer on.');
};
const noOverflow = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    label + ' must fit the viewport.');
const shot = async name => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, 'selection-' + name + '.png'), fullPage: true});
};
const openSelected = async () => {
    await page.locator('#selection-pointer-count').click();
    if (!await dialog.isVisible()) {
        await tag.waitFor();
        await more.click();
    }
    await page.locator('#selection-pointer-dialog[open]').waitFor();
};
const stateOfCanvas = () => page.locator('.schema-world').evaluate(world => ({
    transform: world.style.transform,
    positions: [...world.querySelectorAll('[data-schema-node]')].map(node => [node.dataset.schemaNode, node.style.left, node.style.top]),
}));

try {
    await page.goto(new URL('/#gegevens?table=organizations', base).href, {waitUntil: 'networkidle'});
    await page.locator('.table-workspace .data-table tbody tr').nth(1).waitFor();
    const dataTable = page.locator('.table-workspace .data-table');
    const nameIndex = await dataTable.locator('thead th').evaluateAll(cells => cells.findIndex(cell => cell.textContent.trim() === 'name'));
    assert.ok(nameIndex >= 0, 'The seeded organizations table has its real name column.');
    const rows = dataTable.locator('tbody tr');
    const firstCell = rows.nth(0).locator('td').nth(nameIndex);
    const secondCell = rows.nth(1).locator('td').nth(nameIndex);
    const firstValue = await firstCell.innerText();
    const secondValue = await secondCell.innerText();
    assert.equal(await firstCell.getAttribute('data-selection-kind'), 'cell', 'Browse cells have their exact database context.');
    assert.equal(await rows.nth(0).getAttribute('data-selection-kind'), 'row', 'The parent record is independently inspectable.');

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await firstCell.click();
    await count(1);
    await secondCell.click({modifiers: ['Shift']});
    await count(2);
    await secondCell.click({modifiers: ['Shift']});
    await count(1);
    await secondCell.click({modifiers: ['Shift']});
    await count(2);
    const beforeRefresh = bootstrapRequests.length;
    await page.locator('#refresh-app').click();
    await count(1);
    assert.equal(bootstrapRequests.length, beforeRefresh, 'Selecting Refresh must not refresh the application.');
    const hash = await page.evaluate(() => location.hash);
    await page.locator('#navigation [data-area="research"]').click();
    await count(1);
    assert.equal(await page.evaluate(() => location.hash), hash, 'Selecting a navigation item must not navigate.');
    const searchBefore = await page.locator('#data-search').inputValue();
    await page.locator('#data-search').click();
    assert.equal(await page.locator('#data-search').inputValue(), searchBefore, 'Inspecting an input preserves its value.');
    assert.equal(await page.locator('#data-search').evaluate(input => input === document.activeElement), false,
        'A selection click does not start editing the input.');

    // Restart the pointer to establish a fresh dwell timer, independent of the
    // clicks above. Hover alone never changes the one-item selection.
    await toggle.click();
    await toggle.click();
    await firstCell.click();
    await firstCell.hover();
    await page.waitForTimeout(2400);
    assert.equal(await tag.isVisible(), false, 'The name tag must not appear before three seconds.');
    await tag.waitFor();
    assert.match(await page.locator('#selection-pointer-type').innerText(), /<td>/);
    assert.ok((await page.locator('#selection-pointer-name').innerText()).includes(firstValue), 'The tag identifies this exact cell.');
    await count(1);
    await shot('tag-light');
    // Let a second dwell complete while the first name tag is still open.
    // Do not click, restart the pointer, or move again during this dwell:
    // hiding A's tag must not cancel B's newly started three-second timer.
    const adjacentCell = rows.nth(0).locator('td').nth(0);
    const adjacentKey = await adjacentCell.getAttribute('data-selection-key');
    const adjacentValue = await adjacentCell.innerText();
    assert.notEqual(adjacentKey, await firstCell.getAttribute('data-selection-key'));
    await adjacentCell.hover();
    await page.waitForFunction(key => !document.querySelector('#selection-pointer-tag').hidden
        && document.querySelector('#selection-pointer-path [data-selection-parent][aria-pressed="true"]')?.getAttribute('data-selection-parent') === key,
    adjacentKey);
    assert.ok((await page.locator('#selection-pointer-name').innerText()).includes(adjacentValue), 'The second dwell reveals the second element without another mouse movement.');
    await count(1);
    await page.locator('#selection-pointer-count').click();
    assert.ok((await page.locator('#selection-pointer-name').innerText()).includes(firstValue), 'The selection shortcut restores the selected cell tag.');
    await more.click();
    await page.locator('#selection-pointer-dialog[open]').waitFor();
    assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'The modal takes keyboard focus.');
    const firstExplanation = await dialog.innerText();
    assert.ok(firstExplanation.includes('organizations') && firstExplanation.includes(firstValue), 'The explanation uses the selected table and value.');
    for (let index = 0; index < 7; index += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Tab stays inside the modal.');
    }
    await closeDialog();

    await secondCell.click({modifiers: ['Shift']});
    await count(2);
    await openSelected();
    const combined = await dialog.innerText();
    assert.ok(combined.includes(firstValue) && combined.includes(secondValue), 'More on a selection explains the selected set together.');
    assert.match(await dialog.locator('h2').innerText(), /2/);

    // A language change in another tab updates the open modal without losing
    // the selected records or their raw text.
    const languagePage = await context.newPage();
    languagePage.on('pageerror', error => errors.push(error.message));
    await languagePage.goto(new URL('/#instellingen', base).href, {waitUntil: 'networkidle'});
    await languagePage.locator('#language-select').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#selection-pointer-dialog[open]').waitFor();
    await count(2);
    assert.equal(await page.locator('#selection-pointer-dialog').count(), 1, 'Language changes reuse one explanation dialog.');
    assert.ok((await dialog.innerText()).includes(firstValue), 'Language changes keep the original record text.');
    assert.equal((await dialog.innerText()).includes('app.selection.'), false, 'No translation keys leak into the modal.');
    await shot('combined-en');
    await languagePage.close();
    await closeDialog();

    // A hover outside the selected set explains that target only and leaves
    // the existing set intact.
    await page.locator('#data-search').hover();
    await page.waitForFunction(() => !document.querySelector('#selection-pointer-tag').hidden
        && document.querySelector('#selection-pointer-type').textContent.includes('<input>'));
    await more.click();
    await page.locator('#selection-pointer-dialog[open]').waitFor();
    assert.doesNotMatch(await dialog.locator('h2').innerText(), /2 selected/);
    assert.match(await dialog.innerText(), /search/i);
    await count(2);
    await closeDialog();

    // The parent path resolves the whole record, not merely the cell that was
    // used to point at it. This also works after the language remount.
    const currentRows = page.locator('.table-workspace .data-table tbody tr');
    const currentCell = currentRows.nth(0).locator('td').nth(nameIndex);
    const rowKey = await currentRows.nth(0).getAttribute('data-selection-key');
    await currentCell.hover();
    await page.waitForFunction(value => !document.querySelector('#selection-pointer-tag').hidden
        && document.querySelector('#selection-pointer-type').textContent.includes('<td>')
        && document.querySelector('#selection-pointer-name').textContent.includes(value), firstValue);
    await page.locator('#selection-pointer-path [data-selection-parent]').filter({hasText: /row/i}).click();
    await count(1);
    assert.match(await page.locator('#selection-pointer-type').innerText(), /<tr>/);
    assert.equal(await page.locator('#selection-pointer-path [data-selection-parent][aria-pressed="true"]').getAttribute('data-selection-parent'), rowKey);
    await more.click();
    await page.locator('#selection-pointer-dialog[open]').waitFor();
    assert.ok((await dialog.innerText()).includes(firstValue));
    await closeDialog();
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'Escape exits pointer mode when no modal is open.');

    // Normal controls recover their original behavior immediately.
    await page.locator('#data-search').fill(firstValue);
    await page.waitForFunction(value => document.querySelector('.table-workspace .data-table')?.textContent.includes(value)
        && document.querySelectorAll('.table-workspace .data-table tbody tr').length === 1, firstValue);
    await page.locator('#data-search').fill('');
    await page.locator('.table-workspace .data-table tbody tr').nth(1).waitFor();
    await page.locator('[data-database-view="schema"]').click();
    await page.locator('#schema-viewport').waitFor();
    await page.locator('#schema-table-panel [data-schema-select="organizations"]').click();
    await page.locator('#schema-actual').click();
    await toggle.click();
    const header = page.locator('[data-schema-header="organizations"]');
    await header.scrollIntoViewIfNeeded();
    const beforeDrag = await stateOfCanvas();
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 25, headerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 65, headerBox.y + 50, {steps: 5});
    await page.mouse.up();
    assert.deepEqual(await stateOfCanvas(), beforeDrag, 'Inspection prevents the ordinary table drag from moving the diagram.');
    await header.focus();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await stateOfCanvas(), beforeDrag, 'Inspection prevents keyboard arrows from moving a schema table.');
    const canvas = await page.locator('#schema-viewport').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .35);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => parseInt(document.querySelector('#schema-zoom-value').textContent, 10) > 100);
    assert.notEqual((await stateOfCanvas()).transform, beforeDrag.transform, 'Wheel zoom remains available with the selection pointer on.');
    await page.keyboard.press('Escape');
    await page.locator('#schema-actual').click();
    assert.match(await page.locator('#schema-zoom-value').innerText(), /100/);

    // An unregistered heading is still inspectable. Keyboard users can reach
    // an inspection through the pointer controls without waiting for hover.
    await toggle.click();
    await toggle.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await count(1);
    await openSelected();
    assert.ok((await dialog.innerText()).trim().length > 30);
    await closeDialog();
    await page.keyboard.press('Escape');

    // Safe text display for any element, not just pre-registered database data.
    const hostile = '<img src=x onerror="window.selectionXss=1">';
    await page.evaluate(value => {
        const element = document.createElement('p');
        element.id = 'selection-test-text';
        element.textContent = value;
        document.querySelector('#page').prepend(element);
    }, hostile);
    await toggle.click();
    await page.locator('#selection-test-text').click();
    await openSelected();
    assert.ok((await dialog.innerText()).includes(hostile), 'Arbitrary text is shown literally in its explanation.');
    assert.equal(await dialog.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.selectionXss), undefined);
    await closeDialog();
    await page.keyboard.press('Escape');

    // Chromium suppresses ordinary click activation on disabled controls.
    // Inspect them through real pointer coordinates, not a forced DOM click.
    await page.evaluate(() => {
        const element = document.createElement('button');
        element.id = 'selection-test-disabled';
        element.type = 'button';
        element.disabled = true;
        element.textContent = 'Disabled inspection example';
        element.addEventListener('click', () => { window.selectionDisabledActivated = true; });
        document.querySelector('#page').prepend(element);
    });
    await toggle.click();
    const disabled = page.locator('#selection-test-disabled');
    await disabled.scrollIntoViewIfNeeded();
    const disabledBox = await disabled.boundingBox();
    await page.mouse.click(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
    await count(1);
    await openSelected();
    assert.match(await dialog.innerText(), /Disabled inspection example/);
    assert.match(await dialog.innerText(), /<button>/);
    assert.equal(await page.evaluate(() => window.selectionDisabledActivated), undefined, 'Inspecting a disabled button cannot activate its handler.');
    await closeDialog();
    await page.keyboard.press('Escape');

    // Compact controls and the explanation stay usable with the actual dark,
    // reduced-transparency preference at the narrowest supported width.
    await page.evaluate(async () => {
        const {updatePreferences} = await import('/assets/preferences.js');
        updatePreferences({theme: 'dark', reduceTransparency: true});
    });
    await page.setViewportSize({width: 320, height: 900});
    await noOverflow('320px selection controls');
    await toggle.click();
    await page.locator('.database-heading h1').click();
    await openSelected();
    await noOverflow('320px explanation');
    assert.equal(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true);
    await shot('mobile-dark-solid');
    await closeDialog();
    await page.keyboard.press('Escape');
    assert.deepEqual(mutations, [], 'Inspecting and explaining selections never sends a database mutation.');

    // Free SQL and the visual design endpoint intentionally have different
    // result shapes. Inspect a second statement's real result without guessing
    // a source table, then retain a successful result when statement two fails.
    const scriptPage = await context.newPage();
    scriptPage.on('pageerror', error => errors.push(error.message));
    const scriptPosts = [];
    scriptPage.on('request', request => {
        if (request.method() === 'POST') scriptPosts.push({url: request.url(), body: request.postDataJSON()});
    });
    await scriptPage.goto(new URL('/#onderzoeken', base).href, {waitUntil: 'networkidle'});
    const runScript = async sql => {
        await scriptPage.locator('#sql-editor').fill(sql);
        const pending = scriptPage.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api.php' && url.searchParams.get('action') === 'query';
        });
        await scriptPage.getByRole('button', {name: /^(Run query|Query uitvoeren)$/, exact: true}).click();
        const response = await pending;
        const payload = await response.json();
        assert.equal(response.status(), 200, payload.error);
        assert.equal(payload.ok, true, payload.error);
        await scriptPage.locator('.query-result .loading-state').waitFor({state: 'hidden'});
        return payload.data;
    };
    const script = await runScript('SELECT 1 AS first_value; SELECT 2 AS second_value;');
    assert.equal(script.statements.length, 2);
    assert.equal(script.failed, null);
    const scriptTables = scriptPage.locator('.query-result .data-table');
    await scriptTables.nth(1).waitFor();
    assert.equal(await scriptTables.count(), 2, 'Every successful SELECT statement has its own result table.');
    assert.deepEqual(await scriptTables.nth(1).locator('th').allTextContents(), ['second_value']);
    const secondResultCell = scriptTables.nth(1).locator('tbody td');
    assert.equal(await secondResultCell.innerText(), '2');
    assert.equal(await secondResultCell.getAttribute('data-selection-kind'), 'cell');
    const resultMeta = await secondResultCell.evaluate(async node => {
        const {describeSelection} = await import('/assets/selection-registry.js');
        return describeSelection(node, document.querySelector('.app-shell')).meta;
    });
    assert.equal(resultMeta.snapshot, true, 'Free SQL result cells are snapshots.');
    assert.equal(resultMeta.table, undefined, 'A query alias must not invent a source table.');
    assert.deepEqual(resultMeta.primaryKey, [], 'A query result must not invent a record key.');
    await scriptPage.locator('#selection-pointer-toggle').click();
    await secondResultCell.click();
    await scriptPage.locator('#selection-pointer-count').click();
    await scriptPage.locator('#selection-pointer-more').click();
    const scriptDialog = scriptPage.locator('#selection-pointer-dialog[open]');
    await scriptDialog.waitFor();
    assert.match(await scriptDialog.innerText(), /second_value/);
    assert.match(await scriptDialog.innerText(), /snapshot|momentopname/i);
    assert.equal(await scriptDialog.locator('[data-selection-action]').count(), 0,
        'A keyless SQL result cannot offer a guessed table route or selection query.');
    await scriptPage.keyboard.press('Escape');
    await scriptPage.keyboard.press('Escape');
    const absentTable = '__govern_missing_selection_smoke_' + Date.now();
    const partial = await runScript('SELECT 1 AS before_error; SELECT * FROM `' + absentTable + '`; SELECT 3 AS not_run;');
    assert.equal(partial.statements.length, 1);
    assert.equal(partial.failed.index, 2);
    await scriptPage.locator('.query-result .notice-error').waitFor();
    assert.equal(await scriptTables.count(), 1, 'A later SQL failure retains completed results and stops before the third statement.');
    assert.deepEqual(await scriptTables.locator('th').allTextContents(), ['before_error']);
    assert.deepEqual(await scriptTables.locator('td').allTextContents(), ['1']);
    assert.match(await scriptPage.locator('.query-result .notice-error').innerText(), /(?:statement|opdracht) 2/i);
    assert.equal(scriptPosts.length, 2);
    assert.ok(scriptPosts.every(request => new URL(request.url).searchParams.get('action') === 'query'
        && typeof request.body.sql === 'string' && request.body.sql.startsWith('SELECT ')),
    'The script compatibility probes only send the two explicit read-only SQL scripts.');
    await scriptPage.close();
    assert.deepEqual(errors, [], 'The selection flow has no uncaught browser errors.');
    console.log('PASS: arbitrary UI/data selection, Shift toggle, three-second tags, parent path, exact and combined explanations, modal focus, language continuity, safe text, schema input separation and mobile appearance.');
} finally {
    await browser.close();
}
