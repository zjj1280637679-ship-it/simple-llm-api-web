import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createVideoWorkspace,videoJobLabel} from '../src/video-workspace.js';

const ID=n=>n.toString(16).padStart(32,'0');
const URL='https://video.example';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const reference=(name='reference.png')=>new File(['reference'],name);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fakeClock(){let time=1000,seq=0;const tasks=new Map();return {now:()=>time,setTimeout(fn,delay){const id=++seq;tasks.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>tasks.delete(id),pending:()=>tasks.size,async next(){const first=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!first)return false;tasks.delete(first[0]);time=first[1].at;first[1].fn();await flush();return true;}};}
function memoryStore(initial=null){let data=initial;return {getItem:()=>data,setItem:(key,value)=>{data=value;},read:()=>data};}
function harness({storage=memoryStore(),overrides={},clock=fakeClock(),key='secret-test-key'}={}){
  const calls={submit:[],job:[],cancel:[],download:[],system:[]},records=new Map(),revoked=[],created=[],saved=[];
  const service={instance:'instance-a',admission:true,ready:false,
    async system(){return {instance_id:service.instance,model_ready:service.ready,queue:{admission_open:service.admission}};},
    async submit(input,idempotencyKey){const job={id:ID(records.size+1),instance_id:service.instance,status:'queued',waiting_for:'model_ready',queue_position:records.size+1};records.set(job.id,job);return {...job};},
    async job(id){if(!records.has(id))throw Object.assign(new Error('Not found'),{httpStatus:404});return {...records.get(id)};},
    async cancel(id){const job=records.get(id);job.status=job.status==='queued'?'cancelled':'cancel_requested';return {...job};},
    async download(id,artifact,{onProgress}){onProgress({loaded:8,total:8});return {blob:new Blob(['video123']),bytes:8,filename:id+'.mp4',sha256:'synthetic'};},...overrides};
  const window={location:{pathname:'/index.html'},URL:{createObjectURL(blob){const url='blob:test/'+created.length;created.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)}};
  const document={createElement(){const node={click:()=>saved.push({href:node.href,filename:node.download})};return node;}};
  const clientFactory=options=>Object.fromEntries(['system','submit','job','cancel','download'].map(method=>[method,(...args)=>{calls[method].push({args,options});return service[method](...args);} ]));
  const ui=createVideoWorkspace({document,window,clock,clientFactory,storage,storageKey:'video-test',cryptoImpl:null});
  const input=(field,value)=>ui.handleInput({dataset:{videoField:field},value});
  const connect=async()=>{ui.setConnection({url:URL,key});await ui.connect();};
  const submit=async(prompt='A new paper kite crosses a lavender field')=>{input('draft',prompt);ui.addFiles([reference()]);await ui.submit();return ui.snapshot().jobs.at(-1);};
  return {ui,service,calls,records,revoked,created,saved,storage,window,clock,input,connect,submit};
}

test('model loading allows multiple queued submissions; form ownership and media delivery stay separate',async()=>{
  const h=harness();await h.connect();h.input('draft','<Picture 1> and <Video 1> move to <Audio 1>');h.ui.addFiles([reference(),reference('clip.mp4'),reference('voice.wav')]);await h.ui.submit();await h.submit('An entirely different cobalt sailboat');
  assert.equal(h.calls.submit.length,2);assert.equal(h.ui.snapshot().jobs.length,2);assert.match(h.ui.snapshot().jobs[0].label,/等待模型/);
  assert.deepEqual(h.calls.submit[0].args[0].files.map(f=>f.kind),['image','video','audio']);
  assert.deepEqual(Object.fromEntries(['width','height','steps'].map(k=>[k,h.calls.submit[0].args[0][k]])),{width:960,height:544,steps:50});
  assert.equal(h.ui.snapshot().submitting,false);assert.equal(h.calls.download.length,0);h.ui.dispose();
});

