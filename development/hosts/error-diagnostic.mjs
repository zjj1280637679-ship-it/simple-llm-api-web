import assert from 'node:assert/strict';
import {readErrorDiagnostic} from '../../src/error-diagnostic.js';
import {report} from './report.mjs';
await report('error-diagnostic',async()=>{
  const result=await readErrorDiagnostic(Response.json({error:{message:'reported',code:'example',extra:'omit'}}),{sanitize:x=>x});assert.equal(result.fields.message,'reported');assert.equal(result.fields.extra,undefined);assert.equal(result.verified,false);const large=await readErrorDiagnostic(Response.json({message:'oversize'}),{sanitize:x=>x,maxBytes:4});assert.equal(large.reason,'size-limit');return {boundedFields:true,reportNotDiagnosis:true};
});
