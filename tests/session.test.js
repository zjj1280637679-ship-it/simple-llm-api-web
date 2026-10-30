import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageSession, validateSessionCommand, SESSION_COMMANDS } from '../src/session.js';
import { registerPageSessionTools } from '../src/session-webmcp.js';
import { main } from '../cli/web-cli.mjs';

test('typed commands refuse secrets, target overrides, arbitrary commands and consent flags', () => {
  for (const input of [
    {command:'eval',args:{code:'x'}}, {command:'__proto__'},
    ...['key','url','protocol','trustedTarget','confirmed','__proto__'].map(k=>({command:'settings.update',args:JSON.parse(`{"${k}":"x"}`)})),
    {command:'request.send',args:{confirmed:true}}, {command:'draft.set',args:{text:12}},
    {command:'settings.update',args:{output:1.5}}, {command:'settings.update',args:{topP:2}},
    {command:'settings.update',args:{temperature:NaN}}, {command:'settings.update',args:{imageSize:'8K'}},
    {command:'page.navigate',args:{page:'https://evil.example'}}, {command:'session.logs',args:{key:true}}
  ]) assert.throws(()=>validateSessionCommand(input), {code:'INVALID_SESSION_COMMAND'});
});
test('settings input is copied and empty numeric defaults accepted', () => {
  const args={model:'model',output:'',temperature:0,topP:1,aspectRatio:'16:9',imageSize:'2K'};
  assert.deepEqual(validateSessionCommand({command:'settings.update',args}).args,args);
  assert.notEqual(validateSessionCommand({command:'settings.update',args}).args,args);
});
test('send cannot bypass page user confirmation and catches unsafe errors', async () => {
  let calls=0;
  const send=()=>{calls++;};
  assert.deepEqual(await createPageSession({send}).execute({command:'request.send'}),{ok:false,error:'CONFIRMATION_REQUIRED'});
  assert.deepEqual(await createPageSession({send,confirmSend:()=>false}).execute({command:'request.send'}),{ok:false,error:'CONFIRMATION_REQUIRED'});
  assert.equal(calls,0);
  assert.equal((await createPageSession({send,confirmSend:()=>true}).execute({command:'request.send'})).ok,true);
  assert.equal(calls,1);
  const session=createPageSession({state:()=>{throw new Error('synthetic-key');}});
  assert.equal(JSON.stringify(await session.execute({command:'session.state'})).includes('synthetic-key'),false);
});
test('CLI dispatches exact command to same session through explicit transport', async () => {
  let draft=''; const lines=[];
  const session=createPageSession({draft:args=>{draft=args.text;return {draft};}});
  const code=await main(['draft.set','{"text":"hello"}','--transport','./explicit.mjs'],{
    stdout:s=>lines.push(s),stderr:s=>assert.fail(s),loadTransport:async path=>{assert.equal(path,'./explicit.mjs');return session;}
  });
  assert.equal(code,0); assert.equal(draft,'hello'); assert.deepEqual(JSON.parse(lines[0]),{ok:true,result:{draft:'hello'}});
});
test('CLI missing transport or invalid command never attaches and never leaks error content', async () => {
  for(const argv of [['session.state'],['eval','--transport','x'],['request.send','{"confirmed":true}','--transport','x']]) {
    const output=[];
    assert.equal(await main(argv,{stdout:s=>output.push(s),stderr:s=>output.push(s),loadTransport:()=>assert.fail('must not attach')}),1);
  }
  const lines=[];
  assert.equal(await main(['session.state','--transport','x'],{stderr:s=>lines.push(s),loadTransport:()=>{throw new Error('secret');}}),1);
  assert.equal(lines.join('').includes('secret'),false);
});
test('WebMCP registers bounded tool surface, dispatches and gracefully lacks support', async () => {
  assert.deepEqual(await registerPageSessionTools({},{}),{available:false,registered:[]});
  const tools=[]; const session=createPageSession({state:()=>({page:'chat'})});
  const result=await registerPageSessionTools(session,{registerTool:tool=>tools.push(tool)});
  assert.equal(result.registered.length,Object.keys(SESSION_COMMANDS).length);
  const state=tools.find(t=>t.name==='llm_session_state');
  assert.equal(state.annotations.readOnlyHint,true);
  assert.deepEqual(await state.execute({}),{ok:true,result:{page:'chat'}});
  assert.deepEqual(await state.execute({key:true}),{ok:false,error:'INVALID_SESSION_COMMAND'});
});

test('cancel can execute while an approved send is pending', async () => {
  let finish; let cancelled=false;
  const pending=new Promise(resolve=>{finish=resolve;});
  const session=createPageSession({confirmSend:()=>true,send:()=>pending,cancel:()=>{cancelled=true;finish('cancelled');}});
  const sending=session.execute({command:'request.send'});
  await Promise.resolve();
  assert.equal((await session.execute({command:'request.cancel'})).ok,true);
  assert.equal(cancelled,true);
  assert.deepEqual(await sending,{ok:true,result:'cancelled'});
});

test('WebMCP partial registration failure is observable without leaking errors', async () => {
  const result=await registerPageSessionTools({}, {registerTool:()=>{throw new Error('secret');}});
  const {dispose,...metadata}=result;assert.equal(typeof dispose,'function');dispose();
  assert.deepEqual(metadata,{available:true,registered:[],error:'WEBMCP_REGISTRATION_FAILED'});
});

test('app-shaped send failures are semantic failures and CLI exits nonzero with diagnostics', async () => {
  for (const result of [
    {status:'failed',code:'HTTP'}, {status:'cancelled',code:'CANCELLED'},
    {status:'not-sent',reason:'changed-after-confirmation'}, {status:'needs-configuration'},
    {status:'declined'}, {status:'ignored'}
  ]) {
    const session=createPageSession({confirmSend:()=>true,send:()=>result});
    const response=await session.execute({command:'request.send'});
    assert.equal(response.ok,false);assert.deepEqual(response.result,result);
    const lines=[];
    assert.equal(await main(['request.send','--transport','test'],{stdout:s=>lines.push(s),stderr:s=>assert.fail(s),loadTransport:async()=>session}),1);
    assert.deepEqual(JSON.parse(lines[0]).result,result);
  }
  const completed=createPageSession({confirmSend:()=>true,send:()=>({status:'completed',messageCount:2})});
  assert.equal((await completed.execute({command:'request.send'})).ok,true);
});
test('CLI defensively rejects legacy success envelopes carrying failed sends', async () => {
  const lines=[];
  assert.equal(await main(['request.send','--transport','test'],{stdout:s=>lines.push(s),loadTransport:async()=>({execute:()=>({ok:true,result:{status:'failed',code:'HTTP'}})})}),1);
  assert.deepEqual(JSON.parse(lines[0]),{ok:false,error:'REQUEST_FAILED',result:{status:'failed',code:'HTTP'}});
});
