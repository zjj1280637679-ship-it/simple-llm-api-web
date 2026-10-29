import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore, snapshotWorkspace } from '../src/persistence.js';

const workspace=()=>({api:{protocol:'gemini',url:'https://example.com',model:'test',supplier:'test',key:''},model:{inputs:['text']},draft:'',attachments:[],pendingTextId:null,aspectRatio:'1:1',imageSize:'1K',messages:[],history:[],busy:false,lastUsage:null,lastMetrics:null});
function snapshot(text='') { const data={chat:workspace(),image:workspace()};data.chat.draft=text;return snapshotWorkspace({data,page:'chat',nextId:1}); }

// Contract-focused synthetic IDB: transactions are serialized; writes are staged
// until commit and atomically discarded on abort. This is NOT browser evidence.
function fakeIDB({value,revision=0,holdOpen=false}={}) {
 const state={record:value?structuredClone({value,revision}):undefined,connections:[],failNextWrite:false,transactions:0};
 let queue=[],active=false,opens=[],created=false;
 function pump() {
  if(active||!queue.length)return;active=true;const run=queue.shift();queueMicrotask(()=>run(()=>{active=false;pump();}));
 }
 function open() {
  const request={};const connection={closed:false,objectStoreNames:{contains:()=>created},createObjectStore(){created=true;},close(){this.closed=true;},
   transaction(store,mode) {
    if(this.closed)throw new Error('InvalidStateError');state.transactions++;
    let getRequest,write,aborted=false,finish;
    const t={error:null,abort(){if(aborted)return;aborted=true;queueMicrotask(()=>{t.onabort?.();finish?.();});},objectStore(){return {get(){getRequest={};return getRequest;},put(record){write=structuredClone(record);return {};}};}};
    queue.push(done=>{finish=done;if(aborted)return;getRequest.result=structuredClone(state.record);getRequest.onsuccess?.();
     if(aborted)return;
     queueMicrotask(()=>{if(aborted)return;if(mode==='readwrite'&&state.failNextWrite){state.failNextWrite=false;t.error=new DOMException('quota','QuotaExceededError');t.abort();return;}if(write)state.record=write;t.oncomplete?.();done();});
    });pump();return t;
   }
  };state.connections.push(connection);
  const release=()=>{request.result=connection;if(!created)request.onupgradeneeded?.();request.onsuccess?.();};
  if(holdOpen)opens.push(release);else queueMicrotask(release);return request;
 }
 return {open,state,releaseOpen(){holdOpen=false;opens.splice(0).forEach(fn=>queueMicrotask(fn));},versionchange(){state.connections.forEach(c=>c.onversionchange?.());}};
}
function instance(idb) {const statuses=[];const store=createLocalStore({indexedDB:idb,onStatus:s=>statuses.push(s),debounceMs:60000});return {store,statuses};}

test('load gate never schedules empty state before old snapshot hydration finishes',async()=>{
 const idb=fakeIDB({value:snapshot('existing'),revision:4,holdOpen:true}),{store,statuses}=instance(idb);
 const loading=store.load();store.schedule(snapshot('empty-startup'),{immediate:true});assert.equal(store.ready,false);assert.equal(idb.state.transactions,0);
 idb.releaseOpen();assert.equal((await loading).workspaces.chat.draft,'existing');await store.flush();assert.equal(idb.state.record.value.workspaces.chat.draft,'existing');assert.deepEqual(statuses,['restored']);store.close();
});

test('transaction revision compare prevents stale tab overwrite under simultaneous writes',async()=>{
 const idb=fakeIDB(),a=instance(idb),b=instance(idb);await Promise.all([a.store.load(),b.store.load()]);
 const result=await Promise.all([a.store.schedule(snapshot('winner'),{immediate:true}),b.store.schedule(snapshot('stale'),{immediate:true})]);
 assert.deepEqual(result,[true,false]);assert.equal(idb.state.record.revision,1);assert.equal(idb.state.record.value.workspaces.chat.draft,'winner');assert.equal(b.statuses.at(-1),'conflict');
 b.store.schedule(snapshot('still-stale'),{immediate:true});await b.store.flush();assert.equal(idb.state.record.value.workspaces.chat.draft,'winner');a.store.close();b.store.close();
});

test('quota abort preserves prior commit and allows explicit retry without false saved status',async()=>{
 const idb=fakeIDB({value:snapshot('saved'),revision:7}),{store,statuses}=instance(idb);await store.load();idb.state.failNextWrite=true;
 assert.equal(await store.schedule(snapshot('new'),{immediate:true}),false);assert.equal(statuses.at(-1),'error');assert.equal(idb.state.record.revision,7);assert.equal(idb.state.record.value.workspaces.chat.draft,'saved');
 assert.equal(await store.schedule(snapshot('new'),{immediate:true}),true);assert.equal(statuses.at(-1),'saved');assert.equal(idb.state.record.revision,8);assert.equal(idb.state.record.value.workspaces.chat.draft,'new');store.close();
});

test('unsupported saved schema blocks all automatic writes and retains original bytes',async()=>{
 const bad={schema:999,custom:'keep-me'},idb=fakeIDB({value:bad,revision:2}),{store,statuses}=instance(idb);assert.equal(await store.load(),null);assert.equal(store.ready,false);assert.equal(statuses.at(-1),'schema');
 store.schedule(snapshot('replacement'),{immediate:true});await store.flush();assert.deepEqual(idb.state.record,{value:bad,revision:2});store.close();
});

test('versionchange closes old connection and prevents a queued debounce write',async()=>{
 const idb=fakeIDB({value:snapshot('old'),revision:1}),{store,statuses}=instance(idb);await store.load();store.schedule(snapshot('pending'));idb.versionchange();assert.equal(statuses.at(-1),'blocked');assert.equal(idb.state.connections[0].closed,true);
 assert.equal(await store.flush(),false);assert.equal(idb.state.record.value.workspaces.chat.draft,'old');store.close();
});

test('debounce flush saves latest snapshot exactly once and close prevents writes',async()=>{
 const idb=fakeIDB(),{store,statuses}=instance(idb);await store.load();store.schedule(snapshot('first'));store.schedule(snapshot('latest'));assert.equal(await store.flush(),true);assert.equal(idb.state.record.revision,1);assert.equal(idb.state.record.value.workspaces.chat.draft,'latest');
 store.close();store.schedule(snapshot('closed'),{immediate:true});await store.flush();assert.equal(idb.state.record.revision,1);assert.equal(statuses.filter(s=>s==='saved').length,1);
});

test('unavailable IDB visibly falls back without claiming saved',async()=>{
 const {store,statuses}=instance(null);assert.equal(await store.load(),null);assert.equal(statuses.at(-1),'unavailable');store.schedule(snapshot('memory'),{immediate:true});await store.flush();assert.ok(!statuses.includes('saved'));store.close();
});
