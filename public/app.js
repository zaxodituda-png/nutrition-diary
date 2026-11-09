'use strict';
const START_DATE='2026-11-07';
const isDiaryDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=START_DATE;
let entries={},revisions={},publication={},trainingDates={},isAdmin=false,csrf='',editingRevisions={};
let editorTraining=null,editorTrainingLoaded=false,fitWorker=null,fitReject=null,fitGeneration=0;
const trainingCache=new Map();
const initialToday=WeeklyAnalytics.localDateKey(new Date());
let selected=initialToday<START_DATE?START_DATE:initialToday,shownYear=Number(selected.slice(0,4)),shownMonth=Number(selected.slice(5,7))-1;
let entriesEpoch=0,entriesReady=false,weeklySummaries={},weeklyLoading=true,weeklyError=false,weeklyEpoch=0;
const $=id=>document.getElementById(id);const fmt=n=>Number(n).toLocaleString('ru-RU');const dateKey=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyDate=key=>new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));

function renderCalendar(){
  $('monthLabel').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(shownYear,shownMonth,1));
  const grid=$('calendarGrid');grid.replaceChildren();
  for(const label of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){
    const el=document.createElement('div');el.className='weekday';el.textContent=label;grid.append(el);
  }
  const offset=(new Date(shownYear,shownMonth,1).getDay()+6)%7;
  for(let i=0;i<offset;i++)grid.append(document.createElement('div'));
  const count=new Date(shownYear,shownMonth+1,0).getDate();
  for(let d=1;d<=count;d++){
    const key=dateKey(shownYear,shownMonth,d),button=document.createElement('button');
    const enabled=isDiaryDate(key),active=enabled&&selected===key;
    const hasPublishedEntry=Boolean(entries[key])&&(!isAdmin||publication[key]===true);
    button.type='button';button.disabled=!enabled;
    button.className='day'+(active?' active':'')+(hasPublishedEntry?' has-entry':'');
    button.textContent=d;
    button.setAttribute('aria-label',prettyDate(key)+(hasPublishedEntry?', есть опубликованная запись':'')+(!enabled?', недоступно: дневник ведётся с 7 ноября 2026 года':''));
    button.setAttribute('aria-pressed',String(active));
    if(enabled)button.onclick=()=>{if(!isDiaryDate(key))return;selected=key;render()};
    grid.append(button);
  }
}
function trainingHTML(entry){
  return `<div id="trainingDashboard"><p class="muted">${trainingDates[selected]?'Загрузка тренировки…':'Файл тренировки пока не добавлен.'}</p></div>`;
}
async function loadTraining(date){
  if(!trainingDates[date])return null;
  if(!trainingCache.has(date))trainingCache.set(date,request('training',undefined,{date}).then(result=>result.training));
  try{return await trainingCache.get(date)}catch(error){trainingCache.delete(date);throw error}
}
async function showTraining(date){
  const target=$('trainingDashboard');if(!target)return;
  try{const data=await loadTraining(date);if(target===$('trainingDashboard'))TrainingDashboard.mount(target,data)}
  catch(error){if(target===$('trainingDashboard'))target.textContent=error.message;}
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
function renderReport(){TrainingDashboard.dispose();const root=$('report'),e=entries[selected];if(!e){root.innerHTML=`<section class="card empty"><h2>${escapeHTML(prettyDate(selected))}</h2><p>На этот день запись пока не добавлена.</p>${isAdmin?'<button type="button" id="addEntry">Добавить запись</button>':''}</section>`;if($('addEntry'))$('addEntry').onclick=openEditor;return}const intake=e.meals.reduce((sum,m)=>sum+Number(m.kcal||0),0),out=Number(e.base||0)+Number(e.exercise||0),diff=out-intake;const groups=[...new Set(e.meals.map(m=>m.group))];const mealsHTML=groups.map(g=>`<section class="meal"><h3>${escapeHTML(g)}</h3>${e.meals.filter(m=>m.group===g).map(m=>`<div class="food-row"><span>${escapeHTML(m.name)}</span><span>${fmt(m.kcal)} ккал</span></div>`).join('')}</section>`).join('');root.innerHTML=`<article class="card report"><h2 class="date-title">${escapeHTML(prettyDate(selected))}</h2><p class="subtitle">Отчёт для нутрициолога${isAdmin&&!publication[selected]?' · Черновик':''}</p><div class="stats"><div class="stat"><small>Вес</small><strong>${weightHTML(selected)}</strong></div><div class="stat"><small>Сон</small><strong>${escapeHTML(e.sleep||'—')}</strong></div><div class="stat"><small>${diff>=0?'Дефицит':'Профицит'}</small><strong>${fmt(Math.abs(diff))} ккал</strong></div></div>${mealsHTML||'<p class="muted">Продукты не добавлены.</p>'}<section><h3>Итоги дня</h3><div class="totals"><div class="total-row"><span>Потреблено с пищей</span><span>${fmt(intake)} ккал</span></div><div class="total-row"><span>Базовый обмен веществ (по оценке)</span><span>${fmt(e.base||0)} ккал</span></div><div class="total-row"><span>Тренировка (расход по оценке)</span><span>${fmt(e.exercise||0)} ккал</span></div><div class="total-row"><span>Общий учтённый расход</span><span>${fmt(out)} ккал</span></div><div class="total-row"><span>Расчётный ${diff>=0?'дефицит':'профицит'}</span><span>${fmt(Math.abs(diff))} ккал</span></div></div><p class="hint">${escapeHTML(e.note||'Оценочные значения. Повседневная активность отдельно не учитывается.')}</p></section><hr class="section-divider"><section><h3>Тренировка за день</h3><div class="ride"><div class="ride-title">Велотренировка</div><p>Активные калории (по оценке): <strong>${TrainingDashboard.formatNumber(e.exercise||0,0)} ккал</strong></p>${trainingHTML(e)}</div></section></article>`;showTraining(selected)}
const weekly=WeeklyAnalytics.create($('weeklyAnalytics'),{onDayChange:async()=>{try{await loadEntries()}catch(error){weeklyError=true;weeklyLoading=false;renderWeekly();showStatus(error.message,true)}}});
function renderWeekly(){weekly.update(entries,weeklySummaries,{loading:weeklyLoading,error:weeklyError})}
function clearWeekly(){weeklyEpoch++;weeklySummaries={};weeklyLoading=true;weeklyError=false;weekly.update({}, {}, {loading:true})}
async function refreshWeekly(){
  const epoch=++weeklyEpoch,role=isAdmin,end=WeeklyAnalytics.localDateKey(new Date());weeklyLoading=true;weeklyError=false;renderWeekly();
  try{const result=await request('training-summaries',undefined,{end});if(epoch!==weeklyEpoch||role!==isAdmin||end!==WeeklyAnalytics.localDateKey(new Date()))return;weeklySummaries=result.trainingSummaries||{};weeklyLoading=false;renderWeekly();}
  catch(error){if(epoch!==weeklyEpoch||role!==isAdmin)return;weeklySummaries={};weeklyLoading=false;weeklyError=true;renderWeekly();}
}
function render(){if(!isDiaryDate(selected))selected=START_DATE;renderCalendar();renderReport();renderWeekly()}
async function openEditor(){if(!isAdmin)return;if(!entriesReady){try{await loadEntries()}catch(error){showStatus('Не удалось обновить запись перед редактированием. Проверьте соединение и повторите попытку.',true);return;}}if(!entriesReady||!isAdmin)return;if(!isDiaryDate(selected)){showStatus('Записи доступны с 7 ноября 2026 года.',true);return;}editingRevisions={...revisions};$('publishedInput').checked=publication[selected]??true;const e=entries[selected]||{weight:'',sleep:'',base:2000,exercise:0,meals:[],garmin:'',note:''};$('dateInput').value=selected;$('weightInput').value=e.weight;$('sleepInput').value=e.sleep;$('baseInput').value=e.base;$('exerciseInput').value=e.exercise;$('mealsInput').value=e.meals.map(m=>`${m.group} | ${m.name} | ${m.kcal}`).join('\n');$('noteInput').value=e.note;$('deleteBtn').disabled=!entries[selected];$('editor').showModal();cancelFit();const generation=fitGeneration;editorTraining=null;editorTrainingLoaded=false;$('fitFileInput').value='';$('fitFileName').textContent='Файл не выбран';$('fitStatus').textContent='Загрузка тренировки…';$('entryForm').querySelector('button[type=submit]').disabled=true;try{const loaded=await loadTraining(selected);if(generation===fitGeneration&&$('editor').open){editorTraining=loaded;editorTrainingLoaded=true;TrainingDashboard.mount($('fitPreview'),editorTraining);$('fitStatus').textContent=loaded?.version===1?'Для расчёта времени движения повторно выберите исходный файл тренировки.':e.garmin||e.strava?'Прежняя ссылка на тренировку сохранена в записи; можно загрузить файл тренировки (.fit).':'';}}catch(error){if(generation===fitGeneration)$('fitStatus').textContent=/[А-Яа-яЁё]/.test(error.message||'')?error.message:'Не удалось обработать файл тренировки. Попробуйте выбрать его ещё раз.';}finally{if(generation===fitGeneration)$('entryForm').querySelector('button[type=submit]').disabled=!editorTrainingLoaded;}}
$('entryForm').addEventListener('submit',async event=>{event.preventDefault();if(!isAdmin||!editorTrainingLoaded)return;const date=$('dateInput').value;if(!isDiaryDate(date)){showStatus('Нельзя создавать или редактировать записи ранее 7 ноября 2026 года.',true);return;}const meals=[];for(const [index,line] of $('mealsInput').value.split('\n').entries()){if(!line.trim())continue;const parts=line.split('|').map(s=>s.trim());if(parts.length!==3||!parts[0]||!parts[1]||!/^(\d+)([.,]\d+)?$/.test(parts[2])){alert(`Ошибка в строке ${index+1}: используйте «Приём пищи | Название | ккал».`);return}meals.push({group:parts[0],name:parts[1],kcal:Number(parts[2].replace(',','.'))})}const entry={...entries[date],weight:$('weightInput').value.trim(),sleep:$('sleepInput').value.trim(),base:Number($('baseInput').value||0),exercise:Number($('exerciseInput').value||0),meals,note:$('noteInput').value.trim()};const button=event.submitter;button.disabled=true;try{await request('save',{date,entry,training:editorTraining,published:$('publishedInput').checked,revision:editingRevisions[date]??null});selected=date;const [y,m]=date.split('-').map(Number);shownYear=y;shownMonth=m-1;entriesReady=false;$('editor').close();try{await loadEntries();showStatus('Запись сохранена.');}catch(error){showStatus('Запись сохранена на сервере, но не удалось обновить данные. Перед следующим редактированием они будут загружены заново; проверьте соединение.',true);}}catch(error){showStatus(error.message,true);}finally{button.disabled=false;}});
$('deleteBtn').onclick=async()=>{
  if(!isAdmin)return;
  if($('dateInput').value!==selected){showStatus('Дата в редакторе изменена. Для удаления откройте нужную дату в календаре; другая запись не будет удалена.',true);return;}
  if(!confirm('Удалить запись за '+prettyDate(selected)+'?'))return;
  const button=$('deleteBtn');button.disabled=true;
  try{await request('delete',{date:selected,revision:editingRevisions[selected]??null});entriesReady=false;$('editor').close();try{await loadEntries();showStatus('Запись удалена.');}catch(error){showStatus('Запись удалена на сервере, но не удалось обновить данные. Перед следующим редактированием они будут загружены заново; проверьте соединение.',true);}}
  catch(error){showStatus(error.message,true);}finally{button.disabled=false;}
};
$('editBtn').onclick=openEditor;$('closeEditor').onclick=()=>$('editor').close();$('prev').onclick=()=>{shownMonth--;if(shownMonth<0){shownMonth=11;shownYear--}renderCalendar()};$('next').onclick=()=>{shownMonth++;if(shownMonth>11){shownMonth=0;shownYear++}renderCalendar()};
function showStatus(message,error=false){$('appStatus').textContent=message;$('appStatus').classList.toggle('status-error',error)}
function updateAccess(){
  $('editBtn').hidden=!isAdmin;$('logoutBtn').hidden=!isAdmin;$('loginBtn').hidden=isAdmin;$('migrationPanel').hidden=!isAdmin;
}
async function request(action,data,params={},asBlob=false){
  let response;
  try{response=await fetch('api/index.php?'+new URLSearchParams({action,...params}),{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined})}
  catch{if(data)entriesReady=false;throw new Error('Не удалось связаться с сервером. Проверьте соединение и состояние записи перед повторным сохранением.')}
  if(asBlob&&response.ok)return response.blob();
  let result;try{result=await response.json()}catch{if(data)entriesReady=false;throw new Error('Сервер вернул некорректный ответ. Проверьте настройку PHP и состояние записи перед повторным сохранением.')}
  if(!response.ok){
    if(response.status===409)entriesReady=false;
    if(response.status===401&&action!=='login'){entriesEpoch++;entriesReady=false;clearWeekly();isAdmin=false;updateAccess();$('editor').close();entries={};revisions={};publication={};render();}
    throw new Error(result.error||'Не удалось выполнить запрос.');
  }
  if(result.csrf)csrf=result.csrf;
  return result;
}
async function loadEntries(){const epoch=++entriesEpoch,role=isAdmin;entriesReady=false;const result=await request('entries');if(epoch!==entriesEpoch||role!==isAdmin)return;entries=result.entries;revisions=result.revisions;publication=result.published;trainingDates=result.trainingDates||{};trainingCache.clear();entriesReady=true;weeklySummaries={};weeklyLoading=true;weeklyError=false;render();refreshWeekly();}
$('loginBtn').onclick=()=>{$('loginError').textContent='';$('loginDialog').showModal()};
$('closeLogin').onclick=()=>$('loginDialog').close();
$('loginForm').onsubmit=async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{await request('session');await request('login',{username:$('usernameInput').value,password:$('passwordInput').value});isAdmin=true;updateAccess();$('passwordInput').value='';await loadEntries();$('loginDialog').close();showStatus('Вы вошли как администратор.');}
  catch(error){$('loginError').textContent=error.message;}finally{button.disabled=false;}
};
$('logoutBtn').onclick=async()=>{try{await request('logout',{});isAdmin=false;entriesEpoch++;entriesReady=false;clearWeekly();updateAccess();$('editor').close();entries={};render();await loadEntries();showStatus('Вы вышли из аккаунта.');}catch(error){showStatus(error.message,true)}};
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('exportBtn').onclick=async()=>{try{downloadBlob(await request('export',undefined,{},true),'nutrition-diary-database.json');showStatus('Резервная копия базы сохранена.')}catch(error){showStatus(error.message,true)}};
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
    const result=await request('import',{entries:imported,training:parsed?.training??{}});await loadEntries();showStatus(`Добавлено черновиков: ${result.added}. Пропущено существующих дат: ${result.skipped.length}${result.skipped.length?' ('+result.skipped.join(', ')+')':''}.`);
  }catch(error){showStatus(error.message,true)}finally{$('importFile').value='';}
};
function cancelFit(){fitGeneration++;if(fitReject){fitReject(Error('Чтение отменено.'));fitReject=null;}if(fitWorker){fitWorker.terminate();fitWorker=null;}}
$('editor').addEventListener('close',cancelFit);
$('chooseFitBtn').onclick=()=>$('fitFileInput').click();
$('fitFileInput').onchange=async()=>{
  const file=$('fitFileInput').files[0];if(!file)return;
  $('fitFileName').textContent='Файл выбран';
  cancelFit();const generation=fitGeneration;
  if(!/\.fit$/i.test(file.name)||file.size<14||file.size>10*1024*1024){$('fitStatus').textContent='Выберите файл .fit размером до 10 МБ.';return;}
  const save=$('entryForm').querySelector('button[type=submit]');save.disabled=true;$('fitStatus').textContent='Чтение файла тренировки…';
  let timer;
  try{
    const bytes=await file.arrayBuffer();if(generation!==fitGeneration)return;
    const worker=new Worker('fit-worker.js?v=3');fitWorker=worker;
    const training=await new Promise((resolve,reject)=>{fitReject=reject;timer=setTimeout(()=>reject(Error('Чтение заняло слишком много времени.')),30000);worker.onmessage=event=>event.data.error?reject(Error(event.data.error)):resolve(event.data.training);worker.onerror=()=>reject(Error('Не удалось запустить обработку файла. Проверьте файлы сайта и политику безопасности.'));worker.postMessage(bytes,[bytes]);});
    if(generation!==fitGeneration)return;
    editorTraining=training;editorTrainingLoaded=true;TrainingDashboard.mount($('fitPreview'),training);$('fitStatus').textContent=`Готово: ${training.samples.length.toLocaleString('ru-RU')} измерений. Нажмите «Сохранить»; исходный файл и координаты не отправляются на сервер.`;
  }catch(error){if(generation===fitGeneration)$('fitStatus').textContent=/[А-Яа-яЁё]/.test(error.message||'')?error.message:'Не удалось обработать файл тренировки. Попробуйте выбрать его ещё раз.';}
  finally{clearTimeout(timer);if(generation===fitGeneration){if(fitWorker)fitWorker.terminate();fitWorker=null;fitReject=null;save.disabled=!editorTrainingLoaded;}}
};
$('removeFitBtn').onclick=()=>{cancelFit();editorTraining=null;editorTrainingLoaded=true;$('fitFileInput').value='';$('fitFileName').textContent='Файл не выбран';TrainingDashboard.mount($('fitPreview'),null);$('fitStatus').textContent='Тренировка будет удалена после сохранения записи.';$('entryForm').querySelector('button[type=submit]').disabled=false;};
async function initialize(){
  try{const session=await request('session');isAdmin=session.admin;updateAccess();await loadEntries();showStatus('');}
  catch(error){weeklyLoading=false;weeklyError=true;renderCalendar();renderWeekly();showStatus(error.message,true);$('report').innerHTML='<section class="card empty"><p>Записи не загружены. Обновите страницу после проверки соединения и настройки сервера.</p></section>';}
}
initialize();
