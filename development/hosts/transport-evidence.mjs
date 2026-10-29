import assert from 'node:assert/strict';
import {declareTransport, describeTransport} from '../../src/transport-evidence.js';
import {report} from './report.mjs';
await report('transport-evidence',async()=>{
  const original=()=>{};const fetch=declareTransport(original,{kind:'synthetic',hostId:'H-R-013',evidenceId:'local'});assert.equal(describeTransport(original).kind,'unknown');assert.equal(describeTransport(fetch).kind,'synthetic');assert.equal(describeTransport(fetch).verified,false);return {functionBoundDeclaration:true,noVerificationPromotion:true};
});
