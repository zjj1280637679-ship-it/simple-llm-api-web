import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {persistCard,validCard,captureCard} from '../../src/card-types.js';
await report('card-types',async()=>{
  const card={id:1,type:'card',kind:'api',values:{url:'https://example.com',key:'fixture-secret'}};const out=persistCard(card);assert.equal(Object.hasOwn(out.values,'key'),false);assert.equal(validCard(out),true);
  const model={id:2,type:'card',kind:'model',values:{output:'0'}};
  assert.equal(persistCard(model).values.displayContext,undefined);
  const values=captureCard(model,{api:{protocol:'gemini',key:'fixture-secret'},model:{output:'0'}});
  assert.equal(values.displayContext.protocol,'gemini');assert.equal(values.displayContext.gemini.version,'0.1.0');assert.doesNotMatch(JSON.stringify(values),/fixture-secret/);
  return {keyExcluded:true,version:out.version,legacyUnknownPreserved:true,minimalProtocolContext:true};
});
