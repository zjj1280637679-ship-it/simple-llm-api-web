import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiSimulator, simulatorConfig, getFixture, DUMMY_KEY } from '../module-library/test-resources/gemini-native/index.mjs';
import { generateText } from '../module-library/functions/text-generation/index.js';
let nativeFetch, unexpectedNetworkCalls=0;
test.before(()=>{nativeFetch=globalThis.fetch;globalThis.fetch=()=>{unexpectedNetworkCalls++;throw Error('Unexpected real network in simulator suite');};});
test.after(()=>{globalThis.fetch=nativeFetch;assert.equal(unexpectedNetworkCalls,0,'No real network is permitted');});
const prompt='Draw one blue cup on a white background.';
// Independent literal request oracle. Do not call the production request builder here.
const request=()=>['https://generativelanguage.googleapis.com/v1beta/models/sim-gemini-text-v1:generateContent',{
  method:'POST',headers:{accept:'application/json','content-type':'application/json','x-goog-api-key':DUMMY_KEY},
  body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{}})}];

test('M0 existing Gemini adapter parses strict fixed response with zero real network',async()=>{
  const original=globalThis.fetch;let network=0;
  globalThis.fetch=()=>{network++;throw Error('Real network forbidden');};
  try {
    const sim=createGeminiSimulator();
    const result=await generateText({config:simulatorConfig(),messages:[{role:'user',content:prompt}],fetchImpl:sim.fetch});
    assert.equal(result.text,'Host text reply.'); assert.equal(result.finishReason,'STOP');
    assert.deepEqual(result.usage,{inputTokens:10,outputTokens:5,totalTokens:15,cachedTokens:null});
    const evidence=sim.assertComplete();
    assert.equal(evidence.evidenceType,'SIMULATED');assert.equal(evidence.realApiCalled,false);
    assert.equal(evidence.resourceRevisions[0].resourceId,'TR-GEMINI-001');
    assert.match(evidence.resourceRevisions[0].fixtureSha256,/^[a-f0-9]{64}$/);assert.equal(network,0);
  } finally {globalThis.fetch=original;}
});
for(const field of ['method','url','headers','body','key','extra']) test('M0 rejects '+field+' without consuming success',async()=>{
  const sim=createGeminiSimulator();const [url,init]=request();let badUrl=url;
  if(field==='method')init.method='DELETE';
  if(field==='url')badUrl='https://never-contact.example/other?key=PRIVATE';
  if(field==='headers')delete init.headers.accept;
  if(field==='body')init.body=JSON.stringify({contents:[]});
  if(field==='key')init.headers['x-goog-api-key']='PRIVATE_REALISH_KEY';
  if(field==='extra')init.headers.authorization='Bearer PRIVATE';
  await assert.rejects(sim.fetch(badUrl,init),error=>error.code==='SIMULATOR_REQUEST_MISMATCH');
  assert.equal(sim.inspect().remaining,1);
  assert.equal((await sim.fetch(...request())).status,200);
  assert.throws(()=>sim.assertComplete(),/SIMULATOR_ASSERTION_FAILED/);
  assert(!JSON.stringify(sim.inspect()).includes('PRIVATE'));
});
test('M0 JSON parse mismatch and unexpected extra call are not provider errors',async()=>{
  const sim=createGeminiSimulator();const [url,init]=request();init.body='{';
  await assert.rejects(sim.fetch(url,init),{code:'SIMULATOR_REQUEST_MISMATCH'});
  assert.equal((await sim.fetch(...request())).status,200);
  await assert.rejects(sim.fetch(...request()),{code:'SIMULATOR_REQUEST_MISMATCH'});
});
test('M0 deterministic replay, fixture isolation and explicit prompt parameters',async()=>{
  const a=createGeminiSimulator(),b=createGeminiSimulator();
  assert.deepEqual(await (await a.fetch(...request())).json(),await (await b.fetch(...request())).json());
  assert.deepEqual(a.assertComplete(),b.assertComplete());
  const fixture=getFixture('text.ok');fixture.steps[0].response.json={changed:true};
  const sim=createGeminiSimulator({parameters:{prompt:'你好 🧪'}});
  const result=await generateText({config:simulatorConfig(),messages:[{role:'user',content:'你好 🧪'}],fetchImpl:sim.fetch});
  assert.equal(result.text,'Host text reply.');sim.assertComplete();
  assert.throws(()=>createGeminiSimulator({parameters:{unknown:'value'}}),{code:'SIMULATOR_CONFIGURATION'});
});
test('M0 Request input clones body without consuming original',async()=>{
  const sim=createGeminiSimulator();const original=new Request(...request());
  const result=await sim.fetch(original);assert.equal(result.status,200);
  assert.equal(original.bodyUsed,false);assert(JSON.parse(await original.text()).contents);sim.assertComplete();
});

