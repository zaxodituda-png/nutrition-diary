// In-memory API: tests analytics/privacy/local-date behavior without database writes.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 async function setup(timezone,time,blocked=false){
  const context=await browser.newContext({timezoneId:timezone,hasTouch:true});const page=await context.newPage();await page.clock.install({time:new Date(time)});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(blocked)await page.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw Error('Storage disabled')}});
  let admin=false,full=0,summaryRequests=0,hold=false,release=null;
  const publicEntries={'2026-11-07':{base:2000,exercise:500,meals:[{group:'Утро',name:'Еда',kcal:1800}],weight:'76',sleep:'7 ч 15 мин',note:''},'2026-11-09':{base:2000,exercise:0,meals:[{group:'Утро',name:'Еда',kcal:2500}],weight:'75,5',sleep:'8 ч',note:''},'2026-11-10':{base:2000,exercise:100,meals:[{group:'Утро',name:'Еда',kcal:1900}],weight:'75',sleep:'7 ч',note:''}};
  const privateEntry={base:1,exercise:9999,meals:[],weight:'10',sleep:'1 ч',note:'PRIVATE'};
  const summaries=()=>({'2026-11-07':{distanceKm:55.61568,movingSeconds:5510},...(admin?{'2026-11-08':{distanceKm:999,movingSeconds:120}}:{})});
  await page.route('**/api/index.php?**',route=>{const url=new URL(route.request().url()),action=url.searchParams.get('action');let data;
   if(action==='session')data={admin,csrf:'csrf'};
   else if(action==='login'){admin=true;data={admin:true,csrf:'csrf'}}
   else if(action==='logout'){admin=false;data={admin:false,csrf:'csrf'}}
   else if(action==='entries'){const entries={...publicEntries,...(admin?{'2026-11-08':privateEntry}:{})};data={entries,revisions:admin?Object.fromEntries(Object.keys(entries).map(day=>[day,1])):{},published:{'2026-11-07':true,'2026-11-09':true,'2026-11-10':true},trainingDates:{'2026-11-07':true,...(admin?{'2026-11-08':true}:{})}};}
   else if(action==='training-summaries'){
    summaryRequests++;data={end:url.searchParams.get('end'),trainingSummaries:summaries()};
    if(admin&&hold){hold=false;return new Promise(resolve=>{release=async()=>{await route.fulfill({json:data});resolve()}});}
   }else if(action==='training'){full++;data={training:{format:'diary-fit',version:2,startTime:1893499200,summary:{distanceKm:55.61568,movingSeconds:5510,avgSpeedKmh:36.3,maxSpeedKmh:53,avgHeartRate:152,maxHeartRate:184,avgPower:202,maxPower:720},samples:[[0,0,130,0,0,0],[5510,10,140,100,90,0]],timing:{source:'session-timer',timerSeconds:5510}}};}
   else throw Error('Unexpected API '+action);
   return route.fulfill({json:data});
  });
  await page.goto(process.env.DIARY_TEST_URL||'http://127.0.0.1:8780');await page.waitForFunction(()=>Boolean(document.getElementById('weeklyAnalytics').dataset.windowEnd));
  return {page,context,errors,full:()=>full,summaries:()=>summaryRequests,defer(){hold=true},async release(){assert.ok(release);await release()}};
 }
 const t=await setup('Pacific/Kiritimati','2026-11-08T12:30:00Z'),page=t.page;
 const total=id=>page.locator('.weekly-totals [data-metric="'+id+'"] dd');const count=id=>page.locator('.weekly-totals [data-metric="'+id+'"] .weekly-coverage');
 assert.equal(await page.locator('.day.active').innerText(),'9');assert.equal(await page.locator('#weeklyAnalytics').getAttribute('data-window-start'),'2026-11-03');assert.equal(await page.locator('#weeklyAnalytics').getAttribute('data-window-end'),'2026-11-09');assert.ok(await page.locator('.calendar').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('weeklyAnalytics'))&Node.DOCUMENT_POSITION_FOLLOWING)));assert.ok(await page.locator('#weeklyAnalytics').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('report'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 await page.waitForFunction(()=>document.querySelector('.weekly-totals [data-metric="distance"] dd').dataset.value==='55.61568');
 assert.equal(await total('distance').innerText(),'55,6 км');assert.equal(await total('duration').innerText(),'1:31:50');assert.equal(await total('deficit').innerText(),'+200 ккал');assert.equal(await total('active').innerText(),'500 ккал');assert.equal(await total('weight').innerText(),'75,75 кг');assert.equal(await total('sleep').innerText(),'7 ч 38 мин');assert.equal(await count('weight').getAttribute('data-count'),'2');assert.equal(t.full(),0);
 assert.equal(await page.locator('#weeklyAnalytics h3').innerText(),'Общее');
 assert.deepEqual(await page.locator('.weekly-totals dt').allTextContents(),['Дистанция','Время тренировок','Суммарный дефицит','Активные ккал','Средний вес','Средний сон']);
 assert.equal(await page.locator('#weeklyAnalytics canvas, #weeklyAnalytics button, #weeklyAnalytics h2, .weekly-tooltip, .weekly-selector, .weekly-chart-title, .weekly-period, .weekly-notice, .weekly-accessible').count(),0);
 assert.equal(await page.locator('.weekly-totals').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),3);
 assert.equal(await page.evaluate(()=>localStorage.getItem('nutrition-analytics-metric-v1')),null);
 const requests=t.summaries();await page.locator('.day').filter({hasText:/^7$/}).click();assert.equal(await page.locator('#weeklyAnalytics').getAttribute('data-window-end'),'2026-11-09');assert.equal(t.summaries(),requests);await page.waitForSelector('.ride .fit-canvas');assert.equal(t.full(),1);assert.equal(await total('deficit').innerText(),'+200 ккал');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.weekly-totals [data-metric="distance"] dd').dataset.value==='55.61568');assert.equal(await page.locator('.day.active').innerText(),'9');assert.equal(t.full(),1);
 await page.locator('#loginBtn').click();await page.locator('#usernameInput').fill('test-admin');await page.locator('#passwordInput').fill('test-password-only');await page.locator('#loginForm button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('.weekly-totals [data-metric="active"] dd').dataset.value==='10499');
 t.defer();const pending=page.waitForRequest(r=>r.url().includes('action=training-summaries'));await page.evaluate(()=>{refreshWeekly()});await pending;
 await page.locator('#logoutBtn').click();await page.waitForFunction(()=>document.querySelector('.weekly-totals [data-metric="active"] dd').dataset.value==='500');await t.release();assert.equal(await total('active').innerText(),'500 ккал');assert.equal(await count('weight').getAttribute('data-count'),'2');assert.ok(!(await page.locator('#weeklyAnalytics').innerText()).includes('10499'));
 await page.locator('.day').filter({hasText:/^7$/}).click();const until=await page.evaluate(()=>{const now=new Date(),midnight=new Date(now);midnight.setHours(24,0,0,100);return midnight-now});await page.clock.fastForward(until);await page.waitForFunction(()=>document.getElementById('weeklyAnalytics').dataset.windowEnd==='2026-11-10');await page.waitForFunction(()=>document.querySelector('.weekly-totals [data-metric="active"] dd').dataset.value==='600');assert.equal(await page.locator('.day.active').innerText(),'7');assert.equal(await total('deficit').innerText(),'+400 ккал');
 await page.setViewportSize({width:375,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.weekly-totals').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);assert.deepEqual(t.errors,[]);await t.context.close();
 const west=await setup('America/Los_Angeles','2027-01-01T00:30:00Z');assert.equal(await west.page.locator('.day.active').innerText(),'31');assert.ok((await west.page.locator('#monthLabel').innerText()).includes('2026'));assert.equal(await west.page.locator('#weeklyAnalytics').getAttribute('data-window-start'),'2026-12-25');assert.equal(await west.page.locator('#weeklyAnalytics').getAttribute('data-window-end'),'2026-12-31');assert.equal(await west.page.locator('.weekly-totals [data-metric="weight"] dd').innerText(),'—');assert.equal(await west.page.locator('#weeklyAnalytics').isVisible(),true);assert.deepEqual(west.errors,[]);await west.context.close();
 const early=await setup('Europe/Moscow','2026-11-01T10:00:00Z',true);assert.equal(await early.page.locator('.day.active').innerText(),'7');assert.equal(await early.page.locator('#weeklyAnalytics').getAttribute('data-window-end'),'2026-11-01');assert.equal(await early.page.locator('#weeklyAnalytics').getAttribute('data-window-start'),'2026-10-26');assert.equal(await early.page.locator('.day:disabled').count(),6);assert.equal(await early.page.locator('.weekly-totals [data-metric="weight"] dd').innerText(),'—');assert.deepEqual(early.errors,[]);await early.context.close();
 await browser.close();console.log('PASS weekly browser: summary only, six unchanged metrics/formatting/coverage, no graph/selector/storage, signed deficit, no bulk FIT downloads, local timezone/date/year boundaries, midnight rollover independent of selection, admin/public isolation including late replies, blocked storage and mobile layout.');
})().catch(error=>{console.error(error);process.exit(1)});
