import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotWorkspace, restoreWorkspace, migrateSnapshot, MAX_SNAPSHOT_BYTES, SCHEMA_VERSION } from '../src/persistence.js';

const makePage = () => ({api:{protocol:'gemini',url:'https://example.com/v1',model:'test',supplier:'test',key:'',trustedTarget:''},model:{output:'',temperature:'',topP:'',inputs:['text']},draft:'',attachments:[],pendingTextId:null,aspectRatio:'1:1',imageSize:'1K',messages:[],history:[],busy:false,controller:null,lastUsage:null,lastMetrics:null});
const fixture = () => ({data:{chat:makePage(),image:makePage()},page:'chat',nextId:1,views:{chat:{top:123,bottom:false}}});
const roundtrip = f => restoreWorkspace(snapshotWorkspace(f),makePage);
const attachment = {id:'file-1',name:'note.txt',size:5,mimeType:'text/plain',kind:'text',base64:'aGVsbG8=',text:'hello'};

test('snapshot excludes credentials, runtime objects and diagnostics, including historical cards',()=>{
  const f=fixture(),d=f.data.chat;d.api.key='secret-sentinel';d.api.trustedTarget='trusted-sentinel';
  d.api.headers={Authorization:'header-sentinel'};d.controller={secret:'controller-sentinel'};d.logs=['log-sentinel'];
  d.messages=[{id:1,type:'card',kind:'api',values:{...d.api},showKey:true,models:[{id:'model-list-sentinel'}],modelListStatus:'diagnostic-sentinel'}];
  const encoded=JSON.stringify(snapshotWorkspace(f));
  for(const secret of ['secret-sentinel','trusted-sentinel','header-sentinel','controller-sentinel','log-sentinel','model-list-sentinel','diagnostic-sentinel'])assert.ok(!encoded.includes(secret),secret);
  const restored=roundtrip(f).data.chat;
  assert.equal(restored.api.key,'');assert.equal(restored.api.trustedTarget,'');assert.equal(restored.messages[0].showKey,false);assert.deepEqual(restored.messages[0].models,[]);
});

test('URLs with credentials or query secrets are not persisted',()=>{
 for(const url of ['https://user:pass@example.com','https://example.com?key=secret','https://example.com/#secret','http://example.com','not-url']){
  const f=fixture();f.data.chat.api.url=url;assert.equal(snapshotWorkspace(f).workspaces.chat.api.url,'');
 }
});

test('draft, model family controls, attachments and separate reply metrics round-trip',()=>{
 const f=fixture(),d=f.data.chat;f.page='image';f.nextId=9;d.draft='草稿';d.attachments=[attachment];d.pendingTextId=3;
 Object.assign(d.model,{reasoningFamily:'gemini',reasoningMode:'gemini-budget',reasoningBudget:'1024',reasoning:{template:'gemini-budget',value:'1024'}});
 d.lastUsage={inputTokens:12,outputTokens:5,totalTokens:17,cachedTokens:0};d.lastMetrics={usage:d.lastUsage,speed:2.5,textTokens:5,durationMs:2000};
 d.messages=[{id:3,type:'user',text:'hello',attachments:[attachment]},{id:4,type:'chatResult',text:'done',metrics:d.lastMetrics}];
 const s=snapshotWorkspace(f);assert.equal(s.workspaces.chat.messages[1].metrics,undefined);assert.deepEqual(s.metrics.chat.messages[4],d.lastMetrics);
 const restored=restoreWorkspace(s,makePage);assert.equal(restored.page,'image');assert.equal(restored.nextId,9);assert.deepEqual(restored.views,f.views);
 assert.equal(restored.data.chat.draft,'草稿');assert.deepEqual(restored.data.chat.attachments,[attachment]);assert.deepEqual(restored.data.chat.model,d.model);assert.deepEqual(restored.data.chat.lastMetrics,d.lastMetrics);assert.deepEqual(restored.data.chat.messages[1].metrics,d.lastMetrics);
});

test('native history preserves thought signatures, redacted thinking, reasoning and Gemini tool result',()=>{
 const f=fixture();const raw=[
 {role:'model',parts:[{text:'answer',thoughtSignature:'opaque-signature'},{functionCall:{name:'image_generate',args:{prompt:'a cat'}}}]},
 {role:'user',parts:[{functionResponse:{name:'image_generate',response:{ok:true,imageCount:1,message:'completed'}}}]},
 {role:'assistant',content:[{type:'thinking',thinking:'thought',signature:'anthropic-signature'},{type:'redacted_thinking',data:'opaque-data'},{type:'text',text:'answer'}]},
 {role:'assistant',content:'answer',reasoning_content:'reasoning',tool_calls:[{id:'call-1',type:'function',function:{name:'image_generate',arguments:'{"prompt":"cat"}'}}]}
 ];
 f.data.chat.history=raw.map((r,i)=>({role:i===1?'tool':'assistant',content:'answer',raw:r}));
 assert.deepEqual(roundtrip(f).data.chat.history,f.data.chat.history);
});

test('streamed reply is restored incomplete, request stopped, not inserted into native history',()=>{
 const f=fixture(),d=f.data.chat;d.busy=true;d.controller={abort(){}};d.messages=[{id:2,type:'chatResult',text:'partial',streaming:true}];
 const restored=roundtrip(f).data.chat;
 assert.equal(restored.busy,false);assert.equal(restored.controller,null);assert.equal(restored.messages[0].incomplete,true);assert.equal(restored.messages[0].streaming,undefined);assert.deepEqual(restored.history,[]);assert.match(restored.messages[1].text,/不会自动重发/);
});

test('interrupted status receives an ID distinct from every workspace message',()=>{
 const f=fixture();f.data.chat.busy=true;f.data.chat.messages=[{id:1,type:'user',text:'one'}];f.data.image.messages=[{id:2,type:'user',text:'two'}];
 const r=roundtrip(f),ids=Object.values(r.data).flatMap(d=>d.messages.map(m=>m.id));assert.equal(new Set(ids).size,ids.length);assert.ok(r.nextId>Math.max(...ids));
});

test('generated images retain bytes and regenerate a usable image source',()=>{
 const f=fixture();f.data.image.messages=[{id:1,type:'imageResult',images:[{url:'blob:expired',data:'aGVsbG8=',mimeType:'image/png',extension:'png'}]}];
 const s=snapshotWorkspace(f);assert.ok(!JSON.stringify(s).includes('blob:expired'));
 assert.equal(restoreWorkspace(s,makePage).data.image.messages[0].images[0].url,'data:image/png;base64,aGVsbG8=');
});

test('unknown and malformed schemas fail closed',()=>{
 for(const v of [null,{}, {schema:SCHEMA_VERSION+1}, {...snapshotWorkspace(fixture()),metrics:null}])assert.throws(()=>migrateSnapshot(v),{code:'SCHEMA'});
 const s=snapshotWorkspace(fixture());s.workspaces.chat.attachments=null;assert.throws(()=>migrateSnapshot(s),{code:'SCHEMA'});
});

test('oversize snapshot fails explicitly rather than dropping attachments',()=>{
 const f=fixture();f.data.chat.draft='x'.repeat(MAX_SNAPSHOT_BYTES);assert.throws(()=>snapshotWorkspace(f),{code:'SIZE_LIMIT'});
});
