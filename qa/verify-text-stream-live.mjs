/** Host 0.1.0 offline counterexamples. All responses below are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makePlan,run,assess,EXPECTED} from './text-stream-live.mjs';

const args=['--protocol','openai','--endpoint','https://api.example.com/v1','--model','synthetic-model'];
test('plan needs no credential or fetch; malformed options are rejected',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>assert.fail('plan performed a request');
  try {
    assert.equal((await run(makePlan(args))).status,'PLAN_ONLY');
    for(const extra of [['--execute'],['--output-tokens','0'],['--api-key','secret'],['--protocol','ark']])
      assert.throws(()=>makePlan([...args,...extra]));
  } finally {globalThis.fetch=original;}
});
test('JSON, partial ending and mismatched deltas cannot count as streamed sample success',()=>{
  const base={response:{text:EXPECTED,toolCalls:[],completion:{status:'complete'}},deltaText:EXPECTED,
    deltaCount:1,httpStatus:200,contentType:'text/event-stream'};
  assert.equal(assess(base).samplePassed,true);
  assert.equal(assess(base).multipleDeltasObserved,false);
  for(const patch of [{contentType:'application/json'},{deltaCount:0},{deltaText:'wrong'},
    {httpStatus:429},{error:{code:'CANCELLED'}},{response:{...base.response,completion:{status:'unknown'}}}])
    assert.equal(assess({...base,...patch}).samplePassed,false);
});
test('one synthetic request persists a bounded report; existing path blocks any next request',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'text-acceptance-'));
  const originalFetch=globalThis.fetch, priorKey=process.env.OPENAI_API_KEY;
  const key='synthetic-only-not-a-provider-key';process.env.OPENAI_API_KEY=key;
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    const chunk=content=>`data: ${JSON.stringify({choices:[{index:0,delta:{content}}]})}\n\n`;
    return new Response(chunk('STREAM_OK\n')+chunk('第一行：你好。\n第二行：流式验收。')+
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      {headers:{'content-type':'text/event-stream','x-request-id':key}});
  };
  try {
    const path=join(dir,'report.json'), plan=makePlan([...args,'--execute','--report',path]);
    assert.equal((await run(plan)).status,'SAMPLE_PASS');assert.equal(calls,1);
    const text=await readFile(path,'utf8'), report=JSON.parse(text);
    assert(!text.includes(key));assert.equal(report.observations.deltaCount,2);
    assert.equal(report.provenance.independentlyVerified,false);
    assert.equal(report.assessment.browserCORS,'not-tested');
    assert.equal(report.assessment.productCLI,'not-tested');
    assert.equal(report.observations.requestsObserved,1);
    await assert.rejects(run(plan));assert.equal(calls,1);
    // Missing key must fail before replacing an existing report or sending anything.
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(run(plan));assert.equal(calls,1);
    await writeFile(join(dir,'synthetic-note.txt'),'These are offline fixtures, not live evidence.');
  } finally {
    globalThis.fetch=originalFetch;
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;
    await rm(dir,{recursive:true,force:true});
  }
});
