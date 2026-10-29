import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {canonicalEndpoint,generateText} from '../src/core.js';
const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
test('configuration strings use soft-wrapped labelled textareas, keys stay single-line',()=>{
 for(const key of ['url','model']){
  assert.ok(app.includes(`wrap="soft" id="${key}\${m.id}"`));
  assert.ok(app.includes(`data-key="${key}"`));
  assert.ok(app.includes(`\${esc(x.${key})}</textarea>`));
 }
 assert.match(app,/placeholder="" aria-describedby="key-help\$\{m.id\}"/);
 assert.match(app,/id="key-help\$\{m.id\}"/);
 assert.match(app,/'text' : 'password'/);
 assert.match(app,/type="number"/);
 assert.match(css,/\.fieldrow>\.setting-text\{[^}]*overflow-wrap:anywhere/);
});
test('autosizing expands and shrinks without writing value or selection',()=>{
 const fn=app.slice(app.indexOf('function resizeSettingField('),app.indexOf('function syncSettingFields('));
 const ctx={getComputedStyle:()=>({borderTopWidth:'1px',borderBottomWidth:'1px'})};
 vm.createContext(ctx);vm.runInContext(fn+';this.resize=resizeSettingField',ctx);
 const field={matches:()=>true,style:{},scrollHeight:86,value:'https://example.com/'+ 'long'.repeat(20),selectionStart:4,selectionEnd:8};
 const original=field.value;
 ctx.resize(field);assert.equal(field.style.height,'88px');
 field.scrollHeight=43;ctx.resize(field);assert.equal(field.style.height,'45px');
 assert.equal(field.value,original);assert.equal(field.selectionStart,4);assert.equal(field.selectionEnd,8);
});
test('newlines remain validation errors rather than silently normalized URL/model values',async()=>{
 const url='https://api.example.com/v1';
 const config={protocol:'openai',url,trustedTarget:url,key:'synthetic-unit-only',model:'test-model'};
 for(const newline of ['\n','\r','\r\n']){
  for(const value of [newline+url,url+newline,'https://api.'+newline+'example.com/v1'])assert.throws(()=>canonicalEndpoint(value),e=>e.code==='ENDPOINT');
  await assert.rejects(generateText({config:{...config,model:'test-model'+newline},messages:[{role:'user',content:'ok'}],fetchImpl:()=>assert.fail('No network')}),e=>e.code==='MODEL');
 }
 assert.equal(canonicalEndpoint('  '+url+'  '),url);
});
test('long visually wrapped strings retain exact outbound protocol values',async()=>{
 const url='https://api.example.com/'+ 'long-path-'.repeat(14);
 const model='test-model-'+ 'long-'.repeat(25);
 let calls=0;
 await generateText({config:{protocol:'openai',url,trustedTarget:url,key:'synthetic-unit-only',model},messages:[{role:'user',content:'ok'}],fetchImpl:async(target,options)=>{
  calls++;assert.equal(target,url+'/chat/completions');assert.equal(JSON.parse(options.body).model,model);
  return {ok:true,status:200,json:async()=>({choices:[{message:{role:'assistant',content:'ok'}}]})};
 }});
 assert.equal(calls,1);
});
