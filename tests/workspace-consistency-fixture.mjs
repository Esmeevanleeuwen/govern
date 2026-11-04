/** Real frontend with explicit API fixtures; no PHP or database execution. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {selectWorkspaceLanguage} from './workspace-tools.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../app/public/',import.meta.url));
const errors=[], requests=[];
const names=['organizations','digital_systems','sources',...Array.from({length:20},(_,i)=>'table_'+String(i).padStart(2,'0'))];
const columns=[{name:'id',type:'int',data_type:'int',primary:true,nullable:false,generated:false,comment:''},
    {name:'name',type:'text',data_type:'text',primary:false,nullable:true,generated:false,comment:''}];
const databases=['fixture_a','fixture_b'].map(name=>({name,available:true,engine:'mariadb',connection:'mariadb',scope_key:name}));
const tables=names.map(name=>({name,type:'table',columns:columns.length,rows_estimate:1,comment:'',row_editable:true}));
function fixture(url,body){
    const action=url.searchParams.get('action'),database=url.searchParams.get('database') || 'fixture_a';
    const table=url.searchParams.get('table') || names[0];
    if(action==='bootstrap')return {csrf:'fixture-token',database:{name:database,schema:database,scope_key:database,engine:'mariadb',connection:'mariadb',status:'ready',version:'Fixture'},
        databases,default_database:'fixture_a',scope_key:database,can_create_database:true,stats:{tables:tables.length,views:0,rows_estimate:tables.length},tables};
    if(action==='databases')return {databases,default_database:'fixture_a',csrf:'fixture-token',can_create_database:true};
    if(action==='structure')return {table,columns,indexes:[],foreign_keys:[],create_sql:'CREATE TABLE '+table+' (id int, name text);'};
    if(action==='browse')return {table,columns,rows:[{id:'1',name:table+' row'}],row_keys:[{id:'1'}],key_columns:['id'],total:1,page:1,page_size:25,sql:'SELECT * FROM '+table,params:{}};
    if(action==='schema')return {database,tables:tables.map(table=>({...table,columns,foreign_keys:[]}))};
    if(action==='record-map-records')return {database,table,supported:true,nodes:[],has_more:false};
    if(action==='queries')return [];
    if(action==='query')return {columns:[{key:'answer',label:'answer'}],rows:[{answer:'42'}],returned_rows:1,duration_ms:1,sql:body.sql,params:{},schema_refresh_needed:false};
    if(action==='ai-status')return {enabled:false,provider:'ollama',status:'disabled'};
    throw Error('Unexpected fixture action: '+action);
}
const server=http.createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://localhost');
        if(url.pathname==='/api.php'){
            let raw='';for await(const chunk of req)raw+=chunk;
            const body=raw?JSON.parse(raw):{};requests.push({url:url.href,method:req.method,body});
            const payload=JSON.stringify({ok:true,data:fixture(url,body)});res.writeHead(200,{'content-type':'application/json'}).end(payload);return;
        }
        const filename=path.join(root,url.pathname==='/'?'workspace.php':url.pathname);
        if(!filename.startsWith(root)){res.writeHead(403).end();return;}
        let content=await readFile(filename);
        if(filename.endsWith('.php'))content=content.toString().replace(/^<\?php[\s\S]*?\?>\s*/,'');
        const type=filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'text/html';
        res.writeHead(200,{'content-type':type}).end(content);
    }catch(error){errors.push(String(error));console.error(error);if(!res.headersSent)res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_BIN?{executablePath:process.env.BROWSER_BIN}:{})});
