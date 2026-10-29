import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const REQUEST_DEADLINE_MS'),source.indexOf('function applyCurrentTarget'));
function setup(){
 const timers=new Map();let id=0,announcements=0;
 const node={dataset:{},style:{setProperty(){}},setAttribute(){announcements++},querySelector:()=>({textContent:''})};
 const d={busy:true,controller:new AbortController()};
 const c={Date,Math,AppError:class extends Error{constructor(code,message){super(message);this.code=code}},get:()=>d,app:{querySelector:()=>node},esc:s=>s,
 setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},
 clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id)};
 vm.createContext(c);vm.runInContext(code,c);
 return {c,d,timers,node,announcements:()=>announcements};
}
test('elapsed waiting only slows animation, never infers thinking or failure',()=>{
 const {c}=setup();
 for(const phase of ['waiting_headers','headers_received','first_chunk']){
  const x=c.loadingPresentation({requestPhase:phase,requestPhaseAt:1000},61000);
  assert.equal(x.active,false);assert.equal(x.long,true);assert.equal(x.duration,3);assert.match(x.label,/尚未判定失败/);
 }
 const thought=c.loadingPresentation({requestPhase:'reasoning',requestPhaseAt:1000},21000);
 assert.equal(thought.active,true);assert.equal(thought.long,false);assert.ok(Math.abs(thought.duration-.35)<1e-9);
});
test('phase announcements are discrete and heartbeats do not overwrite actual output',()=>{
 const {c,d,announcements}=setup();c.beginLoading(d);c.requestPhase(d,'headers_received');c.requestPhase(d,'headers_received');
 assert.equal(announcements(),1);c.paintLoading(d);assert.equal(announcements(),1);
 c.requestPhase(d,'output');c.requestPhase(d,'first_chunk');assert.equal(d.requestPhase,'output');
});
test('explicit client deadline aborts once and cleanup releases all timers',()=>{
 const {c,d,timers}=setup();const stop=c.beginLoading(d);
 assert.equal(timers.size,2);const timeout=[...timers.values()].find(x=>x.ms===1800000);assert.ok(timeout);
 timeout.fn();assert.equal(d.controller.signal.aborted,true);
 assert.equal(c.requestError(d,new Error('abort')).code,'CLIENT_TIMEOUT');
 assert.match(c.requestError(d).message,/可能已经计费/);
 stop();assert.equal(timers.size,0);
});
test('normal completion and manual cancellation clear timers without relabeling as timeout',()=>{
 const {c,d,timers}=setup();const stop=c.beginLoading(d);d.controller.abort();stop();
 const error=new Error('manual');assert.equal(c.requestError(d,error),error);assert.equal(timers.size,0);
});

test('user cancellation is an informational status, not a red error',()=>{
 assert.match(source,/status\(d, errorText\(e\), e\?\.code === 'CANCELLED' \? 'status' : 'error', false\)/);
});
