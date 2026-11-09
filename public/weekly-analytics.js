/* Rolling calendar-day summary; no browser storage or chart controls. */
(function(root){
  'use strict';
  const METRICS=[['distance','Дистанция'],['duration','Время тренировок'],['deficit','Суммарный дефицит'],['active','Активные ккал'],['weight','Средний вес'],['sleep','Средний сон']];
  const key=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const localDateKey=date=>key(date.getFullYear(),date.getMonth(),date.getDate());
  function civilDate(value){const [y,m,d]=value.split('-').map(Number),date=new Date(0);date.setUTCHours(12,0,0,0);date.setUTCFullYear(y,m-1,d);return date;}
  function rollingDates(end){const date=civilDate(end),days=[];for(let i=6;i>=0;i--){const day=new Date(date);day.setUTCDate(day.getUTCDate()-i);days.push(key(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()));}return days;}
  const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
  function weight(value){const text=String(value??'').trim();if(!/^\d+(?:[.,]\d+)?$/.test(text))return null;const parsed=Number(text.replace(',','.'));return Number.isFinite(parsed)&&parsed>0?parsed:null;}
  function sleep(value){
    const text=String(value??'').trim().toLowerCase().replace(/(ч|час|часа|часов|мин|минута|минуты|минут)\./g,'$1').replace(/\s+/g,' ');if(!text)return null;
    let minutes=null,match;
    if((match=text.match(/^(\d{1,2}):([0-5]\d)$/)))minutes=Number(match[1])*60+Number(match[2]);
    else if((match=text.match(/^(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часов)(?:\s*(\d+)\s*(?:мин|минута|минуты|минут))?$/))){if(match[2]&&Number(match[2])>=60)return null;minutes=Number(match[1].replace(',','.'))*60+Number(match[2]||0);}
    else if((match=text.match(/^(\d+(?:[.,]\d+)?)\s*(?:мин|минута|минуты|минут)$/)))minutes=Number(match[1].replace(',','.'));
    else if(/^\d+(?:[.,]\d+)?$/.test(text))minutes=Number(text.replace(',','.'))*60;
    return minutes!==null&&Number.isFinite(minutes)&&minutes>=0&&minutes<=1440?minutes:null;
  }
  function deficit(entry){
    if(!('base'in entry)&&!('exercise'in entry)&&!('meals'in entry))return null;
    const base=finite(entry.base??0),exercise=finite(entry.exercise??0),meals=entry.meals??[];
    if(base===null||exercise===null||!Array.isArray(meals))return null;
    let intake=0;for(const meal of meals){const kcal=finite(meal?.kcal??0);if(kcal===null)return null;intake+=kcal;}
    return base+exercise-intake;
  }
  function buildModel(entries,summaries,end){
    const dates=rollingDates(end),values=Object.fromEntries(METRICS.map(([id])=>[id,[]]));
    for(const day of dates){const entry=entries[day],training=entry?summaries[day]:null;
      values.distance.push(training?finite(training.distanceKm):null);values.duration.push(training?finite(training.movingSeconds):null);
      values.deficit.push(entry?deficit(entry):null);values.active.push(entry?finite(entry.exercise):null);values.weight.push(entry?weight(entry.weight):null);values.sleep.push(entry?sleep(entry.sleep):null);
    }
    const totals={};for(const [id]of METRICS){const available=values[id].filter(value=>value!==null),sum=available.reduce((a,b)=>a+b,0);totals[id]={count:available.length,value:available.length?(id==='weight'||id==='sleep'?sum/available.length:sum):null};}
    return {dates,values,totals};
  }
  function numeric(value,max=6){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:max}).format(value).replace(/[\u00a0\u202f]/g,' ').replace(/^-/,'−');}
  function sleepText(value){
    const minutes=Math.round(value),hours=Math.floor(minutes/60),rest=minutes%60,parts=[];
    if(hours)parts.push(hours+' ч');if(rest)parts.push(rest+' мин');return parts.join(' ')||'0 мин';
  }
  function format(id,value){
    if(value===null||!Number.isFinite(value))return 'Нет данных';
    if(id==='duration')return TrainingDashboard.formatDuration(Math.floor(value));
    if(id==='sleep')return sleepText(value);
    if(id==='deficit')return (value>0?'+':'')+numeric(value,0)+' ккал';
    if(id==='active')return numeric(value,0)+' ккал';
    if(id==='weight')return numeric(value,2)+' кг';
    return TrainingDashboard.formatNumber(value,1)+' км';
  }
  function create(container,options={}){
    const now=options.now||(()=>new Date());let entries={},summaries={},timer,day=localDateKey(now());
    container.innerHTML='<h3 class="weekly-total-title">Общее</h3><dl class="weekly-totals"></dl>';
    const cards=new Map();
    for(const [id,label]of METRICS){const box=document.createElement('div');box.dataset.metric=id;const dt=document.createElement('dt'),dd=document.createElement('dd'),coverage=document.createElement('p');dt.textContent=label;coverage.className='hint weekly-coverage';box.append(dt,dd,coverage);container.querySelector('.weekly-totals').append(box);cards.set(id,{dd,coverage});}
    function render(){
      const model=buildModel(entries,summaries,localDateKey(now()));container.dataset.windowStart=model.dates[0];container.dataset.windowEnd=model.dates[6];
      for(const [id,card]of cards){const total=model.totals[id];card.dd.textContent=total.value===null?'—':format(id,total.value);card.coverage.textContent=total.count?'Данные за '+total.count+' из 7 дней':'Нет данных';card.dd.dataset.value=total.value===null?'':String(total.value);card.coverage.dataset.count=String(total.count);}
    }
    function watch(){const next=localDateKey(now());if(next!==day){day=next;render();options.onDayChange?.();}clearTimeout(timer);const date=now(),midnight=new Date(date);midnight.setHours(24,0,0,50);timer=setTimeout(watch,Math.max(50,midnight-date));}
    root.addEventListener('focus',watch);const visible=()=>{if(!document.hidden)watch();};document.addEventListener('visibilitychange',visible);render();watch();
    return {update(nextEntries,nextSummaries){entries=nextEntries;summaries=nextSummaries;render();},destroy(){clearTimeout(timer);root.removeEventListener('focus',watch);document.removeEventListener('visibilitychange',visible);}};
  }
  root.WeeklyAnalytics={METRICS,localDateKey,rollingDates,parseWeight:weight,parseSleep:sleep,deficit,buildModel,format,create};
})(globalThis);
