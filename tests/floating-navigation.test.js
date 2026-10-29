import {createViewPosition} from '../src/view-position.js';
import {tabsMarkup} from '../src/view-markup.js';
import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasGeometry} from '../src/canvas-geometry.js';
import { readFile } from 'node:fs/promises';
const source=uiSource;
function mount(height=60,viewport=800){
 const classes=new Set(),styles={},events={};let disconnected=0,observed=0,scroll=0;
 const nav={getBoundingClientRect:()=>({height,bottom:height+10}),contains:()=>false};
 const app={contains:()=>true,querySelector:selector=>selector==='.top'?nav:null,classList:{toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},style:{setProperty:(k,v)=>styles[k]=v},addEventListener:(k,v)=>events[k]=v,scrollBy:o=>scroll+=o.top};
 const context={app,recordScrollDiagnostic:()=>{},document:{activeElement:null,addEventListener:(k,v)=>events['doc-'+k]=v},window:{innerHeight:viewport,addEventListener:()=>{}},ResizeObserver:class{observe(){observed++}disconnect(){disconnected++}},Math};
 Object.assign(context,createCanvasGeometry(context));context.syncFloatingNavigation();
 return {context,styles,classes,events,stats:()=>({disconnected,observed,scroll})};
}
test('floating clearance follows measured height; observer refresh disconnects old target',()=>{
 const m=mount();assert.equal(m.styles['--navigation-clearance'],'82px');
 m.context.syncFloatingNavigation();assert.deepEqual(m.stats(),{disconnected:1,observed:2,scroll:0});
});
test('oversized navigation falls back to normal flow rather than covering content',()=>{
 const m=mount(200,400);assert.ok(m.classes.has('navigation-in-flow'));assert.equal(m.styles['--navigation-clearance'],'0px');
});
test('keyboard focus under fixed navigation scrolls back into view',()=>{
 const m=mount();m.events['doc-keydown']({key:'Tab',isTrusted:true});m.events['doc-keydown']({key:'Tab',isTrusted:true});m.events.focusin({target:{matches:()=>true,getBoundingClientRect:()=>({top:20})}});assert.equal(m.stats().scroll,-62);
});
test('top navigation has no configuration badge while validation remains',()=>{
 assert.doesNotMatch(source,/class="top-right"|API 未配置|apiStatusMarkup|class="date"|未选择模型/);
 assert.match(source,/if \(!isConfigured\(d\)\)/);
});

test('rerender restores matching enabled action focus without forcing scroll',()=>{
 const active={tagName:'BUTTON',dataset:{action:'tab',tab:'logs'}};let options;
 const other={dataset:{action:'tab',tab:'chat'},focus:()=>assert.fail('Wrong tab focused')};
 const target={dataset:{action:'tab',tab:'logs'},focus:o=>options=o};
 const context={recordScrollDiagnostic:()=>{},document:{activeElement:active},app:{contains:()=>true,querySelectorAll:()=>[other,target]}};
 Object.assign(context,createViewPosition(context));context.restoreControlFocus(context.captureControlFocus());
 assert.equal(options.preventScroll,true);
 assert.match(source,/renderLogsPage\(\); restoreViewPosition\(scrollEnd\); restoreControlFocus\(focusIdentity\)/);
});

