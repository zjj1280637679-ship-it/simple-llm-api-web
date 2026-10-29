import assert from 'node:assert/strict';
import { generateText } from '../../functions/text-generation/index.js';
import { runHost, hostSimulator, hostLiveProbe } from '../support.mjs';

await runHost('F-002',async ({mode,options,signal})=>{
  if(mode==='live')return hostLiveProbe(options,'text');
  const {sim,prompt,config,virtualTime}=await hostSimulator(options,'text');
  try {
    const result=await generateText({config,messages:[{role:'user',content:prompt}],fetchImpl:sim.fetch,signal});
    assert(result.text.trim().length>0,'Text effect did not occur');
    const simulation=sim.assertComplete();
    if(!options.simulator)assert.equal(result.text,'Host text reply.');
    return {text:result.text,requestMappingChecked:true,transportRequests:simulation.consumed,
      realNetworkRequests:0,virtualTime,simulation};
  } finally {sim.dispose();}
});
