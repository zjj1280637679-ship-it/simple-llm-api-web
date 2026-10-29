import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const layout=source.slice(source.indexOf('// Measure the real floating group'),source.indexOf('// Native Popover supplies'));
function mount(height=60,viewport=800){
 const classes=new Set(),styles={},events={};let disconnected=0,observed=0,scroll=0;
 const nav={getBoundingClientRect:()=>({height,bottom:height+10}),contains:()=>false};
 const app={querySelector:selector=>selector==='.top'?nav:null,classList:{toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},style:{setProperty:(k,v)=>styles[k]=v},addEventListener:(k,v)=>events[k]=v,scrollBy:o=>scroll+=o.top};
 const context={app,window:{innerHeight:viewport,addEventListener:()=>{}},ResizeObserver:class{observe(){observed++}disconnect(){disconnected++}},Math};
 vm.createContext(context);vm.runInContext(layout+'\nsyncFloatingNavigation();',context);
 return {context,styles,classes,events,stats:()=>({disconnected,observed,scroll})};
}
test('floating clearance follows measured height; observer refresh disconnects old target',()=>{
 const m=mount();assert.equal(m.styles['--navigation-clearance'],'82px');
 vm.runInContext('syncFloatingNavigation()',m.context);assert.deepEqual(m.stats(),{disconnected:1,observed:2,scroll:0});
});
test('oversized navigation falls back to normal flow rather than covering content',()=>{
 const m=mount(200,400);assert.ok(m.classes.has('navigation-in-flow'));assert.equal(m.styles['--navigation-clearance'],'0px');
});
test('keyboard focus under fixed navigation scrolls back into view',()=>{
 const m=mount();m.events.focusin({target:{getBoundingClientRect:()=>({top:20})}});assert.equal(m.stats().scroll,-62);
});
test('top navigation has no configuration badge while validation remains',()=>{
 assert.doesNotMatch(source,/class="top-right"|API 未配置|apiStatusMarkup|class="date"|未选择模型/);
 assert.match(source,/if \(!isConfigured\(d\)\)/);
});

test('rerender restores matching enabled action focus without forcing scroll',()=>{
 const block=source.slice(source.indexOf('function captureControlFocus()'),source.indexOf('function render(scrollEnd'));
 const active={tagName:'BUTTON',dataset:{action:'tab',tab:'logs'}};let options;
 const other={dataset:{action:'tab',tab:'chat'},focus:()=>assert.fail('Wrong tab focused')};
 const target={dataset:{action:'tab',tab:'logs'},focus:o=>options=o};
 const context={document:{activeElement:active},app:{contains:()=>true,querySelectorAll:()=>[other,target]}};
 vm.createContext(context);vm.runInContext(block+'\nrestoreControlFocus(captureControlFocus());',context);
 assert.equal(options.preventScroll,true);
 assert.match(source,/renderLogsPage\(\); restoreViewPosition\(scrollEnd\); restoreControlFocus\(focusIdentity\)/);
});

test('pending elapsed time uses the shared three-dot presentation',()=>{
 assert.ok(source.includes("d.elapsed === null ? '...'"));
 assert.ok(!source.includes("d.elapsed === null ? '—'"));
});
function mountComposer({height=800,composerHeight=160,visual=null}={}){
 const classes=new Set(),styles={},observed=[],events={};let scroll=0;
 const nav={getBoundingClientRect:()=>({height:60,top:10,bottom:70}),contains:()=>false};
 const composer={getBoundingClientRect:()=>({height:composerHeight,top:height-composerHeight-10-parseFloat(styles['--keyboard-inset']||0)}),contains:()=>false};
 const app={querySelector:s=>s==='.top'?nav:s==='.composer-area'?composer:null,classList:{toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},style:{setProperty:(k,v)=>styles[k]=v},addEventListener:(k,v)=>events[k]=v,scrollBy:o=>scroll+=o.top};
 const context={app,window:{innerHeight:height,visualViewport:visual,addEventListener:()=>{}},document:{activeElement:null},ResizeObserver:class{observe(el){observed.push(el)}disconnect(){}},Math};
 vm.createContext(context);vm.runInContext(layout+'\nsyncFloatingNavigation();',context);
 return {context,styles,classes,observed,events,scroll:()=>scroll};
}
test('floating composer reserves measured bottom space and observes both overlays',()=>{
 const m=mountComposer();assert.equal(m.styles['--composer-clearance'],'182px');assert.equal(m.observed.length,2);
 m.events.focusin({target:{getBoundingClientRect:()=>({top:650,bottom:680})}});assert.equal(m.scroll(),62);
});
test('combined overlay pressure sends long composer into flow and removes spacer',()=>{
 const m=mountComposer({height:400,composerHeight:260});assert.ok(m.classes.has('composer-in-flow'));assert.equal(m.styles['--composer-clearance'],'0px');
});
test('keyboard viewport updates inset; pinch zoom does not masquerade as keyboard',()=>{
 const visual={height:400,offsetTop:20,scale:1,addEventListener:()=>{}};
 const m=mountComposer({visual});assert.equal(m.styles['--keyboard-inset'],'380px');
 visual.scale=2;vm.runInContext('syncFloatingNavigation()',m.context);assert.equal(m.styles['--keyboard-inset'],'0px');
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
