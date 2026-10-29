import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeCredentialUse,listModels,generateText,generateImage,canonicalEndpoint,IMAGE_MODEL,ARK_ENDPOINT,ARK_FLASH_MODEL} from '../src/core.js';
const config=(protocol='gemini',key='  sk-complete-key  ')=>({protocol,key,url:protocol==='ark'?ARK_ENDPOINT:'https://example.com/v1',trustedTarget:canonicalEndpoint(protocol==='ark'?ARK_ENDPOINT:'https://example.com/v1'),model:protocol==='ark'?ARK_FLASH_MODEL:protocol==='gemini'?IMAGE_MODEL:'test'});
test('credential observer sees only the exact trimmed credential at attempted transport, never local reject/abort',async()=>{
 const keys=[],off=subscribeCredentialUse(key=>keys.push(key));let requests=0;
 const fetchImpl=async()=>{requests++;return new Response(JSON.stringify({models:[]}),{status:200});};
 try{
  await assert.rejects(generateText({config:config('gemini','s'),messages:[{role:'user',content:'hello'}],settings:{output:'invalid'},fetchImpl}));
  const c=new AbortController();c.abort();await assert.rejects(listModels({config:config('gemini','s'),signal:c.signal,fetchImpl}));
  await assert.rejects(listModels({config:{...config('gemini','s'),url:'http://invalid.example'},fetchImpl}));
  assert.deepEqual(keys,[]);assert.equal(requests,0);
  await listModels({config:config(),fetchImpl});assert.deepEqual(keys,['sk-complete-key']);assert.equal(requests,1);
 }finally{off();}
});
test('one shared transport observer covers text and image calls across formats, including failed HTTP',async()=>{
 const keys=[],off=subscribeCredentialUse(key=>keys.push(key));let requests=0;
 const fetchImpl=async()=>{requests++;return new Response('{}',{status:401});};
 try{
  for(const protocol of ['gemini','openai','anthropic'])await assert.rejects(generateText({config:{...config(protocol,`  sk-${protocol}-complete  `),model:'test'},messages:[{role:'user',content:'hello'}],fetchImpl}));
  for(const protocol of ['gemini','ark'])await assert.rejects(generateImage({config:config(protocol,`  image-${protocol}-complete  `),prompt:'test image',aspectRatio:'1:1',imageSize:'1K',fetchImpl}));
  assert.equal(requests,5);assert.deepEqual(keys,['sk-gemini-complete','sk-openai-complete','sk-anthropic-complete','image-gemini-complete','image-ark-complete']);
 }finally{off();}
});
