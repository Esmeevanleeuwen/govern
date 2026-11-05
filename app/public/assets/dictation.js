import {getLanguage,setLanguage,registerMessages,t} from './i18n.js';
registerMessages('dictation',{
 nl:{title:'Opnamearchief',help:'Opnemen en transcriberen doe je in GhostSketch. Hier bekijk je de opgeslagen brongegevens.',recordings:'Opnames',refresh:'Verversen',transcript:'Transcript',empty:'Nog geen opnames.',pending:'Nog te verwerken in GhostSketch',setup:'Schakel PostgreSQL en Studio in en voer de provisioning uit.'},
 en:{title:'Recording archive',help:'Record and transcribe in GhostSketch. Inspect the stored source data here.',recordings:'Recordings',refresh:'Refresh',transcript:'Transcript',empty:'No recordings yet.',pending:'Pending in GhostSketch',setup:'Enable PostgreSQL and Studio and run provisioning.'}
});
const $=id=>document.getElementById('dictation-'+id),scope=document.body.dataset.dictationScope;
let selected=null,rows=[];
const copy=k=>t('dictation.'+k);
function translate(){document.documentElement.lang=getLanguage();$('language').value=getLanguage();document.querySelectorAll('[data-copy]').forEach(e=>e.textContent=copy(e.dataset.copy));renderList()}
$('language').onchange=()=>{setLanguage($('language').value);translate()};
async function request(action,options={},id=''){
 const query=new URLSearchParams({action,database:scope,...(id?{id}:{})});
 const response=await fetch('/dictation-api.php?'+query,options);
 const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||response.statusText);return result.data;
}
function status(text){$('status').textContent=text}
function renderList(){const list=$('list');list.replaceChildren();if(!rows.length){list.textContent=copy('empty');return}for(const row of rows){const b=document.createElement('button');b.className='button';b.textContent=row.filename+' · '+(row.status==='ready'?'✓':copy('pending'));b.setAttribute('aria-current',String(selected?.id===row.id));b.onclick=()=>load(row.id).catch(e=>status(e.message));list.append(b)}}
function show(row){selected=row;$('title').textContent=row.filename;$('transcript').textContent=row.segments.map(s=>`[${Math.floor(s.start_ms/60000)}:${String(Math.floor(s.start_ms/1000)%60).padStart(2,'0')}] ${s.text}`).join('\n\n');renderList()}
async function load(id){show(await request('recording',{},id))}
async function refresh(){const result=await request('list');rows=result.recordings;renderList()}
$('refresh').onclick=()=>refresh().catch(e=>status(e.message));
translate();if(scope)refresh().catch(e=>status(e.message));else status(copy('setup'));
