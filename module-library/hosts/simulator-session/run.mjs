import assert from 'node:assert/strict';
import {createSimulatorCore} from '../../relations/simulator-session/index.js';
import {runHost} from '../support.mjs';

await runHost('R-003',async()=>{
  const jobs=new Map();let next=0;
  const scheduler={setTimeout(fn){const id=++next;jobs.set(id,fn);return id;},clearTimeout(id){jobs.delete(id);}};
  const request={method:'POST',url:'https://session.invalid/request',headers:{'content-type':'application/json'},body:{prompt:'host'}};
  const invoke=(sim,signal)=>sim.fetch(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(request.body),signal});
  const fixture={id:'session-host',steps:[{request,response:{status:200,json:{sequence:1},delayMs:20}},{request,response:{status:200,json:{sequence:2}}}]};
  const sim=createSimulatorCore({fixture,revision:{version:'host-inline-1'},clock:()=>0,scheduler});
  const abort=new AbortController();const first=invoke(sim,abort.signal);
  const observedFirst=assert.rejects(first,error=>error===abort.signal.reason);
  const second=await invoke(sim);
  assert.deepEqual(await second.json(),{sequence:2});
  assert.equal(sim.inspect().pending,1);assert.equal(sim.inspect().consumed,2);
  abort.abort(new Error('host cancellation'));await observedFirst;
  assert.equal(jobs.size,0);assert.equal(sim.assertComplete().pending,0);
  const isolated=createSimulatorCore({fixture:{id:'isolated',steps:[{request,response:{status:200,hang:true}}]},revision:{},scheduler});
  const pending=invoke(isolated);const rejected=assert.rejects(pending,error=>error.code==='SIMULATOR_DISPOSED');
  for(let i=0;isolated.inspect().pending===0&&i<20;i++)await Promise.resolve();
  assert.equal(isolated.inspect().pending,1);isolated.dispose();await rejected;
  assert.equal(isolated.inspect().pending,0);assert.equal(isolated.inspect().active,0);
  assert.equal(sim.inspect().failed,false);sim.dispose();
  return {matchedOrder:sim.inspect().events.filter(event=>event.outcome==='request-matched').map(event=>event.step),
    secondResponseWhileFirstPending:true,abortedPending:sim.inspect().pending,remainingTimers:jobs.size,
    isolatedDisposed:true,independentState:true,realNetworkRequests:0};
});
