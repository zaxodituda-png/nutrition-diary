const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../public/training-dashboard.js'),'utf8'));
const {formatNumber:number,formatDuration:time,scaleFor}=TrainingDashboard;
assert.equal(number(55.61568,1),'55,6');assert.equal(number(36.3348,1),'36,3');assert.equal(number(53.0424,1),'53,0');assert.equal(number(1250,0),'1 250');assert.equal(number(218.4,0),'218');assert.equal(number(92.6,0),'93');assert.equal(number(0,1),'0,0');assert.equal(number(null),'—');assert.equal(number(NaN),'—');assert.equal(number(Infinity),'—');
assert.equal(time(5944),'1:39:04');assert.equal(time(59),'00:59');assert.equal(time(60),'01:00');assert.equal(time(0),'00:00');assert.equal(time(null),'—');
const rows=[[0,0,125,0,0],[1,36.3348,145,218.2,92],[2,53.0424,175,720,107]];
const before=JSON.stringify(rows);const scales=[1,2,3,4].map(index=>scaleFor(rows,index));
assert.equal(scales[0].min,0);assert.equal(scales[2].min,0);assert.equal(scales[3].min,0);assert.ok(scales[1].min>=110&&scales[1].min<=120);assert.ok(scales[1].max>=175&&scales[1].max<=185);
for(const [index,peak] of [[0,53.0424],[1,175],[2,720],[3,107]]){assert.ok(scales[index].max>=peak);assert.ok(scales[index].max<=peak*1.1+1);assert.ok(scales[index].ticks.length>=2&&scales[index].ticks.length<=7);assert.ok(scales[index].ticks.every((v,i,a)=>v>=scales[index].min&&v<=scales[index].max&&(i===0||v>a[i-1])));}
assert.ok(scales[2].max<1000);assert.ok(scales[1].max<200);
for(const index of [1,2,3,4]){
 const missing=scaleFor([[0,null,null,null,null],[1,NaN,Infinity,-5,undefined]],index);assert.equal(missing.hasData,false);assert.deepEqual(missing.ticks,[]);
 const flat=scaleFor([[0,0,152,0,0],[1,0,152,0,0]],index);assert.equal(flat.hasData,true);assert.ok(flat.max>flat.min);assert.ok(flat.ticks.length>=2);if(index===2)assert.ok(flat.min>140);
}
const spike=scaleFor([[0,5,130,100,75],[1,6,140,2400,80],[2,7,135,110,85]],3);assert.ok(spike.max>=2400);assert.ok(spike.max<=2640); // Real spikes are retained, never clipped or winsorized.
for(let i=0;i<100;i++)assert.deepEqual(scaleFor(rows,2),scales[1]);assert.equal(JSON.stringify(rows),before);
console.log('PASS presentation: fixed Russian decimal precision, grouping, integer sensors/calories, duration, independent data-based axes, HR lower bound, small peak padding, readable ticks, missing/constant/invalid data, real spikes retained, immutable input.');
