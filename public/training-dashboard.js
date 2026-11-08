(function(root){
  'use strict';
  const numberFormats=new Map();
  function number(value,digits=0){
    if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
    if(!numberFormats.has(digits))numberFormats.set(digits,new Intl.NumberFormat('ru-RU',{minimumFractionDigits:digits,maximumFractionDigits:digits}));
    return numberFormats.get(digits).format(Number(value)).replace(/[\u00a0\u202f]/g,' ');
  }
  function duration(seconds){
    if(seconds===null||seconds===undefined||!Number.isFinite(Number(seconds)))return '—';
    const value=Math.max(0,Math.floor(Number(seconds)||0)),hours=Math.floor(value/3600),minutes=Math.floor(value/60)%60;
    return (hours?hours+':':'')+String(minutes).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  }
  const metric=(value,unit,digits=0)=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':number(value,digits)+' '+unit;
  const validReading=(value,index)=>typeof value==='number'&&Number.isFinite(value)&&(index===2?value>0:value>=0);
  function niceStep(value){
    const magnitude=10**Math.floor(Math.log10(value)),fraction=value/magnitude;
    return (fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*magnitude;
  }
  function scaleFor(samples,index){
    let min=Infinity,max=-Infinity,count=0;
    for(const row of samples){const value=row[index];if(!validReading(value,index))continue;min=Math.min(min,value);max=Math.max(max,value);count++;}
    if(!count)return {min:0,max:1,step:1,ticks:[],hasData:false};
    const unit=index===1?0.1:1,range=max-min;
    const low=index===2?Math.max(0,min-Math.max(2,range*0.1)):0;
    const high=max+Math.max(unit,index===2?range*0.04:max*0.03);
    const step=Math.max(unit,niceStep(Math.max(unit,(high-low)/4)));
    const quantum=Math.max(unit,niceStep(step/5));
    const lower=index===2?Math.floor(low/quantum)*quantum:0;
    let upper=Math.ceil(high/quantum)*quantum;
    // Avoid a coarse tick boundary adding a large empty band above a small peak.
    if(upper>max+Math.max(unit,(max-lower)*0.1))upper=Math.ceil(high/unit)*unit;
    upper=Math.max(lower+unit,upper);
    const clean=value=>Number(value.toFixed(8)),ticks=[];
    for(let tick=Math.ceil(lower/step)*step;tick<=upper+unit*1e-6;tick+=step)ticks.push(clean(tick));
    if(!ticks.length||upper-ticks.at(-1)>=step*0.55)ticks.push(clean(upper));
    return {min:clean(lower),max:clean(upper),step:clean(step),ticks,hasData:true};
  }
  const series=[['Скорость','км/ч','#426b8e'],['Пульс','уд/мин','#ad6b72'],['Мощность','Вт','#8a78a5'],['Каденс','об/мин','#5e8d85']];
  const mounted=new Set();
  function dispose(){for(const cleanup of mounted)cleanup();mounted.clear();}
  function mount(container,data){
    const previous=container._fitCleanup;if(previous)previous();
    container.replaceChildren();
    if(!data){const p=document.createElement('p');p.className='muted';p.textContent='Файл тренировки пока не добавлен.';container.append(p);return}
    if(data.version!==2){const p=document.createElement('p');p.className='muted';p.textContent='Данные времени движения для этой записи ещё не добавлены.';container.append(p);return;}
    const summary=data.summary;
    const metrics=[['Дистанция',metric(summary.distanceKm,'км',1)],['Время движения',duration(summary.movingSeconds)],['Средняя скорость',metric(summary.avgSpeedKmh,'км/ч',1)],['Максимальная скорость',metric(summary.maxSpeedKmh,'км/ч',1)],['Средний пульс',metric(summary.avgHeartRate,'уд/мин')],['Максимальный пульс',metric(summary.maxHeartRate,'уд/мин')],['Средняя мощность',metric(summary.avgPower,'Вт')],['Максимальная мощность',metric(summary.maxPower,'Вт')]];
    const grid=document.createElement('dl');grid.className='fit-metrics';
    for(const [label,value] of metrics){const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;cell.append(dt,dd);grid.append(cell)}
    const hint=document.createElement('p');hint.className='hint';hint.textContent=(data.timing.source==='recording-gaps'?'Паузы восстановлены по разрывам записи и сверены с таймером устройства.':data.timing.source==='speed-samples'?'Таймер отсутствует: время движения рассчитано по последовательным измерениям положительной скорости.':'Время движения определено по таймеру устройства. Паузы исключены.')+' Средние учитывают длительность измерений в движении; пропуски не заполняются. Наведите курсор или проведите по графику.';
    const time=document.createElement('p');time.className='fit-time';time.textContent='Время движения: —';time.setAttribute('aria-live','off');
    container.append(grid,hint,time);
    const charts=[],durationSeconds=Math.max(1,summary.movingSeconds),durationText=duration(summary.movingSeconds),samples=data.samples;
    let hover=null;
    function renderChart(chart){
      const {canvas,index}=chart,rect=canvas.getBoundingClientRect(),width=Math.max(180,Math.round(rect.width)),height=140,dpr=Math.min(devicePixelRatio||1,2);
      canvas.width=width*dpr;canvas.height=height*dpr;
      const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
      const left=44,right=width-10,top=9,bottom=112;
      chart.left=left;chart.width=right-left;chart.canvasWidth=width;
      const scale=chart.scale,span=scale.max-scale.min;
      ctx.font='11px system-ui';ctx.textBaseline='middle';
      for(const tick of scale.ticks){const y=bottom-(tick-scale.min)/span*(bottom-top);ctx.strokeStyle='#e5ebf1';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#7b8b99';ctx.fillText(number(tick,index===1?1:0),2,y)}
      ctx.strokeStyle=series[index-1][2];ctx.lineWidth=1.2;ctx.beginPath();
      let drawing=false,lastTime=-Infinity,lastPixel=-1,lastSegment=-1;
      // Retain the extrema within each pixel column; render work is bounded by canvas width.
      let bucket=[];
      const flush=()=>{if(!bucket.length)return;const chosen=[...new Set([bucket[0],bucket.reduce((a,b)=>a[index]<b[index]?a:b),bucket.reduce((a,b)=>a[index]>b[index]?a:b),bucket.at(-1)])].sort((a,b)=>a[0]-b[0]);for(const row of chosen){const x=left+row[0]/durationSeconds*(right-left),y=bottom-(row[index]-scale.min)/span*(bottom-top);if(!drawing||row[0]-lastTime>15){ctx.moveTo(x,y);drawing=true}else ctx.lineTo(x,y);lastTime=row[0]}bucket=[];};
      for(const row of samples){if(row[5]!==lastSegment){flush();drawing=false;lastPixel=-1;lastSegment=row[5]}if(!validReading(row[index],index)){flush();drawing=false;lastPixel=-1;continue}const pixel=Math.floor(row[0]/durationSeconds*(right-left));if(pixel!==lastPixel||row[0]-lastTime>15&&bucket.length&&row[0]-bucket.at(-1)[0]>15){flush();lastPixel=pixel}bucket.push(row)}flush();ctx.stroke();
      ctx.fillStyle='#7b8b99';ctx.textBaseline='alphabetic';ctx.fillText('00:00',left,134);const label=durationText;ctx.fillText(label,Math.max(left,right-ctx.measureText(label).width),134);
      if(!scale.hasData){ctx.fillStyle='#7b8b99';ctx.fillText('Нет данных датчика',left+12,58)}
      chart.background.width=canvas.width;chart.background.height=canvas.height;chart.background.getContext('2d').drawImage(canvas,0,0);
      drawCursor(chart);
    }
    function drawCursor(chart){
      const {canvas,index}=chart,ctx=canvas.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(chart.background,0,0);ctx.scale(dpr,dpr);
      const left=chart.left,right=left+chart.width,top=9,bottom=112;
      if(hover){const x=left+hover[0]/durationSeconds*(right-left);ctx.strokeStyle='#304a60';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);chart.value.textContent=metric(validReading(hover[index],index)?hover[index]:null,series[index-1][1],index===1?1:0);chart.value.dataset.time=String(hover[0]);chart.value.dataset.value=hover[index]===null?'':String(hover[index]);canvas.dataset.cursorTime=String(hover[0]);}
    }
    function setTime(seconds){hover=FitModel.sampleAt(samples,Math.max(0,Math.min(summary.movingSeconds,seconds)));time.textContent='Время движения: '+duration(hover[0]);for(const chart of charts)drawCursor(chart)}
    for(let index=1;index<=4;index++){
      const box=document.createElement('div');box.className='fit-chart';const heading=document.createElement('div');heading.className='fit-chart-heading';const label=document.createElement('span'),value=document.createElement('strong');label.textContent=series[index-1][0]+' ('+series[index-1][1]+')';value.className='fit-hover-value';value.textContent='—';heading.append(label,value);
      const canvas=document.createElement('canvas');canvas.className='fit-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label',label.textContent+'. Стрелки влево и вправо: выбрать время измерения.');
      const scale=scaleFor(samples,index);canvas.dataset.yMin=String(scale.min);canvas.dataset.yMax=String(scale.max);canvas.dataset.yTicks=JSON.stringify(scale.ticks);
      const chart={canvas,index,value,scale,background:document.createElement('canvas')};charts.push(chart);box.append(heading,canvas);container.append(box);
      const point=event=>{const rect=canvas.getBoundingClientRect();setTime((event.clientX-rect.left-chart.left)/chart.width*durationSeconds)};
      canvas.addEventListener('pointermove',point);canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);point(event)});
      canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();if(!samples.length)return;if(!hover){setTime(samples[0][0]);return}let lo=0,hi=samples.length;const right=event.key==='ArrowRight';while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid][0]<hover[0]||(right&&samples[mid][0]===hover[0]))lo=mid+1;else hi=mid}const next=right?Math.min(lo,samples.length-1):Math.max(0,lo-1);setTime(samples[next][0])});
    }
    let queued=0;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(queued);queued=requestAnimationFrame(()=>charts.forEach(renderChart))});
    charts.forEach(chart=>observer.observe(chart.canvas));
    container._fitCleanup=()=>{observer.disconnect();cancelAnimationFrame(queued);mounted.delete(container._fitCleanup)};mounted.add(container._fitCleanup);
    charts.forEach(renderChart);
  }
  root.TrainingDashboard={mount,dispose,formatNumber:number,formatDuration:duration,scaleFor};
})(globalThis);