test('new submissions require positive admission and an authenticated connection',async()=>{
  const h=harness();h.input('draft','test');h.ui.addFiles([reference()]);await h.ui.submit();assert.equal(h.calls.submit.length,0);
  h.service.admission=false;await h.connect();await h.ui.submit();assert.equal(h.calls.submit.length,0);assert.match(h.ui.snapshot().error,/暂不接收/);
  h.service.admission=true;await h.ui.connect();await h.ui.submit();assert.equal(h.calls.submit.length,1);h.ui.dispose();
});

test('unknown submission is never reposted and a returned expected job ID is queried',async()=>{
  const h=harness({overrides:{submit:async()=>{throw Object.assign(new Error('reply lost'),{unknown:true,jobId:ID(9)});}}});
  h.records.set(ID(9),{id:ID(9),instance_id:'instance-a',status:'queued'});await h.connect();await h.submit();assert.equal(h.ui.snapshot().jobs[0].status,'unknown');
  await h.clock.next();assert.equal(h.calls.submit.length,1);assert.equal(h.calls.job.length,1);assert.equal(h.ui.snapshot().jobs[0].status,'queued');h.ui.dispose();
});

test('unknown submission without an ID remains recoverable and prevents accidental repeated upload',async()=>{
  const h=harness({overrides:{submit:async()=>{throw Object.assign(new Error('connection lost'),{unknown:true});}}});await h.connect();await h.submit();await h.ui.submit();
  assert.equal(h.calls.submit.length,1);assert.match(h.ui.snapshot().error,/结果仍未知/);assert.equal(h.ui.snapshot().jobs[0].id,null);
  h.records.set(ID(7),{id:ID(7),instance_id:'instance-a',status:'queued'});await h.ui.restoreJob(ID(7));assert.equal(h.calls.submit.length,1);assert.equal(h.ui.snapshot().jobs.length,1);assert.equal(h.ui.snapshot().jobs[0].id,ID(7));h.ui.dispose();
});

test('the unknown request identity is durably recorded before POST and survives closing before acknowledgement',async()=>{
  const pending=deferred();let h;
  h=harness({overrides:{submit:async(input,idempotencyKey)=>{const journal=JSON.parse(h.storage.read()).jobs[0];assert.equal(journal.status,'unknown');assert.equal(journal.id,null);assert.equal(journal.idempotencyKey,idempotencyKey);assert.equal(journal.instanceId,'instance-a');return pending.promise;}}});
  await h.connect();const sending=h.submit('private-scene-not-for-storage');const first=JSON.parse(h.storage.read()).jobs[0];assert.equal(h.calls.submit.length,1);assert.equal(first.status,'unknown');assert.doesNotMatch(h.storage.read(),/private-scene|secret-test-key|reference.png/);
  h.ui.dispose();assert.equal(JSON.parse(h.storage.read()).jobs[0].idempotencyKey,first.idempotencyKey);
  const restored=harness({storage:h.storage});assert.equal(restored.ui.snapshot().jobs[0].status,'unknown');assert.equal(restored.ui.snapshot().jobs[0].idempotencyKey,first.idempotencyKey);await restored.connect();await restored.submit('Would duplicate unknown work');assert.equal(restored.calls.submit.length,0);assert.match(restored.ui.snapshot().error,/结果仍未知/);
  pending.resolve({id:ID(1),instance_id:'instance-a',status:'queued'});await sending;restored.ui.dispose();
});

test('storage failure prevents POST and keeps a visible truthful recovery warning',async()=>{
  const storage={getItem:()=>null,setItem(){throw new Error('quota exhausted');}};const h=harness({storage});await h.connect();await h.submit();assert.equal(h.calls.submit.length,0);assert.equal(h.ui.snapshot().jobs[0].status,'not_submitted');assert.match(h.ui.snapshot().error,/不会开始/);assert.match(h.ui.snapshot().jobs[0].error,/上传未开始/);h.ui.dispose();
  const absent=harness({storage:null});await absent.connect();await absent.submit();assert.equal(absent.calls.submit.length,0);assert.match(absent.ui.snapshot().storageError,/不可用/);absent.ui.dispose();
});

