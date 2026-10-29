/**
 * Real browser check for the visual query builder. Uses the Bestuursatlas seed
 * in an isolated local Govern stack. GOVERN_UI_WRITE_TESTS=1 additionally
 * checks saving the executed SQL, then removes its own saved investigation.
 *
 * Uses the same BASE_URL, PLAYWRIGHT_MODULE, BROWSER_BIN, BROWSER_ARGS_JSON and SCREENSHOTS_DIR
 * options as frontend-smoke.mjs. No extra runtime package in Govern is needed.
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
const browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {}), args: browserArgs});
const errors = [];
const ref = (source, column) => JSON.stringify([source, column]);
const responseFor = (page, action) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === action;
});
const shot = async (page, name) => {
    if (screenshots) await page.screenshot({path: path.join(screenshots, name + '.png'), fullPage: true});
};
const generate = async page => {
    const response = responseFor(page, 'build-query');
    await page.getByRole('button', {name: 'Query maken', exact: true}).click();
    const received = await response;
    const payload = await received.json();
    assert.equal(received.status(), 200, payload.error);
    await page.locator('.builder-status').filter({hasText: 'De SQL staat in de editor.'}).waitFor();
    return {data: payload.data, body: received.request().postDataJSON()};
};
const run = async page => {
    const response = responseFor(page, 'query');
    await page.getByRole('button', {name: 'Query uitvoeren', exact: true}).click();
    const received = await response;
    const payload = await received.json();
    assert.equal(received.status(), 200, payload.error);
    await page.locator('.query-result .loading-state').waitFor({state: 'hidden'});
    return {data: payload.data, body: received.request().postDataJSON()};
};

try {
    const page = await browser.newPage({locale: 'nl-NL', viewport: {width: 1440, height: 1000}});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/#onderzoeken?table=digital_systems', base).href, {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: 'Query maken', exact: true}).waitFor();
    assert.equal(await page.getByRole('combobox', {name: 'Basistabel', exact: true}).inputValue(), 'digital_systems');
    const structure = await page.evaluate(async () => (await (await fetch('/api.php?action=structure&table=digital_systems')).json()).data);
    assert.ok(structure?.columns, 'Use a test stack with the Bestuursatlas seed.');

    await page.getByRole('button', {name: 'Kolomkeuze wissen voor de basistabel', exact: true}).click();
    await page.getByRole('checkbox', {name: 'Basiskolom code', exact: true}).check();
    await page.getByRole('checkbox', {name: 'Basiskolom name', exact: true}).check();
    await page.getByRole('button', {name: 'Voorwaarde toevoegen', exact: true}).click();
    await page.getByRole('combobox', {name: 'Kolom voor voorwaarde 1', exact: true}).selectOption(ref('base', 'code'));
    await page.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).fill('digid');
    const first = await generate(page);
    assert.match(first.data.sql, /WHERE/);
    assert.ok(first.data.explanation.length > 0);
    assert.equal(first.body.design.filters[0].value, 'digid');
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), first.data.sql);
    await page.getByRole('heading', {name: 'Wat deze query doet', exact: true}).waitFor();
    const selected = await run(page);
    assert.ok(selected.body.design);
    assert.equal(selected.body.sql, undefined);
    assert.equal(selected.data.returned_rows, 1);
    assert.ok(selected.data.rows.flat().includes('DigiD'));

    // Focused response fixture: keep the real query result, but model a changed
    // compiler response after metadata changed between build and execution.
    const refreshedSql = first.data.sql + '\n-- Geactualiseerde structuur';
    const refreshedExplanation = ['Deze uitleg hoort bij de opnieuw samengestelde query.'];
    const refreshedResponse = async route => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.data.sql = refreshedSql;
        payload.data.explanation = refreshedExplanation;
        if (payload.data.explanation_i18n) payload.data.explanation_i18n.nl = refreshedExplanation;
        await route.fulfill({response, json: payload});
    };
    await page.route('**/api.php?action=query', refreshedResponse);
    await run(page);
    await page.unroute('**/api.php?action=query', refreshedResponse);
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), refreshedSql);
    assert.match(await page.locator('.query-explanation').innerText(), /opnieuw samengestelde query/);
    assert.match(await page.locator('.query-result').innerText(), /De editor toont de uitgevoerde query/);

    if (process.env.GOVERN_UI_WRITE_TESTS === '1') {
        const name = 'Bijgewerkte SQL-test ' + Date.now();
        let id;
        try {
            await page.getByRole('textbox', {name: 'Naam van je onderzoek', exact: true}).fill(name);
            const savedResponse = responseFor(page, 'save-query');
            await page.getByRole('button', {name: 'Onderzoek bewaren', exact: true}).click();
            const saved = await savedResponse;
            id = (await saved.json()).data.id;
            assert.equal(saved.request().postDataJSON().sql, refreshedSql);
            await page.locator('.saved-item-open').filter({hasText: name}).waitFor();
            const savedSql = await page.evaluate(async id => {
                const data = (await (await fetch('/api.php?action=queries')).json()).data;
                return data.find(query => String(query.id) === String(id))?.sql;
            }, id);
            assert.equal(savedSql, refreshedSql);
            await page.getByRole('button', {name: 'Verwijder onderzoek ' + name, exact: true}).click();
            const removed = responseFor(page, 'delete-query');
            await page.getByRole('button', {name: 'Onderzoek verwijderen', exact: true}).click();
            assert.equal((await removed).status(), 200);
            await page.locator('.saved-item-open').filter({hasText: name}).waitFor({state: 'detached'});
            id = undefined;
        } finally {
            if (id !== undefined) await page.evaluate(async id => {
                const {csrf} = (await (await fetch('/api.php?action=bootstrap')).json()).data;
                await fetch('/api.php?action=delete-query', {method: 'POST', headers: {
                    'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
                }, body: JSON.stringify({id})});
            }, id);
        }
    }

    // Editing an unapplied draft must not alter the design bound to visible SQL.
    await page.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).fill('niet-toegepaste-keuze');
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), refreshedSql);
    const untouched = await run(page);
    assert.equal(untouched.body.design.filters[0].value, 'digid');
    assert.equal(untouched.data.returned_rows, 1);

    const manual = "SELECT 'handmatig' AS werkwijze;";
    let releaseQuery, querySeen;
    const queryGate = new Promise(resolve => { releaseQuery = resolve; });
    const queryRequestSeen = new Promise(resolve => { querySeen = resolve; });
    const delayedQuery = async route => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.data.sql = refreshedSql;
        payload.data.explanation = refreshedExplanation;
        if (payload.data.explanation_i18n) payload.data.explanation_i18n.nl = refreshedExplanation;
        querySeen();
        await queryGate;
        await route.fulfill({response, json: payload});
    };
    await page.route('**/api.php?action=query', delayedQuery);
    const pendingQuery = responseFor(page, 'query');
    try {
        await page.getByRole('button', {name: 'Query uitvoeren', exact: true}).click();
        await queryRequestSeen;
        await page.getByRole('textbox', {name: 'SQL-query', exact: true}).fill(manual);
    } finally { releaseQuery(); }
    await pendingQuery;
    await page.unroute('**/api.php?action=query', delayedQuery);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Query uitvoeren"]').disabled);
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), manual);
    assert.equal(await page.locator('.query-result .data-table').count(), 0);
    const edited = await run(page);
    assert.equal(edited.body.sql, manual);
    assert.equal(edited.body.design, undefined);
    assert.deepEqual(edited.data.rows, [['handmatig']]);
    assert.equal(await page.locator('.query-explanation').innerText(), '');

    // Both the applied SQL and the independent, unfinished design survive a
    // visit to another screen. Nothing is parsed back out of arbitrary SQL.
    await page.locator('#navigation [data-area="database"]').click();
    await page.getByRole('heading', {name: 'Verken je database.', exact: true}).waitFor();
    await page.getByRole('link', {name: 'Onderzoeken', exact: true}).click();
    await page.getByRole('button', {name: 'Query maken', exact: true}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).inputValue(), 'niet-toegepaste-keuze');
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), manual);

    await page.getByRole('button', {name: 'Kolomkeuze wissen voor de basistabel', exact: true}).click();
    await page.getByRole('button', {name: 'Query maken', exact: true}).click();
    await page.getByRole('alert').filter({hasText: 'Kies minstens één kolom'}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), manual);
    await page.getByRole('checkbox', {name: 'Basiskolom id', exact: true}).check();
    await page.getByRole('combobox', {name: 'Vergelijking voor voorwaarde 1', exact: true}).selectOption('is_null');
    assert.equal(await page.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).count(), 0);
    const nullQuery = await generate(page);
    assert.equal(Object.hasOwn(nullQuery.body.design.filters[0], 'value'), false);
    assert.match(nullQuery.data.sql, /IS NULL/);
    await page.getByRole('combobox', {name: 'Vergelijking voor voorwaarde 1', exact: true}).selectOption('is_not_null');

    const relation = structure.foreign_keys.find(key => key.referenced_table === 'evidence');
    assert.ok(relation, 'The seed should provide a digital_systems → evidence reference.');
    await page.getByRole('combobox', {name: 'Koppeling', exact: true}).focus();
    await page.getByRole('combobox', {name: 'Koppeling', exact: true}).selectOption(relation.name);
    await page.getByRole('checkbox', {name: 'Gekoppelde kolom id', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Koppeling');
    await page.getByRole('checkbox', {name: 'Gekoppelde kolom id', exact: true}).check();
    await page.getByRole('button', {name: 'Sortering toevoegen', exact: true}).click();
    await page.getByRole('combobox', {name: 'Kolom voor sortering 1', exact: true}).selectOption(ref('base', 'id'));
    await page.getByRole('combobox', {name: 'Richting voor sortering 1', exact: true}).selectOption('desc');
    await page.getByRole('spinbutton', {name: 'Aantal resultaatrijen', exact: true}).fill('2');
    const joined = await generate(page);
    assert.match(joined.data.sql, /LEFT JOIN/);
    const joinedResult = await run(page);
    assert.deepEqual(joinedResult.data.columns, ['basis.id', 'gekoppeld.id']);
    assert.equal(joinedResult.data.returned_rows, 2);
    assert.ok(Number(joinedResult.data.rows[0][0]) > Number(joinedResult.data.rows[1][0]));
    await shot(page, 'query-builder-join');
    await page.getByRole('combobox', {name: 'Soort koppeling', exact: true}).selectOption('inner');
    assert.match((await generate(page)).data.sql, /INNER JOIN/);

    // Hold a real request until an intervening edit is complete. The response
    // still comes from the server; this only makes the timing deterministic.
    let release, seen;
    const gate = new Promise(resolve => { release = resolve; });
    const requestSeen = new Promise(resolve => { seen = resolve; });
    const delayedRoute = async route => { seen(); await gate; await route.continue(); };
    await page.route('**/api.php?action=build-query', delayedRoute);
    const lateResponse = responseFor(page, 'build-query');
    try {
        await page.getByRole('button', {name: 'Query maken', exact: true}).click();
        await requestSeen;
        await page.getByRole('textbox', {name: 'SQL-query', exact: true}).fill('SELECT 42 AS eigen_wijziging;');
    } finally { release(); }
    await lateResponse;
    await page.locator('.builder-status').filter({hasText: 'intussen gewijzigd'}).waitFor();
    await page.unroute('**/api.php?action=build-query', delayedRoute);
    assert.equal(await page.getByRole('textbox', {name: 'SQL-query', exact: true}).inputValue(), 'SELECT 42 AS eigen_wijziging;');
    assert.deepEqual((await run(page)).data.rows, [['42']]);

    await page.locator('.query-builder > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.query-builder').evaluate(element => element.open), false);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.query-builder').evaluate(element => element.open), true);

    // A focused metadata fixture models a removed selected column. The design
    // must keep it until the user explicitly removes that one choice.
    const schemaPage = await browser.newPage({locale: 'nl-NL', viewport: {width: 1440, height: 1000}});
    schemaPage.on('pageerror', error => errors.push(error.message));
    let hideColumn = false;
    let attemptedDesign;
    await schemaPage.route('**/api.php?action=structure&table=*', async route => {
        if (!hideColumn || new URL(route.request().url()).searchParams.get('table') !== 'digital_systems') return route.continue();
        const response = await route.fetch();
        const payload = await response.json();
        payload.data.columns = payload.data.columns.filter(column => column.name !== 'name');
        await route.fulfill({response, json: payload});
    });
    await schemaPage.route('**/api.php?action=build-query', async route => {
        attemptedDesign = route.request().postDataJSON().design;
        if (hideColumn && attemptedDesign.table === 'digital_systems' && attemptedDesign.columns.some(column => column.column === 'name')) {
            return route.fulfill({status: 422, contentType: 'application/json',
                body: JSON.stringify({ok: false, error: 'De gekozen kolom name bestaat niet meer.'})});
        }
        return route.continue();
    });
    await schemaPage.goto(new URL('/#onderzoeken?table=digital_systems', base).href, {waitUntil: 'networkidle'});
    await schemaPage.getByRole('checkbox', {name: 'Basiskolom name', exact: true}).waitFor();
    assert.equal(await schemaPage.getByRole('checkbox', {name: 'Basiskolom name', exact: true}).isChecked(), true);
    hideColumn = true;
    await schemaPage.locator('#navigation [data-area="database"]').click();
    await schemaPage.getByRole('heading', {name: 'Verken je database.', exact: true}).waitFor();
    await schemaPage.getByRole('link', {name: 'Onderzoeken', exact: true}).click();
    const missing = schemaPage.getByRole('button', {name: 'Ontbrekende kolom digital_systems.name verwijderen', exact: true});
    await missing.waitFor();
    assert.equal(await schemaPage.getByRole('checkbox', {name: 'Basiskolom name', exact: true}).count(), 0);
    assert.match(await schemaPage.locator('.builder-missing-columns').innerText(), /niet meer in de huidige structuur/);
    const refused = responseFor(schemaPage, 'build-query');
    await schemaPage.getByRole('button', {name: 'Query maken', exact: true}).click();
    assert.equal((await refused).status(), 422);
    await schemaPage.getByRole('alert').filter({hasText: 'De gekozen kolom name bestaat niet meer.'}).waitFor();
    assert.ok(attemptedDesign.columns.some(column => column.column === 'name'));
    await missing.click();
    assert.equal(await schemaPage.getByRole('checkbox', {name: 'Basiskolom id', exact: true}).isChecked(), true);
    assert.equal(await schemaPage.getByRole('checkbox', {name: 'Basiskolom code', exact: true}).isChecked(), true);
    assert.equal(await schemaPage.locator('.builder-missing-columns').innerText(), '');
    const repaired = await generate(schemaPage);
    assert.ok(!repaired.body.design.columns.some(column => column.column === 'name'));
    assert.ok(repaired.body.design.columns.some(column => column.column === 'code'));
    await schemaPage.getByRole('combobox', {name: 'Basistabel', exact: true}).focus();
    await schemaPage.getByRole('combobox', {name: 'Basistabel', exact: true}).selectOption('evidence');
    await schemaPage.getByRole('button', {name: 'Query maken', exact: true}).waitFor();
    assert.equal(await schemaPage.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Basistabel');

    const mobile = await browser.newPage({locale: 'nl-NL', viewport: {width: 390, height: 844}});
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(new URL('/#onderzoeken?table=digital_systems', base).href, {waitUntil: 'networkidle'});
    await mobile.getByRole('button', {name: 'Query maken', exact: true}).waitFor();
    await mobile.getByRole('button', {name: 'Voorwaarde toevoegen', exact: true}).click();
    await mobile.getByRole('combobox', {name: 'Kolom voor voorwaarde 1', exact: true}).selectOption(ref('base', 'name'));
    await mobile.getByRole('combobox', {name: 'Vergelijking voor voorwaarde 1', exact: true}).selectOption('contains');
    await mobile.getByRole('textbox', {name: 'Waarde voor voorwaarde 1', exact: true}).fill('Digi');
    await generate(mobile);
    assert.equal((await run(mobile)).data.returned_rows, 1);
    await shot(mobile, 'query-builder-mobile');
    const geometry = await mobile.evaluate(() => ({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        overflows: [...document.querySelectorAll('#page, #page *, .workspace')].filter(node => {
            if (!node.getClientRects().length) return false;
            const scroll = node.closest('.table-scroll');
            if (scroll && scroll !== node) return false; // The wide table may scroll inside its own container.
            const rect = node.getBoundingClientRect();
            return rect.right > innerWidth + .5 || rect.left < -.5;
        }).slice(0, 12).map(node => {
            const rect = node.getBoundingClientRect();
            const css = getComputedStyle(node);
            return {element: node.id || (typeof node.className === 'string' && node.className) || node.tagName,
                left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
                minWidth: css.minWidth, columns: css.gridTemplateColumns};
        }),
    }));
    assert.equal(geometry.documentWidth <= geometry.viewport, true, 'Mobiele overflow: ' + JSON.stringify(geometry));
    assert.deepEqual(errors, []);
    console.log('PASS: visual filters, exact applied design, executed SQL reconciliation, manual SQL, draft persistence, missing-column recovery, empty selection, NULL, JOIN, ordering, limit, late-response protection, focus, keyboard, mobile.' +
        (process.env.GOVERN_UI_WRITE_TESTS === '1' ? ' Updated SQL save/delete passed.' : ''));
} finally {
    await browser.close();
}
