import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFiles, validateAttachments, attachmentParts, supportedModalities, MAX_FILE_BYTES} from '../src/attachments.js';
import {generateText} from '../src/core.js';
import {runConversation} from '../src/agent.js';
import {getNetworkLogs,clearNetworkLogs} from '../src/logs.js';
const fixture=(name,type,body='synthetic attachment only')=>new File([body],name,{type});
const config=protocol=>({protocol,url:'https://api.example.com/v1',trustedTarget:'https://api.example.com/v1',model:'synthetic-model',key:'synthetic-key'});
const response=protocol=>({ok:true,status:200,json:async()=>protocol==='gemini'?{candidates:[{content:{role:'model',parts:[{text:'OK'}]}}]}:{choices:[{message:{role:'assistant',content:'OK'}}]}});
test('selection cancellation, accumulation, identity and local preparation',async()=>{
 const a=await prepareFiles([fixture('a.txt','text/plain')],[],'gemini',supportedModalities('gemini'));
 assert.deepEqual(await prepareFiles([],a,'gemini',supportedModalities('gemini')),a);
 const b=await prepareFiles([fixture('b.png','image/png')],a,'gemini',supportedModalities('gemini'));
 assert.equal(b.length,2);assert.equal(b[0],a[0]);assert.notEqual(b[0].id,b[1].id);
 assert.equal(attachmentParts(a,'openai')[0].type,'text');
});
test('selection constraints and protocol changes are fail-closed with useful errors',async()=>{
 await assert.rejects(prepareFiles([fixture('x.exe','application/octet-stream')],[],'gemini',['text']),{code:'ATTACHMENT'});
 await assert.rejects(prepareFiles([fixture('x.txt','text/plain',new Uint8Array([255]))],[],'gemini',['text']),{code:'ATTACHMENT'});
 const pdf=await prepareFiles([fixture('a.pdf','application/pdf')],[],'gemini',['pdf']);
 assert.throws(()=>validateAttachments(pdf,'ark'),{code:'ATTACHMENT'});
 assert.throws(()=>validateAttachments(pdf,'gemini',['image']),{code:'ATTACHMENT'});
 assert.throws(()=>validateAttachments([{...pdf[0],size:MAX_FILE_BYTES+1}],'gemini'),{code:'ATTACHMENT'});
 assert.throws(()=>validateAttachments(Array(9).fill(pdf[0]),'gemini'),{code:'ATTACHMENT'});
 assert.throws(()=>validateAttachments([{...pdf[0],size:MAX_FILE_BYTES},{...pdf[0],size:MAX_FILE_BYTES}],'gemini'),{code:'ATTACHMENT'});
});
for(const protocol of ['gemini','openai','ark']) test(`${protocol} real request encoding, history retention, metadata-only request logs`,async()=>{
 clearNetworkLogs(); const files=[fixture('image.png','image/png'),fixture('private.txt','text/plain','PRIVATE_FILE_CONTENT_SENT_ONLY_TO_API')];
 if(protocol!=='ark') files.push(fixture('a.pdf','application/pdf'));
 if(protocol==='gemini') files.push(fixture('a.mp3','audio/mpeg'),fixture('a.mp4','video/mp4'));
 const attachments=await prepareFiles(files,[],protocol,supportedModalities(protocol));
 let calls=0;
 const result=await runConversation({config:config(protocol),messages:[{role:'user',content:'inspect',attachments}],fetchImpl:async(url,options)=>{
  calls++;const body=JSON.parse(options.body);const parts=protocol==='gemini'?body.contents[0].parts:body.messages[0].content;
  assert.equal(parts.length,files.length+1);assert.match(JSON.stringify(parts),/PRIVATE_FILE_CONTENT/);
  assert.equal(protocol==='gemini'?parts[1].inlineData.mimeType:parts[1].type,protocol==='gemini'?'image/png':'image_url');
  if(protocol==='openai') assert.equal(parts[3].type,'file');
  return response(protocol);
 }});
 assert.equal(calls,1); assert.equal(result.history[0].attachments,attachments);
 const logs=JSON.stringify(getNetworkLogs()); assert(!logs.includes('PRIVATE_FILE_CONTENT'));assert(!logs.includes(attachments[0].base64));assert(logs.includes('image.png'));
});
test('failure and abort preserve attachment input; no automatic retry',async()=>{
 const attachments=await prepareFiles([fixture('a.png','image/png')],[],'gemini',['image']);let calls=0;
 await assert.rejects(runConversation({config:config('gemini'),messages:[{role:'user',content:'',attachments}],fetchImpl:async()=>{calls++;return {ok:false,status:429,json:async()=>({error:{message:'quota'}})}}}),e=>{assert.equal(e.history[0].attachments,attachments);return true;});assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(generateText({config:config('gemini'),messages:[{role:'user',attachments}],signal:controller.signal,fetchImpl:()=>assert.fail('no fetch')}));
});
test('attachment stays present across actual two-round model/tool conversation',async()=>{
 const attachments=await prepareFiles([fixture('a.png','image/png')],[],'gemini',['image']);let calls=0;
 const result=await runConversation({config:config('gemini'),imageConfig:config('gemini'),messages:[{role:'user',content:'inspect',attachments}],fetchImpl:async(url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.data,attachments[0].base64);
  if(calls===1) return {ok:true,status:200,json:async()=>({candidates:[{content:{role:'model',parts:[{functionCall:{name:'unknown_tool',args:{}}}]}}]})};
  assert(body.contents.some(m=>m.parts.some(p=>p.functionResponse)));return response('gemini');
 }});
 assert.equal(calls,2);assert.equal(result.history[0].attachments,attachments);
});
test('attachment-only messages omit empty text parts',async()=>{
 const attachments=await prepareFiles([fixture('a.png','image/png')],[],'gemini',['image']);
 for(const protocol of ['gemini','openai','ark']) await generateText({config:config(protocol),messages:[{role:'user',content:'',attachments}],fetchImpl:async(url,options)=>{
 const body=JSON.parse(options.body),parts=protocol==='gemini'?body.contents[0].parts:body.messages[0].content;assert.equal(parts.length,1);assert(!('text' in parts[0]));return response(protocol);
 }});
});
test('history budget measures UTF-8 bytes not JS character count',async()=>{
 const text='中'.repeat(1024*1024);const attachments=await prepareFiles([fixture('chinese.txt','text/plain',text)],[],'gemini',['text']);
 await assert.rejects(generateText({config:config('gemini'),messages:Array.from({length:6},()=>({role:'user',content:'',attachments})),fetchImpl:()=>assert.fail('oversize request must not leave browser')}),{code:'ATTACHMENT_LIMIT'});
});
test('derived image tool requests cannot log file text echoed into model tool arguments',async()=>{
 clearNetworkLogs();const marker='SYNTHETIC_ATTACHMENT_MARKER_7291';const attachments=await prepareFiles([fixture('private.txt','text/plain',marker)],[],'gemini',['text']);let calls=0;
 await assert.rejects(runConversation({config:config('gemini'),imageConfig:{...config('gemini'),model:'gemini-nano-banana-2.1'},messages:[{role:'user',content:'draw',attachments}],confirmTool:async()=>true,fetchImpl:async()=>{
  calls++;if(calls===1)return {ok:true,status:200,json:async()=>({candidates:[{content:{role:'model',parts:[{functionCall:{name:'image_generate',args:{prompt:marker,aspectRatio:'1:1',imageSize:'1K'}}}]}}]})};
  return {ok:false,status:503,json:async()=>({error:{message:marker}})};
 }}));assert.equal(calls,2);assert(!JSON.stringify(getNetworkLogs()).includes(marker));
});
