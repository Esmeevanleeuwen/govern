import assert from 'node:assert/strict';
import {blankDraft,datasetDrafts,engineId,fixedScope,identifierIssue,jobScopeKey,jobState,nameCollision,planPayload} from '../app/public/assets/database-workflow-model.js';
const source={source_id:'source-ref',datasets:[{index:0,name:'Hidden',hidden:true,count:1,columns:[{name:'x'}]},
 {index:1,name:'Contacts',count:2,columns:[{name:'code'},{name:'notes'}]}]};
const tables=datasetDrafts(source);
assert.deepEqual(tables.map(t=>t.selected),[false,true],'Never select hidden first worksheet automatically');
const draft=blankDraft({task:'dataset'}); Object.assign(draft,{source,engine:'postgres',name:'contacts_db',tables});
tables[1].table='contacts';tables[1].mapping[1].skip=true;tables[1].mapping[1].empty_as_null=true;
const payload=planPayload(draft);
assert.equal(payload.target_mode,'new_database');assert.equal(payload.name,'contacts_db');
assert.deepEqual(payload.tables[0].mapping,[{source:'code',target:'code',empty_as_null:false},{source:'notes',target:null,empty_as_null:false}],'Every source column is reviewed, including explicit skips');
assert.equal(identifierIssue('template1','postgres'),'invalidDatabaseName');assert.equal(identifierIssue('valid_name','postgres'),'');
assert.equal(identifierIssue('n'.repeat(64),'postgres'),'invalidDatabaseName');
for (const engine of ['mariadb','postgres']) {
 assert.equal(identifierIssue('UPPERCASE',engine),'invalidDatabaseName');
 assert.equal(identifierIssue('n'.repeat(63),engine),'');
 assert.equal(identifierIssue('n'.repeat(64),engine),'invalidDatabaseName');
 assert.equal(identifierIssue('pg_private',engine),'invalidDatabaseName');
 assert.equal(identifierIssue('Contacts_2026',engine,true),'','Dataset identifiers preserve mixed case');
 assert.equal(identifierIssue('N'.repeat(63),engine,true),'');
 assert.equal(identifierIssue('N'.repeat(64),engine,true),'invalidTableName');
}
assert.equal(identifierIssue('a'+'n'.repeat(61)+'_','mariadb'),'','63 characters and one underscore fits the additional 64-character limit');
assert.equal(identifierIssue('a'+'n'.repeat(60)+'__','mariadb'),'databasePatternLength');
assert.equal(identifierIssue('a'+'n'.repeat(60)+'__','postgres'),'','PostgreSQL does not escape a database grant pattern');
assert.equal(nameCollision('test','postgres',[{name:'test',engine:'mariadb'}]),false,'Names on distinct engines are distinct destinations');
assert.equal(nameCollision('test','postgres',[{name:'test',engine:'postgres'}]),true);
const contextual=blankDraft({scope:{name:'existing',engine:'mariadb'},table:' Exact table '});
Object.assign(contextual,{source:{source_id:'existing-source'},tables:[{selected:true,dataset:0,table:' Exact table ',version:'revision',mapping:[{source:'code',target:' Exact column ',skip:false,empty_as_null:false}]}]});
const append=planPayload(contextual);
assert.equal(append.engine,'mariadb');assert.equal(append.name,'existing');assert.equal(append.target_mode,'append');assert.equal(append.scope_key,'existing');
assert.equal(Object.hasOwn(append,'schema'),false,'MariaDB request must not invent a separate schema');
assert.equal(append.tables[0].table,' Exact table ');assert.equal(append.tables[0].mapping[0].target,' Exact column ','Catalog identifiers stay exact during append');
const pg=fixedScope('postgres:research:public');assert.equal(pg.engine,'postgres');assert.equal(pg.database,'research');
assert.equal(jobScopeKey({engine:'postgres',database:'research',schema:'public'}),'postgres:research:public');
assert.equal(jobState({state:'unrecognized'}),'unknown','Do not turn an unfamiliar result into success');
assert.equal(engineId('PostgreSQL'),'postgres');
console.log('PASS: unified workflow source selection, complete mapping, destination identity, collisions and job-state boundaries.');
