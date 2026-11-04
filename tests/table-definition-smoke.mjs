/** Browser draft/scope/accessibility checks with explicit API fixtures, not database execution. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import http from 'node:http';
import path from 'node:path';
import {mkdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../app/public/', import.meta.url)));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/table-builder.css"></head><body>
<button id="launch">Create table</button><script type="module">
import {createTableBuilder} from '/assets/table-builder.js'; import {setCsrf} from '/assets/api.js'; import {setLanguage} from '/assets/i18n.js';
setCsrf('fixture-csrf'); setLanguage('en'); let selected='research', callbackPromise=null, rejectCallback=null; const busy=[]; const created=[];
const builder=createTableBuilder({getDatabase:()=>selected,onBusy:value=>busy.push(value),onCreated:value=>{created.push({value,closed:!builder.isOpen(),released:busy.at(-1)===false});return callbackPromise;}});
document.getElementById('launch').addEventListener('click',()=>builder.open());
window.fixture={builder,busy,created,setLanguage,setDatabase:value=>{selected=value;},deferCallback:()=>{callbackPromise=new Promise((resolve,reject)=>{rejectCallback=reject;});},rejectCallback:()=>rejectCallback(new Error('Fixture navigation failure'))};
</script></body></html>`;
const server = http.createServer(async (req, res) => {
    try {
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const target = path.resolve(root, '.' + name);
        if (!target.startsWith(root + path.sep) || !name.startsWith('/assets/')) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(target));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_BIN || process.env.CHROMIUM_PATH ? {executablePath: process.env.BROWSER_BIN || process.env.CHROMIUM_PATH} : {}),
    args: process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox']});
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const requests = [], failures = [];
async function capture(page, name) {
    const directory = process.env.TABLE_BUILDER_SCREENSHOTS_DIR;
    if (!directory) return;
    await mkdir(directory, {recursive: true});
    await page.locator('#table-builder-dialog').screenshot({path: path.join(directory, name + '.png')});
}
try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/api.php?**', async route => {
        const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
        requests.push({action: url.searchParams.get('action'), params: Object.fromEntries(url.searchParams), body, csrf: req.headers()['x-csrf-token']});
        const engine = url.searchParams.get('connection') === 'postgres' ? 'postgres' : 'mariadb';
        const database = url.searchParams.get('database'), schema = url.searchParams.get('schema') || database;
        const definition = body.definition || body;
        const data = {definition, definition_token: 'a'.repeat(64), sql: 'CREATE TABLE fixture (' + definition.columns.map(c => c.name).join(', ') + ');',
            table: definition.name, database, schema, engine, created: true, verified: true,
            scope_key: engine === 'postgres' ? 'postgres:' + database + ':' + schema : database};
        await new Promise(resolve => setTimeout(resolve, 200));
        await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, data})});
    });
    await page.goto(origin); await page.waitForFunction(() => window.fixture); await page.click('#launch');
    check(await page.locator('#table-builder-dialog').isVisible(), 'Builder opens in a native dialog.');
    check(await page.locator('#table-builder-close > span').evaluate(n => getComputedStyle(n).position === 'absolute' && n.getBoundingClientRect().width <= 1), 'Close retains its accessible label without vertical text overflow.');
    check(await page.locator('[id$="-type"]').first().inputValue() === 'text', 'Initial type is Text.');
    check(await page.locator('[id$="-nullable"]').first().isChecked(), 'Initial column allows NULL.');
    check(await page.locator('[id$="-default"]').first().inputValue() === 'none', 'Initial default is no explicit default.');
    await page.fill('#table-builder-name', 'notes'); await page.fill('.table-builder-column [id$="-name"]', 'label');
    await page.click('#table-builder-add-column');
    check(await page.locator('#table-builder-column-1-name').inputValue() === 'label', 'Adding a column preserves populated values.');
    check(await page.locator('#table-builder-column-2-name').evaluate(n => n === document.activeElement), 'New column receives focus.');
    await page.fill('#table-builder-column-2-name', 'amount'); await page.selectOption('#table-builder-column-2-type', 'decimal');
    await page.fill('#table-builder-column-2-precision', '30'); await page.fill('#table-builder-column-2-scale', '8');
    await page.selectOption('#table-builder-column-2-default', 'literal');
    const exact = '1234567890123456789012.12345678'; await page.fill('#table-builder-column-2-literal', exact);
    await page.locator('#table-builder-column-2-literal').evaluate(n => { n.focus(); n.setSelectionRange(4, 8); });
    await page.evaluate(() => window.fixture.setLanguage('nl'));
    check(await page.locator('#table-builder-column-2-literal').inputValue() === exact, 'Translation preserves exact defaults.');
    check(await page.locator('#table-builder-column-2-literal').evaluate(n => n === document.activeElement && n.selectionStart === 4 && n.selectionEnd === 8), 'Translation preserves focus and text selection.');
    await page.click('#table-builder-add-identifier');
    check(await page.locator('#table-builder-column-3-name').inputValue() === 'id', 'Generated identifier is explicit.');
    check(await page.locator('#table-builder-column-3-primary').isChecked(), 'Generated identifier is the declared key.');
    check(!await page.locator('#table-builder-column-3-nullable').isChecked(), 'Generated identifier cannot be NULL.');
    await page.locator('#table-builder-dialog').evaluate(n => { n.scrollTop = 0; });
    await capture(page, 'desktop');
    await page.click('#table-builder-review'); await page.waitForSelector('#table-builder-create');
    check(requests.length === 1 && requests[0].action === 'table-definition-preview', 'Review only calls the preview route.');
    check(requests[0].params.database === 'research' && requests[0].csrf === 'fixture-csrf', 'Preview uses captured scope and CSRF.');
    check(requests[0].body.columns[2].default.value === exact, 'Exact number reaches the server as text.');
    check(requests[0].body.columns[2].precision === 30 && requests[0].body.columns[2].scale === 8, 'Decimal dimensions are explicit integers.');
    check(!('sql' in requests[0].body), 'The browser sends a definition rather than editable SQL.');
    await page.click('#table-builder-back');
    check(await page.locator('#table-builder-column-2-literal').inputValue() === exact, 'Edit after review preserves settings.');
    await page.evaluate(() => window.fixture.setDatabase('another_database')); await page.click('#table-builder-review');
    check(await page.locator('#table-builder-error').isVisible() && requests.length === 1, 'Changed active scope cannot retarget the draft.');
    await page.click('#table-builder-close');
    await page.evaluate(() => { window.fixture.setDatabase('postgres:test:public'); window.fixture.setLanguage('en'); });
    await page.click('#launch');
    check(await page.locator('#table-builder-name').inputValue() === '', 'Another database has a separate blank draft.');
    await page.fill('#table-builder-name', 'pg_notes'); await page.fill('.table-builder-column [id$="-name"]', 'label');
    await page.selectOption('.table-builder-column [id$="-default"]', 'literal');
    await page.fill('[id$="-literal"]', '<img src=x onerror=alert(1)>');
    await page.setViewportSize({width: 320, height: 780});
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow at 320px.');
    check(await page.locator('#table-builder-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), 'Column groups fit the narrow dialog.');
    check(await page.locator('#table-builder-review').evaluate(n => n.getBoundingClientRect().height >= 44), 'Primary action retains a44px target.');
    await page.locator('#table-builder-dialog').evaluate(n => { n.scrollTop = 0; });
    await capture(page, 'mobile-top');
    await page.locator('#table-builder-dialog').evaluate(n => { n.scrollTop = n.scrollHeight; });
    await capture(page, 'mobile-bottom');
    await page.click('#table-builder-review'); await page.keyboard.press('Escape');
    check(await page.locator('#table-builder-dialog').isVisible(), 'Escape cannot dismiss an active request.');
    await page.waitForSelector('#table-builder-create');
    const pg = requests.at(-1);
    check(pg.params.connection === 'postgres' && pg.params.database === 'test' && pg.params.schema === 'public', 'PostgreSQL URL retains database and schema.');
    check(await page.locator('#table-builder-dialog img').count() === 0, 'Literal HTML remains escaped text in review.');
    await page.click('#table-builder-create'); await page.waitForFunction(() => window.fixture.created.length === 1);
    const completed = await page.evaluate(() => window.fixture.created[0]);
    check(completed.closed && completed.released, 'Modal and busy guard release before the callback.');
    const final = requests.at(-1);
    check(final.action === 'table-definition-create' && final.body.definition_token === 'a'.repeat(64), 'Create sends the reviewed token.');
    check(final.body.definition.name === 'pg_notes', 'Create retains the actual new name.');
    await page.evaluate(() => { window.fixture.deferCallback(); });
    await page.click('#launch');
    await page.fill('#table-builder-name', 'late_first'); await page.fill('.table-builder-column [id$="-name"]', 'label');
    await page.click('#table-builder-review'); await page.waitForSelector('#table-builder-create');
    await page.click('#table-builder-create'); await page.waitForFunction(() => window.fixture.created.length === 2);
    await page.click('#launch'); await page.fill('#table-builder-name', 'late_second');
    await page.evaluate(() => window.fixture.rejectCallback());
    await page.waitForTimeout(50);
    check(await page.locator('#table-builder-dialog').isVisible(), 'A newer draft stays open after an older navigation callback rejects.');
    check(await page.locator('#table-builder-name').inputValue() === 'late_second', 'A late callback cannot overwrite the newer draft.');
    check(await page.locator('#table-builder-error').count() === 0, 'An old navigation error is not attributed to the new definition.');
    check(await page.evaluate(() => window.fixture.busy.at(-1)) === true, 'A queued old close event cannot release the newer dialog busy guard.');
    check(failures.length === 0, 'No browser JavaScript errors.');
    console.log(`PASS: ${checks} native table builder browser fixture checks (database execution tested separately).`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
