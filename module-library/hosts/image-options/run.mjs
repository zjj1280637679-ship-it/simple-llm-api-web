import assert from 'node:assert/strict';
import { normalizeImageOptions, getImageCapabilities } from '../../functions/image-options/index.js';
import { runHost } from '../support.mjs';

await runHost('F-001',async ({config})=>{
  const selected=config('image');
  const options=normalizeImageOptions(selected);
  assert.equal(options.size,'2048x2048');
  assert.equal(getImageCapabilities({...selected,model:'unknown'}),null);
  assert.throws(()=>normalizeImageOptions(selected,{imageSize:'4K'}),e=>e.code==='IMAGE_OPTIONS');
  return {options,unknownModelRejected:true,unsupportedSizeRejected:true,networkRequests:0};
});
