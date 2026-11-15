import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyProvider} from '../src/provider-identity.js';
import {getReasoningTemplates} from '../src/reasoning.js';
import {generateText,listModels} from '../src/core.js';

const bases=[
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
];
const key='synthetic-qwen-api-key-no-real-credential';
for(const base of bases) {
  const config={protocol:'openai',url:base,trustedTarget:base,key,model:'qwen3.8-flash'};
  test('Qwen profile matches only its declared official base '+base,()=>{
    assert.deepEqual(identifyProvider(config),{provider:'qwen',profileMatched:true});
    assert.deepEqual(getReasoningTemplates(config),[]);
    assert.equal(identifyProvider({...config,url:base+'/other'}).profileMatched,false);
  });
  test('Qwen text uses OpenAI-compatible Chat and Bearer, no invented fields '+base,async()=>{
    let calls=0;
    const result=await generateText({config,messages:[{role:'user',content:'你好'}],
      settings:{output:1000},fetchImpl:async(url,opts)=>{
        calls++;assert.equal(url,base+'/chat/completions');
        assert.equal(opts.headers.Authorization,'Bearer '+key);
        assert.equal(opts.headers['Content-Type'],'application/json');
        assert.equal(opts.redirect,'error');
        const body=JSON.parse(opts.body);
        assert.equal(body.model,'qwen3.8-flash');
        assert.equal(body.max_completion_tokens,1000);
        assert.equal(body.messages[0].content,'你好');
        assert.equal(body.reasoning_effort,undefined);
        return Response.json({choices:[{message:{role:'assistant',content:'你好！'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}});
      }});
    assert.equal(calls,1);
    assert.equal(result.text,'你好！');
  });
  test('Qwen model listing never calls unverified OpenAI /models '+base,async()=>{
    await assert.rejects(()=>listModels({config,fetchImpl:()=>assert.fail('network must not run')}),e=>e.code==='MODELS_UNSUPPORTED');
  });
}
test('Qwen lookalike hostname is not an official template',()=>{
  assert.deepEqual(identifyProvider({protocol:'openai',url:'https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1'}),{provider:null,profileMatched:false});
  assert.equal(identifyProvider({protocol:'anthropic',url:bases[0]}).profileMatched,false);
});
