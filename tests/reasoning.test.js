import test from 'node:test';
import assert from 'node:assert/strict';
import {reasoningBody,getReasoningTemplates,getRecommendedReasoningTemplate} from '../src/reasoning.js';
import {generateText} from '../src/core.js';
const c=(protocol,model,url='https://gateway.example/v1')=>({protocol,model,url,trustedTarget:url,key:'synthetic'});
const sel=(template,value)=>({template,value});
test('default means omitted controls in all native request bodies',async()=>{
 for(const protocol of ['gemini','openai','ark','anthropic']){
  let body;const config=c(protocol,'fixture');
  await generateText({config,messages:[{role:'user',content:'hi'}],fetchImpl:async(u,o)=>{
   body=JSON.parse(o.body);
   return Response.json(protocol==='gemini'?{candidates:[{content:{parts:[{text:'ok'}]}}]}:protocol==='anthropic'?{role:'assistant',content:[{type:'text',text:'ok'}],stop_reason:'end_turn'}:{choices:[{message:{role:'assistant',content:'ok'}}]});
  }});
  for(const field of ['thinking','reasoning','reasoning_effort','output_config'])assert.equal(field in body,false);
  assert.equal(body.generationConfig?.thinkingConfig,undefined);
 }
});
test('Gemini model-specific budget/levels and immutable default alias',()=>{
 const url='https://generativelanguage.googleapis.com/v1beta';
 assert.deepEqual(reasoningBody(c('gemini','gemini-2.5-pro',url),sel('gemini-budget',128)),{generationConfig:{thinkingConfig:{thinkingBudget:128}}});
 assert.throws(()=>reasoningBody(c('gemini','gemini-2.5-pro',url),sel('gemini-budget',0)));
 assert.deepEqual(reasoningBody(c('gemini','gemini-2.5-flash-lite',url),sel('gemini-budget',0)),{generationConfig:{thinkingConfig:{thinkingBudget:0}}});
 assert.throws(()=>reasoningBody(c('gemini','gemini-3.8-flash',url),sel('gemini-level','minimal')));
 assert.equal(getRecommendedReasoningTemplate(c('gemini','gemini-flash-lite-latest',url)),null);
 assert.equal(getReasoningTemplates(c('gemini','gemini-flash-lite-latest',url))[0].verifiedModel,false);
 assert.deepEqual(reasoningBody(c('gemini','gemini-flash-lite-latest',url),undefined),{});
});
test('custom templates remain protocol-bound; selected fields only',()=>{
 assert.equal(getRecommendedReasoningTemplate(c('gemini','anything')),null);
 assert.deepEqual(reasoningBody(c('openai','custom'),sel('openai-effort','high')),{reasoning_effort:'high'});
 assert.deepEqual(reasoningBody(c('ark','custom'),sel('ark-effort','low')),{reasoning_effort:'low'});
 assert.throws(()=>reasoningBody(c('openai','custom'),sel('gemini-level','high')));
 assert.throws(()=>reasoningBody(c('anthropic','custom'),sel('openai-effort','high')));
 assert.deepEqual(reasoningBody(c('gemini','custom'),sel('gemini-level','')),{});
 for(const v of [true,{},1.5,'1.5',NaN])assert.throws(()=>reasoningBody(c('gemini','custom'),sel('gemini-budget',v)));
});
test('Anthropic adaptive vs budget constraints never auto-raise spending',()=>{
 assert.deepEqual(reasoningBody(c('anthropic','custom'),sel('anthropic-effort','high')),{thinking:{type:'adaptive'},output_config:{effort:'high'}});
 assert.deepEqual(reasoningBody(c('anthropic','custom'),sel('anthropic-budget',1024)),{thinking:{type:'enabled',budget_tokens:1024}});
 assert.throws(()=>reasoningBody(c('anthropic','custom'),sel('anthropic-budget',4096)));
 assert.throws(()=>reasoningBody(c('anthropic','custom'),sel('anthropic-effort','low'),{temperature:.7}));
 assert.throws(()=>reasoningBody(c('anthropic','custom'),sel('anthropic-budget',1024),{output:1000}));
 assert.throws(()=>reasoningBody(c('anthropic','claude-sonnet-4-5','https://api.anthropic.com/v1'),sel('anthropic-effort','high')));
});
test('core wire merges Gemini generation settings without touching stream/history',async()=>{
 let body;
 await generateText({config:c('gemini','gemini-3.5-flash-lite','https://generativelanguage.googleapis.com/v1beta'),messages:[{role:'user',content:'hi'}],settings:{temperature:.5,output:100,reasoning:sel('gemini-level','high')},fetchImpl:async(u,o)=>{
  body=JSON.parse(o.body);return Response.json({candidates:[{content:{parts:[{text:'ok'}]}}]});
 }});
 assert.deepEqual(body.generationConfig,{temperature:.5,maxOutputTokens:100,thinkingConfig:{thinkingLevel:'high'}});
 assert.equal(getRecommendedReasoningTemplate(c('openai','gpt-4.1','https://api.openai.com/v1')),null);
 const choices=getReasoningTemplates(c('gemini','x'));choices[0].choices.push('bad');
 assert.equal(getReasoningTemplates(c('gemini','x'))[0].choices.includes('bad'),false);
});
