/** New PostgreSQL database -> native Backups UI -> real restore -> visible readback. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {authenticatedContext} from './auth-session.mjs';
import {selectWorkspaceLanguage} from './workspace-tools.mjs';
assert.equal(process.env.GOVERN_UI_WRITE_TESTS, '1', 'Use an explicitly disposable stack.');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:8080');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_BIN,
    args:process.env.BROWSER_ARGS_JSON ? JSON.parse(process.env.BROWSER_ARGS_JSON) : ['--no-sandbox']});
const context = await authenticatedContext(browser, base, {locale:'en-GB', viewport:{width:1440,height:1000}});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let csrf, checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const url=(action,params={})=>new URL('/api.php?'+new URLSearchParams({action,...params}),base).href;
async function call(action,body,params={}) {
    const response=await context.request[body===undefined?'get':'post'](url(action,params),
        {headers:{'X-CSRF-Token':csrf||''},...(body===undefined?{}:{data:body})});
    const value=await response.json();assert.ok(response.ok()&&value.ok,JSON.stringify(value));return value.data;
}
const name='govern_backups_ui_'+Date.now().toString(16);
const scope={connection:'postgres',database:name,schema:'public'};
const key='postgres:'+name+':public';
const href=(view,table='')=>new URL('/workspace.php#'+view+'?'+new URLSearchParams({database:key,...(table?{table}:{})}),base).href;
const wait=action=>page.waitForResponse(response=>{const u=new URL(response.url());return u.pathname==='/api.php'&&u.searchParams.get('action')===action;},{timeout:120000});
const read=async response=>{const value=await response.json();assert.ok(response.ok()&&value.ok,JSON.stringify(value));return value.data;};
try {
    csrf=(await call('bootstrap')).csrf;
    const plan=await call('import-plan',{kind:'empty',engine:'postgres',name,target_mode:'new_database'});
    const accepted=await call('import-submit',{plan_id:plan.plan_id,submission_key:randomUUID()});
    let job=accepted.job;
    for(let i=0;i<120&&!['completed','failed','unknown','partial','cancelled'].includes(job.state);i++){
        await new Promise(resolve=>setTimeout(resolve,250));job=(await call('import-job',undefined,{id:job.id})).job;
    }
    check(job.state==='completed','Create a real fresh PostgreSQL database before the recovery test.');
    await call('query',{sql:"CREATE TABLE public.backup_probe (id bigint PRIMARY KEY,label text); INSERT INTO public.backup_probe VALUES (1,'original backup fixture');",confirm:true},scope);
    await page.goto(href('experimenten'),{waitUntil:'networkidle'});
    await page.locator('#snapshot-label').fill('New database browser recovery fixture');
    const created=wait('create-snapshot');await page.locator('#create-snapshot').click();
    const point=await read(await created);
    check(point.database===name&&point.schema==='public','The new database identity stays fixed during checkpoint creation.');
    await page.locator('#snapshot-'+point.id).waitFor();
    const download=await context.request.get(new URL(await page.locator('#snapshot-'+point.id+' a').getAttribute('href'),base).href);
    check(download.ok(),'Download the verified archive from the native Backups card.');
    check((await download.body()).subarray(0,5).toString()==='PGDMP','Download is a real PostgreSQL custom archive.');
    await call('query',{sql:"UPDATE public.backup_probe SET label='changed fixture' WHERE id=1; CREATE TABLE public.after_checkpoint (id integer);",confirm:true},scope);
    const changed=await call('browse',undefined,{...scope,table:'backup_probe'});
    check(changed.rows[0].label==='changed fixture','Confirm an actual database mutation before restoring.');
    await selectWorkspaceLanguage(page,'nl');await page.setViewportSize({width:375,height:900});
    await page.locator('#snapshot-'+point.id+' [data-snapshot-action="restore"]').click();
    const confirm=page.locator('.confirm-dialog');await confirm.waitFor();
    check((await confirm.innerText()).includes(name+'.public'),'Destructive confirmation names database and schema.');
    await confirm.locator('input').fill(name);
    check(await confirm.locator('button[type="submit"]').isDisabled(),'Database name alone does not confirm a schema replacement.');
    await confirm.locator('input').fill(name+'.public');
    const restored=wait('restore-snapshot');await confirm.locator('button[type="submit"]').click();
    const result=await read(await restored);
    check(result.database===name&&result.schema==='public'&&result.safety_snapshot,'Restore records the exact scope and pre-restore safety copy.');
    await page.locator('#create-snapshot:not([disabled])').waitFor();
    const after=await call('browse',undefined,{...scope,table:'backup_probe'});
    check(after.rows[0].label==='original backup fixture','Ordinary readback returns the restored record.');
    const catalog=await call('bootstrap',undefined,scope);
    check(!catalog.tables.some(t=>t.name==='after_checkpoint'),'Later objects are absent after the native restore.');
    await page.goto(href('gegevens','backup_probe'),{waitUntil:'networkidle'});
    await page.getByRole('cell',{name:'original backup fixture',exact:true}).waitFor();
    check(true,'The restored value is visible in the ordinary Records browser.');
    check(errors.length===0,'No browser JavaScript errors.');
    console.log('PASS: '+checks+' new PostgreSQL database Backups UI, real archive/restore, Dutch mobile confirmation and visible readback checks.');
} finally {await context.close();await browser.close();}
