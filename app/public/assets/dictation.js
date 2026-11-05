import {getLanguage,setLanguage,registerMessages,t} from './i18n.js';
registerMessages('dictation',{
 nl:{title:'Dictafoon',help:'Bewaar je opname en transcript in Govern. Maak je aantekeningen in GhostSketch.',file:'Opname uit Dictafoon · M4A, WAV of MP3',import:'Opname inladen',recordings:'Opnames',refresh:'Verversen',transcript:'Transcript',process:'Transcriptie starten / hervatten',empty:'Nog geen opnames.',saved:'Opname bewaard. Je kunt de transcriptie starten.',working:'Transcriptie wordt verwerkt. Houd dit scherm open. Je kunt later hervatten.',ready:'Transcript klaar voor GhostSketch.',failed:'Verwerken gestopt. Je opname en afgeronde fragmenten zijn bewaard.',pending:'Nog te verwerken',setup:'Schakel PostgreSQL en Studio in en voer de provisioning uit.',limit:'Kies maximaal 16 MiB.'},
 en:{title:'Voice recordings',help:'Store recordings and transcripts in Govern. Make your notes in GhostSketch.',file:'Voice recording · M4A, WAV or MP3',import:'Import recording',recordings:'Recordings',refresh:'Refresh',transcript:'Transcript',process:'Start / resume transcription',empty:'No recordings yet.',saved:'Recording saved. You can start transcription.',working:'Transcribing. Keep this screen open. You can resume later.',ready:'Transcript ready for GhostSketch.',failed:'Processing stopped. Your recording and completed fragments are saved.',pending:'Pending',setup:'Enable PostgreSQL and Studio and run provisioning.',limit:'Choose up to 16 MiB.'}
});
const $=id=>document.getElementById('dictation-'+id),scope=document.body.dataset.dictationScope;
let csrf='',selected=null,busy=false,rows=[];
const copy=k=>t('dictation.'+k);
function translate(){document.documentElement.lang=getLanguage();$('language').value=getLanguage();document.querySelectorAll('[data-copy]').forEach(e=>e.textContent=copy(e.dataset.copy));renderList()}
$('language').onchange=()=>{setLanguage($('language').value);translate()};
async function request(action,options={},id=''){
 const query=new URLSearchParams({action,database:scope,...(id?{id}:{})});
 const response=await fetch('/dictation-api.php?'+query,{...options,headers:{'X-CSRF-Token':csrf,...options.headers}});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||response.statusText);return result.data;
}
function status(text){$('status').textContent=text}
function renderList(){const list=$('list');list.replaceChildren();if(!rows.length){list.textContent=copy('empty');return}for(const row of rows){const b=document.createElement('button');b.className='button';b.textContent=row.filename+' · '+(row.status==='ready'?'✓':copy('pending'));b.disabled=busy;b.setAttribute('aria-current',String(selected?.id===row.id));b.onclick=()=>load(row.id).catch(e=>status(e.message));list.append(b)}}
function show(row){selected=row;$('title').textContent=row.filename;$('transcript').textContent=row.segments.map(s=>`[${Math.floor(s.start_ms/60000)}:${String(Math.floor(s.start_ms/1000)%60).padStart(2,'0')}] ${s.text}`).join('\n\n');$('process').hidden=row.status==='ready';renderList()}
async function load(id){show(await request('recording',{},id))}
async function refresh(){const result=await request('list');csrf=result.csrf;rows=result.recordings;renderList()}
function setBusy(value){busy=value;$('process').disabled=value;$('refresh').disabled=value;$('import').querySelector('button').disabled=value;renderList()}
$('refresh').onclick=()=>refresh().catch(e=>status(e.message));
$('import').onsubmit=async e=>{e.preventDefault();const file=$('file').files[0];if(!file)return;if(file.size>16777216){status(copy('limit'));return}setBusy(true);try{const form=new FormData();form.append('file',file);show(await request('import',{method:'POST',body:form}));await refresh();status(copy('saved'));$('file').value=''}catch(error){status(error.message)}finally{setBusy(false)}};
$('process').onclick=async()=>{if(!selected||busy)return;setBusy(true);status(copy('working'));try{while(selected.status!=='ready'){show(await request('transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected.id})}));}await refresh();status(copy('ready'))}catch(error){status(copy('failed')+' '+error.message)}finally{setBusy(false)}};
translate();if(scope)refresh().catch(e=>status(e.message));else status(copy('setup'));
