/* Privacy-preserving model shared by worker, dashboard and tests. No location fields. */
(function(root){
  'use strict';
  const finite=(value,max=Infinity)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;
  const seconds=value=>value instanceof Date&&Number.isFinite(value.getTime())?Math.floor(value.getTime()/1000):null;
  const round=value=>value===null?null:Math.round(value*1000000)/1000000;
  function normalize(parsed){
    if(parsed.file_ids?.[0]?.type&&parsed.file_ids[0].type!=='activity')throw Error('Выберите FIT-файл активности, а не курс или план тренировки.');
    const sessions=parsed.sessions||[];
    if(sessions.length>1)throw Error('Файлы с несколькими сессиями пока не поддерживаются.');
    const session=sessions[0]||{};
    if(session.sport&&session.sport!=='cycling')throw Error('Выберите FIT-файл велотренировки.');
    const records=(parsed.records||[]).filter(row=>seconds(row.timestamp)!==null);
    if(!records.length||records.length>100000)throw Error('Нужны временные измерения: от 1 до 100000 записей.');
    records.sort((a,b)=>seconds(a.timestamp)-seconds(b.timestamp));
    const first=seconds(records[0].timestamp),start=Math.min(seconds(session.start_time)??first,first);
    const byTime=new Map();
    for(const record of records){
      const t=seconds(record.timestamp)-start;
      if(t<0||t>604800)throw Error('Длительность тренировки должна быть не более 7 суток.');
      const speed=finite(record.enhanced_speed??record.speed,500/3.6);
      const hr=finite(record.heart_rate,300);
      const sample=[t,round(speed===null?null:speed*3.6),hr===0?null:hr,finite(record.power,10000),finite(record.cadence,500)];
      // Duplicate messages can carry complementary sensors, but only at this exact timestamp.
      const old=byTime.get(t);
      if(old)for(let i=1;i<5;i++)if(sample[i]===null)sample[i]=old[i];
      byTime.set(t,sample);
    }
    const samples=[...byTime.values()];
    const values=index=>samples.map(row=>row[index]).filter(v=>v!==null);
    const mean=index=>{const list=values(index);return list.length?list.reduce((a,b)=>a+b,0)/list.length:null};
    const max=index=>{const list=values(index);return list.length?list.reduce((a,b)=>Math.max(a,b),0):null};
    const summaryValue=(field,fallback,limit)=>finite(session[field],limit)??fallback;
    const heartSummary=(field,fallback)=>{const value=finite(session[field],300);return value>0?value:fallback};
    const speedSummary=(enhanced,standard,fallback)=>{const value=finite(session[enhanced]??session[standard],500/3.6);return value===null?fallback:value*3.6};
    const distances=records.map(row=>finite(row.distance,100000000)).filter(v=>v!==null);
    const distance=finite(session.total_distance,100000000)??(distances.length?distances.reduce((a,b)=>Math.max(a,b),0):null);
    const summary={
      distanceKm:distance===null?null:distance/1000,
      elapsedSeconds:Math.max(finite(session.total_elapsed_time,604800)??0,samples.at(-1)[0]),
      avgSpeedKmh:speedSummary('enhanced_avg_speed','avg_speed',mean(1)),
      maxSpeedKmh:speedSummary('enhanced_max_speed','max_speed',max(1)),
      avgHeartRate:heartSummary('avg_heart_rate',mean(2)),maxHeartRate:heartSummary('max_heart_rate',max(2)),
      avgPower:summaryValue('avg_power',mean(3),10000),maxPower:summaryValue('max_power',max(3),10000)
    };
    for(const key of Object.keys(summary))summary[key]=round(summary[key]);
    return {format:'diary-fit',version:1,startTime:start,summary,samples};
  }
  // One lookup, one row, one shared timestamp: never independently match each sensor.
  function sampleAt(samples,time){
    let lo=0,hi=samples.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid][0]<time)lo=mid+1;else hi=mid}
    const left=samples[Math.max(0,lo-1)],right=samples[Math.min(lo,samples.length-1)];
    const row=Math.abs(left[0]-time)<=Math.abs(right[0]-time)?left:right;
    return Math.abs(row[0]-time)<=5?row:[Math.round(time),null,null,null,null];
  }
  function clock(seconds){const value=Math.max(0,Math.floor(seconds||0));return [Math.floor(value/3600),Math.floor(value/60)%60,value%60].map(v=>String(v).padStart(2,'0')).join(':')}
  root.FitModel={normalize,sampleAt,clock};
})(globalThis);
