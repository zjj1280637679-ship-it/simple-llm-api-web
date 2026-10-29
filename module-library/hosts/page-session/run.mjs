import assert from 'node:assert/strict';
import { createPageSession } from '../../relations/page-session/index.js';
import { runHost } from '../support.mjs';

await runHost('R-002',async ()=>{
  const state={page:'chat',draft:'',sends:0};
  const session=createPageSession({
    state:()=>({...state}),draft:({text})=>{state.draft=text;return {...state};},
    navigate:({page})=>{state.page=page;return {...state};},
    confirmSend:()=>false,send:()=>{state.sends++;return {status:'completed'};}
  });
  await session.execute({command:'draft.set',args:{text:'host draft'}});
  await session.execute({command:'page.navigate',args:{page:'image'}});
  const readback=await session.execute({command:'session.state'});
  assert.deepEqual(readback.result,{page:'image',draft:'host draft',sends:0});
  const denied=await session.execute({command:'request.send'});
  assert.equal(denied.ok,false); assert.equal(denied.error,'CONFIRMATION_REQUIRED');
  assert.equal(state.sends,0);
  return {state:readback.result,deniedSend:denied,networkRequests:0,
    surface:'In-memory state and real command router; no DOM or browser bridge.'};
});