test('bottom metrics use per-response speed rather than task elapsed time',()=>{
 assert.ok(source.includes("replyMetricsMarkup(d.lastMetrics)"));
 assert.ok(!source.includes("耗时 <strong>"));
 assert.ok(!source.includes("d.elapsed === null ? '—'"));
});
function mountComposer({height=800,composerHeight=160,visual=null}={}){
 const classes=new Set(),styles={},observed=[],events={};let scroll=0;
 const nav={getBoundingClientRect:()=>({height:60,top:10,bottom:70}),contains:()=>false};
 const composer={getBoundingClientRect:()=>({height:composerHeight,top:height-composerHeight-10-parseFloat(styles['--keyboard-inset']||0)}),contains:()=>false};
 const app={contains:()=>true,querySelector:s=>s==='.top'?nav:s==='.composer-area'?composer:null,classList:{toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},style:{setProperty:(k,v)=>styles[k]=v},addEventListener:(k,v)=>events[k]=v,scrollBy:o=>scroll+=o.top};
 const context={app,recordScrollDiagnostic:()=>{},document:{activeElement:null,addEventListener:(k,v)=>events['doc-'+k]=v},window:{innerHeight:height,visualViewport:visual,addEventListener:()=>{}},document:{activeElement:null,addEventListener:(k,v)=>events['doc-'+k]=v},ResizeObserver:class{observe(el){observed.push(el)}disconnect(){}},Math};
 Object.assign(context,createCanvasGeometry(context));context.syncFloatingNavigation();
 return {context,styles,classes,observed,events,scroll:()=>scroll};
}
test('floating composer reserves measured bottom space and observes both overlays',()=>{
 const m=mountComposer();assert.equal(m.styles['--composer-clearance'],'182px');assert.equal(m.observed.length,2);
 m.events['doc-keydown']({key:'Tab',isTrusted:true});m.events.focusin({target:{matches:()=>true,getBoundingClientRect:()=>({top:650,bottom:680})}});assert.equal(m.scroll(),62);
});
test('combined overlay pressure sends long composer into flow and removes spacer',()=>{
 const m=mountComposer({height:400,composerHeight:260});assert.ok(m.classes.has('composer-in-flow'));assert.equal(m.styles['--composer-clearance'],'0px');
});
test('keyboard viewport updates inset; pinch zoom does not masquerade as keyboard',()=>{
 const visual={height:400,offsetTop:20,scale:1,addEventListener:()=>{}};
 const m=mountComposer({visual});assert.equal(m.styles['--keyboard-inset'],'380px');
 visual.scale=2;m.context.syncFloatingNavigation();assert.equal(m.styles['--keyboard-inset'],'0px');
});

test('chat placeholder is empty but image hint and accessible labels remain',()=>{
 assert.ok(source.includes("page === 'image' ? '描述你想生成的图片…' : ''"));
 assert.doesNotMatch(source,/输入消息…/);
 assert.ok(source.includes("page === 'image' ? '图片提示词' : '聊天消息'"));
});
test('floating captions have no shared panel while input retains translucent panel',async()=>{
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 const rules=css.slice(css.indexOf('/* Transparent floating wrapper:'));
 assert.match(rules,/padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none/);
 assert.match(rules,/\.composer-area \.compose\{padding:12px;border:1px solid var\(--line2\);border-radius:28px;background:rgba/);
 assert.match(rules,/\.compose-metrics\{padding:8px 8px 0;background:transparent;border:0;box-shadow:none/);
});
test('navigation uses concise visible and accessible labels without changing route IDs',()=>{
  const html=tabsMarkup('image');
 for(const [id,label] of [['chat','对话'],['image','图片'],['logs','日志']]) assert.match(html,new RegExp('data-tab="'+id+'">'+label+'</button>'));
 assert.doesNotMatch(html,/图片生成|通讯日志/);
 assert.match(html,/role="tab" aria-selected="true"[^>]*data-tab="image"/);
});

test('reasoning choice focus retains template and value identity across render',()=>{
 for(const [action,key,value]of [['reasoning-template','template','openai-effort'],['reasoning-value','value','high']]){
  let focused=false;const active={tagName:'BUTTON',dataset:{action,[key]:value}};
  const wrong={dataset:{action,[key]:'first'},focus:()=>assert.fail('Wrong reasoning choice')};
  const right={dataset:{action,[key]:value},focus:()=>focused=true};
  const context={recordScrollDiagnostic:()=>{},document:{activeElement:active},app:{contains:()=>true,querySelectorAll:()=>[wrong,right]}};
  Object.assign(context,createViewPosition(context));context.restoreControlFocus(context.captureControlFocus());assert.equal(focused,true);
 }
});
