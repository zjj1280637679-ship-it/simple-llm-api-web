import test from 'node:test';
import assert from 'node:assert/strict';
import { usageFrom, usageMetrics, usageMetricsMarkup } from '../src/usage.js';
import { generateText } from '../src/core.js';
for (const protocol of ['gemini','openai','ark']) {
 const raw = protocol === 'gemini' ? {usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:125,cachedContentTokenCount:25}} : {usage:{prompt_tokens:100,completion_tokens:20,total_tokens:125,prompt_tokens_details:{cached_tokens:25}}};
 test(`${protocol} normalizes reported counts without recomputing totals`, () => {
  assert.deepEqual(usageFrom(raw,protocol),{inputTokens:100,outputTokens:20,totalTokens:125,cachedTokens:25});
  assert.equal(usageMetrics(usageFrom(raw,protocol)).cache,'25 Token · 25.0%');
 });
 test(`${protocol} actual dispatcher passes usage to dashboard`,async()=>{
  const body = protocol === 'gemini' ? {...raw,candidates:[{content:{parts:[{text:'fixture'}]}}]} : {...raw,choices:[{message:{role:'assistant',content:'fixture'}}]};
  const url = protocol === 'ark' ? 'https://ark.cn-beijing.volces.com/api/v3' : 'https://api.example.com/v1';
  const result=await generateText({config:{protocol,url,trustedTarget:url,key:'synthetic-test-key',model:'fixture-model'},messages:[{role:'user',content:'fixture'}],fetchImpl:async()=>({ok:true,status:200,json:async()=>body})});
  assert.equal(usageMetrics(result.usage).cacheRatio,.25);
 });
}
test('absence differs from actual zero and never guesses model window',()=>{
 assert.equal(usageFrom({},'gemini'),null);
 assert.equal(usageMetrics(null).cache,'...');
 assert.equal(usageMetrics({inputTokens:10,cachedTokens:0,totalTokens:0}).cache,'0 Token · 0.0%');
 assert.equal(usageMetrics({inputTokens:0,cachedTokens:0}).cache,'0 Token');
 assert.equal(usageMetrics({inputTokens:10}).context,'10 Token · 窗口 ...');
 assert.equal(usageMetrics({totalTokens:0}).total,0);
});
test('malformed, fractional, unsafe counts and invalid cache ratios are unknown',()=>{
 for(const value of [-1,NaN,Infinity,'0',false,1.5,Number.MAX_SAFE_INTEGER+1]) assert.equal(usageFrom({usage:{prompt_tokens:value}},'openai').inputTokens,null);
 assert.equal(usageMetrics({inputTokens:10,cachedTokens:20}).cacheRatio,null);
 assert.equal(usageMetricsMarkup({inputTokens:'<img>',cachedTokens:0}).includes('<img>'),false);
});
test('missing cache detail stays unknown for both compatible protocols',()=>{
 for(const protocol of ['openai','ark']) assert.equal(usageFrom({usage:{prompt_tokens:100,prompt_tokens_details:null}},protocol).cachedTokens,null);
});

test('missing visible metrics use three dots while true zero stays numeric',()=>{
 const m=usageMetrics(null);assert.equal(m.total,'...');assert.equal(m.context,'...');
 const visible=usageMetricsMarkup(null).replace(/<[^>]+>/g,'');
 assert.doesNotMatch(visible,/未知|—/);assert.equal((visible.match(/\.\.\./g)||[]).length,3);
});

test('official Gemini omitted zero cache is distinguished from missing telemetry and compatibility endpoints',()=>{
 const endpoint='https://generativelanguage.googleapis.com/v1beta';
 const raw={usageMetadata:{promptTokenCount:16,candidatesTokenCount:1343,totalTokenCount:1359}};
 assert.equal(usageMetrics(usageFrom(raw,'gemini',{endpoint})).cache,'0 Token · 0.0%');
 assert.equal(usageFrom(raw,'gemini').cachedTokens,null);
 assert.equal(usageFrom(raw,'gemini',{endpoint:'https://proxy.example/v1beta'}).cachedTokens,null);
 assert.equal(usageFrom({},'gemini',{endpoint}),null);
 assert.equal(usageFrom({usageMetadata:{}},'gemini',{endpoint}).cachedTokens,null);
 for(const cachedContentTokenCount of [null,'0',-1]){
  assert.equal(usageFrom({usageMetadata:{...raw.usageMetadata,cachedContentTokenCount}},'gemini',{endpoint}).cachedTokens,null);
 }
 assert.equal(usageFrom({usageMetadata:{...raw.usageMetadata,cachedContentTokenCount:8}},'gemini',{endpoint}).cachedTokens,8);
});
test('official completed GenerateContent maps absent cache to zero through dispatcher',async()=>{
 const url='https://generativelanguage.googleapis.com/v1beta';
 const result=await generateText({config:{protocol:'gemini',url,trustedTarget:url,key:'synthetic',model:'fixture'},messages:[{role:'user',content:'hi'}],fetchImpl:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}],usageMetadata:{promptTokenCount:16,totalTokenCount:1359}}),{status:200})});
 assert.equal(result.usage.cachedTokens,0);
 assert.equal(result.usage.cacheCountSource,'gemini-proto-default-zero');
});
test('Gemini streamed final usage drives zero/matched cache without accumulating snapshots',async()=>{
 const url='https://generativelanguage.googleapis.com/v1beta';
 for(const cached of [undefined,8]){
  const finalUsage={promptTokenCount:16,candidatesTokenCount:1343,totalTokenCount:1359,...(cached===undefined?{}:{cachedContentTokenCount:cached})};
  const frames=[
   {candidates:[{content:{role:'model',parts:[{text:'a'}]}}],usageMetadata:{promptTokenCount:16,cachedContentTokenCount:4,totalTokenCount:18}},
   {candidates:[{content:{role:'model',parts:[{text:'b'}]},finishReason:'STOP'}],usageMetadata:finalUsage}
  ];
  const result=await generateText({config:{protocol:'gemini',url,trustedTarget:url,key:'synthetic',model:'fixture'},messages:[{role:'user',content:'hi'}],onDelta:()=>{},fetchImpl:async()=>new Response(frames.map(j=>'data: '+JSON.stringify(j)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})});
  assert.equal(result.usage.cachedTokens,cached??0);
  assert.equal(result.usage.totalTokens,1359);
 }
});

test('contradictory official Gemini counts do not imply zero cache',()=>{
 assert.equal(usageFrom({usageMetadata:{promptTokenCount:20,totalTokenCount:10}},'gemini',{endpoint:'https://generativelanguage.googleapis.com/v1beta'}).cachedTokens,null);
});
