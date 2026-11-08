'use strict';
const KEY='nutrition-diary-v1';
let entries={},revisions={},publication={},isAdmin=false,csrf='',editingRevisions={};
let selected='2026-11-07',shownYear=2026,shownMonth=10;
const $=id=>document.getElementById(id);const fmt=n=>Number(n).toLocaleString('ru-RU');const dateKey=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyDate=key=>new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));

function renderCalendar(){ $('monthLabel').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(shownYear,shownMonth,1));const grid=$('calendarGrid');grid.replaceChildren();for(const label of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const el=document.createElement('div');el.className='weekday';el.textContent=label;grid.append(el)}const offset=(new Date(shownYear,shownMonth,1).getDay()+6)%7;for(let i=0;i<offset;i++)grid.append(document.createElement('div'));const count=new Date(shownYear,shownMonth+1,0).getDate();for(let d=1;d<=count;d++){const key=dateKey(shownYear,shownMonth,d),b=document.createElement('button');b.type='button';b.className='day'+(selected===key?' active':'')+(entries[key]?' has-entry':'');b.textContent=d;b.setAttribute('aria-label',prettyDate(key)+(entries[key]?', есть запись':''));b.setAttribute('aria-pressed',String(selected===key));b.onclick=()=>{selected=key;render()};grid.append(b)}}
// Extract only a validated Garmin URL; pasted markup is never rendered.
function garminActivity(input){
  let source=String(input||'').trim();
  if(!source)return null;
  if(source.startsWith('<')){
    const doc=new DOMParser().parseFromString(source,'text/html');
    source=doc.querySelector('iframe')?.getAttribute('src')||'';
  }
  try{
    const url=new URL(source);
    if(url.protocol!=='https:'||url.hostname!=='connect.garmin.com'||url.username||url.password||url.port)return null;
    const match=url.pathname.match(/^\/modern\/activity\/(?:embed\/)?([1-9]\d*)\/?$/);
    return match?match[1]:null;
  }catch{return null}
}
function savedGarmin(entry){
  // Older versions stored all activity links in this legacy field.
  return entry.garmin??(garminActivity(entry.strava)?entry.strava:'');
}
function trainingHTML(entry){
  const input=savedGarmin(entry),id=garminActivity(input);
  return id?`<iframe loading="lazy" title="Активность Garmin Connect" referrerpolicy="strict-origin-when-cross-origin" src="https://connect.garmin.com/modern/activity/embed/${id}"></iframe><p class="hint">Карточка может быть недоступна из-за настроек доступа или ограничений Garmin Connect. Если она не отображается, откройте тренировку по ссылке.</p><a href="https://connect.garmin.com/modern/activity/${id}" target="_blank" rel="noopener noreferrer">Открыть в Garmin Connect</a>`:input?'<p class="muted">Не удалось распознать тренировку. Проверьте ссылку Garmin Connect в редакторе.</p>':'<p class="muted">Ссылка на тренировку пока не добавлена.</p>';
}
function parseWeight(value){
  const text=String(value??'').trim();
  if(!/^\d+(?:[.,]\d+)?$/.test(text))return null;
  const weight=Number(text.replace(',','.'));
  return Number.isFinite(weight)&&weight>0?weight:null;
}
function weightHTML(date){
  const value=entries[date].weight,current=parseWeight(value);
  if(current===null)return `${escapeHTML(value||'—')}${value?' кг':''}`;
  const previousDate=Object.keys(entries).filter(key=>key<date&&parseWeight(entries[key]?.weight)!==null).sort().pop();
  const label=`${fmt(current)} кг`;
  if(!previousDate)return label;
  const difference=Number((current-parseWeight(entries[previousDate].weight)).toFixed(10));
  const change=`${difference<0?'−':difference>0?'+':''}${fmt(Math.abs(difference))}`;
  return `${label} <span class="weight-change">(${change} кг)</span>`;
}
function renderReport(){const root=$('report'),e=entries[selected];if(!e){root.innerHTML=`<section class="card empty"><h2>${escapeHTML(prettyDate(selected))}</h2><p>На этот день запись пока не добавлена.</p>${isAdmin?'<button type="button" id="addEntry">Добавить запись</button>':''}</section>`;if($('addEntry'))$('addEntry').onclick=openEditor;return}const intake=e.meals.reduce((sum,m)=>sum+Number(m.kcal||0),0),out=Number(e.base||0)+Number(e.exercise||0),diff=out-intake;const groups=[...new Set(e.meals.map(m=>m.group))];const mealsHTML=groups.map(g=>`<section class="meal"><h3>${escapeHTML(g)}</h3>${e.meals.filter(m=>m.group===g).map(m=>`<div class="food-row"><span>${escapeHTML(m.name)}</span><span>${fmt(m.kcal)} ккал</span></div>`).join('')}</section>`).join('');root.innerHTML=`<article class="card report"><h2 class="date-title">${escapeHTML(prettyDate(selected))}</h2><p class="subtitle">Отчёт для нутрициолога${isAdmin&&!publication[selected]?' · Черновик':''}</p><div class="stats"><div class="stat"><small>Вес</small><strong>${weightHTML(selected)}</strong></div><div class="stat"><small>Сон</small><strong>${escapeHTML(e.sleep||'—')}</strong></div><div class="stat"><small>${diff>=0?'Дефицит':'Профицит'}</small><strong>${fmt(Math.abs(diff))} ккал</strong></div></div>${mealsHTML||'<p class="muted">Продукты не добавлены.</p>'}<section><h3>Итоги дня</h3><div class="totals"><div class="total-row"><span>Потреблено с пищей</span><span>${fmt(intake)} ккал</span></div><div class="total-row"><span>Базовый обмен веществ (по оценке)</span><span>${fmt(e.base||0)} ккал</span></div><div class="total-row"><span>Тренировка (расход по оценке)</span><span>${fmt(e.exercise||0)} ккал</span></div><div class="total-row"><span>Общий учтённый расход</span><span>${fmt(out)} ккал</span></div><div class="total-row"><span>Расчётный ${diff>=0?'дефицит':'профицит'}</span><span>${fmt(Math.abs(diff))} ккал</span></div></div><p class="hint">${escapeHTML(e.note||'Оценочные значения. Повседневная активность отдельно не учитывается.')}</p></section><hr class="section-divider"><section><h3>Тренировка за день</h3><div class="ride"><div class="ride-title">Велотренировка</div><p>Расход энергии (по оценке): <strong>${fmt(e.exercise||0)} ккал</strong></p>${trainingHTML(e)}</div></section></article>`}
function render(){renderCalendar();renderReport()}
function openEditor(){if(!isAdmin)return;editingRevisions={...revisions};$('publishedInput').checked=publication[selected]??true;const e=entries[selected]||{weight:'',sleep:'',base:2000,exercise:0,meals:[],garmin:'',note:''};$('dateInput').value=selected;$('weightInput').value=e.weight;$('sleepInput').value=e.sleep;$('baseInput').value=e.base;$('exerciseInput').value=e.exercise;$('mealsInput').value=e.meals.map(m=>`${m.group} | ${m.name} | ${m.kcal}`).join('\n');$('garminInput').value=savedGarmin(e);$('noteInput').value=e.note;$('deleteBtn').disabled=!entries[selected];$('editor').showModal()}
$('entryForm').addEventListener('submit',async event=>{event.preventDefault();if(!isAdmin)return;const date=$('dateInput').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const meals=[];for(const [index,line] of $('mealsInput').value.split('\n').entries()){if(!line.trim())continue;const parts=line.split('|').map(s=>s.trim());if(parts.length!==3||!parts[0]||!parts[1]||!/^(\d+)([.,]\d+)?$/.test(parts[2])){alert(`Ошибка в строке ${index+1}: используйте «Приём пищи | Название | ккал».`);return}meals.push({group:parts[0],name:parts[1],kcal:Number(parts[2].replace(',','.'))})}const entry={...entries[date],weight:$('weightInput').value.trim(),sleep:$('sleepInput').value.trim(),base:Number($('baseInput').value||0),exercise:Number($('exerciseInput').value||0),meals,garmin:$('garminInput').value.trim(),note:$('noteInput').value.trim()};const button=event.submitter;button.disabled=true;try{await request('save',{date,entry,published:$('publishedInput').checked,revision:editingRevisions[date]??null});selected=date;const [y,m]=date.split('-').map(Number);shownYear=y;shownMonth=m-1;await loadEntries();$('editor').close();showStatus('Запись сохранена.');}catch(error){showStatus(error.message,true);}finally{button.disabled=false;}});
$('deleteBtn').onclick=async()=>{if(!isAdmin||!confirm('Удалить запись за выбранную дату?'))return;const button=$('deleteBtn');button.disabled=true;try{await request('delete',{date:selected,revision:editingRevisions[selected]??null});await loadEntries();$('editor').close();showStatus('Запись удалена.');}catch(error){showStatus(error.message,true);}finally{button.disabled=false;}};
$('editBtn').onclick=openEditor;$('closeEditor').onclick=()=>$('editor').close();$('prev').onclick=()=>{shownMonth--;if(shownMonth<0){shownMonth=11;shownYear--}renderCalendar()};$('next').onclick=()=>{shownMonth++;if(shownMonth>11){shownMonth=0;shownYear++}renderCalendar()};
function showStatus(message,error=false){$('appStatus').textContent=message;$('appStatus').classList.toggle('status-error',error)}
function updateAccess(){
  $('editBtn').hidden=!isAdmin;$('logoutBtn').hidden=!isAdmin;$('loginBtn').hidden=isAdmin;$('migrationPanel').hidden=!isAdmin;
}
async function request(action,data){
  let response;
  try{response=await fetch(`api/index.php?action=${encodeURIComponent(action)}`,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined})}
  catch{throw new Error('Не удалось связаться с сервером. Проверьте соединение и состояние записи перед повторным сохранением.')}
  let result;try{result=await response.json()}catch{throw new Error('Сервер вернул некорректный ответ. Проверьте настройку PHP.')}
  if(!response.ok){
    if(response.status===401&&action!=='login'){isAdmin=false;updateAccess();$('editor').close();entries={};revisions={};publication={};render();}
    throw new Error(result.error||'Не удалось выполнить запрос.');
  }
  if(result.csrf)csrf=result.csrf;
  return result;
}
async function loadEntries(){const result=await request('entries');entries=result.entries;revisions=result.revisions;publication=result.published;render()}
$('loginBtn').onclick=()=>{$('loginError').textContent='';$('loginDialog').showModal()};
$('closeLogin').onclick=()=>$('loginDialog').close();
$('loginForm').onsubmit=async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{await request('session');await request('login',{username:$('usernameInput').value,password:$('passwordInput').value});isAdmin=true;updateAccess();$('passwordInput').value='';await loadEntries();$('loginDialog').close();showStatus('Вы вошли как администратор.');}
  catch(error){$('loginError').textContent=error.message;}finally{button.disabled=false;}
};
$('logoutBtn').onclick=async()=>{try{await request('logout',{});isAdmin=false;updateAccess();$('editor').close();entries={};render();await loadEntries();showStatus('Вы вышли из аккаунта.');}catch(error){showStatus(error.message,true)}};
function downloadJSON(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('exportBtn').onclick=async()=>{try{downloadJSON(await request('export'),'nutrition-diary-database.json');showStatus('Резервная копия базы сохранена.')}catch(error){showStatus(error.message,true)}};
$('exportLocalBtn').onclick=()=>{
  try{const raw=localStorage.getItem(KEY);if(!raw){showStatus('Старых записей в этом браузере и на этом адресе нет. Для другого адреса используйте инструкцию переноса в README.');return}
    const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Некорректный формат старых записей.');downloadJSON({format:'nutrition-diary',version:1,entries:data},'nutrition-diary-browser.json');showStatus('Старые записи экспортированы. Исходные данные в браузере сохранены.');
  }catch(error){showStatus(error.message,true)}
};
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=async()=>{
  const file=$('importFile').files[0];if(!file)return;
  try{
    if(file.size>10*1024*1024)throw new Error('Файл слишком большой (до 10 МБ).');
    const parsed=JSON.parse(await file.text());
    if(parsed?.format&&parsed.format!=='nutrition-diary')throw new Error('Неизвестный формат файла.');
    if(parsed?.version!==undefined&&parsed.version!==1)throw new Error('Неизвестная версия файла.');
    const imported=parsed?.entries??parsed;
    if(!imported||typeof imported!=='object'||Array.isArray(imported))throw new Error('Ожидается JSON-объект с записями по датам.');
    if(!confirm(`Добавить записи из файла (${Object.keys(imported).length} дат) как черновики? Совпадающие даты будут пропущены.`))return;
    const result=await request('import',{entries:imported});await loadEntries();showStatus(`Добавлено черновиков: ${result.added}. Пропущено существующих дат: ${result.skipped.length}${result.skipped.length?' ('+result.skipped.join(', ')+')':''}.`);
  }catch(error){showStatus(error.message,true)}finally{$('importFile').value='';}
};
async function initialize(){
  try{const session=await request('session');isAdmin=session.admin;updateAccess();await loadEntries();showStatus('');}
  catch(error){showStatus(error.message,true);$('report').innerHTML='<section class="card empty"><p>Записи не загружены. Обновите страницу после проверки соединения и настройки сервера.</p></section>';}
}
initialize();
