import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {createArkSimulator,simulatorConfig,getFixture,getManifest,IMAGE_MODEL,DUMMY_KEY} from '../module-library/test-resources/ark-native/index.mjs';
import {generateText,generateImage,makeToolResult} from '../src/core.js';
import {inspectPng} from '../module-library/test-resources/shared/png.mjs';
globalThis.fetch=()=>{throw Error('REAL NETWORK FORBIDDEN');};
const prompt=getFixture('text.ok').parameters.prompt.default;
const bind=(value,parameters)=>value&&typeof value==='object'?(Object.keys(value).length===1&&'$parameter'in value?parameters[value.$parameter]:Array.isArray(value)?value.map(v=>bind(v,parameters)):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v,parameters)]))):value;
const request=(scenario='text.ok',index=0)=>{const f=getFixture(scenario),parameters=Object.fromEntries(Object.entries(f.parameters).map(([k,v])=>[k,v.default]));return bind(f.steps[index].request,parameters);};
const invoke=(sim,req=request(),signal)=>sim.fetch(req.url,{method:req.method,headers:req.headers,body:JSON.stringify(req.body),signal});
const run=sim=>generateText({config:simulatorConfig(),messages:[{role:'user',content:prompt}],fetchImpl:sim.fetch});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function time(){let now=0,id=0;const jobs=new Map();return {clock:()=>now,setTimeout(fn,ms){jobs.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){jobs.delete(id);},tick(ms){now+=ms;for(const [id,j]of jobs)if(j.at<=now){jobs.delete(id);j.fn();}},size:()=>jobs.size};}
test('Ark text native adapter, resource isolation and safe pathname evidence',async()=>{
  const sim=createArkSimulator(),result=await run(sim);assert.equal(result.text,'Host Ark text reply.');
  const report=sim.assertComplete();assert.equal(report.realApiCalled,false);assert.equal(report.resourceRevisions[0].resourceId,'TR-ARK-001');assert.equal(report.events[0].route,'/api/v3/chat/completions');
  assert(!JSON.stringify(report).includes(DUMMY_KEY));assert(!JSON.stringify(report).includes(prompt));
});
for(const field of ['method','url','headers','body','key','extra','model','stream'])test('Ark strict oracle rejects '+field+' and latches without consumption',async()=>{
  const sim=createArkSimulator(),r=request();if(field==='method')r.method='PUT';if(field==='url')r.url+='?api_key=SECRET';if(field==='headers')r.headers['x-extra']='SECRET';if(field==='body')r.body.messages[0].content='SECRET';if(field==='key')r.headers.authorization='Bearer SECRET';if(field==='extra')r.body.extra=true;if(field==='model')r.body.model='wrong';if(field==='stream')r.body.stream=true;
  await assert.rejects(invoke(sim,r),{code:'SIMULATOR_REQUEST_MISMATCH'});assert.equal(sim.inspect().consumed,0);await run(sim);assert.throws(()=>sim.assertComplete(),{code:'SIMULATOR_ASSERTION_FAILED'});assert(!JSON.stringify(sim.inspect()).includes('SECRET'));
});
for(const status of [400,401,403,404,429,500,503])test('Ark HTTP '+status+' is provider response, no retry',async()=>{
  const sim=createArkSimulator({scenario:'http.'+status});await assert.rejects(run(sim),error=>error.code==='HTTP'&&error.status===status);assert.equal(sim.assertComplete().entered,1);
});
test('Ark transport malformed and empty distinct failures remain no-retry',async()=>{
  for(const [scenario,code]of [['transport.reject','NETWORK'],['robust.invalid-json','RESPONSE'],['text.empty','EMPTY']]){const sim=createArkSimulator({scenario});await assert.rejects(run(sim),{code});assert.equal(sim.assertComplete().consumed,1);}
});
test('Ark image fixture full CRC/zlib/pixels and actual adapter returns measured1536 PNG',async()=>{
  const sim=createArkSimulator({scenario:'image.output'}),result=await generateImage({config:simulatorConfig(IMAGE_MODEL),prompt,imageSize:'1.5K',aspectRatio:'1:1',fetchImpl:sim.fetch});
  const bytes=Buffer.from(result.images[0].data,'base64'),asset=getManifest().assets[0];assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);assert.deepEqual(bytes,await readFile(new URL('../module-library/test-resources/ark-native/'+asset.path,import.meta.url)));
  const info=inspectPng(bytes);assert.equal(info.width,1536);assert.equal(info.height,1536);let offset=8;const chunks=[];while(offset<bytes.length){const n=bytes.readUInt32BE(offset);if(bytes.subarray(offset+4,offset+8).toString()==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+n));offset+=n+12;}
  const raw=inflateSync(Buffer.concat(chunks));for(let y=0;y<1536;y++){assert.equal(raw[y*6145],0);for(let x=0;x<1536;x++){const i=y*6145+1+x*4;assert.equal(raw.readUInt32BE(i),0x0080ffff);}}
  sim.assertComplete();assert.throws(()=>inspectPng(bytes.subarray(0,24)),/INVALID_PNG/);const corrupt=Buffer.from(bytes);corrupt[50]^=1;assert.throws(()=>inspectPng(corrupt),/INVALID_PNG/);
});
test('Ark tool result and opaque encrypted assistant metadata roundtrip unchanged',async()=>{
  const scenario='tools.follow-up',f=getFixture(scenario),sim=createArkSimulator({scenario}),req=request(scenario);const tools=req.body.tools.map(t=>t.function),messages=req.body.messages;
  const first=await generateText({config:simulatorConfig(),messages,tools,fetchImpl:sim.fetch});assert.equal(first.toolCalls[0].name,'sim_add');assert.deepEqual(first.toolCalls[0].args,{a:2,b:3});
  const follow=makeToolResult(simulatorConfig(),first.toolCalls[0],{value:5});const second=await generateText({config:simulatorConfig(),messages:[...messages,{role:'assistant',content:first.text,raw:first.rawAssistant},follow],tools,fetchImpl:sim.fetch});assert.equal(second.text,'SIMULATED sum: 5.');sim.assertComplete();
});
test('Ark losing encrypted_content rejects next request without consuming it',async()=>{
  const sim=createArkSimulator({scenario:'text.encrypted-follow-up'});await invoke(sim,request('text.encrypted-follow-up'));const req=request('text.encrypted-follow-up',1);delete req.body.messages[1].encrypted_content;await assert.rejects(invoke(sim,req),{code:'SIMULATOR_REQUEST_MISMATCH'});assert.equal(sim.inspect().consumed,1);
});
test('Ark delayed cancellation clears scheduler, exact signal reason, no slot retry',async()=>{
  const clock=time(),sim=createArkSimulator({scenario:'transport.delay',clock:clock.clock,scheduler:clock}),c=new AbortController(),reason=new Error('cancel');const pending=invoke(sim,request('transport.delay'),c.signal);await flush();assert.equal(clock.size(),1);c.abort(reason);await assert.rejects(pending,e=>e===reason);assert.equal(clock.size(),0);sim.assertComplete();
});
for(const mode of ['abort','dispose'])test('Shared asynchronous Request normalization '+mode+' settles without closing body or consuming slot',async()=>{
  let writer;const body=new ReadableStream({start(c){writer=c;}}),c=new AbortController(),sim=createArkSimulator(),r=request();const pending=sim.fetch(new Request(r.url,{method:r.method,headers:r.headers,body,duplex:'half',signal:c.signal}));const handled=pending.catch(e=>e);await flush();const reason=new Error('cancel');if(mode==='abort')c.abort(reason);else sim.dispose();const error=await handled;assert.equal(mode==='abort'?error===reason:error.code==='SIMULATOR_DISPOSED',true);assert.equal(sim.inspect().active,0);assert.equal(sim.inspect().consumed,0);writer.enqueue(new TextEncoder().encode(JSON.stringify(r.body)));writer.close();await flush();assert.equal(sim.inspect().consumed,0);
});
test('Ark unsupported server/models/video/voice scopes fail closed',()=>{for(const scenario of ['models.list','video.output','voice.output'])assert.throws(()=>createArkSimulator({scenario}),{code:'SIMULATOR_UNSUPPORTED_FEATURE'});});

test('Queued abort settles independently of earlier never-ending Request admission',async()=>{
  let writer;const c1=new AbortController(),c2=new AbortController(),sim=createArkSimulator(),r=request();
  const first=sim.fetch(new Request(r.url,{method:r.method,headers:r.headers,body:new ReadableStream({start(c){writer=c;}}),duplex:'half',signal:c1.signal}));const firstHandled=first.catch(e=>e);await flush();
  const second=invoke(sim,r,c2.signal),secondHandled=second.catch(e=>e),reason=new Error('queued cancellation');c2.abort(reason);
  assert.equal(await Promise.race([secondHandled,new Promise(resolve=>setTimeout(()=>resolve('NOT_SETTLED'),100))]),reason);
  assert.equal(sim.inspect().consumed,0);c1.abort();await firstHandled;writer.close();await flush();assert.equal(sim.inspect().active,0);assert.equal(sim.inspect().consumed,0);
});
