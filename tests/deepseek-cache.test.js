import test from 'node:test';
import assert from 'node:assert/strict';
import {usageFrom,usageMetrics} from '../src/usage.js';
import {generateText} from '../src/core.js';
const options={endpoint:'https://api.deepseek.com'};
const u={prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:64,prompt_cache_miss_tokens:36};
test('DeepSeek independent hit and equivalent nested fields normalize without invented zero',()=>{
 assert.equal(usageFrom({usage:u},'openai',options).cachedTokens,64);
 assert.equal(usageMetrics(usageFrom({usage:u},'openai',options)).cacheRatio,.64);
 assert.equal(usageFrom({usage:{...u,prompt_tokens_details:{cached_tokens:64}}},'openai',options).cachedTokens,64);
 assert.equal(usageFrom({usage:{...u,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}},'openai',options).cachedTokens,0);
 assert.equal(usageFrom({usage:{prompt_tokens:100}},'openai',options).cachedTokens,null);
 for(const bad of [{prompt_cache_hit_tokens:null},{prompt_cache_hit_tokens:-1},{prompt_cache_miss_tokens:37},{prompt_tokens_details:{cached_tokens:0}}]){
  const value=usageFrom({usage:{...u,...bad}},'openai',options);
  assert.equal(value.cachedTokens,null);assert.equal(value.cacheCountSource,'deepseek-cache-inconsistent');
 }
 assert.equal(usageFrom({usage:u},'openai',{endpoint:'https://api.openai.com/v1'}).cachedTokens,null);
 assert.equal(usageFrom({usage:u},'ark',options).cachedTokens,null);
});
test('DeepSeek SSE terminal usage preserved including independent fields, no chunk accumulation',async()=>{
 const encode=new TextEncoder();
 const chunks=[{choices:[{index:0,delta:{content:'OK'}}],usage:null},{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:u}];
 const body=chunks.map(j=>'data: '+JSON.stringify(j)+'\n\n').join('')+'data: [DONE]\n\n';
 const result=await generateText({config:{protocol:'openai',url:options.endpoint,trustedTarget:options.endpoint,key:'synthetic',model:'deepseek-flash'},messages:[{role:'user',content:'hi'}],onDelta:()=>{},fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(encode.encode(body));c.close();}}),{headers:{'content-type':'text/event-stream'}})});
 assert.equal(result.usage.cachedTokens,64);assert.equal(result.usage.inputTokens,100);
});