test('unknown task exposes a copyable request number without exposing its API key',async()=>{
  const h=harness({overrides:{submit:async()=>{throw Object.assign(new Error('lost acknowledgement'),{unknown:true});}}});await h.connect();const job=await h.submit();let copied;h.window.navigator={clipboard:{writeText:async text=>{copied=text;}}};await h.ui.handleClick({dataset:{action:'video-copy-id',uid:job.uid}});
  assert.equal(copied,job.idempotencyKey);assert.notEqual(copied,'secret-test-key');assert.match(h.ui.snapshot().notice,/请求编号/);assert.match(h.ui.markup(''),/data-video-identity-label/);h.ui.dispose();
});

test('invalid recovery candidates never bind or remove the unknown-request submission guard',async()=>{
  const h=harness({overrides:{submit:async()=>{throw Object.assign(new Error('lost'),{unknown:true});}}});await h.connect();const original=await h.submit();
  await h.ui.restoreJob(ID(999));assert.equal(h.ui.snapshot().jobs[0].id,null);assert.equal(h.ui.snapshot().jobs[0].idempotencyKey,original.idempotencyKey);await h.ui.submit();assert.equal(h.calls.submit.length,1);
  h.service.job=async()=>{throw new Error('network unavailable');};await h.ui.restoreJob(ID(998));assert.equal(h.ui.snapshot().jobs[0].id,null);
  h.service.job=async id=>({id,instance_id:'other-instance',status:'queued'});await h.ui.restoreJob(ID(997));assert.equal(h.ui.snapshot().jobs[0].id,null);assert.equal(h.ui.snapshot().jobs[0].instanceMismatch,false);await h.ui.submit();assert.equal(h.calls.submit.length,1);
  h.service.job=async id=>({id,instance_id:'instance-a',status:'queued'});await h.ui.restoreJob(ID(996));assert.equal(h.ui.snapshot().jobs[0].id,ID(996));assert.equal(h.ui.snapshot().jobs[0].status,'queued');h.ui.dispose();
});

test('refresh restores only job identities and waits for the user to reconnect; secrets/files/prompts are excluded',async()=>{
  const h=harness();await h.connect();await h.submit('private-prompt-must-not-persist');const record=h.storage.read();
  assert.doesNotMatch(record,/secret-test-key|reference.png|private-prompt|blob:/);assert.match(record,/instance-a/);h.ui.dispose();
  const second=harness({storage:h.storage});second.records.set(ID(1),{id:ID(1),instance_id:'instance-a',status:'succeeded',artifact:{bytes:8}});
  assert.equal(second.ui.snapshot().keyPresent,false);assert.equal(second.ui.snapshot().jobs.length,1);assert.equal(second.clock.pending(),0);
  await second.connect();await second.clock.next();assert.equal(second.calls.submit.length,0);assert.equal(second.ui.snapshot().jobs[0].status,'succeeded');assert.equal(second.calls.download.length,0);
  await second.ui.downloadJob(ID(1),{saveFile:true});assert.equal(second.calls.download.length,1);assert.equal(second.saved[0].href,'blob:test/0');assert.equal(second.ui.snapshot().jobs[0].mediaReady,true);second.ui.dispose();assert.deepEqual(second.revoked,['blob:test/0']);
});

test('queued cancellation and running cancellation report the server semantics separately',async()=>{
  const h=harness();await h.connect();await h.submit();await h.ui.cancelJob(ID(1));assert.equal(h.ui.snapshot().jobs[0].status,'cancelled');
  await h.submit();h.records.get(ID(2)).status='running';await h.ui.refreshJob(ID(2));await h.ui.cancelJob(ID(2));assert.equal(h.ui.snapshot().jobs[1].status,'cancel_requested');assert.match(h.ui.snapshot().jobs[1].label,/等待停止/);h.ui.dispose();
});

