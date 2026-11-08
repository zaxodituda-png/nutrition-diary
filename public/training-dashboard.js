(function(root){
  'use strict';
  const number=(value,digits=1)=>value===null||value===undefined?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:digits});
  const series=[['Скорость','км/ч','#426b8e'],['Пульс','уд/мин','#ad6b72'],['Мощность','Вт','#8a78a5'],['Каденс','об/мин','#5e8d85']];
  const mounted=new Set();
  function dispose(){for(const cleanup of mounted)cleanup();mounted.clear();}
  function mount(container,data){
    const previous=container._fitCleanup;if(previous)previous();
    container.replaceChildren();
    if(!data){const p=document.createElement('p');p.className='muted';p.textContent='FIT-файл тренировки пока не добавлен.';container.append(p);return}
    const summary=data.summary;
    const metrics=[['Дистанция',number(summary.distanceKm,2)+' км'],['Время (прошедшее)',FitModel.clock(summary.elapsedSeconds)],['Средняя скорость',number(summary.avgSpeedKmh)+' км/ч'],['Максимальная скорость',number(summary.maxSpeedKmh)+' км/ч'],['Средний пульс',number(summary.avgHeartRate,0)+' уд/мин'],['Максимальный пульс',number(summary.maxHeartRate,0)+' уд/мин'],['Средняя мощность',number(summary.avgPower,0)+' Вт'],['Максимальная мощность',number(summary.maxPower,0)+' Вт']];
    const grid=document.createElement('dl');grid.className='fit-metrics';
    for(const [label,value] of metrics){const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;cell.append(dt,dd);grid.append(cell)}
    const hint=document.createElement('p');hint.className='hint';hint.textContent='Прошедшее время включает остановки. Итоги берутся из FIT-сессии; при отсутствии — из доступных записей. Наведите курсор или проведите по графику. Пропуски не заполняются.';
    const time=document.createElement('p');time.className='fit-time';time.textContent='Время тренировки: —';time.setAttribute('aria-live','off');
    container.append(grid,hint,time);
    const charts=[],duration=Math.max(1,summary.elapsedSeconds),samples=data.samples;
    let hover=null;
    function renderChart(chart){
      const {canvas,index}=chart,rect=canvas.getBoundingClientRect(),width=Math.max(180,Math.round(rect.width)),height=140,dpr=Math.min(devicePixelRatio||1,2);
      canvas.width=width*dpr;canvas.height=height*dpr;
      const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
      const left=44,right=width-10,top=9,bottom=112;
      chart.left=left;chart.width=right-left;chart.canvasWidth=width;
      const values=samples.map(row=>row[index]).filter(value=>value!==null),max=values.length?values.reduce((a,b)=>Math.max(a,b),0):0,ceiling=Math.max(1,max*1.08);
      ctx.font='11px system-ui';ctx.textBaseline='middle';
      for(let i=0;i<3;i++){const y=top+(bottom-top)*i/2;ctx.strokeStyle='#e5ebf1';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#7b8b99';ctx.fillText(number(ceiling*(1-i/2),0),2,y)}
      ctx.strokeStyle=series[index-1][2];ctx.lineWidth=1.2;ctx.beginPath();
      let drawing=false,lastTime=-Infinity,lastPixel=-1;
      // Retain the extrema within each pixel column; render work is bounded by canvas width.
      let bucket=[];
      const flush=()=>{if(!bucket.length)return;const chosen=[bucket[0],bucket.reduce((a,b)=>a[index]<b[index]?a:b),bucket.reduce((a,b)=>a[index]>b[index]?a:b),bucket.at(-1)].sort((a,b)=>a[0]-b[0]);for(const row of chosen){const x=left+row[0]/duration*(right-left),y=bottom-row[index]/ceiling*(bottom-top);if(!drawing||row[0]-lastTime>15){ctx.moveTo(x,y);drawing=true}else ctx.lineTo(x,y);lastTime=row[0]}bucket=[];};
      for(const row of samples){if(row[index]===null){flush();drawing=false;lastPixel=-1;continue}const pixel=Math.floor(row[0]/duration*(right-left));if(pixel!==lastPixel||row[0]-lastTime>15&&bucket.length&&row[0]-bucket.at(-1)[0]>15){flush();lastPixel=pixel}bucket.push(row)}flush();ctx.stroke();
      ctx.fillStyle='#7b8b99';ctx.textBaseline='alphabetic';ctx.fillText('00:00:00',left,134);const label=FitModel.clock(duration);ctx.fillText(label,Math.max(left,right-ctx.measureText(label).width),134);
      if(!values.length){ctx.fillStyle='#7b8b99';ctx.fillText('Нет данных датчика',left+12,58)}
      chart.background.width=canvas.width;chart.background.height=canvas.height;chart.background.getContext('2d').drawImage(canvas,0,0);
      drawCursor(chart);
    }
    function drawCursor(chart){
      const {canvas,index}=chart,ctx=canvas.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(chart.background,0,0);ctx.scale(dpr,dpr);
      const left=chart.left,right=left+chart.width,top=9,bottom=112;
      if(hover){const x=left+hover[0]/duration*(right-left);ctx.strokeStyle='#304a60';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);chart.value.textContent=number(hover[index],index===1?1:0)+' '+series[index-1][1];chart.value.dataset.time=String(hover[0]);chart.value.dataset.value=hover[index]===null?'':String(hover[index]);canvas.dataset.cursorTime=String(hover[0]);}
    }
    function setTime(seconds){hover=FitModel.sampleAt(samples,Math.max(0,Math.min(duration,seconds)));time.textContent='Время тренировки: '+FitModel.clock(hover[0]);for(const chart of charts)drawCursor(chart)}
    for(let index=1;index<=4;index++){
      const box=document.createElement('div');box.className='fit-chart';const heading=document.createElement('div');heading.className='fit-chart-heading';const label=document.createElement('span'),value=document.createElement('strong');label.textContent=series[index-1][0]+' ('+series[index-1][1]+')';value.className='fit-hover-value';value.textContent='—';heading.append(label,value);
      const canvas=document.createElement('canvas');canvas.className='fit-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label',label.textContent+'. Стрелки влево и вправо: выбрать время измерения.');
      const chart={canvas,index,value,background:document.createElement('canvas')};charts.push(chart);box.append(heading,canvas);container.append(box);
      const point=event=>{const rect=canvas.getBoundingClientRect();setTime((event.clientX-rect.left-chart.left)/chart.width*duration)};
      canvas.addEventListener('pointermove',point);canvas.addEventListener('pointerdown',event=>{canvas.setPointerCapture(event.pointerId);point(event)});
      canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const current=hover?samples.findIndex(row=>row[0]>=hover[0]):0;const next=Math.max(0,Math.min(samples.length-1,current+(event.key==='ArrowLeft'?-1:1)));setTime(samples[next][0])});
    }
    let queued=0;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(queued);queued=requestAnimationFrame(()=>charts.forEach(renderChart))});
    charts.forEach(chart=>observer.observe(chart.canvas));
    container._fitCleanup=()=>{observer.disconnect();cancelAnimationFrame(queued);mounted.delete(container._fitCleanup)};mounted.add(container._fitCleanup);
    charts.forEach(renderChart);
  }
  root.TrainingDashboard={mount,dispose};
})(globalThis);
