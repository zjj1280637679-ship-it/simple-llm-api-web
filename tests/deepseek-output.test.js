import test from 'node:test';
import assert from 'node:assert/strict';
import {generateText} from '../src/core.js';
test('exact DeepSeek Chat target maps explicit output budget only',async()=>{
 for(const url of ['https://api.deepseek.com','https://api.deepseek.com/v1','https://api.deepseek.com/v1/chat/completions','https://api.openai.com/v1','https://gateway.example/v1','https://api.deepseek.com/custom']) {
  for(const output of [undefined,128]) {
   let body;
   await generateText({config:{protocol:'openai',url,trustedTarget:url,model:'deepseek-flash',key:'synthetic'},messages:[{role:'user',content:'ok'}],settings:{output},fetchImpl:async(u,o)=>{
    body=JSON.parse(o.body);return Response.json({choices:[{message:{role:'assistant',content:'ok'}}]});
   }});
   const exact=['https://api.deepseek.com','https://api.deepseek.com/v1','https://api.deepseek.com/v1/chat/completions'].includes(url);
   assert.equal(body.max_tokens,exact?output:undefined,url);
   assert.equal(body.max_completion_tokens,exact?undefined:output,url);
  }
 }
});
