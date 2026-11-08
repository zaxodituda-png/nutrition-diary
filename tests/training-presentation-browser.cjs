// Presentation-only integration: in-memory synthetic API, no database writes or raw FIT files.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1000,height:1000},hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){(this.canvas._testText??=[]).push(String(text));return original.call(this,text,...args)}});
 const samples=Array.from({length:5945},(_,t)=>[t,30+20*Math.sin(t/500),125+50*t/5944,200+150*Math.sin(t/300),90+10*Math.sin(t/200)]);
 samples[0]=[0,0,125,0,0];samples[1000]=[1000,36.3348,145.3,218.2,92.4];samples[3000]=[3000,53.0424,160,720,107];
 const training={format:'diary-fit',version:1,startTime:1893499200,summary:{distanceKm:55.61568,elapsedSeconds:5944,avgSpeedKmh:36.3348,maxSpeedKmh:53.0424,avgHeartRate:145.3,maxHeartRate:175,avgPower:218.2,maxPower:720},samples};
 const original=JSON.stringify(training);const entry={weight:'75',sleep:'8 ч',base:2000,exercise:1250,meals:[],note:''};let admin=false,saves=0;
 await page.route('**/api/index.php?**',route=>{const action=new URL(route.request().url()).searchParams.get('action');let data;
  if(action==='session')data={admin,csrf:'test-csrf'};
  else if(action==='login'){admin=true;data={admin:true,csrf:'admin-csrf'}}
  else if(action==='entries')data={entries:{'2026-11-07':entry},revisions:admin?{'2026-11-07':1}:{},published:admin?{'2026-11-07':true}:{},trainingDates:{'2026-11-07':true}};
  else if(action==='training')data={training};
  else if(action==='save'){saves++;throw Error('This presentation test must not save')}
  else throw Error('Unexpected endpoint '+action);
  return route.fulfill({json:data});
 });
 await page.goto(process.env.DIARY_TEST_URL||'http://127.0.0.1:8780');await page.waitForSelector('.ride .fit-canvas');
 assert.deepEqual(await page.locator('.ride .fit-metrics dt').allTextContents(),['Дистанция','Время тренировки','Средняя скорость','Максимальная скорость','Средний пульс','Максимальный пульс','Средняя мощность','Максимальная мощность']);
 assert.deepEqual(await page.locator('.ride .fit-metrics dd').allTextContents(),['55,6 км','1:39:04','36,3 км/ч','53,0 км/ч','145 уд/мин','175 уд/мин','218 Вт','720 Вт']);
 assert.ok((await page.locator('.ride').innerText()).includes('Активные калории (по оценке): 1 250 ккал'));assert.ok(!/[a-z]/i.test(await page.locator('.ride').innerText()));
 const axes=()=>page.locator('.ride .fit-canvas').evaluateAll(nodes=>nodes.map(node=>({min:Number(node.dataset.yMin),max:Number(node.dataset.yMax),ticks:JSON.parse(node.dataset.yTicks)})));
 const baseline=await axes();assert.deepEqual(baseline.map(v=>v.min),[0,120,0,0]);assert.ok(baseline[0].max<60);assert.ok(baseline[1].max<=185);assert.ok(baseline[2].max<800);assert.ok(baseline[3].max<120);
 assert.equal(await page.locator('.ride .fit-canvas').evaluateAll(nodes=>nodes.every((canvas,i)=>JSON.parse(canvas.dataset.yTicks).every(tick=>canvas._testText.includes(TrainingDashboard.formatNumber(tick,i===0?1:0))))),true);
 for(const seconds of [1000,3000,0,5944]){
  for(let graph=0;graph<4;graph++){
   const canvas=page.locator('.ride .fit-canvas').nth(graph);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+44+(Math.round(box.width)-54)*seconds/5944,box.y+45);
   await page.waitForFunction(t=>[...document.querySelectorAll('.ride .fit-hover-value')].every(node=>Number(node.dataset.time)===t),seconds);
   assert.deepEqual(await axes(),baseline);
   assert.deepEqual(await page.locator('.ride .fit-hover-value').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.value))),samples[seconds].slice(1));
   if(seconds===1000)assert.deepEqual(await page.locator('.ride .fit-hover-value').allTextContents(),['36,3 км/ч','145 уд/мин','218 Вт','92 об/мин']);
  }
 }
 if(process.env.TRAINING_PRESENTATION_SCREENSHOT)await page.locator('.ride').screenshot({path:process.env.TRAINING_PRESENTATION_SCREENSHOT});
 await page.setViewportSize({width:375,height:850});await page.locator('.ride .fit-canvas').last().scrollIntoViewIfNeeded();const box=await page.locator('.ride .fit-canvas').last().boundingBox();await page.touchscreen.tap(box.x+44+(Math.round(box.width)-54)*1000/5944,box.y+45);await page.waitForFunction(()=>[...document.querySelectorAll('.ride .fit-hover-value')].every(node=>node.dataset.time==='1000'));assert.deepEqual(await axes(),baseline);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#loginBtn').click();await page.locator('#usernameInput').fill('test-admin');await page.locator('#passwordInput').fill('test-password-only');await page.locator('#loginForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('loginDialog').open);
 await page.locator('#editBtn').click();await page.waitForFunction(()=>!document.querySelector('#entryForm button[type=submit]').disabled);
 assert.equal(await page.locator('#fitFileInput').isVisible(),false);assert.equal(await page.locator('#chooseFitBtn').innerText(),'Выбрать файл');assert.equal(await page.locator('#fitFileName').innerText(),'Файл не выбран');assert.ok(!/[a-z]/i.test((await page.locator('.fit-editor').innerText()).replaceAll('.fit','')));
 const chooser=page.waitForEvent('filechooser');await page.locator('#chooseFitBtn').click();await(await chooser).setFiles({name:'English-filename.fit',mimeType:'application/octet-stream',buffer:Buffer.from('short')});await page.waitForFunction(()=>document.getElementById('fitStatus').textContent.startsWith('Выберите файл'));assert.equal(await page.locator('#fitFileName').innerText(),'Файл выбран');assert.ok(!(await page.locator('.fit-editor').innerText()).includes('English-filename'));
 await page.evaluate(()=>{window._originalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=()=>Promise.reject(Error('The file could not be read'))});await page.locator('#fitFileInput').setInputFiles({name:'second.fit',mimeType:'application/octet-stream',buffer:Buffer.alloc(20)});await page.waitForFunction(()=>document.getElementById('fitStatus').textContent.startsWith('Не удалось обработать файл тренировки'));await page.evaluate(()=>{File.prototype.arrayBuffer=window._originalArrayBuffer});
 assert.equal(await page.evaluate(async()=>JSON.stringify(await loadTraining('2026-11-07'))),original);assert.equal(JSON.stringify(training),original);assert.equal(saves,0);assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS presentation browser: full-activity independent/stable axes; correct HR bounds and peak padding; actual Russian canvas ticks, summary/readout formatting, shared hover/touch, mobile width, Russian upload/errors, no filename exposure or data mutation.');
})().catch(e=>{console.error(e);process.exit(1)});
