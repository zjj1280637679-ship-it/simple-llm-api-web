import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {generateText} from '../src/core.js';
import {runConversation} from '../src/agent.js';
const config=protocol=>({protocol,url:'https://api.example.com/v1',trustedTarget:'https://api.example.com/v1',key:'synthetic',model:'fixture'});
const response=events=>new Response(events.map(e=>`data: ${typeof e==='string'?e:JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
const o=(delta,finish_reason=null)=>({choices:[{index:0,delta,finish_reason}]});
const messages=[{role:'user',content:'hi'}];
test('reasoning arrives before final answer, separately, without changing native history or output timing',async()=>{
 let control,time=100;const publicText=[],answer=[];
 const body=new ReadableStream({start(c){control=c}});let first;const observed=new Promise(resolve=>{first=resolve});
 const request=generateText({config:config('openai'),messages,now:()=>time,onDelta:x=>answer.push(x),onReasoningDelta:x=>{publicText.push(x);first()},fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})});
 control.enqueue(new TextEncoder().encode('data: '+JSON.stringify(o({reasoning_content:'公开思考🙂'}))+'\n\n'));await observed;
 assert.deepEqual(publicText,['公开思考🙂']);assert.deepEqual(answer,[]);time=1100;
 control.enqueue(new TextEncoder().encode('data: '+JSON.stringify(o({encrypted_content:'opaque-must-not-display'}))+'\n\ndata: '+JSON.stringify(o({content:'最终回答'},'stop'))+'\n\ndata: [DONE]\n\n'));control.close();
 const result=await request;assert.equal(result.text,'最终回答');assert.equal(result.rawAssistant.reasoning_content,'公开思考🙂');assert.equal(result.rawAssistant.encrypted_content,'opaque-must-not-display');assert.deepEqual(publicText,['公开思考🙂']);
 assert.equal(result.metrics.durationMs,null); // Only one answer chunk: reasoning must not start the output clock.
});
test('Gemini only public thought text is forwarded, not thoughtSignature',async()=>{
 const thoughts=[];const result=await generateText({config:config('gemini'),messages,onDelta:()=>{},onReasoningDelta:x=>thoughts.push(x),fetchImpl:async()=>response([{candidates:[{content:{parts:[{thought:true,text:'summary'},{text:'',thoughtSignature:'opaque-signature'},{text:'answer'}]},finishReason:'STOP'}]}])});
 assert.deepEqual(thoughts,['summary']);assert.equal(result.text,'answer');assert.equal(result.rawAssistant.parts[1].thoughtSignature,'opaque-signature');
});
test('Anthropic thinking start/delta are public; signature/redacted blocks never are',async()=>{
 const thoughts=[];const events=[{type:'message_start',message:{role:'assistant',content:[],usage:{}}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'public start',signature:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:' +delta'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'opaque-signature'}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'redacted_thinking',data:'opaque-redacted'}},{type:'content_block_stop',index:1},{type:'content_block_start',index:2,content_block:{type:'text',text:'answer'}},{type:'content_block_stop',index:2},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}];
 const result=await generateText({config:config('anthropic'),messages,onDelta:()=>{},onReasoningDelta:x=>thoughts.push(x),fetchImpl:async()=>response(events)});
 assert.deepEqual(thoughts,['public start',' +delta']);assert.equal(result.text,'answer');assert.equal(result.rawAssistant.content[1].data,'opaque-redacted');
});
test('cancelling public reasoning does not checkpoint partial history',async()=>{
 const controller=new AbortController();let checkpoints=0,observed='';
 await assert.rejects(runConversation({config:config('ark'),messages,signal:controller.signal,onDelta:()=>{},onReasoningDelta:(x,{round})=>{observed+=x;assert.equal(round,0);controller.abort()},onHistory:()=>checkpoints++,fetchImpl:async()=>response([o({reasoning_content:'partial'}),o({content:'answer'},'stop'),'[DONE]'])}),{code:'CANCELLED'});
 assert.equal(observed,'partial');assert.equal(checkpoints,0);
});
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
test('incremental paint keeps existing collapsed reasoning DOM and reader position',()=>{
 const text={textContent:''},summary={textContent:''},answer={textContent:''},label={textContent:''};
 const details={open:false,querySelector:s=>s==='summary'?summary:text};let inserted=0;
 const node={querySelector:s=>({'.reasoning-content':details,'.reply-text':answer,'.assistant-label':label}[s])};
 const d={};const app={scrollTop:20,scrollHeight:1000,clientHeight:400,querySelector:()=>node};
 const ctx={app,get:()=>d,saveLocal(){},recordScrollDiagnostic(){},render(){throw Error('rerender')},messageMarkup(){inserted++;return ''}};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function paintStream'),source.indexOf('// These phases')),ctx);
 ctx.paintStream(d,{id:1,text:'answer',reasoningText:'public delta',incomplete:true});
 assert.equal(text.textContent,'public delta');assert.match(summary.textContent,/未完成/);assert.equal(details.open,false);assert.equal(app.scrollTop,20);assert.equal(inserted,0);
});
test('reasoning markup is escaped, optional and model-backed for collapse restoration',()=>{
 const ctx={esc:s=>s.replaceAll('<','&lt;')};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function reasoningContentMarkup'),source.indexOf('function messageMarkup')),ctx);
 assert.equal(ctx.reasoningContentMarkup({id:1,text:'body'}),'');
 const markup=ctx.reasoningContentMarkup({id:1,reasoningText:'<script>opaque?',reasoningOpen:false});assert.match(markup,/&lt;script>/);assert.doesNotMatch(markup,/<script>| open/);
 assert.match(source,/message.reasoningOpen = details.open; saveLocal\(\)/);
});
