import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/core.js';
import { runConversation } from '../src/agent.js';
const config = protocol => ({protocol,url:'https://api.example.com/v1',trustedTarget:'https://api.example.com/v1',key:'synthetic-key',model:'fixture'});
const messages = [{role:'user',content:'hi'}];
const o = (content,finish_reason=null,extra={}) => ({choices:[{index:0,delta:{content,...extra},finish_reason}]});
const g = (parts,finishReason) => ({candidates:[{index:0,content:{role:'model',parts},...(finishReason?{finishReason}:{})}]});
const frame = value => `data: ${typeof value==='string'?value:JSON.stringify(value)}\r\n\r\n`;
function response(events, byteSize=1) {
 const bytes=new TextEncoder().encode(events.map(frame).join(''));
 return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=byteSize)c.enqueue(bytes.slice(i,i+byteSize));c.close()}}),{headers:{'content-type':'text/event-stream'}});
}
for(const protocol of ['openai','ark']) test(`${protocol}: byte-split UTF8, DONE and usage-only tail`,async()=>{
 const deltas=[];let body;
 const result=await generateText({config:config(protocol),messages,onDelta:s=>deltas.push(s),fetchImpl:async(url,opts)=>{body=JSON.parse(opts.body);return response([o('你🙂'),o('好','stop'),{choices:[],usage:{prompt_tokens:11,completion_tokens:4,total_tokens:15}},'[DONE]']);}});
 assert.equal(body.stream,true);assert.equal(body.stream_options.include_usage,true);
 assert.deepEqual(deltas,['你🙂','好']);assert.equal(result.text,'你🙂好');assert.equal(result.usage.totalTokens,15);
});
test('Gemini preserves empty signature part and native part boundaries into round 2',async()=>{
 let n=0,second;
 const args={config:config('gemini'),messages,onDelta:()=>{},fetchImpl:async(url,opts)=>{
  assert.match(url,/:streamGenerateContent\?alt=sse$/);n++;if(n===2)second=JSON.parse(opts.body);
  return response([g([{text:'一'}]),g([{text:'二'}]),g([{text:'',thoughtSignature:'opaque-signature'}],'STOP'),{usageMetadata:{promptTokenCount:7,totalTokenCount:9}}]);
 }};
 const result=await generateText(args);assert.equal(result.text,'一二');assert.equal(result.rawAssistant.parts.length,3);
 await generateText({...args,messages:[...messages,{role:'assistant',content:result.text,raw:result.rawAssistant},{role:'user',content:'next'}]});
 assert.deepEqual(second.contents[1],result.rawAssistant);assert.equal(result.usage.totalTokens,9);
});
test('first delta reaches caller before upstream completes (not delayed typing)',async()=>{
 let controller,complete=false;
 const r=new Response(new ReadableStream({start(c){controller=c}}),{headers:{'content-type':'text/event-stream'}});
 let seen;const first=new Promise(resolve=>{seen=resolve});
 const pending=generateText({config:config('openai'),messages,onDelta:s=>seen(s),fetchImpl:async()=>r}).then(r=>{complete=true;return r});
 controller.enqueue(new TextEncoder().encode(frame(o('首段'))));
 assert.equal(await first,'首段');assert.equal(complete,false);
 controller.enqueue(new TextEncoder().encode(frame(o('末段','stop'))+frame('[DONE]')));controller.close();
 assert.equal((await pending).text,'首段末段');
});
test('tool fragments complete by index; confirmation only after finish and DONE',async()=>{
 let n=0,confirmed=0;const events=[];
 const result=await runConversation({config:config('openai'),imageConfig:{...config('gemini'),model:'gemini-nano-banana-2.1'},messages,onDelta:()=>{},confirmTool:async()=>{confirmed++;return false;},fetchImpl:async()=>{
  n++;if(n===2)return response([o('已取消','stop'),'[DONE]']);
  return response([
   o('',null,{tool_calls:[{index:0,id:'call-a',type:'function',function:{name:'image_generate',arguments:'{"prompt":'}}]}),
   o('',null,{tool_calls:[{index:0,function:{arguments:'"cat"}'}}]}),
   o('', 'tool_calls'),'[DONE]']);
 },onHistory:h=>events.push(h)});
 assert.equal(confirmed,1);assert.equal(n,2);assert.equal(result.history[1].raw.tool_calls[0].function.arguments,'{"prompt":"cat"}');assert.equal(result.text,'已取消');
});
for(const [name,events,code] of [
 ['missing DONE',[o('partial','stop')],'STREAM_INTERRUPTED'],
 ['missing finish',[o('partial'),'[DONE]'],'STREAM_INTERRUPTED'],
 ['length finish',[o('partial','length'),'[DONE]'],'STREAM_INCOMPLETE'],
 ['in-stream error',[o('partial'),{error:{message:'secret'}}],'STREAM_ERROR'],
 ['bad JSON',[o('partial'),'{oops'],'STREAM_FORMAT'],
 ['bad tool JSON',[o('',null,{tool_calls:[{index:0,id:'x',type:'function',function:{name:'image_generate',arguments:'{'}}]}),o('','tool_calls'),'[DONE]'],'TOOL_FORMAT'],
])test(`${name} never commits partial assistant`,async()=>{
 let checkpoints=0;
 await assert.rejects(runConversation({config:config('openai'),messages,onDelta:()=>{},onHistory:()=>checkpoints++,fetchImpl:async()=>response(events)}),e=>{assert.equal(e.code,code);assert.equal(e.history.length,1);assert.doesNotMatch(e.message,/secret/);return true});
 assert.equal(checkpoints,0);
});
test('cancellation stops reader immediately and never executes fragmented tools',async()=>{
 const controller=new AbortController();let cancelled=false,confirmed=false;
 const r=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame(o('partial'))))},cancel(){cancelled=true}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(runConversation({config:config('openai'),messages,signal:controller.signal,onDelta:()=>controller.abort(),confirmTool:()=>{confirmed=true},fetchImpl:async()=>r}),{code:'CANCELLED'});
 assert.equal(cancelled,true);assert.equal(confirmed,false);
});
test('HTTP failures retain status; non-SSE is not silently buffered/retried',async()=>{
 let requests=0;
 await assert.rejects(generateText({config:config('ark'),messages,onDelta:()=>{},fetchImpl:async()=>{requests++;return new Response('secret',{status:503})}}),{code:'HTTP',status:503});
 await assert.rejects(generateText({config:config('ark'),messages,onDelta:()=>{},fetchImpl:async()=>{requests++;return new Response('{}',{headers:{'content-type':'application/json'}})}}),{code:'STREAM_UNSUPPORTED'});assert.equal(requests,2);
});
test('SSE comments, multiline data, LF, lone CR and final unterminated frame',async()=>{
 const source=': ping\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]';
 const result=await generateText({config:config('openai'),messages,onDelta:()=>{},fetchImpl:async()=>new Response(source,{headers:{'content-type':'text/event-stream'}})});assert.equal(result.text,'ok');
});
