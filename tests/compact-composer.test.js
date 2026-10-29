import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function resizeDraft('),source.indexOf('function protectFloatingFocus('));
function measure(height,{viewport=800,line=21}={}) {
 const field={matches:()=>true,style:{},scrollHeight:height,value:'输入中\nsecond line',selectionStart:2,selectionEnd:3};
 const context={app:{querySelector:()=>field},window:{innerHeight:viewport},getComputedStyle:()=>({lineHeight:String(line),paddingTop:'10',paddingBottom:'10'}),Math,parseFloat};
 vm.createContext(context);vm.runInContext(code,context);context.resizeDraft(field);return {field,context};
}
test('idle draft is compact and multi-line draft grows then shrinks without rewriting text or selection',()=>{
 const {field,context}=measure(41);assert.equal(field.style.height,'44px');
 field.scrollHeight=125;context.resizeDraft(field);assert.equal(field.style.height,'125px');
 field.scrollHeight=41;context.resizeDraft(field);assert.equal(field.style.height,'44px');
 assert.equal(field.value,'输入中\nsecond line');assert.equal(field.selectionStart,2);assert.equal(field.selectionEnd,3);
});
test('long draft has bounded scrollable editing area and enlarged text gets a full line',()=>{
 const {field}=measure(3000,{viewport:400});assert.equal(field.style.height,'120px');assert.equal(field.style.overflowY,'auto');
 assert.equal(measure(62,{line:42}).field.style.height,'62px');
});
test('capsule keeps 44px controls, separate metrics, dynamic resize and unchanged Enter/IME behavior',()=>{
 assert.match(css,/grid-template-columns:44px minmax\(0,1fr\) 44px/);
 assert.match(css,/\.composer-area \.circle,\.composer-area \.send\{width:44px;height:44px/);
 assert.match(source,/id="draft" rows="1"/);
 assert.match(source,/d\.draft = t\.value; resizeDraft\(t\)/);
 assert.match(source,/!e\.shiftKey && !e\.isComposing/);
 assert.match(source,/class="compose-metrics"/);
});
