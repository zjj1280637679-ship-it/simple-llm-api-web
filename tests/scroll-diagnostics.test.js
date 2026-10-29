const register=(map,key,fn)=>{const before=map[key];map[key]=before?event=>{before(event);fn(event);}:fn;};
import {copyDiagnosticReport} from '../src/clipboard-report.js';
import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {createCanvasGeometry} from '../src/canvas-geometry.js';import {readFile} from 'node:fs/promises';
const source=uiSource;
function setup(){const callbacks={};const secret={tagName:'INPUT',id:'key1',get value(){throw Error('secret read')},get textContent(){throw Error('content read')}};
 const app={querySelector:()=>null,scrollTop:1500,scrollHeight:4000,clientHeight:700,classList:{contains:()=>false},addEventListener:(k,v)=>register(callbacks,'app-'+k,v)};
 const window={scrollY:12,innerHeight:700,visualViewport:{height:0,offsetTop:2,scale:1},addEventListener:(k,v)=>register(callbacks,'window-'+k,v)};
 const document={activeElement:secret,visibilityState:'visible',scrollingElement:{scrollTop:12,scrollHeight:710,clientHeight:700},querySelector:()=>({getAttribute:()=> './src/app.js?v=0123456789abcdefabcd'})};
 const c={app,window,document,Date,Number,JSON};Object.assign(c,createCanvasGeometry(c));return {c,app,callbacks};}
test('diagnostic snapshot records zero viewport, both scroll roots and build, never content',()=>{const {c,callbacks}=setup();c.recordScrollDiagnostic('view-restore-write',-1500);callbacks['app-scroll']();callbacks['window-scroll']();const report=c.scrollDiagnosticReport();assert.equal(report.events[0].visualHeight,0);assert.equal(report.events[0].rootTop,12);assert.equal(report.events[0].top,1500);assert.equal(report.events[1].recentAction.reason,'view-restore-write');assert.equal(report.build.app,'0123456789abcdefabcd');assert.ok(!JSON.stringify(report).includes('secret read'));});
test('entering log page freezes evidence before navigation and later events cannot evict it',()=>{const {c,app}=setup();c.recordScrollDiagnostic('viewport');c.freezeScrollReport();const frozen=c.exportScrollReport();app.scrollTop=0;for(let i=0;i<100;i++)c.recordScrollDiagnostic('render-start');assert.equal(c.exportScrollReport(),frozen);assert.equal(c.window.__llmScrollDiagnostics().length,80);});
test('log UI has copy and download without console; all existing app writes are annotated',()=>{assert.match(source,/复制滚动诊断/);assert.match(source,/导出滚动诊断/);for(const reason of ['view-restore-write','stream-follow-write','geometry-write','explicit-focus-write','matrix-write','control-focus-restore','geometry-before-fields','geometry-after-fields','geometry-measured'])assert.ok(source.includes(reason));assert.match(source,/if\(el.dataset.tab === 'logs'\)freezeScrollReport\(\)/);assert.match(source,/clipboard.writeText\(text\)/);assert.match(source,/link.download='scroll-diagnostic.json'/);});

test('pending clipboard completion after leaving logs cannot touch stale nodes',async()=>{

 for(const fail of [false,true]){
  let finish;const field={isConnected:false,focus(){assert.fail('stale focus')},select(){assert.fail('stale select')}};
  const c={page:'logs',exportScrollReport:()=> '{}',app:{querySelector:()=>field},navigator:{clipboard:{writeText:()=>new Promise((resolve,reject)=>{finish=fail?reject:resolve})}}};
  const pending=copyDiagnosticReport({app:c.app,getPage:()=>c.page,clipboard:c.navigator.clipboard,text:'{}'});
  c.page='chat';c.app.querySelector=()=>null;finish();await pending;
 }
});

test('canvas snapshot distinguishes body exposure from a full-size hit-tested main without reading content',()=>{
 const {c,app}=setup();const body={get textContent(){throw Error('content read')}},main={getBoundingClientRect:()=>({top:-500,bottom:120,width:375,height:620,left:0,right:375})};
 app.getBoundingClientRect=()=>({top:0,bottom:700,width:375,height:700,left:0,right:375});app.querySelector=()=>main;c.document.body=body;c.document.elementFromPoint=()=>body;c.window.innerWidth=375;c.window.visualViewport.height=700;
 const surface=c.canvasSurfaceSnapshot();assert.equal(surface.main.bottom,120);assert.equal(surface.app.bottom,700);assert.ok(surface.hits.every(h=>h.surface==='body'));
 c.document.elementFromPoint=()=>main;assert.ok(c.canvasSurfaceSnapshot().hits.every(h=>h.surface==='main'));
 c.recordScrollDiagnostic('viewport-resize');const before=c.window.__llmScrollDiagnostics();before[0].mainRect.bottom=999;assert.equal(c.window.__llmScrollDiagnostics()[0].mainRect.bottom,120);
});
