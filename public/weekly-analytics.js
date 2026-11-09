/* Rolling calendar-day analytics. Only the selected metric preference uses localStorage. */
(function(root){
  'use strict';
  const METRICS=[['distance','Дистанция','км','Дистанция'],['duration','Время тренировок','ч:мм:сс','Время тренировок'],['deficit','Дефицит','ккал','Суммарный дефицит'],['active','Активные ккал','ккал','Активные ккал'],['weight','Вес','кг','Средний вес'],['sleep','Сон','ч / мин','Средний сон']];
  const KEY='nutrition-analytics-metric-v1';
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
  function sleepText(value,precise=false){
    const seconds=precise?Math.round(value*60*1e6)/1e6:Math.round(value)*60,hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60,parts=[];
    if(hours)parts.push(hours+' ч');if(minutes)parts.push(minutes+' мин');if(precise&&rest)parts.push(numeric(rest)+' с');return parts.join(' ')||'0 мин';
  }
  function format(id,value,precise=false){
    if(value===null||!Number.isFinite(value))return 'Нет данных';
    if(id==='duration'){const whole=Math.floor(value),fraction=value-whole;return TrainingDashboard.formatDuration(whole)+(precise&&fraction?numeric(fraction).replace(/^0/, ''):'');}
    if(id==='sleep')return sleepText(value,precise);
    if(id==='deficit')return (value>0?'+':'')+numeric(value,precise?6:0)+' ккал';
    if(id==='active')return numeric(value,precise?6:0)+' ккал';
    if(id==='weight')return numeric(value,precise?10:2)+' кг';
    return (precise?numeric(value,6):TrainingDashboard.formatNumber(value,1))+' км';
  }
  function scale(values,id){
    const list=values.filter(value=>value!==null);if(!list.length)return {min:0,max:1,ticks:[],step:1};
    let lower=Math.min(...list),upper=Math.max(...list);const unit=id==='distance'||id==='weight'?0.1:1;
    if(id==='weight'){const pad=Math.max(0.2,(upper-lower)*0.15);lower=Math.max(0,lower-pad);upper+=pad;}
    else{lower=Math.min(0,lower);upper=Math.max(0,upper);const pad=Math.max(unit,(upper-lower)*0.04);if(lower<0)lower-=pad;if(upper>0)upper+=pad;}
    const span=Math.max(unit,upper-lower),power=10**Math.floor(Math.log10(span/4)),ratio=span/4/power;
    let step=Math.max(unit,(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power);
    if(id==='duration'||id==='sleep'){const units=id==='sleep'?60:1;const candidates=[1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,10800,21600,43200,86400,172800,432000];step=candidates.map(v=>v/units).find(v=>v>=span/4&&v>=unit)||step;}
    const quantum=Math.max(unit,step/5);lower=Math.floor(lower/quantum)*quantum;upper=Math.ceil(upper/quantum)*quantum;if(upper<=lower)upper=lower+step;
    const ticks=[];for(let v=Math.ceil(lower/step)*step;v<=upper+unit*1e-6;v+=step)ticks.push(Number(v.toFixed(8)));if(!ticks.length||upper-ticks.at(-1)>step*0.6)ticks.push(Number(upper.toFixed(8)));
    return {min:lower,max:upper,ticks,step};
  }
  function create(container,options={}){
    const now=options.now||(()=>new Date()),storage=()=>options.storage===undefined?root.localStorage:options.storage;let selected='distance',entries={},summaries={},state={},model,hover=null,timer,raf=0,day=localDateKey(now());
    try{const saved=storage()?.getItem(KEY);if(METRICS.some(([id])=>id===saved))selected=saved;}catch{}
    container.innerHTML='<div class="weekly-heading"><h2>Последние 7 дней</h2><p class="hint weekly-period"></p></div><div class="weekly-selector" role="group" aria-label="Показатель графика"></div><p class="hint weekly-notice" role="status"></p><div class="weekly-chart-title"></div><p class="weekly-tooltip" aria-live="polite"></p><canvas class="weekly-canvas" tabindex="0" aria-label="График за семь дней. Стрелки влево и вправо выбирают дату."></canvas><ol class="weekly-accessible sr-only"></ol><h3 class="weekly-total-title">Общее</h3><dl class="weekly-totals"></dl>';
    const find=selector=>container.querySelector(selector),canvas=find('canvas'),background=document.createElement('canvas'),buttons=new Map(),cards=new Map();let geometry;
    for(const [id,label]of METRICS){const button=document.createElement('button');button.type='button';button.className='weekly-option';button.textContent=label;button.dataset.metric=id;button.onclick=()=>{selected=id;hover=null;try{storage()?.setItem(KEY,id);}catch{}render();};find('.weekly-selector').append(button);buttons.set(id,button);}
    for(const [id,,,label]of METRICS){const box=document.createElement('div');box.dataset.metric=id;const dt=document.createElement('dt'),dd=document.createElement('dd'),coverage=document.createElement('p');dt.textContent=label;coverage.className='hint weekly-coverage';box.append(dt,dd,coverage);find('.weekly-totals').append(box);cards.set(id,{dd,coverage});}
    function redraw(){
      if(!model)return;const rect=canvas.getBoundingClientRect(),width=Math.max(180,Math.round(rect.width)),height=212,dpr=Math.min(devicePixelRatio||1,2),left=56,right=width-14,top=14,bottom=169;
      canvas.width=width*dpr;canvas.height=height*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.font='11px system-ui';const values=model.values[selected],axis=scale(values,selected),span=axis.max-axis.min;
      geometry={left,right,top,bottom,width,height,dpr};canvas.dataset.values=JSON.stringify(values);canvas.dataset.yMin=String(axis.min);canvas.dataset.yMax=String(axis.max);
      const tickText=value=>selected==='duration'?TrainingDashboard.formatDuration(value):selected==='sleep'?sleepText(value):numeric(value,selected==='distance'||selected==='weight'?Math.max(1,Math.ceil(-Math.log10(axis.step))):0);
      ctx.textBaseline='middle';for(const tick of axis.ticks){const y=bottom-(tick-axis.min)/span*(bottom-top);ctx.strokeStyle=tick===0?'#b9c8d4':'#e5ebf1';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#7b8b99';ctx.fillText(tickText(tick),3,y);}
      ctx.strokeStyle='#426b8e';ctx.lineWidth=1.5;ctx.beginPath();let drawing=false;const points=[];
      values.forEach((value,i)=>{if(value===null){drawing=false;return}const x=left+(right-left)*i/6,y=bottom-(value-axis.min)/span*(bottom-top);points.push([x,y,value]);if(drawing)ctx.lineTo(x,y);else{ctx.moveTo(x,y);drawing=true;}});ctx.stroke();
      for(const [x,y,value]of points){ctx.beginPath();ctx.fillStyle=value<0?'#ad6b72':'#426b8e';ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();}
      if(!points.length){ctx.fillStyle='#7b8b99';ctx.textAlign='center';ctx.fillText('Нет данных за этот период',(left+right)/2,85);}
      ctx.fillStyle='#7b8b99';ctx.textAlign='center';ctx.font='10px system-ui';model.dates.forEach((date,i)=>ctx.fillText(date.slice(8)+'.'+date.slice(5,7),left+(right-left)*i/6,194));
      background.width=canvas.width;background.height=canvas.height;background.getContext('2d').drawImage(canvas,0,0);cursor();
    }
    function cursor(){
      if(!geometry)return;const {width,height,dpr,left,right,top,bottom}=geometry,ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(background,0,0);ctx.scale(dpr,dpr);
      const tooltip=find('.weekly-tooltip');if(hover===null){tooltip.textContent='Наведите курсор на дату или коснитесь графика.';delete container.dataset.hoverDate;return;}
      const x=left+(right-left)*hover/6;ctx.strokeStyle='#304a60';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
      const date=model.dates[hover],value=model.values[selected][hover];tooltip.textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(civilDate(date))+' · '+format(selected,value,true);container.dataset.hoverDate=date;container.dataset.hoverValue=value===null?'':String(value);
    }
    function render(){
      model=buildModel(entries,summaries,localDateKey(now()));container.dataset.windowStart=model.dates[0];container.dataset.windowEnd=model.dates[6];container.dataset.metric=selected;
      find('.weekly-period').textContent=model.dates.map(civilDate).filter((_,i)=>i===0||i===6).map(date=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date)).join(' — ');
      for(const [id,button]of buttons){button.classList.toggle('is-active',id===selected);button.setAttribute('aria-pressed',String(id===selected));}
      const descriptor=METRICS.find(([id])=>id===selected);find('.weekly-chart-title').textContent=descriptor[1]+' · '+descriptor[2];
      find('.weekly-notice').textContent=state.loading?'Загрузка сводки тренировок…':state.error?'Сводка тренировок недоступна. Дистанция и время показаны как отсутствующие; обновите страницу для повторной загрузки.':selected==='deficit'?'+ означает дефицит, − означает профицит. Пропущенные дни не считаются нулями.':selected==='duration'?'Учтено только время движения из FIT. Пропущенные дни не считаются нулями.':'Пропущенные дни не считаются нулями.';
      for(const [id,card]of cards){const total=model.totals[id];card.dd.textContent=total.value===null?'—':format(id,total.value);card.coverage.textContent=total.count?'Данные за '+total.count+' из 7 дней':'Нет данных';card.dd.dataset.value=total.value===null?'':String(total.value);card.coverage.dataset.count=String(total.count);}
      find('.weekly-accessible').replaceChildren(...model.dates.map((date,i)=>{const li=document.createElement('li');li.textContent=date+': '+format(selected,model.values[selected][i],true);return li;}));redraw();
    }
    const point=event=>{if(!geometry)return;const rect=canvas.getBoundingClientRect();hover=Math.max(0,Math.min(6,Math.round((event.clientX-rect.left-geometry.left)/(geometry.right-geometry.left)*6)));cursor();};
    canvas.addEventListener('pointermove',point);canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);point(event)});canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();hover=hover===null?0:Math.max(0,Math.min(6,hover+(event.key==='ArrowLeft'?-1:1)));cursor();});
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(redraw);});observer.observe(canvas);
    function watch(){const next=localDateKey(now());if(next!==day){day=next;hover=null;render();options.onDayChange?.();}clearTimeout(timer);const date=now(),midnight=new Date(date);midnight.setHours(24,0,0,50);timer=setTimeout(watch,Math.max(50,midnight-date));}
    root.addEventListener('focus',watch);const visible=()=>{if(!document.hidden)watch();};document.addEventListener('visibilitychange',visible);render();watch();
    return {update(nextEntries,nextSummaries,nextState={}){entries=nextEntries;summaries=nextSummaries;state=nextState;render();},destroy(){observer.disconnect();clearTimeout(timer);cancelAnimationFrame(raf);root.removeEventListener('focus',watch);document.removeEventListener('visibilitychange',visible);}};
  }
  root.WeeklyAnalytics={METRICS,localDateKey,rollingDates,parseWeight:weight,parseSleep:sleep,deficit,buildModel,format,scale,create};
})(globalThis);
