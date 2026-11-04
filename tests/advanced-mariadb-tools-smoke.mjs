/** Advanced tools use the real official phpMyAdmin import/export, on a new test database. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {authenticatedContext} from './auth-session.mjs';
import {clickWorkspaceTool} from './workspace-tools.mjs';
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable isolated stack.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_BIN, args: ['--no-sandbox']});
const context = await authenticatedContext(browser, base), page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const endpoint = (action, params = {}) => new URL('/api.php?' + new URLSearchParams({action, ...params}), base).href;
let csrf, release;
async function api(action, body, params = {}) {
    const response = await context.request[body ? 'post' : 'get'](endpoint(action, params), body ? {headers: {'X-CSRF-Token': csrf}, data: body} : {});
    const result = await response.json(); assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`); return result.data;
}
try {
    csrf = (await api('bootstrap')).csrf;
    const name = 'zz_pma_' + Date.now().toString(16);
    const plan = await api('import-plan', {kind: 'empty', engine: 'mariadb', name});
    const accepted = await api('import-submit', {plan_id: plan.plan_id, submission_key: randomUUID()});
    let job;
    for (let i = 0; i < 120; i++) {
        job = (await api('import-job', undefined, {id: accepted.job.id})).job;
        if (job.state === 'completed') break;
        assert.ok(['queued', 'provisioning', 'verifying'].includes(job.state), JSON.stringify(job));
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(job.state, 'completed');
    await page.goto(new URL('/workspace.php#gegevens?' + new URLSearchParams({database: name}), base).href);
    await page.locator('#open-database:not([disabled])').waitFor({state: 'attached'});
    await clickWorkspaceTool(page, '#open-database');
    const modal = page.locator('#database-dialog'), frame = page.frameLocator('#database-frame');
    await modal.waitFor({state: 'visible'});
    await page.locator('#database-tab-import').click();
    await frame.locator('#input_import_file').waitFor();
    assert.equal(await modal.locator('#native-import-file').count(), 0, 'Ordinary native imports are outside Advanced MariaDB tools.');
    const source = 'CREATE TABLE people(id INT PRIMARY KEY,label VARCHAR(80)) ENGINE=InnoDB;\n'
        + 'CREATE TABLE notes(id INT PRIMARY KEY,person_id INT NOT NULL,body TEXT,CONSTRAINT note_person FOREIGN KEY(person_id) REFERENCES people(id)) ENGINE=InnoDB;\n'
        + "INSERT INTO people VALUES(1,'Official import'); INSERT INTO notes VALUES(1,1,'Verified through Govern');\n";
    await frame.locator('#input_import_file').setInputFiles({name: 'advanced.sql', mimeType: 'application/sql', buffer: Buffer.from(source)});
    let started;
    const waiting = new Promise((resolve, reject) => { started = resolve; setTimeout(() => reject(new Error('Official phpMyAdmin did not submit the selected file')), 20000).unref(); });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(url => url.pathname.startsWith('/phpmyadmin/') && url.searchParams.get('route') === '/import', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        started(); await gate; await route.continue();
    }, {times: 1});
    const uploaded = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/phpmyadmin/')
        && new URL(response.url()).searchParams.get('route') === '/import' && response.request().method() === 'POST');
    await frame.locator('#buttonGo').click(); await waiting;
    await page.waitForFunction(() => document.querySelector('#modal-database')?.disabled === true);
    const frameSrc = await page.locator('#database-frame').getAttribute('src');
    await page.evaluate(async () => (await import('/assets/i18n.js')).setLanguage('en'));
    assert.equal(await page.locator('#database-frame').getAttribute('src'), frameSrc, 'Language updates preserve the actual native upload.');
    await page.keyboard.press('Escape'); assert.ok(await modal.isVisible(), 'A pending official upload retains its surrounding scope.');
    release(); release = null; assert.ok((await uploaded).ok());
    await page.waitForFunction(() => document.querySelector('#modal-database')?.disabled === false);
    const rows = await api('browse', undefined, {database: name, table: 'notes'});
    assert.equal(rows.rows[0].body, 'Verified through Govern');
    const schema = await api('schema', undefined, {database: name});
    assert.ok(schema.tables.some(table => table.foreign_keys.length >= 1), 'The imported foreign key is read from the live engine.');
    await page.locator('#database-tab-export').click();
    await frame.locator('#buttonGo').waitFor();
    const pendingDownload = page.waitForEvent('download'); await frame.locator('#buttonGo').click();
    const download = await pendingDownload, stream = await download.createReadStream();
    let exported = ''; for await (const chunk of stream) exported += chunk.toString();
    assert.ok(/CREATE TABLE/.test(exported) && exported.includes('Official import') && exported.includes('Verified through Govern'), 'Official export contains the imported structure and records.');
    await modal.locator('.database-dialog-header .button').click(); await modal.waitFor({state: 'hidden'});
    assert.deepEqual(errors, []);
    console.log('PASS: real official phpMyAdmin import, upload scope/language/Escape guards, live records/foreign key and SQL export.');
} catch (error) { console.error('Advanced tool diagnostics:', await page.evaluate(() => { const f=document.querySelector('#database-frame'); return {frameTitle:f?.contentDocument?.title,frameText:f?.contentDocument?.body?.innerText.slice(0,240)}; }).catch(() => ({})), errors); throw error; } finally { release?.(); await context.close(); await browser.close(); }
