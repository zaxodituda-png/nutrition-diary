/* Privacy-preserving moving-time model. Raw timestamps/locations are not persisted. */
(function(root){
  'use strict';
  const finite=(value,max=Infinity)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;
  const seconds=value=>value instanceof Date&&Number.isFinite(value.getTime())?value.getTime()/1000:null;
  const round=value=>value===null?null:Math.round(value*1000000)/1000000;
  const length=ranges=>ranges.reduce((sum,[a,b])=>sum+b-a,0);
  function eventRanges(events,start,end){
    let opened=null,lastStop=null,valid=true,sawStart=false;const ranges=[];
    const timer=(events||[]).filter(row=>row.event==='timer'&&seconds(row.timestamp)!==null).sort((a,b)=>seconds(a.timestamp)-seconds(b.timestamp));
    for(const event of timer){
      const time=seconds(event.timestamp);if(time<start-0.5||time>end+0.5){valid=false;continue}
      if(event.event_type==='start'){
        if(opened!==null){if(time!==opened)valid=false;continue}
        opened=time;sawStart=true;
      }else if(['stop','stop_all','stop_disable','stop_disable_all'].includes(event.event_type)){
        if(opened===null){if(time!==lastStop&&!(time===start&&!sawStart))valid=false;lastStop=time;continue}
        if(time>opened)ranges.push([opened,time]);opened=null;lastStop=time;
      }
    }
    return valid&&sawStart&&opened===null&&ranges.length?ranges:null;
  }
  function fromGaps(records,start,end,target){
    const differences=[];
    for(let i=1;i<records.length;i++){const dt=seconds(records[i].timestamp)-seconds(records[i-1].timestamp);if(dt>0)differences.push(dt)}
    if(!differences.length)return null;
    const ordered=[...differences].sort((a,b)=>a-b),nominal=ordered[Math.floor(ordered.length/2)];
    const gaps=[];
    for(let i=1;i<records.length;i++){
      const a=seconds(records[i-1].timestamp),b=seconds(records[i].timestamp);
      if(b-a>Math.max(15,nominal*5))gaps.push([a,b]);
    }
    if(!gaps.length||gaps.length>64)return null;
    // Bounded subset search: reconcile whole recording gaps (or gap minus one normal tick).
    // Never stretch all timestamps or invent a pause inside continuously recorded data.
    const wanted=Math.round((end-start-target)*1000);let states=new Map([[0,{plan:[],ambiguous:false}]]);
    for(const [a,b] of gaps){
      const next=new Map(states);
      for(const [sum,state] of states){for(const left of [a,a+nominal]){
        const size=Math.round((b-left)*1000),total=sum+size;
        if(size<=0||total>wanted)continue;
        const plan=[...state.plan,[left,b]],old=next.get(total);
        next.set(total,old?{plan:old.plan,ambiguous:true}:{plan,ambiguous:state.ambiguous});
      }}
      states=next;if(states.size>4096)return null;
    }
    const solution=states.get(wanted);if(!solution||solution.ambiguous)return null;const pauses=solution.plan;
    const ranges=[];let cursor=start;
    for(const [a,b] of pauses){if(a>cursor)ranges.push([cursor,a]);cursor=b}
    if(cursor<end)ranges.push([cursor,end]);
    return Math.abs(length(ranges)-target)<0.001?ranges:null;
  }
  function speedRanges(records){
    const ranges=[];
    for(let i=1;i<records.length;i++){
      const a=records[i-1],b=records[i],left=seconds(a.timestamp),right=seconds(b.timestamp),dt=right-left;
      const av=finite(a.enhanced_speed??a.speed,500/3.6),bv=finite(b.enhanced_speed??b.speed,500/3.6);
      // No arbitrary minimum speed: any measured positive speed includes slow climbing.
      if(dt>0&&dt<=15&&av!==null&&bv!==null&&av>0&&bv>0){
        if(ranges.length&&ranges.at(-1)[1]===left)ranges.at(-1)[1]=right;else ranges.push([left,right]);
      }
    }
    return ranges;
  }
  function normalize(parsed){
    if(parsed.file_ids?.[0]?.type&&parsed.file_ids[0].type!=='activity')throw Error('Выберите файл активности, а не курс или план тренировки.');
    const sessions=parsed.sessions||[];if(sessions.length>1)throw Error('Файлы с несколькими сессиями пока не поддерживаются.');
    const session=sessions[0]||{};if(session.sport&&session.sport!=='cycling')throw Error('Выберите файл велотренировки.');
    const records=(parsed.records||[]).filter(row=>seconds(row.timestamp)!==null).sort((a,b)=>seconds(a.timestamp)-seconds(b.timestamp));
    if(!records.length||records.length>100000)throw Error('Нужны временные измерения: от 1 до 100 000 записей.');
    const first=seconds(records[0].timestamp),start=Math.min(seconds(session.start_time)??first,first);
    const end=Math.max(seconds(records.at(-1).timestamp),seconds(session.timestamp)??start,start+(finite(session.total_elapsed_time,604800)??0));
    if(end-start>604800)throw Error('Длительность записи должна быть не более 7 суток.');
    const declared=finite(session.total_timer_time,604800);
    if(declared!==null&&declared>end-start+0.5)throw Error('Время таймера противоречит временным меткам файла.');
    let ranges=eventRanges(parsed.events,start,end),source='timer-events';
    if(declared===0){ranges=[];source='session-timer'}
    else if(ranges&&declared!==null&&Math.abs(length(ranges)-declared)>0.5)ranges=null;
    if(ranges)ranges=ranges.map(([a,b])=>[a,b,b]);
    if(ranges&&declared!==null){
      // FIT event timestamps have one-second resolution; reconcile subsecond timer totals at the tail only.
      const correction=declared-length(ranges);if(ranges.length){ranges.at(-1)[1]+=correction;if(ranges.at(-1)[1]<ranges.at(-1)[0])ranges=null;}
    }
    if(!ranges){
      if(declared!==null){
        if(Math.abs(end-start-declared)<0.001){ranges=[[start,end]];source='session-timer'}
        else{ranges=fromGaps(records,start,end,declared);source='recording-gaps'}
        if(!ranges)throw Error('Время таймера есть, но паузы нельзя надёжно сопоставить с записями. Время движения не рассчитано.');
      }else{ranges=speedRanges(records);source='speed-samples';if(!ranges.length)throw Error('Нет надёжных данных для времени движения: нужен таймер или последовательные измерения скорости.');}
    }
    const merged=[];for(const range of ranges){if(merged.length&&merged.at(-1)[1]===range[0]){merged.at(-1)[1]=range[1];if(range.length>2)merged.at(-1)[2]=range[2]}else merged.push([...range])}ranges=merged;
    const moving=declared??length(ranges),bySegment=new Map(),segmentEnds=[];let accumulated=0,position=0;
    for(let segment=0;segment<ranges.length;segment++){
      const [a,b,eventStop=b]=ranges[segment];while(position<records.length&&seconds(records[position].timestamp)<a)position++;
      for(let i=position;i<records.length&&seconds(records[i].timestamp)<=b;i++){
        if(source==='timer-events'&&seconds(records[i].timestamp)>=eventStop)continue;
        const record=records[i],timestamp=seconds(record.timestamp),speed=finite(record.enhanced_speed??record.speed,500/3.6),hr=finite(record.heart_rate,300);
        // Endpoint records are retained for each side of a pause; segment IDs prevent a connecting spike.
        const row=[round(accumulated+timestamp-a),round(speed===null?null:speed*3.6),hr===0?null:hr,finite(record.power,10000),finite(record.cadence,500),segment];
        const key=segment+':'+timestamp,old=bySegment.get(key);if(old)for(let index=1;index<5;index++)if(row[index]===null)row[index]=old[index];bySegment.set(key,row);
      }
      accumulated+=b-a;segmentEnds[segment]=accumulated;
    }
    const samples=[...bySegment.values()];
    if(moving>0&&!samples.length)throw Error('В файле нет измерений во время движения.');
    const maximum=index=>{let result=null;for(const row of samples)if(row[index]!==null)result=result===null?row[index]:Math.max(result,row[index]);return result};
    const average=index=>{
      let area=0,weight=0;
      for(let i=0;i<samples.length;i++){
        const a=samples[i],next=samples[i+1];
        const right=next&&next[5]===a[5]?next[0]:segmentEnds[a[5]],dt=right-a[0];
        if(dt<=0||dt>15||a[index]===null)continue;
        // Each measured value supports the following interval, never a pause or long gap.
        area+=a[index]*dt;weight+=dt;
      }
      return weight?area/weight:null;
    };
    const distances=records.map(row=>finite(row.distance,100000000)).filter(value=>value!==null);
    const distance=finite(session.total_distance,100000000)??(distances.length?distances.reduce((a,b)=>Math.max(a,b),0):null);
    const summary={distanceKm:distance===null?null:distance/1000,movingSeconds:moving,
      avgSpeedKmh:source!=='speed-samples'&&moving>0&&distance!==null?distance/moving*3.6:average(1),maxSpeedKmh:maximum(1),
      avgHeartRate:average(2),maxHeartRate:maximum(2),avgPower:average(3),maxPower:maximum(3)};
    for(const key of Object.keys(summary))summary[key]=round(summary[key]);
    return {format:'diary-fit',version:2,startTime:start,summary,samples,timing:{source,timerSeconds:declared}};
  }
  function sampleAt(samples,time){
    if(!samples.length)return [Math.round(time),null,null,null,null];
    // Upper-bound search selects the resumed segment if two pause-edge records share moving time.
    let lo=0,hi=samples.length;while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid][0]<=time)lo=mid+1;else hi=mid}
    const left=samples[Math.max(0,lo-1)],right=samples[Math.min(lo,samples.length-1)];
    const row=Math.abs(left[0]-time)<=Math.abs(right[0]-time)?left:right;
    return Math.abs(row[0]-time)<=5?row:[Math.round(time),null,null,null,null];
  }
  function clock(seconds){const value=Math.max(0,Math.floor(seconds||0));return [Math.floor(value/3600),Math.floor(value/60)%60,value%60].map(v=>String(v).padStart(2,'0')).join(':')}
  root.FitModel={normalize,sampleAt,clock};
})(globalThis);