test('a lost cancellation receipt does not invent final cancellation',async()=>{
  const h=harness({overrides:{cancel:async()=>{throw Object.assign(new Error('lost'),{unknown:true});}}});await h.connect();await h.submit();await h.ui.cancelJob(ID(1));
  assert.equal(h.ui.snapshot().jobs[0].status,'queued');assert.match(h.ui.snapshot().jobs[0].observationError,/尚未确认/);
  h.records.get(ID(1)).status='cancelled';await h.clock.next();assert.equal(h.ui.snapshot().jobs[0].status,'cancelled');h.ui.dispose();
});

test('clearing a key revokes subsequent query/cancel/download access without claiming to undo in-flight effects',async()=>{
  const h=harness();await h.connect();await h.submit();h.input('key','');await h.ui.refreshJob(ID(1));await h.ui.cancelJob(ID(1));
  assert.equal(h.calls.job.length,0);assert.equal(h.calls.cancel.length,0);assert.equal(h.clock.pending(),0);assert.equal(h.ui.snapshot().connected,false);h.ui.dispose();
});

test('a different instance at the same endpoint cannot claim historical jobs',async()=>{
  const h=harness();await h.connect();await h.submit();h.service.instance='instance-b';await h.ui.connect();
  assert.equal(h.ui.snapshot().jobs[0].instanceMismatch,true);await h.ui.refreshJob(ID(1));await h.ui.cancelJob(ID(1));assert.equal(h.calls.job.length,0);assert.equal(h.calls.cancel.length,0);
  assert.equal(h.clock.pending(),0);assert.match(h.ui.snapshot().jobs[0].observationError,/其他服务实例/);h.ui.dispose();
});

test('missing system identity and changed job identity fail closed',async()=>{
  const missing=harness({overrides:{system:async()=>({queue:{admission_open:true}})}});await missing.connect();assert.equal(missing.ui.snapshot().connected,false);assert.match(missing.ui.snapshot().error,/实例身份/);missing.ui.dispose();
  const h=harness();await h.connect();await h.submit();h.records.get(ID(1)).instance_id='instance-b';await h.ui.refreshJob(ID(1));assert.equal(h.ui.snapshot().jobs[0].instanceId,'instance-a');assert.match(h.ui.snapshot().jobs[0].observationError,/不同服务实例/);assert.equal(h.clock.pending(),0);h.ui.dispose();
});

test('a late connection failure cannot delete a newer successful credential',async()=>{
  const old=deferred();let count=0;const h=harness({overrides:{system:()=>++count===1?old.promise:Promise.resolve({instance_id:'instance-a',queue:{admission_open:true}})}});
  h.ui.setConnection({url:URL,key:'old-key'});const first=h.ui.connect();h.input('key','new-key');await h.ui.connect();old.reject(new Error('old network error'));await first;
  assert.equal(h.ui.snapshot().connected,true);await h.submit();assert.equal(h.calls.submit[0].options.key,'new-key');assert.equal(h.ui.snapshot().error,'');h.ui.dispose();
});

test('a late unauthorized query cannot revoke a newly connected credential, even for the same key',async()=>{
  const pending=deferred();const h=harness({overrides:{job:()=>pending.promise}});await h.connect();await h.submit();const querying=h.ui.refreshJob(ID(1));
  await h.ui.connect();pending.reject(Object.assign(new Error('old unauthorized receipt'),{httpStatus:401}));await querying;
  assert.equal(h.ui.snapshot().connected,true);await h.submit('A second distinct scene');assert.equal(h.calls.submit.length,2);h.ui.dispose();
});

test('a pre-cancellation query cannot roll the cancellation receipt backwards',async()=>{
  const pending=deferred();const h=harness({overrides:{job:()=>pending.promise}});await h.connect();await h.submit();const querying=h.ui.refreshJob(ID(1));
  await h.ui.cancelJob(ID(1));assert.equal(h.ui.snapshot().jobs[0].status,'cancelled');pending.resolve({id:ID(1),instance_id:'instance-a',status:'queued'});await querying;
  assert.equal(h.ui.snapshot().jobs[0].status,'cancelled');assert.equal(h.clock.pending(),0);h.ui.dispose();
});

