import assert from 'node:assert/strict';
import { generateImage } from '../../functions/image-generation/index.js';
import { runHost, scriptedFetch, imageReply, persistImages } from '../support.mjs';

await runHost('F-003',async ({mode,options,config,realFetch,signal})=>{
  const fixture=scriptedFetch([imageReply]);
  const result=await generateImage({config:config('image'),prompt:options.prompt,
    fetchImpl:mode==='live'?realFetch:fixture.fetchImpl,signal});
  if(mode!=='live') {
    assert.equal(fixture.requests.length,1);
    assert.equal(fixture.requests[0].body.prompt,options.prompt);
    assert.equal(fixture.requests[0].body.size,'2048x2048');
  }
  return {files:await persistImages(result,options),requestedSize:result.size,
    fixtureImageDimensions:mode==='synthetic'?[1,1]:null,
    note:'Requested size is not a measurement of the returned file.'};
});
