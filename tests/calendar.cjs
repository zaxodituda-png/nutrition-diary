// Run after tests/api.py on its disposable DB, with a fresh auth_limits budget.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://connect.garmin.com/**',r=>r.abort());
 await page.goto(process.env.DIARY_TEST_URL||'http://127.0.0.1:8780');await page.waitForSelector('.report');
 const day=n=>page.locator('.day').filter({hasText:new RegExp(`^${n}$`)});
 const selected=()=>page.locator('.day.active').innerText();
 const navigate=async(id,count)=>{for(let i=0;i<count;i++)await page.locator('#'+id).click()};
 assert.equal(await selected(),'7');assert.equal(await page.locator('.day:disabled').count(),6);
 for(let n=1;n<=6;n++)assert.equal(await day(n).isDisabled(),true);
 assert.equal(await day(7).isEnabled(),true);assert.equal(await day(30).isEnabled(),true);
 assert.equal(await day(7).evaluate(e=>e.classList.contains('has-entry')),true);
 assert.equal(await day(8).evaluate(e=>e.classList.contains('has-entry')),false);
 assert.equal(await day(10).evaluate(e=>e.classList.contains('has-entry')),false); // Draft hidden from visitors.
 await day(6).evaluate(e=>{e.click();e.dispatchEvent(new MouseEvent('click',{bubbles:true}))});assert.equal(await selected(),'7');
 await day(7).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'next');
 await day(7).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'8');
 const report=await page.locator('#report').innerText();
 await navigate('prev',1);assert.equal(await page.locator('.day:disabled').count(),31);assert.equal(await page.locator('.day.active').count(),0);
 await day(31).evaluate(e=>e.click());assert.equal(await page.locator('#report').innerText(),report);
 await navigate('prev',10);assert.ok((await page.locator('#monthLabel').innerText()).includes('2025'));assert.equal(await page.locator('.day:enabled').count(),0); // December 2025.
 await navigate('prev',1);assert.ok((await page.locator('#monthLabel').innerText()).includes('ноябрь'));assert.equal(await page.locator('.day:disabled').count(),30);
 await navigate('next',12);assert.equal(await page.locator('.day:disabled').count(),6);
 await navigate('next',1);assert.equal(await page.locator('.day:disabled').count(),0);assert.equal(await page.locator('.day').count(),31); // December 2026.
 await navigate('next',1);assert.ok((await page.locator('#monthLabel').innerText()).includes('2027'));assert.equal(await page.locator('.day:disabled').count(),0);
 await day(1).click();assert.equal(await selected(),'1');await navigate('prev',1);assert.ok((await page.locator('#monthLabel').innerText()).includes('2026'));await day(31).click();assert.equal(await selected(),'31');
 await navigate('prev',1);await day(7).click();assert.equal(await selected(),'7');
 await page.locator('#loginBtn').click();await page.locator('#usernameInput').fill('owner');await page.locator('#passwordInput').fill(process.env.DIARY_TEST_PASSWORD);await page.locator('#loginForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('loginDialog').open);
 assert.equal(await day(10).evaluate(e=>e.classList.contains('has-entry')),false); // Admin sees draft but no published dot.
 await day(10).click();assert.equal(await selected(),'10');assert.equal(await day(10).evaluate(e=>getComputedStyle(e,'::after').content),'none');
 await page.locator('#editBtn').click();assert.equal(await page.locator('#dateInput').getAttribute('min'),'2026-11-07');
 await page.locator('#dateInput').fill('2026-11-06');assert.equal(await page.locator('#dateInput').evaluate(e=>e.validity.rangeUnderflow),true);
 let saves=0;const onRequest=r=>{if(r.url().includes('action=save'))saves++};page.on('request',onRequest);
 await page.locator('#entryForm').evaluate(e=>e.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:e.querySelector('button[type=submit]')})));
 assert.equal(saves,0);assert.ok((await page.locator('#appStatus').innerText()).includes('7 ноября 2026'));assert.equal(await page.locator('#editor').evaluate(e=>e.open),true);
 await page.locator('#dateInput').fill('2026-11-10');await page.locator('#publishedInput').check();await page.locator('#entryForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('editor').open);
 assert.equal(await day(10).evaluate(e=>e.classList.contains('has-entry')),true);assert.equal(await day(10).evaluate(e=>getComputedStyle(e,'::after').backgroundColor),'rgb(255, 255, 255)');
 await day(8).click();assert.equal(await day(8).evaluate(e=>e.classList.contains('active')),true);assert.equal(await day(8).evaluate(e=>e.classList.contains('has-entry')),false);assert.equal(await day(10).evaluate(e=>e.classList.contains('active')),false);assert.equal(await day(10).evaluate(e=>getComputedStyle(e,'::after').width),'4px');
 await page.setViewportSize({width:375,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS calendar: November 1–6 disabled, 7+ enabled; previous months/years; December/January rollover; disabled click and Tab behavior; published-only dots, drafts, selected vs entry states; editor min and programmatic-submit guard; mobile layout.');
})().catch(e=>{console.error(e);process.exit(1)});