test('new job observations wait for an in-flight cancellation instead of racing it',async()=>{
  const pending=deferred();const h=harness({overrides:{cancel:()=>pending.promise}});await h.connect();await h.submit();const cancelling=h.ui.cancelJob(ID(1));await h.ui.refreshJob(ID(1));await h.clock.next();assert.equal(h.calls.job.length,0);
  pending.resolve({id:ID(1),instance_id:'instance-a',status:'cancel_requested'});await cancelling;assert.equal(h.ui.snapshot().jobs[0].status,'cancel_requested');h.ui.dispose();
});

test('a 202 acknowledgement missing instance metadata preserves its known ID as unknown instead of claiming failed',async()=>{
  const h=harness({overrides:{submit:async()=>({id:ID(1),status:'queued'})}});await h.connect();await h.submit();const job=h.ui.snapshot().jobs[0];assert.equal(job.id,ID(1));assert.equal(job.status,'unknown');assert.equal(h.calls.submit.length,1);h.ui.dispose();
});

test('polling has a three-request concurrency budget even with many queued jobs',async()=>{
  const pending=[];const h=harness({overrides:{job:id=>{const task=deferred();pending.push({task,id});return task.promise;}}});await h.connect();for(let n=0;n<8;n++)await h.submit('new scene '+n);
  await h.clock.next();assert.equal(h.calls.job.length,3);assert.equal(h.clock.pending(),0);
  pending[0].task.resolve({id:pending[0].id,instance_id:'instance-a',status:'queued'});await flush();await h.clock.next();assert.equal(h.calls.job.length,4);
  h.ui.dispose();for(const {task,id} of pending)task.resolve({id,instance_id:'instance-a',status:'cancelled'});await flush();assert.equal(h.calls.cancel.length,0);
});

test('query failure backs off and an explicit 404 pauses automatic querying without resubmitting',async()=>{
  const h=harness({overrides:{job:async()=>{throw Object.assign(new Error('gone'),{httpStatus:404});}}});await h.connect();await h.submit();await h.clock.next();
  assert.equal(h.calls.job.length,1);assert.equal(h.clock.pending(),0);assert.match(h.ui.snapshot().jobs[0].observationError,/未重新提交/);assert.equal(h.calls.submit.length,1);h.ui.dispose();
});

test('download is explicit and media cache is bounded independently of the task queue',async()=>{
  const h=harness();await h.connect();for(let n=0;n<4;n++){await h.submit('new scene '+n);h.records.get(ID(n+1)).status='succeeded';h.records.get(ID(n+1)).artifact={bytes:8};await h.ui.refreshJob(ID(n+1));}
  assert.equal(h.calls.download.length,0);for(let n=0;n<4;n++)await h.ui.downloadJob(ID(n+1));assert.equal(h.ui.snapshot().jobs.length,4);assert.equal(h.ui.snapshot().jobs.filter(j=>j.mediaReady).length,3);assert.deepEqual(h.revoked,['blob:test/0']);
  h.ui.dispose();assert.equal(h.revoked.length,4);assert.equal(new Set(h.revoked).size,4);
});

test('aggregate media bytes also evict prior previews',async()=>{
  const h=harness({overrides:{download:async id=>({blob:new Blob(['small synthetic payload']),bytes:150*1024*1024,filename:id+'.mp4'})}});await h.connect();for(let n=1;n<=2;n++){await h.submit();Object.assign(h.records.get(ID(n)),{status:'succeeded',artifact:{bytes:150*1024*1024}});await h.ui.refreshJob(ID(n));await h.ui.downloadJob(ID(n));}
  assert.equal(h.ui.snapshot().jobs.filter(j=>j.mediaReady).length,1);assert.equal(h.revoked.length,1);h.ui.dispose();
});

