/** Exercise writable SQL and routine results only in an isolated local stack. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use a disposable stack and set GOVERN_UI_WRITE_TESTS=1.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a disposable local stack.');
const args = process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox'];
const browser = await chromium.launch({headless: true, args,
    ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
const page = await browser.newPage({locale: 'nl-NL', viewport: {width: 1440, height: 1100}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const suffix = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
const name = 'zz_govern_ui_sql_' + suffix;
const procedureName = name + '_routine';
const table = '`' + name + '`', procedure = '`' + procedureName + '`';
const responseForQuery = () => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api.php' && url.searchParams.get('action') === 'query';
});
const waitReady = async () => {
    await page.waitForFunction(() => {
        const button = document.querySelector('#run-query');
        return button && !button.disabled && !document.querySelector('.query-result .loading-state');
    });
};
const readResponse = async response => {
    const payload = await response.json();
    assert.equal(response.status(), 200, payload.error);
    assert.equal(payload.ok, true, payload.error);
    return payload.data;
};
const run = async (sql, confirmation) => {
    await waitReady();
    await page.locator('#sql-editor').fill(sql);
    const pending = responseForQuery();
    await page.locator('#run-query').click();
    let data = await readResponse(await pending);
    if (data.confirm_required) {
        const dialog = page.locator('dialog.confirm-dialog[open]');
        await dialog.waitFor();
        if (confirmation === 'cancel') {
            await dialog.getByRole('button', {name: /^(Annuleren|Cancel)$/}).click();
            await waitReady();
            return data;
        }
        assert.equal(confirmation, 'confirm', 'Unexpected confirmation for: ' + sql);
        const confirmed = responseForQuery();
        await dialog.locator('button[type="submit"]').click();
        data = await readResponse(await confirmed);
    }
    await waitReady();
    return data;
};
const apiSql = async (sql, confirm = false) => page.evaluate(async ({sql, confirm}) => {
    const bootstrap = await (await fetch('/api.php?action=bootstrap')).json();
    const response = await fetch('/api.php?action=query', {method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-CSRF-Token': bootstrap.data.csrf,
    }, body: JSON.stringify({confirm, sql})});
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'SQL request failed');
    return payload.data;
}, {sql, confirm});
const exists = async () => {
    const data = await apiSql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + name + "'");
    return data.statements[0].rows[0][0] === '1';
};

try {
    await page.goto(new URL('/#onderzoeken', base).href, {waitUntil: 'networkidle'});
    await page.locator('#sql-editor').waitFor();
    const sql = `CREATE TABLE ${table} (id BIGINT UNSIGNED PRIMARY KEY, label VARCHAR(80), amount DECIMAL(30,2)) ENGINE=InnoDB;
INSERT INTO ${table} VALUES (9007199254740993, 'original', 123456789012345678901234.12);
UPDATE ${table} SET label = 'changed' WHERE id = 9007199254740993;
ALTER TABLE ${table} ADD extra INT NOT NULL DEFAULT 7;
SELECT id, label, amount, extra FROM ${table};`;
    const written = await run(sql);
    assert.equal(written.failed, null);
    assert.equal(written.executed, 5);
    assert.equal(written.statements[1].affected_rows, 1);
    assert.equal(written.statements[2].affected_rows, 1);
    assert.deepEqual(written.statements[4].rows, [['9007199254740993', 'changed', '123456789012345678901234.12', '7']]);
    assert.equal(await page.locator('#sql-editor').inputValue(), sql, 'Post-write metadata refresh retains the exact SQL draft.');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'run-query', 'Metadata refresh restores Run focus.');
    assert.deepEqual(await page.locator('.query-result .data-table tbody td').allTextContents(), written.statements[4].rows[0]);
    await page.locator('#navigation [data-area="database"]').click();
    await page.locator('#catalog-search').fill(name);
    await page.locator('.catalog-item-name').filter({hasText: name}).waitFor();
    await page.locator('#navigation [data-area="research"]').click();
    await page.locator('#sql-editor').waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), sql, 'Leaving the workspace retains the executed SQL.');
    assert.equal(await page.locator('.query-result .data-table tbody tr').count(), 1);

    const routineSql = `DELIMITER //
CREATE PROCEDURE ${procedure}()
BEGIN
  SELECT id, label FROM ${table} WHERE id = 9007199254740993;
  SELECT 'second; set' AS second_result;
END//
DELIMITER ;
CALL ${procedure}();`;
    const called = await run(routineSql);
    assert.equal(called.failed, null);
    assert.equal(called.executed, 2);
    const rowSets = called.statements[1].result_sets.filter(set => set.columns.length);
    assert.equal(rowSets.length, 2);
    assert.equal(await page.locator('.query-result-set').count(), 2, 'Every CALL rowset appears once.');
    assert.deepEqual(await page.locator('.query-result-set .data-table').nth(1).locator('td').allTextContents(), ['second; set']);
    const secondCell = page.locator('.query-result-set .data-table').nth(1).locator('td');
    const metadata = await secondCell.evaluate(async node => {
        const {describeSelection} = await import('/assets/selection-registry.js');
        return describeSelection(node, document.querySelector('.app-shell')).meta;
    });
    assert.equal(metadata.snapshot, true);
    assert.equal(metadata.table, undefined, 'CALL aliases cannot invent a source table.');
    await page.locator('#selection-pointer-toggle').click();
    await secondCell.click();
    await page.locator('#selection-pointer-count').click();
    await page.locator('#selection-pointer-more').click();
    const explanation = page.locator('#selection-pointer-dialog[open]');
    await explanation.waitFor();
    assert.ok((await explanation.innerText()).includes('second; set'));
    assert.equal(await explanation.locator('[data-selection-action]').count(), 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const warnedSql = "SELECT CAST('not-a-number' AS UNSIGNED) AS warned;";
    const warned = await run(warnedSql);
    assert.ok(warned.statements[0].warning_count > 0);
    await page.locator('.query-warnings').waitFor();
    await page.locator('.query-warnings summary').click();
    assert.match(await page.locator('.query-warnings').innerText(), /not-a-number/);
    await page.locator('#language-select').selectOption('en');
    await page.locator('.query-warnings summary').filter({hasText: 'Database messages'}).waitFor();
    assert.equal(await page.locator('#sql-editor').inputValue(), warnedSql);
    assert.equal((await page.locator('.query-result').innerText()).includes('app.core.'), false);

    const rolledBack = await run(`START TRANSACTION; INSERT INTO ${table} (id, label) VALUES (30, 'temporary'); SELECT id FROM ${table} WHERE id = 30;`);
    assert.equal(rolledBack.transaction_rolled_back, true);
    assert.match(await page.locator('.query-result .notice-warning').innerText(), /rolled back/);
    const absent = await apiSql(`SELECT COUNT(*) FROM ${table} WHERE id = 30;`);
    assert.deepEqual(absent.statements[0].rows, [['0']], 'Uncommitted changes are absent in a separate connection.');

    const missing = '`' + name + '_missing`';
    const partial = await run(`INSERT INTO ${table} (id, label) VALUES (40, 'completed'); SELECT * FROM ${missing}; INSERT INTO ${table} (id, label) VALUES (41, 'not run');`);
    assert.equal(partial.failed.index, 2);
    assert.equal(partial.executed, 1);
    await page.locator('.query-result .notice-error').waitFor();
    assert.match(await page.locator('.query-result .notice-error').innerText(), /Statement 2/);
    assert.equal(await page.locator('.query-result > .card').count(), 1);
    const persisted = await apiSql(`SELECT id FROM ${table} WHERE id IN (40, 41) ORDER BY id;`);
    assert.deepEqual(persisted.statements[0].rows, [['40']], 'An autocommitted first statement survives a later error; later statements never run.');

    const cancelled = await run(`DROP TABLE ${table};`, 'cancel');
    assert.equal(cancelled.confirm_required, true);
    assert.equal(await exists(), true, 'Cancelling DROP does not remove the table.');
    const dropped = await run(`DROP TABLE ${table};`, 'confirm');
    assert.equal(dropped.failed, null);
    assert.equal(await exists(), false, 'Confirmed DROP removes the actual probe table.');
    assert.equal(await page.locator('#sql-editor').inputValue(), `DROP TABLE ${table};`);
    if (process.env.SCREENSHOTS_DIR) {
        await mkdir(process.env.SCREENSHOTS_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SCREENSHOTS_DIR, 'full-sql-workspace.png'), fullPage: true});
    }
    assert.deepEqual(errors, [], 'The full SQL path has no uncaught browser errors.');
    console.log('PASS: writable SQL, exact values, live catalog refresh, focus/draft continuity, DELIMITER/CALL rowsets, selection snapshots, warnings, rollback, partial failure, language and destructive confirmation.');
} finally {
    try {
        await apiSql(`DROP PROCEDURE IF EXISTS ${procedure}; DROP TABLE IF EXISTS ${table};`, true);
    } finally { await browser.close(); }
}
