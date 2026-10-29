import assert from 'node:assert/strict';
import { generateText } from '../../functions/text-generation/index.js';
import { runHost, scriptedFetch, textReply } from '../support.mjs';

await runHost('F-002',async ({mode,options,config,realFetch,signal})=>{
  const fixture=scriptedFetch([textReply('Host text reply.')]);
  const result=await generateText({config:config('text'),messages:[{role:'user',content:options.prompt}],
    fetchImpl:mode==='live'?realFetch:fixture.fetchImpl,signal});
  assert(result.text.trim().length>0,'Text effect did not occur');
  if(mode!=='live') {
    assert.equal(fixture.requests.length,1);
    assert.equal(fixture.requests[0].body.messages[0].content,options.prompt);
    assert.equal(result.text,'Host text reply.');
  }
  return {text:result.text,requestMappingChecked:mode!=='live',networkRequests:mode==='live'?null:1};
});
