import assert from 'node:assert/strict';
import { generateImage } from '../../functions/image-generation/index.js';
import { runHost, scriptedFetch, imageReply, persistImages, hostSimulator, hostLiveProbe } from '../support.mjs';

await runHost('F-003',async ({mode,options,config,signal})=>{
  if(mode==='live')return hostLiveProbe(options,'image');
  if(options.simulator==='ark') {
    const selected=await hostSimulator(options,'image'),{sim}=selected;
    try {
      const result=await generateImage({config:selected.config,prompt:selected.prompt,...selected.imageOptions,fetchImpl:sim.fetch,signal});
      const simulation=sim.assertComplete();
      return {files:await persistImages(result,options),requestedSize:result.size,requestMappingChecked:true,
        virtualTime:true,realNetworkRequests:0,simulation,note:'PNG fixture is synthetic, not real image-generation evidence.'};
    } finally {sim.dispose();}
  }
  const fixture=scriptedFetch([imageReply]);
  const result=await generateImage({config:config('image'),prompt:options.prompt,fetchImpl:fixture.fetchImpl,signal});
  assert.equal(fixture.requests.length,1);assert.equal(fixture.requests[0].body.prompt,options.prompt);
  assert.equal(fixture.requests[0].body.size,'2048x2048');
  return {files:await persistImages(result,options),requestedSize:result.size,fixtureImageDimensions:[1,1],
    note:'Requested size is not a measurement of the returned file.'};
});
