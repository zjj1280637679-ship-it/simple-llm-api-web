import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=resolve(new URL('..',import.meta.url).pathname),results=[];
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844}});let external=0;
await context.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external++;return route.abort();});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin);await page.waitForSelector('#draft');await page.locator('#draft').fill('手机刷新草稿');await page.waitForTimeout(450);await page.reload();await page.waitForSelector('#draft');assert.equal(await page.locator('#draft').inputValue(),'手机刷新草稿');results.push('real app mobile draft reload');
await page.locator('[data-action="plus"]').click();await page.locator('[data-action="new-card"][data-kind="api"]').click();await page.locator('[data-key="key"]').fill('synthetic-never-persist');await page.locator('[data-key="model"]').fill('synthetic-model');await page.waitForTimeout(400);await page.reload();await page.waitForSelector('[data-key="key"]');assert.equal(await page.locator('[data-key="key"]').inputValue(),'');assert.equal(await page.locator('[data-key="model"]').inputValue(),'synthetic-model');results.push('settings reload; key blank');
const storage=await page.evaluate(async()=>{const r=indexedDB.open('llm-workbench-local-v1:/',1);const db=await new Promise((s,j)=>{r.onsuccess=()=>s(r.result);r.onerror=j;});const t=db.transaction('snapshots'),q=t.objectStore('snapshots').get('workspace');return await new Promise(s=>{q.onsuccess=()=>s(JSON.stringify(q.result));});});assert.ok(!storage.includes('synthetic-never-persist'));assert.ok(!storage.includes('trustedTarget'));results.push('IDB has no key/trust');
await page.locator('[data-action="plus"]').click();await page.locator('[data-action="clear-chat"]').click();await page.reload();await page.waitForSelector('#draft');assert.equal(await page.locator('#draft').inputValue(),'');assert.equal(await page.locator('.message').count(),0);results.push('clear immediate reload');
const moduleResults=await page.evaluate(async()=>{
const {createLocalStore,snapshotWorkspace}=await import('/src/persistence.js');const report=[];
const make=()=>({api:{protocol:'gemini',url:'https://example.com',model:'test',key:''},model:{inputs:['text']},draft:'',attachments:[],messages:[],history:[],lastMetrics:null,lastUsage:null});const f={data:{chat:make(),image:make()},page:'chat',nextId:1};const value=snapshotWorkspace(f);
const aStates=[],bStates=[];const a=createLocalStore({name:'qa-conflict',onStatus:s=>aStates.push(s)}),b=createLocalStore({name:'qa-conflict',onStatus:s=>bStates.push(s)});
a.schedule(value,{immediate:true});await a.load();await b.load();f.data.chat.draft='first';await a.schedule(snapshotWorkspace(f),{immediate:true});f.data.chat.draft='second';await b.schedule(snapshotWorkspace(f),{immediate:true});if(!bStates.includes('conflict'))throw Error('no conflict');const reader=createLocalStore({name:'qa-conflict'});if((await reader.load()).workspaces.chat.draft!=='first')throw Error('overwritten');report.push('atomic two-tab revision conflict preserves winner; load-before-save');
const original=IDBDatabase.prototype.transaction;let fail=true;IDBDatabase.prototype.transaction=function(...args){const t=original.apply(this,args);if(args[1]==='readwrite'&&fail)queueMicrotask(()=>t.abort());return t;};f.data.chat.draft='quota simulation';await a.schedule(snapshotWorkspace(f),{immediate:true});if(aStates.at(-1)!=='error')throw Error('no abort warning');fail=false;await a.schedule(snapshotWorkspace(f),{immediate:true});if(aStates.at(-1)!=='saved')throw Error('retry failed');IDBDatabase.prototype.transaction=original;report.push('transaction-abort visible failure and successful retry');
const unavailable=[];const u=createLocalStore({indexedDB:null,onStatus:s=>unavailable.push(s)});await u.load();if(unavailable.at(-1)!=='unavailable')throw Error('fallback');report.push('IDB unavailable memory fallback');a.close();b.close();reader.close();return report;
});results.push(...moduleResults);
assert.deepEqual(errors,[]);assert.equal(external,0);results.push('no page errors or external/API requests');console.log(JSON.stringify({ok:true,results},null,2));await context.close();
}finally{await browser.close();server.close();}
