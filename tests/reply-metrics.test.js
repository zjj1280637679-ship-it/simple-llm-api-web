import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextTiming, visibleOutputTokens, replyMetricsSnapshot, replyMetricsMarkup} from '../src/usage.js';
import {generateText} from '../src/core.js';
import {runConversation} from '../src/agent.js';
const config={protocol:'openai',url:'https://example.com/v1',trustedTarget:'https://example.com/v1',key:'synthetic',model:'fixture'};
const usage={prompt_tokens:10,completion_tokens:30,total_tokens:40,completion_tokens_details:{reasoning_tokens:10},prompt_tokens_details:{cached_tokens:0}};
const frames=(u=usage)=>[
 {choices:[{delta:{reasoning_content:'not displayed'}}]},
 {choices:[{delta:{content:'hello'}}]},
 {choices:[{delta:{content:' world'},finish_reason:'stop'}]},
 {choices:[],usage:u}
];
const sse=items=>new Response(items.map(j=>'data: '+JSON.stringify(j)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
test('timing ignores empty text, excludes first-token wait and trailing usage',()=>{
 let at=7000;const t=createTextTiming(()=>at);t.observe('');t.observe('hello');at=9000;t.observe('world');at=99999;
 assert.deepEqual(t.snapshot(),{chunks:2,durationMs:2000});
 assert.equal(replyMetricsSnapshot(null,t.snapshot(),20).speed,10);
});
test('single chunk, absent counts, zero/nonfinite duration are unknown not infinity',()=>{
 for(const timing of [null,{chunks:1,durationMs:100},{chunks:2,durationMs:0},{chunks:2,durationMs:Infinity}]) assert.equal(replyMetricsSnapshot(null,timing,20).speed,null);
 assert.equal(replyMetricsSnapshot(null,{chunks:2,durationMs:100},null).speed,null);
 assert.match(replyMetricsMarkup(null),/速度 <strong>\.\.\.<\/strong>/);
 assert.equal(replyMetricsSnapshot(null,{chunks:2,durationMs:100},0).speed,0);
});
test('protocol token provenance excludes unknown thinking and tool/multimodal outputs',()=>{
 const raw={choices:[{message:{content:'text'}}],usage};
 assert.equal(visibleOutputTokens(raw,'openai'),20);
 assert.equal(visibleOutputTokens({...raw,usage:{completion_tokens:30}},'ark'),null);
 assert.equal(visibleOutputTokens({...raw,choices:[{message:{tool_calls:[{}]}}]},'openai'),null);
 assert.equal(visibleOutputTokens({content:[{type:'text',text:'x'}],usage:{output_tokens:30}},'anthropic'),30);
 assert.equal(visibleOutputTokens({content:[{type:'thinking'},{type:'text'}],usage:{output_tokens:30}},'anthropic'),null);
 assert.equal(visibleOutputTokens({content:[{type:'text'}],usage:{output_tokens:30}},'anthropic',{thinking:{type:'adaptive'}}),null);
 assert.equal(visibleOutputTokens({candidates:[{content:{parts:[{text:'thought',thought:true},{text:'answer'}]}}],usageMetadata:{candidatesTokenCount:20,thoughtsTokenCount:50}},'gemini'),20);
 assert.equal(visibleOutputTokens({candidates:[{content:{parts:[{functionCall:{}}]}}],usageMetadata:{candidatesTokenCount:20}},'gemini'),null);
});
test('real stream dispatcher snapshots reported visible output, not reasoning or characters',async()=>{
 let now=4000;
 const response=await generateText({config,messages:[{role:'user',content:'fixture'}],onDelta:()=>{},now:()=>{now+=1000;return now;},fetchImpl:async()=>sse(frames())});
 assert.equal(response.metrics.speed,20);assert.equal(response.metrics.durationMs,1000);
 assert.equal(response.metrics.usage.totalTokens,40);assert.equal(response.metrics.textTokens,20);
 assert.ok(Object.isFrozen(response.metrics));assert.ok(Object.isFrozen(response.metrics.usage));
});
test('snapshots survive mutable upstream data and a later response',()=>{
 const u={totalTokens:40};const first=replyMetricsSnapshot(u,{chunks:2,durationMs:2000},20);u.totalTokens=800;
 const next=replyMetricsSnapshot(u,{chunks:2,durationMs:1000},99);
 assert.equal(first.usage.totalTokens,40);assert.equal(first.speed,10);assert.equal(next.speed,99);
});
test('runConversation propagates the exact successful response snapshot; interrupted stream has none',async()=>{
 let completed;
 const r=await runConversation({config,messages:[{role:'user',content:'fixture'}],onDelta:()=>{},onResponse:r=>{completed=r.metrics;},fetchImpl:async()=>sse(frames())});
 assert.strictEqual(r.metrics,completed);
 let count=0;
 await assert.rejects(runConversation({config,messages:[{role:'user',content:'fixture'}],onDelta:()=>{},onResponse:()=>count++,fetchImpl:async()=>sse(frames().slice(0,2))}));
 assert.equal(count,0);
});
