import assert from 'node:assert/strict';
import {inspectPng} from '../../functions/png-inspection/index.mjs';
import {runHost} from '../support.mjs';

// Tiny standalone input; no provider manifest, production adapter, or network oracle.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
await runHost('F-005',async()=>{
  const bytes=Buffer.from(PNG,'base64'),original=Buffer.from(bytes);
  const inspected=inspectPng(bytes);
  assert.equal(inspected.width,1);assert.equal(inspected.height,1);
  assert.equal(inspected.decodedBytes,5);
  const corrupted=Buffer.from(bytes);corrupted[29]^=1;
  assert.throws(()=>inspectPng(corrupted),/INVALID_PNG/);
  assert.throws(()=>inspectPng(bytes,{maxBytes:bytes.length-1}),/INVALID_PNG/);
  assert.deepEqual(bytes,original);
  return {inspected,crcMismatchRejected:true,byteLimitRejected:true,inputUnchanged:true,networkRequests:0};
});
