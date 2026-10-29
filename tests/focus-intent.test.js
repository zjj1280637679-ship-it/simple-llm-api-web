const register=(map,key,fn)=>{const before=map[key];map[key]=before?event=>{before(event);fn(event);}:fn;};
import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createCanvasGeometry} from '../src/canvas-geometry.js';import {readFile} from 'node:fs/promises';
const source=uiSource;
function mount(){
 const events={},calls=[];let writes=0,y=6000;
 const old={tagName:'INPUT',id:'key1',inside:true,matches:()=>true,closest(selector){return selector==='[data-floating-menu]'?null:this;},getBoundingClientRect:()=>({top:-5000,bottom:-4950})};
 const app={contains:t=>t.inside,querySelector:s=>s==='#draft'||s==='[data-floating-menu]'?null:({contains:()=>false,getBoundingClientRect:()=>s==='.top'?{height:60,bottom:80}:{height:150,top:650}}),style:{setProperty(){}},classList:{contains:()=>false,toggle(){}},addEventListener:(k,v)=>register(events,'app-'+k,v),scrollBy:o=>{calls.push(o.top);y+=o.top;},get scrollTop(){return y},set scrollTop(v){writes++;y=v},scrollHeight:6800,clientHeight:800};
 const document={activeElement:old,visibilityState:'visible',hasFocus:()=>true,addEventListener:(k,v)=>register(events,'doc-'+k,v)};
 const window={innerHeight:800,addEventListener:(k,v)=>register(events,'win-'+k,v),visualViewport:{height:800,offsetTop:0,scale:1,addEventListener:(k,v)=>register(events,'vv-'+k,v)}};
 const c={app,document,window,Date,Math,Number,recordScrollDiagnostic:()=>{},syncFloatingNavigation:()=>{}};Object.assign(c,createCanvasGeometry(c));
 return {c,old,events,calls,app,document,writes:()=>writes};
}
test('screenshot-like viewport/blur/visibility sequence never reveals stale real input',()=>{
 const m=mount();for(let i=0;i<30;i++){m.events['vv-resize']();m.events['vv-scroll']();m.events['win-blur']();m.document.visibilityState='hidden';m.events['doc-visibilitychange']();m.document.visibilityState='visible';m.events['doc-visibilitychange']();m.events['app-focusin']({target:m.old});}
 assert.equal(m.app.scrollTop,6000);assert.equal(m.calls.length,0);
});
test('only fresh trusted pointer or Tab intent may reveal an actual field, once',()=>{
 const m=mount();m.events['doc-pointerdown']({target:m.old,isTrusted:true});m.events['app-focusin']({target:m.old});assert.deepEqual(m.calls,[-5092]);
 m.events['app-focusin']({target:m.old});assert.equal(m.calls.length,1);
 m.events['doc-keydown']({key:'Tab',isTrusted:true});m.events['win-blur']();m.events['app-focusin']({target:m.old});assert.equal(m.calls.length,1);
 m.events['doc-pointerdown']({target:m.old,isTrusted:false});m.events['app-focusin']({target:m.old});assert.equal(m.calls.length,1);
});
test('unchanged geometry is a no-op rather than another active scroll write',()=>{
 const m=mount();for(let i=0;i<30;i++)m.c.restoreScrollGeometry(m.c.captureScrollGeometry());assert.equal(m.writes(),0);
});
test('bounded memory diagnostics never inspect values or chat contents',()=>{
 const active={tagName:'INPUT',id:'key1',get value(){throw Error('must not read secret')}};
 const c={app:{scrollTop:0,scrollHeight:800,clientHeight:800,addEventListener:()=>{}},window:{},document:{activeElement:active},Date,Number};Object.assign(c,createCanvasGeometry(c));
 for(let i=0;i<100;i++)c.recordScrollDiagnostic('viewport');const logs=c.window.__llmScrollDiagnostics();assert.equal(logs.length,80);assert.equal(logs[0].focusId,'key1');assert.ok(logs.every(x=>!('value' in x)&&!('content' in x)));logs[0].reason='mutated';assert.equal(c.window.__llmScrollDiagnostics()[0].reason,'viewport');
});