test('cached and in-flight media share the same 256 MiB payload budget',async()=>{
  const mib=1024*1024,pending=[];let initial=true;
  const h=harness({overrides:{download:async id=>{if(initial){initial=false;return {blob:new Blob(['synthetic']),bytes:200*mib,filename:id+'.mp4'};}const task=deferred();pending.push({task,id});return task.promise;}}});await h.connect();
  for(let n=1;n<=3;n++){await h.submit('scene '+n);Object.assign(h.records.get(ID(n)),{status:'succeeded',artifact:{bytes:200*mib}});await h.ui.refreshJob(ID(n));}
  await h.ui.downloadJob(ID(1));assert.equal(h.ui.snapshot().mediaBudget.cachedBytes,200*mib);
  const second=h.ui.downloadJob(ID(2));await h.ui.downloadJob(ID(3));assert.equal(h.calls.download.length,2);assert.equal(h.revoked.length,1);assert.deepEqual(h.ui.snapshot().mediaBudget,{limitBytes:256*mib,reservedBytes:200*mib,cachedBytes:0});assert.equal(h.ui.snapshot().jobs[2].downloadState,'waiting');
  pending[0].task.resolve({blob:new Blob(['synthetic']),bytes:200*mib,filename:'second.mp4'});await second;assert.equal(h.calls.download.length,3);assert.equal(h.ui.snapshot().mediaBudget.cachedBytes+h.ui.snapshot().mediaBudget.reservedBytes,200*mib);
  pending[1].task.resolve({blob:new Blob(['synthetic']),bytes:200*mib,filename:'third.mp4'});await flush();assert.equal(h.ui.snapshot().mediaBudget.reservedBytes,0);assert.equal(h.ui.snapshot().mediaBudget.cachedBytes,200*mib);h.ui.dispose();
});

test('media scheduling allows a fitting later task without blocking behind a larger waiting task',async()=>{
  const mib=1024*1024,pending=[];const h=harness({overrides:{download:async id=>{const task=deferred();pending.push({task,id});return task.promise;}}});await h.connect();
  for(let n=1;n<=3;n++){await h.submit('scene '+n);Object.assign(h.records.get(ID(n)),{status:'succeeded',artifact:{bytes:(n===3?50:200)*mib}});await h.ui.refreshJob(ID(n));}
  const first=h.ui.downloadJob(ID(1));await h.ui.downloadJob(ID(2));const third=h.ui.downloadJob(ID(3));assert.deepEqual(h.calls.download.map(call=>call.args[0]),[ID(1),ID(3)]);assert.equal(h.ui.snapshot().mediaBudget.reservedBytes,250*mib);
  h.ui.dispose();for(const {task,id} of pending)task.resolve({blob:new Blob(['synthetic']),bytes:(id===ID(3)?50:200)*mib,filename:'test.mp4'});await Promise.all([first,third]);assert.equal(h.ui.snapshot().mediaBudget.reservedBytes,0);
});

test('failed downloads release reservations before another task starts',async()=>{
  const mib=1024*1024,pending=[];const h=harness({overrides:{download:async id=>{const task=deferred();pending.push({task,id});return task.promise;}}});await h.connect();for(let n=1;n<=2;n++){await h.submit();Object.assign(h.records.get(ID(n)),{status:'succeeded',artifact:{bytes:200*mib}});await h.ui.refreshJob(ID(n));}
  const first=h.ui.downloadJob(ID(1));await h.ui.downloadJob(ID(2));assert.equal(h.calls.download.length,1);pending[0].task.reject(new Error('failed body'));await first;assert.equal(h.calls.download.length,2);assert.equal(h.ui.snapshot().mediaBudget.reservedBytes,200*mib);
  pending[1].task.resolve({blob:new Blob(['synthetic']),bytes:200*mib,filename:'test.mp4'});await flush();assert.equal(h.ui.snapshot().mediaBudget.reservedBytes,0);h.ui.dispose();
});

