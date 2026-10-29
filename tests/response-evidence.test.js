import test from 'node:test';
import assert from 'node:assert/strict';
import {generateText} from '../src/core.js';
import {runConversation} from '../src/agent.js';

const config = protocol => ({protocol,url:'https://example.com/v1',trustedTarget:'https://example.com/v1',model:'fixture',key:'synthetic'});
const messages=[{role:'user',content:'hello'}];
const payload=(protocol,reason)=>protocol==='gemini'
  ? {candidates:[{content:{parts:[{text:'partial'}]},finishReason:reason}]}
  : {choices:[{message:{role:'assistant',content:'partial'},finish_reason:reason}]};

test('explicit nonstream truncation/unknown ending never counts as a complete response', async () => {
  for (const [protocol,reason] of [['gemini','MAX_TOKENS'],['gemini','SAFETY'],['openai','length'],['ark','content_filter'],['openai','future_status']]) {
    await assert.rejects(generateText({config:config(protocol),messages,fetchImpl:async()=>Response.json(payload(protocol,reason))}),{code:'RESPONSE_INCOMPLETE'});
  }
});

test('missing completion metadata is explicitly unknown; normal stop is scoped completion', async () => {
  for (const protocol of ['gemini','openai','ark']) {
    for (const reason of [undefined,protocol==='gemini'?'STOP':'stop']) {
      const response=await generateText({config:config(protocol),messages,fetchImpl:async()=>Response.json(payload(protocol,reason))});
      assert.equal(response.completion.status,reason?'complete':'unknown');
    }
  }
});

test('partial tool-call response cannot reach approval, execution or history checkpoint', async () => {
  let approvals=0,requests=0,checkpoints=0;
  await assert.rejects(runConversation({config:config('openai'),messages,
    confirmTool:()=>{approvals++;return true;},onHistory:()=>checkpoints++,
    fetchImpl:async()=>{requests++;return Response.json({choices:[{finish_reason:'length',message:{role:'assistant',content:'partial',tool_calls:[{id:'t',type:'function',function:{name:'image_generate',arguments:'{"prompt":"cat"}'}}]}}]});}
  }),{code:'RESPONSE_INCOMPLETE'});
  assert.deepEqual({approvals,requests,checkpoints},{approvals:0,requests:1,checkpoints:0});
});

test('explicit refusal cannot be hidden by accompanying parseable text or tools', async () => {
  await assert.rejects(generateText({config:config('openai'),messages,fetchImpl:async()=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'text',refusal:'declined'}}]})}),{code:'BLOCKED'});
});

test('full Chat endpoint is not suffixed twice; base endpoint still gets the operation path', async () => {
  for (const base of ['https://api.deepseek.com','https://api.deepseek.com/v1','https://api.deepseek.com/v1/chat/completions']) {
    let observed;
    await generateText({config:{...config('openai'),url:base,trustedTarget:base},messages,fetchImpl:async url=>{observed=url;return Response.json(payload('openai','stop'));}});
    assert.equal(observed,base.endsWith('/chat/completions')?base:base+'/chat/completions');
  }
});

test('HTTP status is observed evidence; a suggested cause is not presented as a diagnosis', async () => {
  await assert.rejects(generateText({config:config('openai'),messages,fetchImpl:async()=>new Response('',{status:429})}), error=>error.status===429 && /具体原因尚未核实/.test(error.message));
});

test('conversation result retains unknown protocol completion instead of silently upgrading it',async()=>{
 const result=await runConversation({config:config('openai'),messages,fetchImpl:async()=>Response.json(payload('openai',undefined))});
 assert.equal(result.completion.status,'unknown');
});
