/** Real UI modules with bounded API fixtures; live database coverage is separate. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
const root=fileURLToPath(new URL('../app/public/',import.meta.url));
const source={source_id:'a'.repeat(32),name:'contacts.csv',bytes:42,kind:'dataset',engine:null,requires_engine:false,blocked:false,expires_at:Math.floor(Date.now()/1000)+86400,datasets:[{index:0,name:'Contacts',suggested_name:'contacts',count:2,preview_truncated:true,columns:[{name:'code',source:'Code'},{name:'name',source:'Name'}],rows:[['001','Alex'],['002','Robin']]}]};
const scopes=[{name:'baseline',engine:'mariadb',available:true,scope_key:'baseline'}];
const html=`<!doctype html><html lang="en"><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/database-manager.css"><body><button id="entry">Add database</button><script type="module">import{createDatabaseManager}from'/assets/database-manager.js';import{setCsrf,setDatabase}from'/assets/api.js';import{setLanguage}from'/assets/i18n.js';setLanguage('en');setCsrf('fixture-csrf');setDatabase('baseline');window.calls=[];window.busy=false;window.setLanguage=setLanguage;window.manager=createDatabaseManager({getDatabase:()=> 'baseline',getDatabases:()=>${JSON.stringify(scopes)},onBusy:value=>window.busy=value,onOpenDatabase:(key)=>{calls.push({key,busy:window.busy});if(window.deferNavigation)return new Promise((resolve,reject)=>{window.rejectNavigation=reject;window.navigationCount=(window.navigationCount||0)+1;});},onFirstTable:(key)=>calls.push({key,first:true,busy:window.busy})});document.getElementById('entry').onclick=()=>manager.open();window.ready=true;</script></body></html>`;
let plan=null,job=null,mutations=[],completionState='completed';
const history=Array.from({length:9},(_,index)=>({id:'e'.repeat(31)+index,database:'history_'+index,engine:'mariadb',state:'completed'}));
const context=await browser.newContext({viewport:{width:1280,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('http://localhost:9038/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
 if(url.pathname==='/api.php'){
  const action=url.searchParams.get('action');let data;
  if(route.request().method()==='POST')mutations.push(action);
  if(action==='database-workflows')data={engines:['mariadb','postgres'].map(id=>({id,available:true,can_create:true})),worker_available:true};
  if(action==='import-jobs')data={jobs:job?[job,...history]:history};
  if(action==='import-source')data=route.request().postDataBuffer().includes(Buffer.from('\r\n\r\nbackup'))?{...source,name:'export.sql',kind:'backup',datasets:[],requires_engine:true}:source;
  if(action==='import-targets')data={datasets:source.datasets.map(dataset=>({...dataset,targets:[{name:'contacts',version:'b'.repeat(64),eligible:true,columns:[{name:'code',importable:true},{name:'name',importable:true}]}]}))};
  if(action==='import-plan'){plan=route.request().postDataJSON();data={plan_id:'c'.repeat(32),summary:{...plan,database:plan.name,rows:2}};}
  if(action==='import-submit'){job={id:'d'.repeat(32),kind:plan.kind,engine:plan.engine,database:plan.name,schema:plan.engine==='postgres'?'public':'',scope_key:plan.engine==='postgres'?'postgres:'+plan.name+':public':plan.name,state:'queued',created_database:plan.target_mode==='new_database',tables:plan.tables||[],target_mode:plan.target_mode};data={job};}
  if(action==='import-job'){job={...job,state:completionState,completed_units:2,unit_kind:'rows'};data={job};}
  if(!data)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'Unhandled fixture action '+action})});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data})});
 }
 const file=path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root))return route.abort();
 try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/css',body:await readFile(file)});}catch{return route.abort();}
});
const open=async()=>{await page.goto('http://localhost:9038/fixture');await page.waitForFunction(()=>window.ready);await page.locator('#entry').click();await page.waitForFunction(()=>document.querySelector('#database-workflow-task-empty')&&!document.querySelector('#database-manager-status').textContent);};
try{
 await open();assert.equal(await page.locator('.database-workflow-task').count(),3);
 assert.equal(await page.locator('.database-workflow-jobs li').count(),5);await page.locator('#database-workflow-show-jobs').click();assert.equal(await page.locator('.database-workflow-jobs li').count(),9);await page.locator('#database-workflow-show-jobs').click();assert.equal(await page.locator('.database-workflow-jobs li').count(),5);
 await page.locator('#database-workflow-task-empty').click();await page.locator('#database-workflow-engine').selectOption('postgres');await page.locator('#database-manager-name').fill('fresh_pg');
 await page.locator('#database-workflow-review').click();await page.locator('[data-job-state="completed"]').waitFor();
 assert.equal(plan.kind,'empty');assert.equal(Object.hasOwn(plan,'source_id'),false);await page.locator('#database-workflow-first-table').click();await page.waitForFunction(()=>calls.length>0);
 assert.deepEqual(await page.evaluate(()=>calls),[{key:'postgres:fresh_pg:public',first:true,busy:false}],'Release busy before opening native table builder');
 job=null;mutations=[];await open();await page.locator('#database-workflow-task-dataset').click();
 await page.locator('#database-workflow-file').setInputFiles({name:'contacts.csv',mimeType:'text/csv',buffer:Buffer.from('Code,Name\n001,Alex\n002,Robin\n')});
 await page.locator('#database-workflow-inspect').click();await page.waitForFunction(()=>document.querySelector('#database-workflow-source-next')&&!document.querySelector('#database-workflow-source-next').disabled);
 assert.ok((await page.locator('tbody').innerText()).includes('001'));
 assert.ok((await page.locator('.database-workflow-preview-notice').innerText()).includes('full source values'),'Source declares bounded previews');
 await page.evaluate(()=>setLanguage('nl'));assert.ok((await page.locator('#database-manager-dialog').innerText()).includes('contacts.csv'));assert.ok((await page.locator('.database-workflow-preview-notice').innerText()).includes('volledige bronwaarden'));await page.evaluate(()=>setLanguage('en'));
 await page.locator('#database-workflow-source-next').click();await page.locator('#database-workflow-engine').selectOption('postgres');await page.locator('#database-manager-name').fill('contacts_db');assert.ok((await page.locator('.database-workflow-preview-notice').innerText()).includes('full source values'),'Mapping preserves preview scope notice');
 await page.locator('.database-workflow-mapping-row').nth(1).locator('input[type=checkbox]').check();
 await page.locator('#database-workflow-review').click();assert.equal(mutations.includes('import-submit'),false,'Review is side-effect free');assert.ok((await page.locator('.database-workflow-preview-notice').innerText()).includes('full source values'),'Review retains preview scope notice');
 assert.deepEqual(plan.tables[0].mapping,[{source:'code',target:'code',empty_as_null:false},{source:'name',target:null,empty_as_null:false}]);
 await page.locator('#database-workflow-submit').click();await page.locator('[data-job-state="completed"]').waitFor();await page.locator('#database-workflow-open').click();await page.waitForFunction(()=>calls.length>0);
 assert.deepEqual(await page.evaluate(()=>calls),[{key:'postgres:contacts_db:public',busy:false}]);
 job=null;mutations=[];await open();await page.locator('#database-workflow-task-backup').click();
 await page.locator('#database-workflow-file').setInputFiles({name:'export.sql',mimeType:'application/sql',buffer:Buffer.from('CREATE TABLE contacts (name text);')});
 await page.locator('#database-workflow-inspect').click();await page.waitForFunction(()=>document.querySelector('#database-workflow-source-next')&&!document.querySelector('#database-workflow-source-next').disabled);
 await page.locator('#database-workflow-source-next').click();assert.ok((await page.locator('#database-manager-error').innerText()).includes('engine'));
 await page.locator('#database-workflow-source-engine').selectOption('mariadb');await page.locator('#database-workflow-source-next').click();
 assert.equal(await page.locator('#database-workflow-engine').count(),0,'Backup destination engine is fixed by source');await page.locator('#database-manager-name').fill('backup_copy');
 await page.locator('#database-workflow-review').click();assert.equal(plan.engine,'mariadb');await page.locator('#database-workflow-submit').click();await page.locator('[data-job-state="completed"]').waitFor();
 await page.locator('#database-workflow-leave').click();
 await page.evaluate(()=>manager.open({task:'dataset',scope:{name:'existing',engine:'postgres',schema:'public',scope_key:'postgres:existing:public'},table:'contacts'}));
 await page.locator('#database-workflow-file').setInputFiles({name:'contacts.csv',mimeType:'text/csv',buffer:Buffer.from('Code,Name\n001,Alex\n')});await page.locator('#database-workflow-inspect').click();
 await page.waitForFunction(()=>document.querySelector('#database-workflow-source-next')&&!document.querySelector('#database-workflow-source-next').disabled);await page.locator('#database-workflow-source-next').click();
 assert.equal(await page.locator('#database-manager-name').count(),0);assert.equal(await page.locator('#database-workflow-engine').count(),0);await page.locator('#database-workflow-review').click();
 assert.equal(plan.scope_key,'postgres:existing:public');assert.equal(plan.target_mode,'append');assert.equal(plan.tables[0].mode,'append');
 await page.setViewportSize({width:320,height:700});await page.evaluate(()=>setLanguage('nl'));
 assert.equal(await page.evaluate(()=>document.querySelector('#database-manager-dialog').scrollWidth<=document.querySelector('#database-manager-dialog').clientWidth+1),true,'320px dialog has no page overflow');
 await page.evaluate(()=>setLanguage('en'));await page.locator('#database-manager-close').click();
 completionState='partial';job={...job,state:'partial',created_database:true,error_code:'workflow_import_failed',diagnostics:{sqlstate:'23505',statement_line:4}};
 await page.locator('#entry').click();await page.locator('[data-job-id="'+job.id+'"]').click();await page.locator('[data-job-state="partial"]').waitFor();
 assert.ok((await page.locator('.database-workflow-content').innerText()).includes('database error'));
 await page.locator('.database-workflow-technical summary').click();assert.ok((await page.locator('.database-workflow-technical pre').innerText()).includes('23505'));
 completionState='unknown';await page.locator('#database-workflow-refresh-job').click();await page.locator('[data-job-state="unknown"]').waitFor();
 assert.equal(await page.locator('#database-workflow-stop').count(),0,'Unknown outcome does not pretend to offer confirmed cancellation');
 assert.equal(await page.locator('#database-workflow-submit').count(),0,'Unknown outcome never offers automatic SQL replay');
 completionState='completed';await page.locator('#database-workflow-refresh-job').click();await page.locator('[data-job-state="completed"]').waitFor();
 await page.evaluate(()=>{window.deferNavigation=true;});await page.locator('#database-workflow-open').click();await page.waitForFunction(()=>window.navigationCount===1);
 await page.locator('#entry').click();await page.locator('#database-workflow-task-empty').click();await page.locator('#database-manager-name').fill('next_draft');
 await page.evaluate(()=>window.rejectNavigation(new Error('Previous navigation rejected')));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(()=>setLanguage('nl'));await page.evaluate(()=>setLanguage('en'));
 assert.equal(await page.locator('#database-manager-name').inputValue(),'next_draft','Late navigation rejection preserves the new draft');
 assert.equal(await page.locator('#database-manager-error').isHidden(),true,'Late failure must not be stored on the reopened draft');
 assert.equal(await page.evaluate(()=>window.busy&&document.querySelector('#database-manager-dialog').open&&document.activeElement.id==='database-manager-name'),true,'Late failure cannot release the new busy guard or steal its focus');
 await page.locator('#database-manager-close').click();await page.locator('#entry').click();await page.locator('[data-job-id="'+job.id+'"]').click();await page.locator('[data-job-state="completed"]').waitFor();
 await page.evaluate(()=>{const existing=document.createElement('dialog');existing.textContent='Existing record window';document.body.append(existing);existing.show();});
 await page.locator('#database-workflow-open').click();await page.waitForFunction(()=>window.navigationCount===2);
 await page.evaluate(()=>window.rejectNavigation(new Error('Current navigation rejected')));
 await page.locator('#database-manager-error').waitFor({state:'visible'});
 assert.equal(await page.locator('#database-manager-error').innerText(),'Current navigation rejected','A current failure returns to its original result');
 assert.equal(await page.locator('[data-job-state="completed"]').count(),1,'Failure recovery preserves the recorded result instead of resetting the chooser');
 assert.equal(await page.evaluate(()=>window.busy&&document.querySelector('#database-manager-dialog').open),true,'Current failure reopens with the busy guard active');
 assert.deepEqual(errors,[]);console.log('PASS: real wizard UI fixtures for three tasks, source-first review, mapping, fixed append, NL/EN, 320px and busy-safe navigation.');
}finally{await browser.close();}
