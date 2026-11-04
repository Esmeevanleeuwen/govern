/** Actual native journeys, fixed contextual scope, table builder and narrow-layout behavior. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile, chmod} from 'node:fs/promises';
import {authenticatedContext} from './auth-session.mjs';
import {clickWorkspaceTool} from './workspace-tools.mjs';
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use only a disposable stack.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_BIN, args: ['--no-sandbox']});
const context = await authenticatedContext(browser, base, {viewport: {width: 1440, height: 1000}});
if (process.env.GOVERN_TEST_STORAGE_OUT) {
    await writeFile(process.env.GOVERN_TEST_STORAGE_OUT, JSON.stringify(await context.storageState()));
    await chmod(process.env.GOVERN_TEST_STORAGE_OUT, 0o600);
}
const page = await context.newPage(), failures = [];
page.on('pageerror', e => failures.push(e.message));
const manager = page.locator('#database-manager-dialog');
let checks = 0;
const verify = (ok, message) => { assert.ok(ok, message); checks++; };
const prefix = 'zz_ui_' + Date.now().toString(16);
const waitWorkspace = async value => page.waitForFunction(value => {
    const el = document.querySelector('#database-select');
    return el && !el.disabled && (!value || el.value === value);
}, value);
const open = async () => { await clickWorkspaceTool(page, '#manage-databases'); await manager.waitFor({state: 'visible'}); };
const language = value => page.evaluate(async v => (await import('/assets/i18n.js')).setLanguage(v), value);
const finished = async () => manager.locator('[data-job-state="completed"]').waitFor({timeout: 60000});
const inspect = async (name, value) => {
    await manager.locator('#database-workflow-file').setInputFiles({name, mimeType: 'text/plain', buffer: Buffer.from(value)});
    await manager.locator('#database-workflow-inspect').click();
    await manager.locator('#database-workflow-source-next:not([disabled])').waitFor();
    await manager.locator('#database-workflow-source-next').click();
};
const readback = (key, table) => page.evaluate(async ({key, table}) => {
    const res = await fetch('/api.php?' + new URLSearchParams({action: 'browse', database: key, table}));
    const value = await res.json(); if (!value.ok) throw new Error(value.error); return value.data;
}, {key, table});
try {
    await page.goto(new URL('/workspace.php#gegevens?database=bestuursatlas', base).href);
    await waitWorkspace(); await language('en'); await open();
    for (const task of ['empty', 'backup', 'dataset']) verify(await manager.locator('#database-workflow-task-' + task).isVisible(), 'The chooser exposes ' + task + '.');
    verify(await manager.locator('#database-manager-existing').count() === 0, 'Existing selection stays outside Add database.');
    await manager.locator('#database-workflow-task-empty').click();
    await manager.locator('#database-workflow-engine').selectOption('postgres');
    await manager.locator('#database-manager-name').fill(prefix + '_empty');
    await language('nl'); verify(await manager.locator('#database-manager-name').inputValue() === prefix + '_empty', 'Language change preserves the actual new name.');
    await language('en'); await manager.locator('#database-workflow-review').click(); await finished();
    verify(await manager.locator('#database-workflow-first-table').isVisible(), 'Empty success offers the first native table.');
    await manager.locator('#database-workflow-first-table').click();
    const builder = page.locator('#table-builder-dialog'); await builder.waitFor({state: 'visible'});
    await builder.locator('#table-builder-name').fill('notes');
    await builder.locator('#table-builder-column-1-name').fill('label');
    await builder.locator('#table-builder-add-identifier').click();
    verify(await builder.locator('#table-builder-column-1-name').inputValue() === 'label', 'Adding the identifier preserves existing column edits.');
    await builder.locator('#table-builder-review').click();
    await builder.locator('#table-builder-create:not([disabled])').waitFor(); await builder.locator('#table-builder-create').click();
    await builder.waitFor({state: 'hidden'}); await waitWorkspace('postgres:' + prefix + '_empty:public');
    verify((await readback('postgres:' + prefix + '_empty:public', 'notes')).rows.length === 0, 'The actual first table opens as a valid empty table.');

    await open(); await manager.locator('#database-workflow-task-dataset').click();
    verify(await manager.locator('#database-manager-name').count() === 0, 'Dataset import asks for the source before its destination.');
    await inspect('contacts.csv', 'contact_id,full_name,postal_code\n001,Alex Example,02108\n002,Sam Example,00123\n');
    await manager.locator('#database-workflow-engine').selectOption('mariadb');
    await manager.locator('#database-manager-name').fill(prefix + '_data');
    await manager.locator('#database-workflow-table-0').fill('contacts');
    await manager.locator('#database-workflow-review').click();
    verify((await manager.locator('#database-workflow-submit').innerText()).includes(prefix + '_data'), 'The final action names its real result.');
    verify(await manager.locator('input[id*="confirmation"]').count() === 0, 'Fresh creation does not ask users to retype a confirmation name.');
    await manager.locator('#database-workflow-submit').click(); await finished();
    await manager.locator('#database-workflow-open').click(); await manager.waitFor({state: 'hidden'}); await waitWorkspace(prefix + '_data');
    verify((await readback(prefix + '_data', 'contacts')).rows[0].postal_code === '02108', 'A dataset created from another active engine preserves source text.');

    await page.locator('[data-add-data="contacts"]').click(); await manager.waitFor({state: 'visible'});
    await inspect('more.csv', 'contact_id,full_name,postal_code\n003,Robin Example,00001\n');
    verify(await manager.locator('#database-manager-name').count() === 0 && await manager.locator('#database-workflow-engine').count() === 0,
        'Contextual Add data keeps engine and database fixed.');
    await manager.locator('#database-workflow-mode').selectOption('append');
    await manager.locator('#database-workflow-table-0').selectOption('contacts');
    await page.setViewportSize({width: 320, height: 800});
    verify(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Mapping reflows inside its 320-pixel dialog.');
    await language('nl'); await language('en');
    verify(await manager.locator('#database-workflow-table-0').inputValue() === 'contacts', 'Language changes preserve the fixed append target.');
    await manager.locator('#database-workflow-review').click();
    verify(/Append/i.test(await manager.locator('#database-workflow-submit').innerText()), 'Append has an explicit final action.');
    await manager.locator('#database-workflow-submit').click(); await finished();
    await manager.locator('#database-workflow-open').click(); await waitWorkspace(prefix + '_data');
    verify((await readback(prefix + '_data', 'contacts')).rows.length === 3, 'Contextual append adds one row and keeps existing records.');
    await page.setViewportSize({width: 1440, height: 1000});

    await open(); await manager.locator('#database-workflow-task-backup').click();
    await inspect('backup.sql', '-- MariaDB dump\nCREATE TABLE `example` (`id` INTEGER PRIMARY KEY, `label` TEXT); INSERT INTO `example` VALUES(1,\'from backup\');');
    verify(await manager.locator('#database-workflow-engine').count() === 0, 'A known backup fixes its compatible engine.');
    await manager.locator('#database-manager-name').fill(prefix + '_backup');
    await manager.locator('#database-workflow-review').click(); await manager.locator('#database-workflow-submit').click(); await finished();
    await manager.locator('#database-workflow-open').click(); await waitWorkspace(prefix + '_backup');
    verify((await readback(prefix + '_backup', 'example')).rows[0].label === 'from backup', 'The backup journey ends in a real imported table.');
    await page.setViewportSize({width: 320, height: 800}); await open();
    verify(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The workspace has no horizontal page overflow at 320 px.');
    verify(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'The chooser stays within its narrow dialog.');
    await page.keyboard.press('Escape'); await manager.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.id === 'manage-databases', null, {timeout: 2000});
    verify(await page.locator('#manage-databases').evaluate(el => document.activeElement === el), 'Escape restores focus to Add database.');
    assert.deepEqual(failures, []); checks++;
    console.log(`PASS: ${checks} actual unified database browser checks.`);
} finally { await context.close(); await browser.close(); }
