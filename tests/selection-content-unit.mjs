import assert from 'node:assert/strict';
import {explainSelection} from '../app/public/assets/selection-content.js';
import {setLanguage} from '../app/public/assets/i18n.js';

setLanguage('en');
const item = (kind, table, record, extra = {}) => ({meta:{kind,table,record,primaryKey:['id'],...extra},tag:kind==='cell'?'td':'tr',connected:true});
const first = item('row','exact`table',{id:'9223372036854775807',name:'<script>literal</script>'});
const cell = item('cell','exact`table',first.meta.record,{column:'name',value:first.meta.record.name});
let result = explainSelection([first,cell]);
assert.match(result.relationship,/same row/);
assert.equal(result.actions.filter(action=>action.type==='query').length,1);
assert.match(result.actions.at(-1).sql,/`exact``table`/);
assert.match(result.actions.at(-1).sql,/'9223372036854775807'/);
assert.equal((result.actions.at(-1).sql.match(/`id` =/g)||[]).length,1,'A row and its cell produce one key predicate');
assert.equal(result.entries[1].details.find(detail=>detail.label==='Value').value,'<script>literal</script>');

result = explainSelection([item('row','pairs',{a:'1',b:'2'},{primaryKey:['a','b']}),item('row','pairs',{a:'3',b:'4'},{primaryKey:['a','b']})]);
assert.match(result.actions.at(-1).sql,/\(`a` = '1' AND `b` = '2'\)\n   OR \(`a` = '3' AND `b` = '4'\)/);
assert.match(result.relationship,/2 different records/);
for (const invalid of [[],['missing']]) {
    assert.equal(explainSelection([item('row','keyless',{id:'1'},{primaryKey:invalid})]).actions.some(action=>action.type==='query'),false);
}
assert.equal(explainSelection([first,item('row','other',{id:'1'})]).actions.some(action=>action.type==='query'),false);
assert.equal(explainSelection([first,{meta:{kind:'control',label:'Delete'},tag:'button'}]).actions.some(action=>action.type==='query'),false);
assert.equal(explainSelection([item('row','nullable',{id:null})]).actions.some(action=>action.type==='query'),false);
assert.equal(explainSelection([item('row','unsafe',{id:Infinity})]).actions.some(action=>action.type==='query'),false);
assert.equal(explainSelection([item('row','unsafe',{id:9007199254740992})]).actions.some(action=>action.type==='query'),false);
assert.equal(explainSelection([item('row','binary',{id:'0x3100'},{snapshot:true})]).actions.some(action=>action.type==='query'),false);
assert.match(explainSelection([item('row','binary',{id:'0x3100'},{snapshot:true})]).entries[0].details.at(-1).value,/cannot serve as reliable record identifiers/);
assert.match(explainSelection([item('cell','t',{id:'1'},{truncated:true,column:'name',value:'long…'})]).entries[0].description,/contains shortened values/);
assert.equal(explainSelection([item('row','t',{id:'1',other:'a'}),item('row','t',{id:'2',other:'b'},{primaryKey:['other']})]).actions.some(action=>action.type==='query'),false);
assert.match(explainSelection([item('row','quotes',{id:"a'b"})]).actions.at(-1).sql,/'a''b'/);
assert.match(explainSelection([item('row','slashes',{id:'a\\b\n'})]).actions.at(-1).sql,/CONVERT\(0x615c620a USING utf8mb4\)/);
assert.match(explainSelection([{...first,connected:false}]).entries[0].description,/Snapshot from when selected/);

const context={database:'test',schema:{tables:[{name:'source',foreign_keys:[{name:'fk_pair',columns:['parent','scope'],referenced_table:'target',referenced_schema:'test',referenced_columns:['id','scope']}]}]}};
const source=item('row','source',{id:'1',parent:'7',scope:'a'}),target=item('row','target',{id:'7',scope:'a'});
assert.match(explainSelection([source,target],context).relationship,/matches the declared relationship fk_pair/);
assert.match(explainSelection([source,item('row','target',{id:'7',scope:'b'})],context).relationship,/do not match all fields/);
assert.match(explainSelection([source,item('row','target',{id:'7',scope:null})],context).relationship,/do not match all fields/);
assert.match(explainSelection([source,target]).relationship,/No direct foreign key/);
assert.match(explainSelection([source,target],{...context,schema:{tables:[{name:'source',foreign_keys:[{...context.schema.tables[0].foreign_keys[0],referenced_schema:'external'}]}]}}).relationship,/No direct foreign key/);
const tableSelection=[{meta:{kind:'table',table:'source'},tag:'article'},{meta:{kind:'table',table:'target'},tag:'article'}];
assert.match(explainSelection(tableSelection,context).relationship,/table connection does not prove/);
const control=explainSelection([{meta:{kind:'control',label:'Refresh'},tag:'button'}]);
assert.match(control.entries[0].description,/<button>/);
assert.equal(control.actions.length,0);
assert.match(control.possibilities[0],/Exit the selection pointer/);
assert.match(explainSelection([{meta:{kind:'control',label:'Search',table:'t',purpose:'searchRecords'},tag:'input'}]).entries[0].description,/Filters the displayed records of t/);
assert.match(explainSelection([{meta:{kind:'column',table:'t',column:'code',attribute:'type',value:'varchar(40)'},tag:'td'}]).entries[0].description,/definition of t.code: varchar\(40\)/);
const resultCell=explainSelection([{meta:{kind:'cell',column:'calculated',value:'12',snapshot:true,record:['12']},tag:'td'}]);
assert.match(resultCell.entries[0].description,/result column calculated: 12/);
assert.match(resultCell.relationship,/snapshots of SQL results/);
assert.equal(resultCell.actions.length,0);
setLanguage('nl');
assert.match(explainSelection([{meta:{kind:'cell',table:'t',column:'id',value:'exact English value'},tag:'td'}]).entries[0].description,/exact English value/);
assert.match(explainSelection([first]).entries[0].kind,/Rij/);
console.log('PASS selection explanations: exact values, composite identities, safe SQL preparation, declared FK matching, snapshots and both languages.');
