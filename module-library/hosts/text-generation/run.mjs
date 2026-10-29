import assert from 'node:assert/strict';
import { generateText } from '../../functions/text-generation/index.js';
import { runHost } from '../support.mjs';
import { createGeminiSimulator, simulatorConfig } from '../../test-resources/gemini-native/index.mjs';

await runHost('F-002',async ({mode,options,config,realFetch,signal})=>{
  // The existing host borrows a shared resource; no duplicate provider mock.
  const sim=mode==='live'?null:createGeminiSimulator({scenario:'text.ok',parameters:{prompt:options.prompt}});
  const result=await generateText({config:mode==='live'?config('text'):simulatorConfig(),
    messages:[{role:'user',content:options.prompt}],fetchImpl:mode==='live'?realFetch:sim.fetch,signal});
  assert(result.text.trim().length>0,'Text effect did not occur');
  const simulation=sim?.assertComplete();
  if(sim) assert.equal(result.text,'Host text reply.');
  return {text:result.text,requestMappingChecked:!!sim,transportRequests:simulation?.consumed ?? null,
    realNetworkRequests:sim?0:null,...(simulation?{simulation}:{})};
});
