const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');vm.runInThisContext(fs.readFileSync(path.join(root,'public/vendor/fit-parser.js'),'utf8'));vm.runInThisContext(fs.readFileSync(path.join(root,'public/fit-model.js'),'utf8'));
(async()=>{
 const fixtures=require('./fixtures/synthetic-fit.json');const read=async text=>{const b=Buffer.from(text,'base64');return FitDecoder.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};
 const data=FitModel.normalize(await read(fixtures.sensors));
 assert.deepEqual(data.summary,{distanceKm:0.6,elapsedSeconds:60,avgSpeedKmh:72,maxSpeedKmh:90,avgHeartRate:155,maxHeartRate:170,avgPower:220,maxPower:500});
 assert.deepEqual(data.samples.map(row=>row[0]),[0,1,3,7,60]);assert.equal(data.samples[0][3],0);assert.equal(data.samples[0][4],0);assert.equal(data.samples[1][2],null);assert.equal(data.samples[2][3],null);assert.equal(data.samples[3][4],null);assert.equal(data.samples[0][1],36);
 assert.deepEqual(FitModel.sampleAt(data.samples,3),data.samples[2]);assert.deepEqual(FitModel.sampleAt(data.samples,30),[30,null,null,null,null]);
 const missing=FitModel.normalize(await read(fixtures.missing));assert.equal(missing.summary.avgPower,null);assert.equal(missing.summary.avgHeartRate,null);assert.ok(missing.samples.every(row=>row.slice(2).every(v=>v===null)));
 const zeroHr=await read(fixtures.missing);zeroHr.sessions[0].avg_heart_rate=0;zeroHr.sessions[0].max_heart_rate=0;assert.equal(FitModel.normalize(zeroHr).summary.avgHeartRate,null);const unsupported=await read(fixtures.sensors);unsupported.file_ids[0].type='course';assert.throws(()=>FitModel.normalize(unsupported));
 const parsed=await read(fixtures.sensors);delete parsed.sessions[0].total_elapsed_time;delete parsed.sessions[0].total_distance;delete parsed.sessions[0].avg_speed;delete parsed.sessions[0].avg_power;const fallback=FitModel.normalize(parsed);assert.equal(fallback.summary.elapsedSeconds,60);assert.equal(fallback.summary.distanceKm,0.6);assert.equal(fallback.summary.avgSpeedKmh,43.2);assert.equal(fallback.summary.avgPower,152);
 const bytes=Buffer.from(fixtures.sensors,'base64');await assert.rejects(()=>FitDecoder.decode(bytes.subarray(0,-10).buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length-10)));const broken=Uint8Array.from(bytes);broken[20]^=1;await assert.rejects(()=>FitDecoder.decode(broken.buffer));await assert.rejects(()=>FitDecoder.decode(new ArrayBuffer(20)));
 assert.ok(!JSON.stringify(data).match(/position|latitude|longitude|serial|device/i));
 console.log('PASS FIT: strict CRC/truncation validation, session summaries and sample fallbacks, metric conversions, missing sensors, zero readings, irregular timestamps and gaps, shared timestamp lookup, sanitized model.');
})().catch(e=>{console.error(e);process.exit(1)});
