import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { executeMcpCommand, validateMcpConfig, assertCurrentTarget, normalizeMcpResult } from '../cli/cli-mcp-transport.mjs';
import { main } from '../cli/web-cli.mjs';
import { pageSessionTools } from '../src/session-webmcp.js';
const config = { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/fake-browser-mcp.fixture.mjs', import.meta.url))], targetUrl: 'https://workbench.example/app/', tabIndex: 0 };
const tabs = url => ({ content: [{ type: 'text', text: `### Open tabs\n- 0: (current) [Workbench](${url})` }] });

test('MCP config is explicit, bounded and does not accept env, shell or credentials', () => {
  assert.equal(validateMcpConfig(config).origin,'https://workbench.example');
  for(const update of [{shell:true},{env:{KEY:'secret'}},{tabIndex:-1},{targetUrl:'http://public.example/'},{targetUrl:'https://user:pass@workbench.example/'},{targetUrl:'https://workbench.example/?token=x'},{args:'--extension'},{timeoutMs:Infinity}]) assert.throws(()=>validateMcpConfig({...config,...update}));
});
test('target verification rejects origin, path, index and ambiguous output mismatches', () => {
  const checked=validateMcpConfig(config);
  assert.doesNotThrow(()=>assertCurrentTarget(tabs(config.targetUrl),checked));
  for(const result of [tabs('https://evil.example/app/'),tabs('https://workbench.example/other/'),{content:[]},{content:[{type:'text',text:'- 1: (current) [W](https://workbench.example/app/)'}]}]) assert.throws(()=>assertCurrentTarget(result,checked),{code:'MCP_TARGET_MISMATCH'});
});
test('MCP results normalize structured and Playwright text results without dumping errors', () => {
  assert.deepEqual(normalizeMcpResult({structuredContent:{ok:true,result:{page:'chat'}}}),{ok:true,result:{page:'chat'}});
  assert.deepEqual(normalizeMcpResult({content:[{type:'text',text:'### Result\n{"ok":true,"result":42}\n### Page\nuntrusted'}]}),{ok:true,result:42});
  assert.throws(()=>normalizeMcpResult({isError:true,content:[{type:'text',text:'secret'}]}),{code:'MCP_COMMAND_FAILED'});
});
test('page-side guard prevents stale selected-tab check from reaching a wrong page', async () => {
  let called=false;
  const tool=pageSessionTools({execute:()=>{called=true;}})[0];
  assert.deepEqual(await tool.execute({__expectedOrigin:'https://wrong.example'}),{ok:false,error:'MCP_TARGET_MISMATCH'});
  assert.equal(called,false);
});

// Small synthetic SDK stand-in permits pipe-level tests without installing SDK
// or a real browser host. Production SDK interoperability is separately gated.
class SyntheticStdio {
  constructor(options) { this.options=options; }
  async close() { this.process?.stdin.end(); if(this.process) await new Promise(resolve=>this.process.once('close',resolve)); }
}
class SyntheticClient {
  constructor() { this.id=0; this.pending=new Map(); }
  async connect(transport) {
    this.transport=transport;
    const child=spawn(transport.options.command,transport.options.args,{shell:false,stdio:['pipe','pipe','ignore']});
    transport.process=child;
    createInterface({input:child.stdout}).on('line',line=>{const data=JSON.parse(line);this.pending.get(data.id)?.(data.result);this.pending.delete(data.id);});
    await this.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'synthetic-test',version:'1'}});
  }
  rpc(method,params) { const id=++this.id;return new Promise(resolve=>{this.pending.set(id,resolve);this.transport.process.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}); }
  listTools() {return this.rpc('tools/list',{});}
  callTool(params) {return this.rpc('tools/call',params);}
  close() {return this.transport.close();}
}
test('synthetic stdio end-to-end: CLI → transport → actual child pipe → JSON result (no browser)', async () => {
  const output=[];
  const code=await main(['draft.set','{"text":"visible draft"}','--mcp-config','explicit.json'],{
    stdout:line=>output.push(line),stderr:line=>assert.fail(line),
    runMcp:input=>executeMcpCommand(input,config,{loadSdk:async()=>({Client:SyntheticClient,StdioClientTransport:SyntheticStdio})})
  });
  assert.equal(code,0);
  assert.deepEqual(JSON.parse(output[0]),{ok:true,result:{draft:'visible draft',synthetic:true}});
});
test('transport allowlists commands, fails closed without SDK, and disconnects on target mismatch', async () => {
  await assert.rejects(executeMcpCommand({command:'eval'},config),{code:'INVALID_SESSION_COMMAND'});
  assert.deepEqual(await executeMcpCommand({command:'session.state'},config,{loadSdk:async()=>{const e=new Error('secret');e.code='MCP_SDK_REQUIRED';throw e;}}),{ok:false,error:'MCP_SDK_REQUIRED'});
  let closed=false,called=[];
  class FakeClient {async connect(){} async callTool(p){called.push(p.name);return tabs('https://wrong.example/');} async close(){closed=true;}}
  const result=await executeMcpCommand({command:'session.state'},config,{loadSdk:async()=>({Client:FakeClient,StdioClientTransport:class{}})});
  assert.deepEqual(result,{ok:false,error:'MCP_TARGET_MISMATCH'});assert.equal(closed,true);assert.deepEqual(called,['browser_tabs']);
});

test('optional actual MCP SDK against synthetic stdio peer (still no browser)', async t => {
  try { await import('@modelcontextprotocol/sdk/client/index.js'); }
  catch { t.skip('Optional MCP SDK not installed; actual SDK interoperability not verified'); return; }
  const result=await executeMcpCommand({command:'draft.set',args:{text:'SDK pipe test'}},config);
  assert.deepEqual(result,{ok:true,result:{draft:'SDK pipe test',synthetic:true}});
});

test('MCP preserves safe failed-send metadata without upstream payloads', () => {
  assert.deepEqual(normalizeMcpResult({structuredContent:{ok:false,error:'REQUEST_FAILED',result:{status:'failed',code:'HTTP',body:'must not return'}}}),{ok:false,error:'REQUEST_FAILED',result:{status:'failed',code:'HTTP'}});
});
