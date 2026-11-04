/** Actual local UI and review APIs; never submits a database operation. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,chmod} from 'node:fs/promises';
import path from 'node:path';
import {authenticatedContext} from './auth-session.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=new URL(process.env.BASE_URL||'http://127.0.0.1:8080');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const output=process.env.WORKFLOW_SCREENSHOT_DIR||'/tmp/govern-workflow-ui';await mkdir(output,{recursive:true});
const contextOptions={locale:'en-GB',viewport:{width:1440,height:1050}};
const context=process.env.GOVERN_TEST_STORAGE_STATE ? await browser.newContext({...contextOptions,storageState:process.env.GOVERN_TEST_STORAGE_STATE}) : await authenticatedContext(browser,base,contextOptions);
if(process.env.GOVERN_TEST_SAVE_STORAGE_STATE){await context.storageState({path:process.env.GOVERN_TEST_SAVE_STORAGE_STATE});await chmod(process.env.GOVERN_TEST_SAVE_STORAGE_STATE,0o600);}
const page=await context.newPage(),errors=[];let submissions=0;
page.on('pageerror',error=>errors.push(error.message));
await page.route(url=>url.pathname==='/api.php'&&url.searchParams.get('action')==='import-submit',route=>{submissions++;return route.abort();});
const shot=async name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
try{
 await page.goto(new URL('/workspace.php#gegevens',base).href);await page.locator('#manage-databases:not([disabled])').waitFor();
 await page.locator('#manage-databases').click();await page.locator('#database-workflow-task-dataset').waitFor();await shot('01-chooser-desktop');
 await page.locator('#database-workflow-task-dataset').click();await page.locator('#database-workflow-file').setInputFiles({name:'contacts.csv',mimeType:'text/csv',buffer:Buffer.from('Contact code,Full name,Postal code,Organization\n001,Alex Example,00123,\n002,Robin Example,02108,Example organization\n')});
 await page.locator('#database-workflow-inspect').click();await page.waitForFunction(()=>document.querySelector('#database-workflow-source-next')&&!document.querySelector('#database-workflow-source-next').disabled);
 await shot('02-dataset-source-desktop');await page.locator('#database-workflow-source-next').click();
 await page.locator('#database-workflow-engine').selectOption('postgres');await page.locator('#database-manager-name').fill('zz_visual_'+Date.now().toString(16));await shot('03-postgres-destination-desktop');
 await page.locator('#database-workflow-review').click();await page.locator('#database-workflow-submit').waitFor();await shot('04-mapping-review-desktop');
 await page.setViewportSize({width:320,height:740});await shot('05-review-mobile-en');
 assert.equal(await page.evaluate(()=>document.querySelector('#database-manager-dialog').scrollWidth<=document.querySelector('#database-manager-dialog').clientWidth+1),true,'Dialog reflows at320px');
 await page.locator('#database-manager-close').click();await page.locator('#manage-databases').click();
 assert.equal(await page.locator('.database-workflow-task').count(),3,'Main Add database starts at the three-task chooser');await shot('06-chooser-mobile-en');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Actual workspace header reflows at320px');
 assert.equal(submissions,0,'Visual review never enqueues a database operation');assert.deepEqual(errors,[]);
 console.log('PASS: actual UI chooser, source inspection, PG destination, side-effect-free review and320px workspace; screenshots in '+output);
}finally{await browser.close();}
