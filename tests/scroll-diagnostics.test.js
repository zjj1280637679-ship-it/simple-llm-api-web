import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
function setup(){const callbacks={};const secret={tagName:'INPUT',id:'key1',get value(){throw Error('secret read')},get textContent(){throw Error('content read')}};
 const app={scrollTop:1500,scrollHeight:4000,clientHeight:700,classList:{contains:()=>false},addEventListener:(k,v)=>callbacks['app-'+k]=v};
 const window={scrollY:12,innerHeight:700,visualViewport:{height:0,offsetTop:2,scale:1},addEventListener:(k,v)=>callbacks['window-'+k]=v};
 const document={activeElement:secret,visibilityState:'visible',scrollingElement:{scrollTop:12,scrollHeight:710,clientHeight:700},querySelector:()=>({getAttribute:()=> './src/app.js?v=0123456789abcdefabcd'})};
 const c={app,window,document,Date,Number,JSON};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const scrollDiagnostics ='),source.indexOf('// Measure the real floating')),c);return {c,app,callbacks};}
test('diagnostic snapshot records zero viewport, both scroll roots and build, never content',()=>{const {c,callbacks}=setup();c.recordScrollDiagnostic('view-restore-write',-1500);callbacks['app-scroll']();callbacks['window-scroll']();const report=c.scrollDiagnosticReport();assert.equal(report.events[0].visualHeight,0);assert.equal(report.events[0].rootTop,12);assert.equal(report.events[0].top,1500);assert.equal(report.events[1].recentAction.reason,'view-restore-write');assert.equal(report.build.app,'0123456789abcdefabcd');assert.ok(!JSON.stringify(report).includes('secret read'));});
test('entering log page freezes evidence before navigation and later events cannot evict it',()=>{const {c,app}=setup();c.recordScrollDiagnostic('viewport');c.freezeScrollReport();const frozen=c.exportScrollReport();app.scrollTop=0;for(let i=0;i<100;i++)c.recordScrollDiagnostic('render-start');assert.equal(c.exportScrollReport(),frozen);assert.equal(c.window.__llmScrollDiagnostics().length,80);});
test('log UI has copy and download without console; all existing app writes are annotated',()=>{assert.match(source,/复制滚动诊断/);assert.match(source,/导出滚动诊断/);for(const reason of ['view-restore-write','stream-follow-write','geometry-write','explicit-focus-write','matrix-write','control-focus-restore','geometry-before-fields','geometry-after-fields','geometry-measured'])assert.ok(source.includes(reason));assert.match(source,/if\(el.dataset.tab === 'logs'\)freezeScrollReport\(\)/);assert.match(source,/navigator.clipboard.writeText\(text\)/);assert.match(source,/link.download='scroll-diagnostic.json'/);});

test('pending clipboard completion after leaving logs cannot touch stale nodes',async()=>{
 const body=source.slice(source.indexOf("case 'copy-scroll-diagnostics': {")+33,source.indexOf("case 'export-scroll-diagnostics':")).replace(/break;\s*}\s*$/,'');
 for(const fail of [false,true]){
  let finish;const field={isConnected:false,focus(){assert.fail('stale focus')},select(){assert.fail('stale select')}};
  const c={page:'logs',exportScrollReport:()=> '{}',app:{querySelector:()=>field},navigator:{clipboard:{writeText:()=>new Promise((resolve,reject)=>{finish=fail?reject:resolve})}}};
  vm.createContext(c);const pending=vm.runInContext('(async()=>{'+body+'})()',c);
  c.page='chat';c.app.querySelector=()=>null;finish();await pending;
 }
});