test('dispose aborts owned network calls and ignores late effects without cancelling remote jobs',async()=>{
  const pending=deferred();const h=harness({overrides:{submit:()=>pending.promise}});await h.connect();const sending=h.submit();const signal=h.calls.submit[0].args[2].signal;h.ui.dispose();assert.equal(signal.aborted,true);
  pending.resolve({id:ID(1),instance_id:'instance-a',status:'queued'});await sending;assert.equal(h.calls.cancel.length,0);assert.equal(h.created.length,0);assert.equal(h.ui.snapshot().disposed,true);assert.equal(h.clock.pending(),0);
});

test('late media completion after dispose creates no blob URL',async()=>{
  const pending=deferred();const h=harness({overrides:{download:()=>pending.promise}});await h.connect();await h.submit();Object.assign(h.records.get(ID(1)),{status:'succeeded',artifact:{bytes:8}});await h.ui.refreshJob(ID(1));const downloading=h.ui.downloadJob(ID(1));h.ui.dispose();pending.resolve({blob:new Blob(['video123']),bytes:8,filename:'test.mp4'});await downloading;assert.equal(h.created.length,0);
});

test('corrupt existing storage is preserved instead of being silently overwritten',async()=>{
  const storage=memoryStore('{broken');const h=harness({storage});await h.connect();await h.submit();h.ui.dispose();assert.equal(storage.read(),'{broken');assert.match(h.ui.snapshot().storageError,/保持不变/);
});

test('private connection import stays local and rejects unsafe URLs',async()=>{
  const h=harness();await h.ui.importConnection(new File([JSON.stringify({url:URL,api_key:'import-secret'})],'api-connection.private.json'));
  assert.equal(h.calls.system.length,0);assert.equal(h.ui.snapshot().keyPresent,true);assert.doesNotMatch(h.storage.read(),/import-secret/);await assert.rejects(()=>h.ui.importConnection(new File([JSON.stringify({url:URL+'?key=bad',api_key:'key'})],'bad.json')),/地址/);
  const later=deferred();const operation=h.ui.importConnection({size:10,text:()=>later.promise});h.ui.dispose();later.resolve(JSON.stringify({url:URL,api_key:'late-secret'}));await operation;assert.equal(h.ui.snapshot().keyPresent,false);
});

test('markup escapes reference data and offers correct advanced defaults; minimal DOM hosts are safe',async()=>{
  const h=harness();h.ui.addFiles([reference('<img src=x onerror=alert(1)>.png')]);const markup=h.ui.markup('<nav>tabs</nav>');assert.doesNotMatch(markup,/<img src=x/);assert.match(markup,/&lt;img/);assert.match(markup,/min="5" max="14.375"/);assert.match(markup,/min="2" max="50"/);assert.match(markup,/value="960"/);
  h.ui.mount({querySelector:()=>null});await h.ui.handleClick({dataset:{action:'video-preset-test'}});assert.match(h.ui.markup(''),/value="512"/);h.ui.dispose();
});

test('unsupported clipboard reports a failure instead of a fictional successful copy',async()=>{
  const h=harness();await h.connect();const job=await h.submit();await h.ui.handleClick({dataset:{action:'video-copy-id',uid:job.uid}});assert.match(h.ui.snapshot().error,/不支持复制/);assert.doesNotMatch(h.ui.snapshot().notice,/已复制/);h.ui.dispose();
});

test('reference-only contract rejects text-only and audio-only before any network submission',async()=>{
  const h=harness();await h.connect();h.input('draft','A new scene');await h.ui.submit();assert.equal(h.calls.submit.length,0);h.ui.addFiles([reference('sound.wav')]);await h.ui.submit();assert.equal(h.calls.submit.length,0);assert.match(h.ui.snapshot().error,/不能只提交文本或音频/);h.ui.dispose();
});

test('progress labels preserve real phases and never invent a generation percentage',()=>{
  assert.equal(videoJobLabel({status:'queued',queue_position:4}),'已排队 · 第 4 位');assert.equal(videoJobLabel({status:'running',active_phase:{phase:'encode'}}),'正在编码与校验');assert.equal(videoJobLabel({status:'cancel_requested'}),'取消请求已接收 · 等待停止');assert.doesNotMatch(videoJobLabel({status:'running'}),/%/);
});
