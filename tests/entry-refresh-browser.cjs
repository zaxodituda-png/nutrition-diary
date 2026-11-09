// Acknowledged writes followed by failed refreshes, using an in-memory API only.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({timezoneId:'UTC'});await page.clock.install({time:new Date('2026-11-07T12:00:00Z')});
 let admin=false,revision=1,deleted=false,failRefresh=false,commits=0,attempts=0,deletes=0;
 let entry={weight:'75',sleep:'8 ч',base:2000,exercise:500,meals:[],note:'Initial'};
 const other={weight:'77',sleep:'7 ч',base:2000,exercise:0,meals:[],note:'Other date'};const originalOther=JSON.stringify(other);
 await page.route('**/api/index.php?**',route=>{const action=new URL(route.request().url()).searchParams.get('action');let data,status=200;
  if(action==='session')data={admin,csrf:'token'};
  else if(action==='login'){admin=true;data={admin:true,csrf:'token'}}
  else if(action==='entries'){
   if(failRefresh){failRefresh=false;return route.fulfill({status:503,json:{error:'Не удалось обновить записи.'}})}
   data={entries:{...(!deleted?{'2026-11-07':entry}:{}),'2026-11-08':other},revisions:admin?{...(!deleted?{'2026-11-07':revision}:{}),'2026-11-08':1}:{},published:{'2026-11-07':true,'2026-11-08':true},trainingDates:{}};
  }else if(action==='training-summaries')data={trainingSummaries:{}};
  else if(action==='save'){
   attempts++;const payload=route.request().postDataJSON();assert.equal(payload.date,'2026-11-07');
   if((deleted&&payload.revision!==null)||(!deleted&&payload.revision!==revision)){status=409;data={error:'Запись изменилась или была удалена. Обновите страницу; ваши несохранённые поля оставлены в редакторе.'}}
   else{entry=payload.entry;deleted=false;revision++;commits++;failRefresh=commits===1;data={ok:true};assert.equal(payload.training,null);}
  }else if(action==='delete'){const payload=route.request().postDataJSON();assert.equal(payload.date,'2026-11-07');assert.equal(payload.revision,revision);deleted=true;revision++;deletes++;failRefresh=true;data={ok:true}}
  else throw Error('Unexpected API '+action);
  return route.fulfill({status,json:data});
 });
 await page.goto(process.env.DIARY_TEST_URL||'http://127.0.0.1:8780');await page.waitForSelector('.report');await page.locator('#loginBtn').click();await page.locator('#usernameInput').fill('test-admin');await page.locator('#passwordInput').fill('test-password-only');await page.locator('#loginForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('loginDialog').open);
 await page.locator('#editBtn').click();await page.waitForFunction(()=>document.getElementById('editor').open&&!document.querySelector('#entryForm button[type=submit]').disabled);await page.locator('#noteInput').fill('Acknowledged');await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('appStatus').classList.contains('status-error'));
 if(process.env.EXPECT_OLD_REFRESH_BUG==='1'){
  assert.equal(await page.locator('#editor').evaluate(e=>e.open),true);await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('appStatus').textContent.includes('изменилась'));assert.equal(attempts,2);assert.equal(commits,1);await browser.close();console.log('REPRODUCED: acknowledged save + failed GET leaves stale editor; retry produces 409.');return;
 }
 assert.equal(await page.locator('#editor').evaluate(e=>e.open),false);assert.ok((await page.locator('#appStatus').innerText()).includes('сохранена'));
 await page.locator('#editBtn').click();await page.waitForFunction(()=>document.getElementById('editor').open&&!document.querySelector('#entryForm button[type=submit]').disabled);assert.equal(await page.locator('#noteInput').inputValue(),'Acknowledged');await page.locator('#noteInput').fill('Fresh revision');await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('editor').open);assert.equal(revision,3);
 await page.locator('#editBtn').click();await page.waitForFunction(()=>document.getElementById('editor').open&&!document.querySelector('#entryForm button[type=submit]').disabled);await page.locator('#dateInput').fill('2026-11-08');await page.locator('#deleteBtn').click();assert.equal(deletes,0);assert.ok((await page.locator('#appStatus').innerText()).includes('Дата в редакторе'));await page.locator('#dateInput').fill('2026-11-07');page.once('dialog',d=>d.accept());await page.locator('#deleteBtn').click();await page.waitForFunction(()=>!document.getElementById('editor').open);assert.equal(deletes,1);
 await page.locator('#editBtn').click();await page.waitForFunction(()=>document.getElementById('editor').open&&!document.querySelector('#entryForm button[type=submit]').disabled);assert.equal(await page.locator('#noteInput').inputValue(),'');await page.locator('#noteInput').fill('Recreated');await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('editor').open);assert.equal(revision,5);
 await page.locator('#editBtn').click();await page.waitForFunction(()=>document.getElementById('editor').open&&!document.querySelector('#entryForm button[type=submit]').disabled);revision++;await page.locator('#noteInput').fill('Unsaved conflicting edit');await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('appStatus').textContent.includes('изменилась'));assert.equal(await page.locator('#editor').evaluate(e=>e.open),true);assert.equal(await page.locator('#noteInput').inputValue(),'Unsaved conflicting edit');assert.equal(entry.note,'Recreated');assert.equal(JSON.stringify(other),originalOther);
 await browser.close();console.log('PASS mutation refresh: acknowledged save/delete survives GET failure, fresh revisions on reopen/recreate, wrong-date delete blocked, genuine conflict preserves form and other dates.');
})().catch(error=>{console.error(error);process.exit(1)});
