import assert from 'node:assert/strict';
import { runConversation } from '../../compositions/agent-image-turn/index.js';
import { runHost, scriptedFetch, imageReply, textReply, persistImages } from '../support.mjs';

await runHost('C-001',async ({mode,options,config,realFetch,signal})=>{
  const first={choices:[{message:{role:'assistant',content:null,tool_calls:[{
    id:'host-image-1',type:'function',function:{name:'image_generate',arguments:JSON.stringify({prompt:options.prompt})}
  }]}}]};
  const fixture=scriptedFetch([first,imageReply,textReply('Image returned.')]);
  let approvals=0,checkpoints=0,delivered=0; const files=[];
  const result=await runConversation({config:config('text'),imageConfig:config('image'),
    messages:[{role:'user',content:options.prompt}],signal,
    fetchImpl:mode==='live'?realFetch:fixture.fetchImpl,
    confirmTool:()=>++approvals===1,
    onHistory:()=>{checkpoints++;},
    onToolResult:async ({result})=>{delivered++;files.push(...await persistImages(result,options));}
  });
  assert.equal(delivered,1,'Host goal requires one actual image-tool result');
  assert.equal(result.toolResults.length,1); assert(checkpoints>0);
  assert(result.text.trim(),'Host goal requires a follow-up text response');
  if(mode!=='live') {
    assert.equal(fixture.requests.length,3);
    const tool=fixture.requests[2].body.messages.find(m=>m.role==='tool');
    assert.equal(tool.tool_call_id,'host-image-1');
    assert.equal(fixture.remaining(),0);
  }
  return {text:result.text,deliveredImages:delivered,checkpoints,files,
    toolHistoryMatched:mode==='synthetic',approvedImageCalls:1};
});
