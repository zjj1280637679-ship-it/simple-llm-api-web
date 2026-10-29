import test from 'node:test';
import assert from 'node:assert/strict';
import {createScope} from '../src/lifecycle.js';
import {createWorkspaceStorage} from '../src/workspace-storage.js';
import {createImageDelivery} from '../src/image-delivery.js';
import {readErrorDiagnostic} from '../src/error-diagnostic.js';
import {declareTransport,describeTransport} from '../src/transport-evidence.js';
import {generateText} from '../src/core.js';
import {getNetworkLogs,clearNetworkLogs} from '../src/logs.js';
import {registerPageSessionTools} from '../src/session-webmcp.js';

test('scope disposal releases every listener once, including late registrations',()=>{
  const scope=createScope(),target=new EventTarget();let events=0,releases=0;
  scope.listen(target,'x',()=>events++);scope.own(()=>{releases++;});scope.own(()=>{throw Error('release failure');});
  target.dispatchEvent(new Event('x'));scope.dispose();scope.dispose();
  target.dispatchEvent(new Event('x'));scope.own(()=>releases++);
  assert.equal(events,1);assert.equal(releases,2);
});

test('storage cannot write before hydration or restore after disposal',async()=>{
  let finish,restores=0,writes=0,closes=0;
  const store={load:()=>new Promise(r=>finish=r),schedule:()=>writes++,close:()=>closes++};
  const storage=createWorkspaceStorage({store,capture:()=>({}),restore:()=>restores++});
  const ready=storage.initialize();storage.save(true);storage.dispose();finish({});await ready;
  storage.save(true);assert.equal(restores,0);assert.equal(writes,0);assert.equal(closes,1);
});

test('journal failure is visible and full snapshot remains a separate viable route',async()=>{
  const states=[],written=[];
  const storage=createWorkspaceStorage({store:{load:async()=>null,journal(){throw Error();},schedule:value=>written.push(value),close(){}},
    capture:()=>({data:'retained'}),captureJournal(){throw Error();},getPage:()=> 'chat',onStatus:s=>states.push(s)});
  await storage.initialize();storage.save(true,true,['chat']);storage.dispose();
  assert.deepEqual(written,[{data:'retained'}]);assert.ok(states.includes('journal-error'));
});

const image={mimeType:'image/png',data:'iVBORw0KGgo='};
test('image receipt distinguishes decoded pixels from requested preset, preserving download on failure',async()=>{
  const released=[];let n=0;
  const host=createImageDelivery({urls:{createObjectURL:()=>`blob:${++n}`,revokeObjectURL:url=>released.push(url)},
    decode:async()=>{if(n===2)throw Error('truncated');return {width:1,height:1};}});
  const images=await host.prepare([image,image],[1024,1024]);
  assert.equal(images[0].checks.decoded,'passed');assert.equal(images[0].checks.dimensions,'mismatch');
  assert.equal(images[1].failed,true);assert.equal(images[1].url,'blob:2');
  host.release(images[0].url);host.dispose();host.dispose();assert.deepEqual(released,['blob:1','blob:2']);
});

test('late decoder completion cannot leak an object URL after host disposal',async()=>{
  let finish;const released=[];
  const host=createImageDelivery({urls:{createObjectURL:()=> 'blob:owned',revokeObjectURL:url=>released.push(url)},decode:()=>new Promise(r=>finish=r)});
  const pending=host.prepare([image]);host.dispose();finish({width:1,height:1});
  await assert.rejects(pending,/disposed/);assert.deepEqual(released,['blob:owned']);
});

test('bounded upstream diagnostic stops on oversize, stalled stream and cancellation',async()=>{
  const sanitize=x=>x;
  assert.equal((await readErrorDiagnostic(Response.json({message:'x'.repeat(30)}),{sanitize,maxBytes:8})).reason,'size-limit');
  assert.equal((await readErrorDiagnostic(new Response(new ReadableStream({start(){}})),{sanitize,timeoutMs:5})).reason,'time-limit');
  const controller=new AbortController();controller.abort();
  assert.equal((await readErrorDiagnostic(new Response(new ReadableStream({start(){}})),{sanitize,signal:controller.signal})).reason,'cancelled');
});

test('upstream fields are redacted and transport declaration is bound to selected function identity',async()=>{
  clearNetworkLogs();const key='synthetic-private-credential';
  const fetch=async()=>Response.json({error:{message:`quota for ${key}`,code:'quota',unneeded:'never copied'}},{status:429});
  const transport=declareTransport(fetch,{kind:'synthetic',hostId:'owned-effects',evidenceId:'test-only'});
  assert.equal(describeTransport(fetch).kind,'unknown');assert.equal(describeTransport(transport).verified,false);
  const config={protocol:'openai',url:'https://example.com/v1',trustedTarget:'https://example.com/v1',key,model:'fixture'};
  await assert.rejects(generateText({config,messages:[{role:'user',content:'test'}],fetchImpl:transport}),error=>{
    assert.equal(error.status,429);assert.match(error.message,/上游说明（未独立核实）/);assert.ok(!error.message.includes(key));return true;
  });
  const logs=getNetworkLogs();assert.equal(logs.at(-1).transport.hostId,'owned-effects');
  assert.ok(!JSON.stringify(logs).includes(key));assert.ok(!JSON.stringify(logs).includes('never copied'));
});

test('retained WebMCP handles become inert when registration is disposed',async()=>{
  const tools=[],removed=[];let called=0;
  const registration=await registerPageSessionTools({execute:()=>called++},{registerTool:tool=>tools.push(tool),unregisterTool:name=>removed.push(name)});
  registration.dispose();registration.dispose();
  assert.equal((await tools[0].execute({})).error,'SESSION_CLOSED');assert.equal(called,0);assert.equal(removed.length,tools.length);
});