try{
    const context=await browser.newContext({locale:'en-GB',viewport:{width:1440,height:1100}});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    const mode=async name=>{await page.locator('[data-database-view="'+name+'"]').click();await page.waitForFunction(name=>location.hash.startsWith('#'+name),name);};
    const table=name=>page.locator('.catalog-item').filter({has:page.locator('.catalog-item-name',{hasText:new RegExp('^'+name+'$')})});
    const sidebar=async()=>{
        assert.equal(await page.locator('#workspace-context').isVisible(),true);
        assert.equal(await page.locator('#catalog-search').count(),1);
        assert.equal(await page.locator('.catalog-item').count(),tables.length);
        assert.deepEqual(await page.locator('.database-views a').evaluateAll(nodes=>nodes.map(node=>node.dataset.databaseView)),['gegevens','verkennen','schema','onderzoeken']);
    };
    const shot=async name=>{if(process.env.SCREENSHOTS_DIR){await mkdir(process.env.SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOTS_DIR,name+'.png'),fullPage:true});}};
    await page.goto(base+'/workspace.php#gegevens?database=fixture_a&table=organizations');
    await page.locator('.data-table tbody tr').waitFor();await sidebar();
    await page.locator('#catalog-search').fill('sources');
    await mode('schema');await page.locator('#schema-viewport').waitFor();
    assert.equal(await page.locator('#catalog-search').inputValue(),'sources');
    assert.equal(await page.locator('.catalog-item').count(),1);
    await table('sources').click();assert.match(await page.locator('#schema-selected').innerText(),/sources/);
    await page.locator('#catalog-search').fill('');await sidebar();
    await page.locator('#schema-zoom-in').click();const zoom=await page.locator('#schema-zoom-value').innerText();
    await shot('workspace-schema-en');
    await mode('verkennen');await page.locator('#record-map-search').waitFor();await sidebar();
    await page.locator('.record-map-scene').evaluate(node=>node.dataset.fixtureContinuity='keep');
    await table('digital_systems').click();
    assert.equal(await page.locator('.record-map-scene').getAttribute('data-fixture-continuity'),'keep');
    assert.equal(await page.locator('#record-map-table').inputValue(),'digital_systems');
    await shot('workspace-explore-en');
    await mode('onderzoeken');await page.locator('#sql-editor').waitFor();await sidebar();
    assert.equal(await page.locator('#sql-editor').evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}),true,'Queries opens with the SQL editor visible in the first viewport.');
    const sql='SELECT 42 AS answer;';await page.locator('#sql-editor').fill(sql);
    await page.locator('#query-name').fill('Query draft');await page.locator('#query-notes').fill('Keep these notes');
    await table('organizations').click();assert.equal(await page.locator('#sql-editor').inputValue(),sql);
    assert.equal(await page.locator('#query-name').inputValue(),'Query draft');
    await page.locator('#run-query').click();await page.locator('.query-result .data-table tbody td').waitFor();
    assert.equal(await page.locator('.query-result .data-table tbody td').innerText(),'42');
    await shot('workspace-queries-en');
    await mode('schema');await page.locator('#schema-viewport').waitFor();
    assert.equal(await page.locator('#schema-zoom-value').innerText(),zoom);
    await mode('onderzoeken');assert.equal(await page.locator('#sql-editor').inputValue(),sql);
    assert.equal(await page.locator('#query-notes').inputValue(),'Keep these notes');
    assert.equal(await page.locator('.query-result .data-table tbody td').innerText(),'42');
    await page.locator('#database-select').selectOption('fixture_b');
    await page.waitForFunction(()=>document.querySelector('#database-select')?.value==='fixture_b'&&!document.querySelector('#database-select').disabled);
    await mode('onderzoeken');assert.notEqual(await page.locator('#sql-editor').inputValue(),sql);await page.locator('#sql-editor').fill('SELECT 7;');
    await page.locator('#database-select').selectOption('fixture_a');
    await page.waitForFunction(()=>document.querySelector('#database-select')?.value==='fixture_a'&&!document.querySelector('#database-select').disabled);
    assert.equal(await page.locator('#sql-editor').inputValue(),sql);
    await selectWorkspaceLanguage(page,'nl');assert.equal(await page.locator('#sql-editor').inputValue(),sql);
    assert.equal(await page.locator('[data-database-view="onderzoeken"]').innerText(),'Queries');
    await selectWorkspaceLanguage(page,'en');
    for(const width of [1440,768,320]){
        await page.setViewportSize({width,height:1000});
        for(const view of ['gegevens','verkennen','schema','onderzoeken']){
            await mode(view);
            await page.locator(view==='schema'?'#schema-viewport':view==='verkennen'?'#record-map-search':view==='onderzoeken'?'#sql-editor':'#data-search').waitFor();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' fits '+width+'px');
            if(width<=820){await page.locator('#workspace-explorer-open').click();await sidebar();await page.keyboard.press('Escape');}
            else await sidebar();
        }
        if(width===320)await shot('workspace-queries-mobile-en');
    }
    assert.deepEqual(errors,[]);
    assert.ok(requests.filter(item=>new URL(item.url).searchParams.get('action')==='query').every(item=>new URL(item.url).searchParams.get('database')==='fixture_a'));
    console.log('PASS: frontend fixtures for shared Records/Explore/Schema/Queries catalog, canvas continuity, query/result and per-database drafts, language and 1440/768/320px layouts. PHP/database execution not exercised.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
