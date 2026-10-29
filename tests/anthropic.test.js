import test from 'node:test';
import assert from 'node:assert/strict';
import {generateText,listModels} from '../src/core.js';
import {runConversation} from '../src/agent.js';
import {supportedModalities} from '../src/attachments.js';
import {usageFrom} from '../src/usage.js';
const key='synthetic-anthropic-test-not-secret';
const config={protocol:'anthropic',url:'https://api.anthropic.com/v1',trustedTarget:'https://api.anthropic.com/v1',key,model:'fixture-model'};
const messages=[{role:'system',content:'Be concise'},{role:'user',content:'你好'}];
const start={type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model:'fixture-model',content:[],stop_reason:null,usage:{input_tokens:12,cache_read_input_tokens:8,cache_creation_input_tokens:4,output_tokens:1}}};
const events=[start,{type:'ping'},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'private reasoning'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'opaque+sig=='}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'text',text:''}},{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'你好🌏'}},{type:'content_block_stop',index:1},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}},{type:'message_stop'}];
function stream(values=events) {
 const bytes=new TextEncoder().encode(values.map(e=>`event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''));
 let i=0; return new Response(new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=1));}}),{headers:{'content-type':'text/event-stream'}});
}
test('native Messages request and split UTF8 SSE preserve thinking signature, usage and second turn',async()=>{
 const seen=[],deltas=[];
 const fetchImpl=async(url,options)=>{seen.push({url,options,body:JSON.parse(options.body)});return stream();};
 const first=await runConversation({config,messages,onDelta:d=>deltas.push(d),fetchImpl});
 assert.equal(first.text,'你好🌏');assert.deepEqual(deltas,['你好🌏']);
 assert.equal(seen[0].url,config.url+'/messages');
 assert.equal(seen[0].options.headers['x-api-key'],key);
 assert.equal(seen[0].options.headers.Authorization,undefined);
 assert.equal(seen[0].options.headers['anthropic-version'],'2023-06-01');
 assert.equal(seen[0].options.headers['anthropic-dangerous-direct-browser-access'],'true');
 assert.deepEqual(seen[0].body,{model:'fixture-model',messages:[messages[1]],stream:true,max_tokens:4096,system:[{type:'text',text:'Be concise'}]});
 assert.deepEqual(first.usage,{inputTokens:24,outputTokens:5,totalTokens:29,cachedTokens:8,cacheCreationTokens:4});
 await runConversation({config,messages:[...first.history,{role:'user',content:'continue'}],onDelta:()=>{},fetchImpl});
 const assistant=seen[1].body.messages.find(m=>m.role==='assistant');
 assert.deepEqual(assistant,first.history.at(-1).raw);
 assert.equal(assistant.content[0].signature,'opaque+sig==');
 assert.equal(assistant.content[0].thinking,'private reasoning');
});
test('custom models use native headers and one page, never proprietary browser opt-in',async()=>{
 const c={...config,url:'https://gateway.example.com/v1',trustedTarget:'https://gateway.example.com/v1'};
 const result=await listModels({config:c,fetchImpl:async(url,o)=>{assert.equal(url,c.url+'/models?limit=1000');assert.equal(o.headers['anthropic-dangerous-direct-browser-access'],undefined);return Response.json({data:[{id:'claude-fixture',display_name:'Fixture'}],has_more:false});}});
 assert.deepEqual(result,[{id:'claude-fixture',name:'Fixture'}]);
});
test('missing stop, error, truncation and unsupported tools never commit completed history',async()=>{
 for(const values of [events.slice(0,-1),[start,{type:'error',error:{message:key}}],events.map(e=>e.type==='message_delta'?{...e,delta:{stop_reason:'max_tokens'}}:e),[start,{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'t1',name:'anything',input:{}}}]]) {
  let checkpoint=false;
  await assert.rejects(runConversation({config,messages,onDelta:()=>{},onHistory:()=>checkpoint=true,fetchImpl:async()=>stream(values)}),e=>!e.message.includes(key));
  assert.equal(checkpoint,false);
 }
});
test('unsupported attachments/tools and invalid settings fail before any network',async()=>{
 assert.deepEqual(supportedModalities('anthropic'),['text']);
 for(const extra of [{tools:[{name:'x'}]},{settings:{temperature:1.1}},{settings:{temperature:0.5,topP:0.5}},{messages:[{role:'user',content:'x',attachments:[{kind:'image',mimeType:'image/png',name:'x.png',size:1,base64:'AA=='}]}]}])
  await assert.rejects(generateText({config,messages,...extra,fetchImpl:()=>assert.fail('network')}));
});
test('abort during native stream cancels, does not retry or save partial output',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(generateText({config,messages,signal:controller.signal,onDelta:()=>controller.abort(),fetchImpl:async()=>{calls++;return stream();}}),{code:'CANCELLED'});assert.equal(calls,1);
});
test('unknown usage is not fabricated and cumulative output is not summed',()=>{
 assert.equal(usageFrom({usage:{input_tokens:3,output_tokens:2}},'anthropic').inputTokens,null);
 assert.equal(usageFrom({usage:{input_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:2}},'anthropic').totalTokens,2);
});
test('nonstream Messages preserves redacted thinking and rejects incomplete response',async()=>{
 const content=[{type:'redacted_thinking',data:'opaque-data'},{type:'text',text:'answer'}];
 const fetchImpl=async()=>Response.json({role:'assistant',content,stop_reason:'end_turn',usage:{input_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:3}});
 const result=await generateText({config,messages,settings:{output:'128'},fetchImpl});
 assert.deepEqual(result.rawAssistant,{role:'assistant',content});assert.equal(result.text,'answer');
 await assert.rejects(generateText({config,messages,fetchImpl:async()=>Response.json({role:'assistant',content,stop_reason:'max_tokens'})}),{code:'STREAM_INCOMPLETE'});
});
test('native stream tolerates new top-level events but rejects unmatched block events',async()=>{
 await generateText({config,messages,onDelta:()=>{},fetchImpl:async()=>stream([events[0],{type:'future_event'},...events.slice(1)])});
 await assert.rejects(generateText({config,messages,onDelta:()=>{},fetchImpl:async()=>stream([start,{type:'content_block_delta',index:9,delta:{type:'text_delta',text:'bad'}}])}),{code:'STREAM_FORMAT'});
});

test('opaque redacted thinking and signing material never leak into diagnostics',async()=>{
 const {sanitizeLogValue}=await import('../src/logs.js');
 const cleaned=JSON.stringify(sanitizeLogValue({content:[{type:'redacted_thinking',data:'short-opaque'},{type:'thinking',signature:'opaque-signature'}]}));
 assert.doesNotMatch(cleaned,/short-opaque|opaque-signature/);
 const usage=usageFrom({usage:{input_tokens:Number.MAX_SAFE_INTEGER,cache_read_input_tokens:1,cache_creation_input_tokens:0,output_tokens:1}},'anthropic');
 assert.equal(usage.inputTokens,null);assert.equal(usage.totalTokens,null);
});
