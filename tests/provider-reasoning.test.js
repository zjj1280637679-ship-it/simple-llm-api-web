import test from 'node:test';
import assert from 'node:assert/strict';
import {getReasoningTemplates,getRecommendedReasoningTemplate,reasoningBody} from '../src/reasoning.js';
import {generateText} from '../src/core.js';
const deep=(model='deepseek-flash',url='https://api.deepseek.com')=>({protocol:'openai',model,url,trustedTarget:url,key:'synthetic'});
const select=(template,value)=>({template,value});
test('DeepSeek provider is independent of OpenAI wire protocol',()=>{
 const config=deep();
 assert.equal(getRecommendedReasoningTemplate(config),'deepseek-effort');
 assert.deepEqual(getReasoningTemplates(config).map(x=>x.id),['deepseek-effort','deepseek-thinking']);
 assert.deepEqual(reasoningBody(config,select('deepseek-effort','max')),{reasoning_effort:'max'});
 assert.deepEqual(reasoningBody(config,select('deepseek-effort','none')),{reasoning_effort:'none'});
 assert.deepEqual(reasoningBody(config,select('deepseek-thinking','disabled')),{thinking:{type:'disabled'}});
 assert.throws(()=>reasoningBody(config,select('openai-effort','medium')));
 assert.throws(()=>reasoningBody(config,select('deepseek-effort','medium')));
 assert.deepEqual(reasoningBody(config),{});
});
test('unknown DeepSeek and legacy names manual only, no alias rewrite',()=>{
 for(const model of ['deepseek-reasoner','deepseek-chat','future-latest']){
  const config=deep(model);
  assert.equal(getRecommendedReasoningTemplate(config),null);
  assert.ok(getReasoningTemplates(config).every(x=>x.id.startsWith('deepseek-')&&!x.verifiedModel));
  assert.deepEqual(reasoningBody(config,select('deepseek-thinking','enabled')),{thinking:{type:'enabled'}});
 }
});
test('custom gateway can explicitly choose vendor templates without official claim',()=>{
 const config=deep('anything','https://gateway.example/v1');
 assert.equal(getRecommendedReasoningTemplate(config),null);
 assert.ok(getReasoningTemplates(config).some(x=>x.id==='deepseek-effort'));
 assert.deepEqual(reasoningBody(config,select('deepseek-effort','low')),{reasoning_effort:'low'});
 assert.deepEqual(reasoningBody(config,select('openai-effort','medium')),{reasoning_effort:'medium'});
 assert.throws(()=>reasoningBody({...config,protocol:'gemini'},select('deepseek-effort','low')));
 for(const url of ['https://api.deepseek.com:8443','https://api.deepseek.com/custom','https://api.deepseek.com?x=1','https://api.deepseek.com.evil.example']) assert.equal(getRecommendedReasoningTemplate(deep('deepseek-flash',url)),null);
});
test('Zhipu regular model rules do not inherit OpenAI or Coding Plan semantics',()=>{
 const config={...deep(),url:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3'};
 assert.equal(getRecommendedReasoningTemplate(config),'zhipu-effort');
 assert.deepEqual(getReasoningTemplates(config)[0].choices,['low','high','max']);
 assert.throws(()=>reasoningBody(config,select('zhipu-effort','none')));
 assert.throws(()=>reasoningBody(config,select('zhipu-thinking','disabled')));
 assert.deepEqual(reasoningBody({...config,model:'glm-5.2'},select('zhipu-thinking','disabled')),{thinking:{type:'disabled'}});
 assert.equal(getRecommendedReasoningTemplate({...config,url:'https://open.bigmodel.cn/api/coding/paas/v4'}),null);
 assert.ok(getReasoningTemplates({...config,model:'future'}).every(x=>x.id.startsWith('zhipu-')&&!x.verifiedModel));
});
test('core emits only chosen DeepSeek field and default sends none',async()=>{
 for(const selection of [undefined,select('deepseek-thinking','enabled'),select('deepseek-effort','high')]){
  let body;await generateText({config:deep(),messages:[{role:'user',content:'hello'}],settings:{reasoning:selection},fetchImpl:async(url,options)=>{
   body=JSON.parse(options.body);return Response.json({choices:[{message:{role:'assistant',content:'ok'}}]});
  }});
  assert.equal(body.model,'deepseek-flash');
  assert.deepEqual(body.thinking,selection?.template==='deepseek-thinking'?{type:'enabled'}:undefined);
  assert.equal(body.reasoning_effort,selection?.template==='deepseek-effort'?'high':undefined);
 }
});
