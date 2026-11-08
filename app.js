'use strict';
const KEY='nutrition-diary-v1';
const seed={'2026-11-07':{weight:'76,6',sleep:'5 ч 31 мин',base:2000,exercise:1500,meals:[{group:'Утро',name:'Омлет из 5 яиц',kcal:400},{group:'Утро',name:'Шоколад Alpen Gold, 80 г',kcal:421},{group:'Утро',name:'Конфеты Amorreta Chocolate, 172 г',kcal:959},{group:'Обед',name:'Творожная запеканка с джемом, 322 г',kcal:644},{group:'Обед',name:'Салат «Цезарь», Макдональдс',kcal:180},{group:'Обед',name:'Конфеты',kcal:104},{group:'Вечер',name:'Креветки, 370 г',kcal:370},{group:'Вечер',name:'Рис, 168 г',kcal:218},{group:'Вечер',name:'Огурец, 75 г',kcal:11}],strava:'',note:'Калорийность продуктов и расход энергии указаны по предоставленным оценкам. Дополнительная повседневная активность отдельно не учитывалась.'}};
let entries;try{const saved=JSON.parse(localStorage.getItem(KEY));entries=saved&&typeof saved==='object'?saved:structuredClone(seed)}catch{entries=structuredClone(seed)}
let selected='2026-11-07',shownYear=2026,shownMonth=10;
const $=id=>document.getElementById(id);const fmt=n=>Number(n).toLocaleString('ru-RU');const dateKey=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyDate=key=>new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
function persist(){localStorage.setItem(KEY,JSON.stringify(entries))}
function renderCalendar(){ $('monthLabel').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(shownYear,shownMonth,1));const grid=$('calendarGrid');grid.replaceChildren();for(const label of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const el=document.createElement('div');el.className='weekday';el.textContent=label;grid.append(el)}const offset=(new Date(shownYear,shownMonth,1).getDay()+6)%7;for(let i=0;i<offset;i++)grid.append(document.createElement('div'));const count=new Date(shownYear,shownMonth+1,0).getDate();for(let d=1;d<=count;d++){const key=dateKey(shownYear,shownMonth,d),b=document.createElement('button');b.type='button';b.className='day'+(selected===key?' active':'')+(entries[key]?' has-entry':'');b.textContent=d;b.setAttribute('aria-label',prettyDate(key)+(entries[key]?', есть запись':''));b.setAttribute('aria-pressed',String(selected===key));b.onclick=()=>{selected=key;render()};grid.append(b)}}
// Read pasted markup in an inert document; only a validated numeric ID is rendered.
function stravaActivity(input){
  let source=String(input||'').trim();
  if(!source)return null;
  if(source.startsWith('<')){
    const doc=new DOMParser().parseFromString(source,'text/html');
    const frame=doc.querySelector('iframe');
    if(frame)source=frame.getAttribute('src')||'';
    else {
      const placeholder=doc.querySelector('.strava-embed-placeholder[data-embed-type="activity"]');
      const id=placeholder?.getAttribute('data-embed-id');
      return /^[1-9]\d*$/.test(id||'')?id:null;
    }
  }
  try{
    const url=new URL(source);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    let match;
    if(['strava.com','www.strava.com','embed.strava.com'].includes(url.hostname)){
      match=url.pathname.match(/^\/activities\/([1-9]\d*)(?:\/embed(?:\/[a-zA-Z0-9_-]+)?)?\/?$/);
    }else if(url.hostname==='strava-embeds.com'){
      match=url.pathname.match(/^\/activity\/([1-9]\d*)\/?$/);
    }
    return match?match[1]:null;
  }catch{return null}
}
function trainingHTML(entry){
  const training=entry.training||{};
  const number=value=>value!==undefined&&value!==''&&Number.isFinite(Number(String(value).replace(',','.')))?fmt(Number(String(value).replace(',','.'))):'—';
  const metrics=[['Дистанция (км)',number(training.distance)],['Время тренировки (ч:мин:сек)',training.movingTime||'—'],['Средняя мощность (Вт)',number(training.power)],['Средний пульс (уд/мин)',number(training.heartRate)]];
  const grid=`<dl class="training-metrics">${metrics.map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>`;
  const id=stravaActivity(entry.strava);
  const activity=id?`<iframe loading="lazy" title="Активность Strava" referrerpolicy="strict-origin-when-cross-origin" src="https://strava-embeds.com/activity/${id}?style=standard"></iframe><p class="hint">Если карточка не отображается, откройте активность по ссылке.</p><a href="https://www.strava.com/activities/${id}" target="_blank" rel="noopener noreferrer">Открыть в Strava</a>`:entry.strava?'<p class="muted">Не удалось распознать активность Strava. Проверьте ссылку или код в редакторе.</p>':'<p class="muted">Активность Strava пока не добавлена.</p>';
  return grid+activity;
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
function renderReport(){const root=$('report'),e=entries[selected];if(!e){root.innerHTML=`<section class="card empty"><h2>${escapeHTML(prettyDate(selected))}</h2><p>На этот день запись пока не добавлена.</p><button type="button" id="addEntry">Добавить запись</button></section>`;$('addEntry').onclick=openEditor;return}const intake=e.meals.reduce((sum,m)=>sum+Number(m.kcal||0),0),out=Number(e.base||0)+Number(e.exercise||0),diff=out-intake;const groups=[...new Set(e.meals.map(m=>m.group))];const mealsHTML=groups.map(g=>`<section class="meal"><h3>${escapeHTML(g)}</h3>${e.meals.filter(m=>m.group===g).map(m=>`<div class="food-row"><span>${escapeHTML(m.name)}</span><span>${fmt(m.kcal)} ккал</span></div>`).join('')}</section>`).join('');root.innerHTML=`<article class="card report"><h2 class="date-title">${escapeHTML(prettyDate(selected))}</h2><p class="subtitle">Отчёт для нутрициолога</p><div class="stats"><div class="stat"><small>Вес</small><strong>${weightHTML(selected)}</strong></div><div class="stat"><small>Сон</small><strong>${escapeHTML(e.sleep||'—')}</strong></div><div class="stat"><small>${diff>=0?'Дефицит':'Профицит'}</small><strong>${fmt(Math.abs(diff))} ккал</strong></div></div>${mealsHTML||'<p class="muted">Продукты не добавлены.</p>'}<section><h3>Итоги дня</h3><div class="totals"><div class="total-row"><span>Потреблено с пищей</span><span>${fmt(intake)} ккал</span></div><div class="total-row"><span>Базовый обмен веществ (по оценке)</span><span>${fmt(e.base||0)} ккал</span></div><div class="total-row"><span>Тренировка (расход по оценке)</span><span>${fmt(e.exercise||0)} ккал</span></div><div class="total-row"><span>Общий учтённый расход</span><span>${fmt(out)} ккал</span></div><div class="total-row"><span>Расчётный ${diff>=0?'дефицит':'профицит'}</span><span>${fmt(Math.abs(diff))} ккал</span></div></div><p class="hint">${escapeHTML(e.note||'Оценочные значения. Повседневная активность отдельно не учитывается.')}</p></section><hr class="section-divider"><section><h3>Тренировка за день</h3><div class="ride"><div class="ride-title">Велотренировка</div><p>Расход по оценке: <strong>${fmt(e.exercise||0)} ккал</strong></p>${trainingHTML(e)}</div></section></article>`}
function render(){renderCalendar();renderReport()}
function openEditor(){const e=entries[selected]||{weight:'',sleep:'',base:2000,exercise:0,meals:[],strava:'',note:''};$('dateInput').value=selected;$('weightInput').value=e.weight;$('sleepInput').value=e.sleep;$('baseInput').value=e.base;$('exerciseInput').value=e.exercise;$('mealsInput').value=e.meals.map(m=>`${m.group} | ${m.name} | ${m.kcal}`).join('\n');$('stravaInput').value=e.strava||'';const training=e.training||{};for(const field of ['distance','movingTime','power','heartRate'])$(field+'Input').value=training[field]??'';$('noteInput').value=e.note;$('deleteBtn').disabled=!entries[selected];$('editor').showModal()}
$('entryForm').addEventListener('submit',event=>{event.preventDefault();const date=$('dateInput').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const meals=[];for(const [index,line] of $('mealsInput').value.split('\n').entries()){if(!line.trim())continue;const parts=line.split('|').map(s=>s.trim());if(parts.length!==3||!parts[0]||!parts[1]||!/^(\d+)([.,]\d+)?$/.test(parts[2])){alert(`Ошибка в строке ${index+1}: используйте «Приём пищи | Название | ккал».`);return}meals.push({group:parts[0],name:parts[1],kcal:Number(parts[2].replace(',','.'))})}const training={distance:$('distanceInput').value.trim(),movingTime:$('movingTimeInput').value.trim(),power:$('powerInput').value.trim(),heartRate:$('heartRateInput').value.trim()};if(training.movingTime){const [hours,minutes,seconds]=training.movingTime.split(':');training.movingTime=`${hours.padStart(2,'0')}:${minutes}:${seconds}`;}entries[date]={...entries[date],training,weight:$('weightInput').value.trim(),sleep:$('sleepInput').value.trim(),base:Number($('baseInput').value||0),exercise:Number($('exerciseInput').value||0),meals,strava:$('stravaInput').value.trim(),note:$('noteInput').value.trim()};selected=date;const [y,m]=date.split('-').map(Number);shownYear=y;shownMonth=m-1;persist();$('editor').close();render()});
$('deleteBtn').onclick=()=>{if(!confirm('Удалить запись за выбранную дату?'))return;delete entries[selected];persist();$('editor').close();render()};$('editBtn').onclick=openEditor;$('closeEditor').onclick=()=>$('editor').close();$('prev').onclick=()=>{shownMonth--;if(shownMonth<0){shownMonth=11;shownYear--}renderCalendar()};$('next').onclick=()=>{shownMonth++;if(shownMonth>11){shownMonth=0;shownYear++}renderCalendar()};render();
