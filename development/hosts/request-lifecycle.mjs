import assert from 'node:assert/strict';
import {createRequestLifecycle} from '../../src/request-lifecycle.js';
import {report} from './report.mjs';
await report('request-lifecycle',async()=>{
  const timers=new Map();let n=0;const clock={setTimeout:(f,ms)=>{timers.set(++n,{f,ms});return n;},setInterval:(f,ms)=>{timers.set(++n,{f,ms});return n;},clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)};const d={busy:true,controller:new AbortController()};const host=createRequestLifecycle({app:{querySelector:()=>null},get:()=>d,esc:x=>x,clock});host.beginLoading(d);assert.equal(timers.size,2);host.dispose();assert.equal(timers.size,0);assert.equal(d.controller.signal.aborted,true);return {timersReleased:true,requestAborted:true};
});