// Extensions remain narrow and explicit; no production code changes or live calls.
import { listModels, generateImage, makeToolResult } from '../src/core.js';
import { createSimulatorCore } from '../module-library/test-resources/gemini-native/core.js';
import { getManifest } from '../module-library/test-resources/gemini-native/index.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PNG } from '../module-library/hosts/support.mjs';
const invocation=sim=>generateText({config:simulatorConfig(),messages:[{role:'user',content:prompt}],fetchImpl:sim.fetch});
function scheduler() {
  let now=0,next=0;const timers=new Map();
  return {clock:()=>now,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout(id){timers.delete(id);},size:()=>timers.size,
    tick(ms){now+=ms;for(const [id,timer] of [...timers]) if(timer.at<=now){timers.delete(id);timer.fn();}}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('M1 GET models has no body; adapter preserves synthetic method metadata and empty list',async()=>{
  const sim=createGeminiSimulator({scenario:'models.list'});
  const result=await listModels({config:simulatorConfig(),fetchImpl:sim.fetch});
  assert.deepEqual(result.map(m=>m.id),['sim-gemini-text-v1','sim-embedding-v1','sim-gemini-second-v1']);
  assert.deepEqual(result.filter(m=>m.methods.includes('generateContent')).map(m=>m.id),['sim-gemini-text-v1','sim-gemini-second-v1']);
  sim.assertComplete();
  const empty=createGeminiSimulator({scenario:'models.empty'});
  assert.deepEqual(await listModels({config:simulatorConfig(),fetchImpl:empty.fetch}),[]);empty.assertComplete();
});
test('M1 direct pagination is deterministic; invalid token/body mismatches do not consume',async()=>{
  const sim=createGeminiSimulator({scenario:'models.paged'}),headers={accept:'application/json','x-goog-api-key':DUMMY_KEY};
  const first=await (await sim.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=2',{headers})).json();
  assert.equal(first.nextPageToken,'SIMULATED_PAGE_2');
  const url='https://generativelanguage.googleapis.com/v1beta/models?pageSize=2&pageToken=SIMULATED_PAGE_2';
  const second=await (await sim.fetch(url,{headers})).json();
  assert.equal(new Set([...first.models,...second.models].map(m=>m.name)).size,3);sim.assertComplete();
  for(const init of [{headers,body:'{}'},{headers}]) {
    const invalid=createGeminiSimulator({scenario:'models.list'});
    await assert.rejects(invalid.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageToken=invalid',init),{code:'SIMULATOR_REQUEST_MISMATCH'});
    assert.equal(invalid.inspect().consumed,0);
  }
});
for(const status of [400,403,404,429,500,503]) test('M2 provider HTTP '+status+' resolves Response; adapter does not retry',async()=>{
  const direct=createGeminiSimulator({scenario:'http.'+status});
  const response=await direct.fetch(...request());assert.equal(response.status,status);assert.equal(response.ok,false);
  const json=await response.json();assert.equal(json.error.code,status);assert(json.error.message.startsWith('SIMULATED'));direct.assertComplete();
  const sim=createGeminiSimulator({scenario:'http.'+status});
  await assert.rejects(invocation(sim),error=>error.code==='HTTP' && error.status===status);
  assert.equal(sim.assertComplete().consumed,1);
});
test('M2 network rejection, malformed response and blocked prompt remain distinct adapter errors',async()=>{
  for(const [scenario,code] of [['transport.reject','NETWORK'],['robust.invalid-json','RESPONSE'],['safety.prompt-blocked','BLOCKED']]) {
    const sim=createGeminiSimulator({scenario});await assert.rejects(invocation(sim),{code});sim.assertComplete();
  }
});
test('M2 pre-aborted signals preserve exact reason and do not consume the request',async()=>{
  for(const reason of [new DOMException('Timeout','TimeoutError'),new Error('custom reason')]) {
    const sim=createGeminiSimulator();const [url,init]=request();init.signal=AbortSignal.abort(reason);
    await assert.rejects(sim.fetch(url,init),error=>error===reason);assert.equal(sim.inspect().consumed,0);
    await sim.fetch(...request());sim.assertComplete();
  }
});
test('M2 in-flight abort clears timer/listener, preserves reason and settles once',async()=>{
  const time=scheduler(),sim=createGeminiSimulator({scenario:'transport.delay',clock:time.clock,scheduler:time});
  const controller=new AbortController();let adds=0,removes=0;
  const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener=(...args)=>{adds++;return add(...args);};
  controller.signal.removeEventListener=(...args)=>{removes++;return remove(...args);};
  const [url,init]=request();init.signal=controller.signal;
  const pending=sim.fetch(url,init);await flush();assert.equal(time.size(),1);
  const reason=new DOMException('test cancellation','AbortError');controller.abort(reason);
  await assert.rejects(pending,error=>error===reason);time.tick(1000);
  assert.equal(time.size(),0);assert.equal(adds,removes);
  assert.equal(sim.assertComplete().events.filter(e=>e.outcome==='aborted').length,1);
  assert.equal(sim.inspect().events.filter(e=>e.outcome==='response').length,0);
});
test('M2 virtual delay resolves once; later abort is inert; hanging request has explicit disposal',async()=>{
  const time=scheduler(),sim=createGeminiSimulator({scenario:'transport.delay',clock:time.clock,scheduler:time});
  const controller=new AbortController();const [url,init]=request();init.signal=controller.signal;
  const promise=sim.fetch(url,init);await flush();time.tick(49);assert.equal(sim.inspect().pending,1);
  time.tick(1);assert.equal((await promise).status,200);controller.abort();time.tick(100);
  assert.equal(time.size(),0);assert.equal(sim.assertComplete().events.filter(e=>e.outcome==='response').length,1);
  const hang=createGeminiSimulator({scenario:'transport.hang',scheduler:time});
  const hanging=hang.fetch(...request());await flush();assert.equal(hang.inspect().pending,1);hang.dispose();
  await assert.rejects(hanging,{code:'SIMULATOR_DISPOSED'});assert.equal(hang.inspect().pending,0);
  assert.throws(()=>hang.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
test('M2 adapter maps in-flight cancellation to CANCELLED without retry',async()=>{
  const time=scheduler(),sim=createGeminiSimulator({scenario:'transport.delay',scheduler:time});
  const controller=new AbortController();const pending=generateText({config:simulatorConfig(),messages:[{role:'user',content:prompt}],fetchImpl:sim.fetch,signal:controller.signal});
  await flush();controller.abort();await assert.rejects(pending,{code:'CANCELLED'});
  assert.equal(sim.assertComplete().consumed,1);assert.equal(time.size(),0);
});
test('M2 delivery configuration errors cannot become false PASS after a consumed request',async()=>{
  const sim=createGeminiSimulator({scenario:'transport.delay'});
  await assert.rejects(sim.fetch(...request()),{code:'SIMULATOR_CONFIGURATION'});
  assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
  const fixture=getFixture('text.ok');fixture.steps[0].response.status=999;
  const invalid=createSimulatorCore({fixture,revision:{}});
  await assert.rejects(invalid.fetch(...request()),{code:'SIMULATOR_CONFIGURATION'});
  assert.throws(()=>invalid.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function decodeFixturePng(bytes) {
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let offset=8;const types=[],data=[];let width,height;
  while(offset<bytes.length) {
    assert(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),end=offset+12+length;
    assert(end<=bytes.length);const type=bytes.subarray(offset+4,offset+8).toString();types.push(type);
    const chunk=bytes.subarray(offset+8,offset+8+length);
    assert.equal(bytes.readUInt32BE(offset+8+length),crc32(bytes.subarray(offset+4,offset+8+length)),type+' CRC');
    if(type==='IHDR') {assert.equal(length,13);width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);assert.deepEqual([...chunk.subarray(8)],[8,6,0,0,0]);}
    if(type==='IDAT')data.push(chunk);
    if(type==='IEND')assert.equal(length,0);
    offset=end;
  }
  assert.deepEqual(types,['IHDR','IDAT','IEND']);assert.equal(width,1);assert.equal(height,1);
  const decoded=inflateSync(Buffer.concat(data));assert.deepEqual([...decoded],[0,0,128,255,255]);
  return {width,height,rgba:[...decoded.subarray(1)]};
}
test('M3 PNG every chunk CRC, full zlib decode, exact RGBA, hash and existing host fixture agree',async()=>{
  const bytes=await readFile(new URL('../module-library/test-resources/gemini-native/assets/pixel-1x1.png',import.meta.url));
  assert.deepEqual(decodeFixturePng(bytes),{width:1,height:1,rgba:[0,128,255,255]});
  assert.deepEqual(Buffer.from(PNG,'base64'),bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),getManifest().assets[0].sha256);
  assert.equal(getFixture('image.output').steps[0].response.json.candidates[0].content.parts[1].inlineData.data,PNG);
});
test('M3 actual Gemini image adapter receives verified pixel with mixed text parts',async()=>{
  const sim=createGeminiSimulator({scenario:'image.output'});
  const result=await generateImage({config:simulatorConfig('gemini-nano-banana-2.1'),prompt:'Render the test pixel.',aspectRatio:'1:1',imageSize:'1K',fetchImpl:sim.fetch});
  assert.equal(result.images.length,1);assert.equal(result.images[0].mimeType,'image/png');
  decodeFixturePng(Buffer.from(result.images[0].data,'base64'));
  assert.equal(result.text,'SIMULATED pixel. Not a generated image.');sim.assertComplete();
});
const tool={name:'sim_add',description:'Add two numbers in the local test allowlist.',parameters:{type:'OBJECT',properties:{a:{type:'NUMBER'},b:{type:'NUMBER'}},required:['a','b']}};
test('M3 actual adapter preserves tool ID/signature and makeToolResult returns exact expected follow-up',async()=>{
  const sim=createGeminiSimulator({scenario:'tools.follow-up'}),config=simulatorConfig();
  const messages=[{role:'user',content:'Add two and three.'}];
  const first=await generateText({config,messages,tools:[tool],fetchImpl:sim.fetch});
  assert.equal(first.text,'');assert.equal(first.toolCalls.length,1);
  const call=first.toolCalls[0];assert.deepEqual(call,{id:'SIMULATED-call-1',name:'sim_add',args:{a:2,b:3}});
  const allowlist={sim_add:({a,b})=>({value:a+b})};assert.equal(typeof allowlist[call.name],'function');
  const result=allowlist[call.name](call.args);
  messages.push({role:'assistant',content:first.text,raw:first.rawAssistant},makeToolResult(config,call,result));
  const second=await generateText({config,messages,tools:[tool],fetchImpl:sim.fetch});
  assert.equal(second.text,'SIMULATED sum: 5.');assert.equal(sim.assertComplete().consumed,2);
});
test('M3 losing opaque signature is request mismatch, not synthetic provider 400',async()=>{
  const sim=createGeminiSimulator({scenario:'tools.follow-up'}),config=simulatorConfig();
  const messages=[{role:'user',content:'Add two and three.'}];
  const first=await generateText({config,messages,tools:[tool],fetchImpl:sim.fetch});
  delete first.rawAssistant.parts[1].thoughtSignature;
  messages.push({role:'assistant',content:'',raw:first.rawAssistant},makeToolResult(config,first.toolCalls[0],{value:5}));
  await assert.rejects(generateText({config,messages,tools:[tool],fetchImpl:sim.fetch}),{code:'NETWORK'});
  assert.equal(sim.inspect().failures[0].code,'SIMULATOR_REQUEST_MISMATCH');assert.equal(sim.inspect().remaining,1);
});
test('M2 abort between admission and immediate delivery preserves reason rather than resolving 200',async()=>{
  const sim=createGeminiSimulator(),controller=new AbortController(),reason=new Error('raced cancellation');
  const [url,init]=request();init.signal=controller.signal;
  const pending=sim.fetch(url,init);
  queueMicrotask(()=>queueMicrotask(()=>controller.abort(reason)));
  await assert.rejects(pending,error=>error===reason);
  assert.equal(sim.inspect().events.some(event=>event.outcome==='response'),false);
});
test('M2 concurrent Request admission keeps sequence order even when completion reverses',async()=>{
  const fixture=getFixture('text.ok');fixture.steps[0].response.delayMs=50;
  const second=structuredClone(fixture.steps[0]);second.request.body.contents[0].parts[0].text='Second request';
  second.response.delayMs=10;second.response.json.responseId='SIMULATED-second';fixture.steps.push(second);
  const time=scheduler(),sim=createSimulatorCore({fixture,revision:{},scheduler:time,clock:time.clock});
  const first=sim.fetch(new Request(...request()));
  const [url,init]=request();init.body=JSON.stringify({contents:[{role:'user',parts:[{text:'Second request'}]}],generationConfig:{}});
  const later=sim.fetch(url,init);await flush();time.tick(10);
  assert.equal((await (await later).json()).responseId,'SIMULATED-second');
  time.tick(40);assert.equal((await (await first).json()).responseId,'SIMULATED-text-ok-1');
  const evidence=sim.assertComplete();assert.deepEqual(evidence.events.filter(event=>event.outcome==='request-matched').map(event=>event.sequence),[1,2]);
  assert.deepEqual(evidence.events.filter(event=>event.outcome==='response').map(event=>event.sequence),[2,1]);
});
test('M0 simulator source has no network fallback or production request-builder dependency',async()=>{
  const core=await readFile(new URL('../module-library/test-resources/gemini-native/core.js',import.meta.url),'utf8');
  const loader=await readFile(new URL('../module-library/test-resources/gemini-native/index.mjs',import.meta.url),'utf8');
  assert(!/from\s+['"].*src\//.test(core+loader));assert(!/globalThis\.fetch|window\.fetch/.test(core+loader));
});
test('M2 assertComplete refuses queued/fire-and-forget requests before admission finishes',async()=>{
  const sim=createGeminiSimulator();await sim.fetch(...request());sim.assertComplete();
  const extra=sim.fetch(...request());
  assert.equal(sim.inspect().active,1);
  assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_INCOMPLETE'});
  await assert.rejects(extra,{code:'SIMULATOR_REQUEST_MISMATCH'});
  assert.equal(sim.inspect().active,0);assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
test('M2 scheduler exceptions clear pending work and latch delivery failure',async()=>{
  const sim=createGeminiSimulator({scenario:'transport.delay',scheduler:{setTimeout(){throw Error('bad scheduler');},clearTimeout(){}}});
  await assert.rejects(sim.fetch(...request()),{code:'SIMULATOR_CONFIGURATION'});
  assert.equal(sim.inspect().pending,0);assert.equal(sim.inspect().active,0);
  assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});
});
