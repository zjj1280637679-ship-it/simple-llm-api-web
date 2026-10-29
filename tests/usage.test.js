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
 assert.equal(usageMetrics(null).cache,'未知');
 assert.equal(usageMetrics({inputTokens:10,cachedTokens:0,totalTokens:0}).cache,'0 Token · 0.0%');
 assert.equal(usageMetrics({inputTokens:0,cachedTokens:0}).cache,'0 Token');
 assert.equal(usageMetrics({inputTokens:10}).context,'10 Token · 窗口未知');
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
