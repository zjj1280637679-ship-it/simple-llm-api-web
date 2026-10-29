import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestLifecycle} from '../src/request-lifecycle.js';
import {createStreamPainter} from '../src/stream-painter.js';
import {readFile} from 'node:fs/promises';
const source=uiSource;
function setup(){
 const timers=new Map();let id=0,announcements=0;
 const node={dataset:{},style:{setProperty(){}},setAttribute(){announcements++},querySelector:()=>({textContent:''})};
 const d={busy:true,controller:new AbortController()};
 const c={Date,Math,AppError:class extends Error{constructor(code,message){super(message);this.code=code}},get:()=>d,app:{querySelector:()=>node},esc:s=>s,
 setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},
 clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id)};
 Object.assign(c,createRequestLifecycle({...c,clock:c}));
 return {c,d,timers,node,announcements:()=>announcements};
}
test('elapsed waiting changes only delay indication, never infers thinking or failure',()=>{
 const {c}=setup();
 for(const phase of ['waiting_headers','headers_received','first_chunk']){
  const x=c.loadingPresentation({requestPhase:phase,requestPhaseAt:1000},61000);
  assert.equal(x.active,false);assert.equal(x.long,true);assert.equal(x.duration,1.25);assert.match(x.label,/尚未判定失败/);
 }
 const thought=c.loadingPresentation({requestPhase:'reasoning',requestPhaseAt:1000},21000);
 assert.equal(thought.active,true);assert.equal(thought.long,false);assert.ok(Math.abs(thought.duration-.5)<1e-9);
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
test('fixed CSS timeline changes playback rate once per stage without per-tick duration edits',()=>{
 const calls=[],animation={animationName:'api-spin',currentTime:1234,updatePlaybackRate(rate){calls.push(rate)}};
 const spinner={dataset:{},getAnimations:()=>[animation]};
 const d={busy:true,requestPhase:'waiting_headers',requestPhaseAt:Date.now()};
 const node={dataset:{},style:{setProperty(){assert.fail('must not change duration')}},setAttribute(){},querySelector:s=>s==='.api-spinner'?spinner:{textContent:''}};
 const c={Date,Math,get:()=>d,app:{querySelector:()=>node},esc:s=>s};Object.assign(c,createRequestLifecycle({...c,clock:c}));
 for(let i=0;i<30;i++)c.paintLoading(d);
 assert.deepEqual(calls,[.64]);assert.equal(animation.currentTime,1234);
 d.requestPhase='output';c.paintLoading(d);c.paintLoading(d);
 assert.deepEqual(calls,[.64,1.6]);assert.equal(animation.currentTime,1234);
});
test('first streaming delta inserts reply beside the existing spinner, subsequent deltas only paint text',()=>{
 let reply=null,renders=0,inserts=0;const text={},label={};
 const spinner={closest:()=>({insertAdjacentHTML(){inserts++;reply={querySelector:s=>s==='.reply-text'?text:label}}})};
 const app={scrollHeight:1000,clientHeight:500,scrollTop:500,querySelector:s=>s==='.api-loading'?spinner:reply};
 const d={};const c={recordScrollDiagnostic:()=>{},get:()=>d,app,render:()=>renders++,messageMarkup:()=>'<div></div>'};c.paintStream=createStreamPainter({...c,saveLocal(){}});
 for(let i=0;i<20;i++)c.paintStream(d,{id:1,text:'chunk'+i,streaming:true});
 assert.equal(renders,0);assert.equal(inserts,1);assert.equal(app.querySelector('.api-loading'),spinner);assert.equal(text.textContent,'chunk19');
});
test('ordinary waiting never uses failure-red and reduced motion remains supported',async()=>{
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(css,/api-spin \.8s linear/);assert.doesNotMatch(css,/animation:api-spin var/);
 assert.match(css,/\.api-loading\[data-long="true"\]\{color:#a66b12\}/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
