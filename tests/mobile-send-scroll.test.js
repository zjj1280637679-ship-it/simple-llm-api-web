import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function captureScrollGeometry('),source.indexOf('function syncFloatingNavigation('));
function mount(){
 let y=2600,height=3400;const calls=[];
 const nav={contains:()=>false,getBoundingClientRect:()=>({bottom:80})};
 const composer={contains:()=>false,getBoundingClientRect:()=>({top:650})};
 const app={get scrollTop(){return y},set scrollTop(v){y=Math.max(0,Math.min(v,height-800))},get scrollHeight(){return height},clientHeight:800,contains:t=>Boolean(t.inside),classList:{contains:()=>false},querySelector:s=>s==='.top'?nav:composer,scrollBy:o=>{calls.push(o.top);app.scrollTop+=o.top;}};
 const c={app,recordScrollDiagnostic:()=>{},window:{innerHeight:800},Math,Number};vm.createContext(c);vm.runInContext(code,c);
 return {app,c,calls,setHeight:v=>{height=v;},field:(top,bottom)=>({inside:true,matches:()=>true,closest:()=>null,getBoundingClientRect:()=>({top,bottom})})};
}
test('repeated viewport focus checks after send ignore body, detached nodes and non-controls',()=>{
 const {app,c,calls}=mount();
 for(let i=0;i<30;i++){
  c.protectFloatingFocus({inside:false,matches:()=>true,getBoundingClientRect:()=>({top:0,bottom:800})});
  c.protectFloatingFocus({inside:true,matches:()=>false,getBoundingClientRect:()=>({top:0,bottom:800})});
 }
 assert.equal(app.scrollTop,2600);assert.equal(calls.length,0);
});
test('real focused controls still reveal above navigation or below composer',()=>{
 const {c,calls,field}=mount();c.protectFloatingFocus(field(20,50));c.protectFloatingFocus(field(660,700));
 assert.deepEqual(calls,[-72,62]);
});
test('keyboard inset and draft-height geometry changes follow bottom but preserve active reading',()=>{
 const {app,c,setHeight}=mount();const bottom=c.captureScrollGeometry();
 setHeight(3800);c.restoreScrollGeometry(bottom);assert.equal(app.scrollTop,3000);
 const closing=c.captureScrollGeometry();setHeight(3300);c.restoreScrollGeometry(closing);assert.equal(app.scrollTop,2500);
 app.scrollTop=735;const reading=c.captureScrollGeometry();setHeight(3500);c.restoreScrollGeometry(reading);assert.equal(app.scrollTop,735);
});
test('manual scroll policy is scoped to app; user zoom remains available',async()=>{
 const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(css,/\.shell\{overflow-anchor:none;scroll-behavior:auto\}/);
 assert.doesNotMatch(html,/user-scalable=no|maximum-scale/);
 assert.match(source,/const before = captureScrollGeometry\(\)/);assert.match(source,/restoreScrollGeometry\(before\)/);
});
