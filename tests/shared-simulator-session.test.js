import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulatorCore} from '../module-library/relations/simulator-session/index.js';
import {SimulatorError} from '../module-library/functions/fixture-contract/index.js';
import * as legacy from '../module-library/test-resources/shared/core.js';
const request={method:'POST',url:'https://session.invalid/request',headers:{'content-type':'application/json'},body:{prompt:'test'}};
const fixture=(responses=[{status:200,json:{ok:true}}])=>({id:'independent',steps:responses.map(response=>({request:structuredClone(request),response}))});
const invoke=(sim,overrides={})=>sim.fetch(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(request.body),...overrides});
const scheduler=()=>{let next=0;const jobs=new Map();return {jobs,setTimeout(fn){const id=++next;jobs.set(id,fn);return id;},clearTimeout(id){jobs.delete(id);},run(){for(const [id,fn] of [...jobs]){jobs.delete(id);fn();}}};};
const ready=async predicate=>{for(let i=0;i<100&&!predicate();i++)await Promise.resolve();assert(predicate(),'expected microtask progress');};

test('session relation is the same function exported through the legacy shared entry',()=>{
  assert.equal(legacy.createSimulatorCore,createSimulatorCore);
});
test('session composes exact matching with ordered consumption but independently completes delayed responses',async()=>{
  const timer=scheduler(),sim=createSimulatorCore({fixture:fixture([{status:200,json:{id:1},delayMs:1},{status:200,json:{id:2}}]),revision:{version:'sample'},scheduler:timer});
  const first=invoke(sim),second=await invoke(sim);assert.deepEqual(await second.json(),{id:2});
  assert.equal(sim.inspect().pending,1);assert.equal(sim.inspect().consumed,2);
  assert.throws(()=>sim.assertComplete(),error=>error.code==='SIMULATOR_INCOMPLETE');
  timer.run();assert.deepEqual(await (await first).json(),{id:1});
  assert.deepEqual(sim.assertComplete().events.filter(e=>e.outcome==='request-matched').map(e=>e.step),[1,2]);
});
test('a mismatch never consumes a step and remains latched after later successful completion',async()=>{
  const sim=createSimulatorCore({fixture:fixture(),revision:{}});
  await assert.rejects(invoke(sim,{body:'{"prompt":"secret-value"}'}),error=>error instanceof SimulatorError&&error.code==='SIMULATOR_REQUEST_MISMATCH');
  assert.equal(sim.inspect().consumed,0);assert.equal(sim.inspect().failed,true);
  await invoke(sim);assert.equal(sim.inspect().consumed,1);
  assert.throws(()=>sim.assertComplete(),error=>error.code==='SIMULATOR_ASSERTION_FAILED');
  assert(!JSON.stringify(sim.inspect()).includes('secret-value'));
});
test('instances own separate state and timer cleanup even when sharing a scheduler',async()=>{
  const timer=scheduler(),options={fixture:fixture([{status:200,json:{ok:true},delayMs:5}]),revision:{},scheduler:timer};
  const one=createSimulatorCore(options),two=createSimulatorCore(options),abort=new AbortController();
  const a=invoke(one,{signal:abort.signal}),aRejected=assert.rejects(a,error=>error===abort.signal.reason),b=invoke(two);
  await ready(()=>one.inspect().pending===1&&two.inspect().pending===1);
  abort.abort(new Error('cancel one'));await aRejected;assert.equal(timer.jobs.size,1);assert.equal(two.inspect().pending,1);
  timer.run();await b;assert.equal(two.assertComplete().failed,false);assert.equal(one.inspect().pending,0);
});
test('fixture, revision, and observation mutation cannot alter a live session',async()=>{
  const input=fixture(),revision={resource:{id:'original'}},sim=createSimulatorCore({fixture:input,revision});
  input.steps[0].request.body.prompt='changed';input.steps[0].response.json.ok=false;revision.resource.id='changed';
  const report=sim.inspect();report.resourceRevisions[0].resource.id='other';report.events.push({fake:true});
  assert.deepEqual(await (await invoke(sim)).json(),{ok:true});
  assert.equal(sim.assertComplete().resourceRevisions[0].resource.id,'original');assert(!sim.inspect().events.some(e=>e.fake));
});
test('dispose rejects pending delivery, clears timers and refuses later requests without affecting peers',async()=>{
  const timer=scheduler(),sim=createSimulatorCore({fixture:fixture([{status:200,hang:true}]),revision:{},scheduler:timer});
  const pending=invoke(sim),rejected=assert.rejects(pending,error=>error.code==='SIMULATOR_DISPOSED');
  await ready(()=>sim.inspect().pending===1);sim.dispose();sim.dispose();await rejected;
  assert.equal(sim.inspect().pending,0);assert.equal(sim.inspect().active,0);assert.equal(timer.jobs.size,0);
  await assert.rejects(invoke(sim),error=>error.code==='SIMULATOR_DISPOSED');
});
test('abort before admission consumes no step and preserves the original abort reason',async()=>{
  const abort=new AbortController(),reason=new Error('stop');abort.abort(reason);
  const sim=createSimulatorCore({fixture:fixture(),revision:{}});
  await assert.rejects(invoke(sim,{signal:abort.signal}),error=>error===reason);
  assert.equal(sim.inspect().consumed,0);assert.equal(sim.inspect().failed,false);await invoke(sim);sim.assertComplete();
});
test('disposal releases an unfinished Request-body reader and queued requests without consuming either',async()=>{
  const stream=new ReadableStream({start(){}}),requestObject=new Request(request.url,{method:'POST',headers:request.headers,body:stream,duplex:'half'});
  const sim=createSimulatorCore({fixture:fixture(),revision:{}}),first=sim.fetch(requestObject),second=invoke(sim);
  const firstRejected=assert.rejects(first,error=>error.code==='SIMULATOR_DISPOSED');
  const secondRejected=assert.rejects(second,error=>error.code==='SIMULATOR_DISPOSED');
  await Promise.resolve();await Promise.resolve();sim.dispose();await Promise.all([firstRejected,secondRejected]);
  assert.equal(sim.inspect().active,0);assert.equal(sim.inspect().consumed,0);
});
test('missing scheduler is a latched configuration failure, not an external fetch fallback',async()=>{
  const sim=createSimulatorCore({fixture:fixture([{status:200,json:{ok:true},delayMs:1}]),revision:{}});
  await assert.rejects(invoke(sim),error=>error.code==='SIMULATOR_CONFIGURATION');assert.equal(sim.inspect().failed,true);
  assert.equal(sim.inspect().pending,0);
});
