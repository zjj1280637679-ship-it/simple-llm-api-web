import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {canonicalEndpoint,validateEndpoint} from '../../src/api-target.js';
await report('api-target',async()=>{
  const base=canonicalEndpoint('https://example.com/v1/');assert.equal(base,'https://example.com/v1');
  assert.throws(()=>validateEndpoint({protocol:'openai',url:base,trustedTarget:'https://other.example.com/v1',key:'synthetic'}),{code:'UNTRUSTED_ENDPOINT'});
  return {normalizationObserved:true,targetChangeRejected:true,ownershipNotProved:true};
});
