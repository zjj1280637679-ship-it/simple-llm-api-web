import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const layout=source.slice(source.indexOf('// Measure the real floating group'),source.indexOf('const esc = value =>'));
function mount(height=60,viewport=800){
 const classes=new Set(),styles={},events={};let disconnected=0,observed=0,scroll=0;
 const nav={getBoundingClientRect:()=>({height,bottom:height+10}),contains:()=>false};
 const app={querySelector:()=>nav,classList:{toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},style:{setProperty:(k,v)=>styles[k]=v},addEventListener:(k,v)=>events[k]=v,scrollBy:o=>scroll+=o.top};
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
 assert.match(source,/renderLogsPage\(\); restoreControlFocus\(focusIdentity\)/);
});
