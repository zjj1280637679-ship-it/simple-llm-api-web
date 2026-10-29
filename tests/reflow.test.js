import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const app=uiSource;
test('reflow policy explicitly lets constrained text and action groups wrap',()=>{
 const rules=css.slice(css.indexOf('/* Content-driven reflow:'));
 for(const selector of ['.top{height:auto','.tabs{display:flex;flex-wrap:wrap','.fieldrow{flex-wrap:wrap','.compose-metrics{flex-wrap:wrap','.matrix-pixels,.size-dim{white-space:normal'])assert.ok(rules.includes(selector),selector);
 assert.match(rules,/overflow-wrap:anywhere/);
 assert.match(rules,/\.thread\{min-height:min\(18rem,45dvh\)\}/);
 assert.match(rules,/\.shell\{overflow:auto\}/);
 assert.match(rules,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,12rem\),1fr\)\)/);
 assert.match(rules,/@media\(max-height:600px\)/);
 assert.match(rules,/\.size-menu,\.plus-menu\{position:static;margin-top:10px;max-width:100%;max-height:none\}/);
});
test('read-only descriptive values reflow while editable key/number semantics remain',()=>{
 assert.match(app,/<output[^>]*class="block-value">当前对话上下文<\/output>/);
 assert.match(app,/<output[^>]*class="block-value">上游原始格式<\/output>/);
 assert.match(app,/type="number"/);assert.match(app,/'text' : 'password'/);
});
test('manual browser harness is separate from production and labels synthetic scope',async()=>{
 const h=await readFile(new URL('./browser/reflow.html',import.meta.url),'utf8');
 for(const w of [320,375,430,768,1280])assert.ok(h.includes(`<option>${w}</option>`));
 assert.match(h,/QA network disabled/);assert.match(h,/synthetic display fixtures/);
 const build=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');assert.doesNotMatch(build,/reflow\.html/);
});

test('usage indicators share a flex row and wrap only under width pressure',()=>{
 const rules=css.slice(css.indexOf('/* Content-driven reflow:'));
 assert.match(rules,/\.compose-metrics\{flex-wrap:wrap;white-space:normal/);
 assert.match(rules,/\.compose-metrics span,\.compose-metrics span:first-child\{flex:0 1 auto/);
 assert.doesNotMatch(rules,/\.compose-metrics span:first-child\{flex-basis:100%/);
});
