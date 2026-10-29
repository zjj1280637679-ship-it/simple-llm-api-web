import assert from 'node:assert/strict';
import { dispatchCommand } from '../../relations/image-command/index.js';
import { runHost, scriptedFetch, imageReply, persistImages } from '../support.mjs';

await runHost('R-001',async ({mode,options,config,realFetch,signal})=>{
  const imageConfig=config('image'), fixture=scriptedFetch([imageReply]);
  let rejectedRequests=0;
  const command={command:'image.generate',args:{prompt:options.prompt}};
  await assert.rejects(dispatchCommand(command,{imageConfig,confirmed:false,signal,
    fetchImpl:async()=>{rejectedRequests++;throw Error('Unconfirmed call reached transport');}}),e=>e.code==='CONFIRMATION');
  assert.equal(rejectedRequests,0);
  const result=await dispatchCommand(command,{imageConfig,confirmed:true,signal,
    fetchImpl:mode==='live'?realFetch:fixture.fetchImpl});
  if(mode!=='live') assert.equal(fixture.requests.length,1);
  return {unconfirmedRequests:rejectedRequests,confirmedEffect:true,files:await persistImages(result,options)};
});
