import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const viewPositions ='),source.indexOf('function render(scrollEnd'));
function setup(){const frames=[],app={scrollTop:0,scrollHeight:3000,clientHeight:800};const c={recordScrollDiagnostic:()=>{},app,page:'chat',Map,Math,Number,requestAnimationFrame:fn=>frames.push(fn)};vm.createContext(c);vm.runInContext(code,c);return {app,c,frames};}
test('each tab restores independent reading position rather than the short-page clamped offset',()=>{
 const {app,c}=setup();c.restoreViewPosition();app.scrollTop=735;c.rememberViewPosition();
 c.page='image';app.scrollHeight=800;app.scrollTop=0;c.restoreViewPosition();assert.equal(app.scrollTop,0);
 c.rememberViewPosition();c.page='chat';app.scrollHeight=3000;c.restoreViewPosition();assert.equal(app.scrollTop,735);
 c.rememberViewPosition();c.page='logs';app.scrollHeight=4000;c.restoreViewPosition();app.scrollTop=1234;c.rememberViewPosition();
 c.page='chat';app.scrollHeight=3000;c.restoreViewPosition();assert.equal(app.scrollTop,735);
 c.rememberViewPosition();c.page='logs';app.scrollHeight=4000;c.restoreViewPosition();assert.equal(app.scrollTop,1234);
});
test('bottom-follow intent survives offscreen content growth and explicit send scroll',()=>{
 const {app,c}=setup();c.restoreViewPosition();app.scrollTop=2200;c.rememberViewPosition();
 c.page='image';c.restoreViewPosition();c.rememberViewPosition();c.page='chat';app.scrollHeight=4500;c.restoreViewPosition();assert.equal(app.scrollTop,4500);
 app.scrollTop=100;c.rememberViewPosition();c.restoreViewPosition(true);assert.equal(app.scrollTop,4500);
});
test('queued layout correction cannot overwrite a newer tab or intervening user scroll',()=>{
 const {app,c,frames}=setup();c.restoreViewPosition();app.scrollTop=53;frames.shift()();assert.equal(app.scrollTop,53);
 c.rememberViewPosition();c.page='image';c.restoreViewPosition();c.page='logs';c.restoreViewPosition();app.scrollTop=66;frames.forEach(fn=>fn());assert.equal(app.scrollTop,66);
});
test('viewport permits user zoom and touch edit controls have readable minimum sizing',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(html,/width=device-width, initial-scale=1/);assert.doesNotMatch(html,/user-scalable=no|maximum-scale/);
 assert.doesNotMatch(html,/autofocus/);assert.match(css,/font-size:max\(16px,1em\)/);
});
