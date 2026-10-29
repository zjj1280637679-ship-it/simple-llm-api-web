// Optional offline host 0.1.0, created/updated 2026-10-29T11:10:00Z.
import assert from 'node:assert/strict';
import { buildStructuredOutputFields, parseStructuredResult } from '../src/structured-output.js';
const common = { type:'object',properties:{answer:{type:'string'}},required:['answer'] };
for (const protocol of ['openai','ark','gemini']) {
 const schema = protocol === 'gemini' ? common : { ...common,additionalProperties:false };
 const fields=buildStructuredOutputFields(protocol,{schema});
 assert(fields[protocol==='gemini'?'generationConfig':'response_format']);
 const response=protocol==='gemini' ? {candidates:[{finishReason:'STOP',content:{parts:[{text:'{"answer":"OK"}'}]}}]} : {choices:[{finish_reason:'stop',message:{content:'{"answer":"OK"}'}}]};
 assert.deepEqual(parseStructuredResult(protocol,response),{ok:true,value:{answer:'OK'}});
}
console.log(JSON.stringify({evidenceType:'OFFLINE_HOST',hostVersion:'0.1.0',candidateVersion:'0.1.1-candidate',protocols:3,status:'PASS',networkRequests:0}));
