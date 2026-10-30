import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {persistCard,validCard} from '../../src/card-types.js';
await report('card-types',async()=>{
  const card={id:1,type:'card',kind:'api',values:{url:'https://example.com',key:'fixture-secret'}};const out=persistCard(card);assert.equal(Object.hasOwn(out.values,'key'),false);assert.equal(validCard(out),true);return {keyExcluded:true,version:out.version};
});
