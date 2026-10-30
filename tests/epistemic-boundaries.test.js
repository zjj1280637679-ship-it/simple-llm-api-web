import test from 'node:test';
import assert from 'node:assert/strict';
import {observeCompletion} from '../src/completion-evidence.js';
import {decideCompletion} from '../src/completion-policy.js';
import {imageWorkspaceReceipt,applyImageReceipt,receivedImageSummary} from '../src/image-evidence.js';
import {requestOutcome} from '../src/request-outcome.js';
import {collectTextStream} from '../src/stream.js';
import {AppError,generateText} from '../src/core.js';
import {checkCompletionModel} from '../development/models/completion-model.mjs';
import {checkImageEvidenceModel} from '../development/models/image-evidence-model.mjs';

test('completion evidence and admission retain separate meanings across the finite model',()=>{
  assert.equal(checkCompletionModel().cases,680);
});
test('image evidence finite model rejects empty-set and cross-predicate success inference',()=>{
  assert.equal(checkImageEvidenceModel().cases,820);
});
test('unknown future marker is a profile gap, not an observed truncation',()=>{
  const unknown=observeCompletion({protocol:'openai',reason:'future_status'});
  const truncated=observeCompletion({protocol:'openai',reason:'length'});
  assert.equal(unknown.status,'unknown');assert.equal(truncated.status,'incomplete');
  assert.equal(decideCompletion(unknown).admitted,false);assert.equal(decideCompletion(truncated).admitted,false);
  assert.notEqual(decideCompletion(unknown).reason,decideCompletion(truncated).reason);
});
test('JSON and stream consult the same profile but keep their framing policy',async()=>{
  const config={protocol:'openai',url:'https://example.com/v1',trustedTarget:'https://example.com/v1',key:'synthetic',model:'fixture'};
  const json=await generateText({config,messages:[{role:'user',content:'fixture'}],fetchImpl:async()=>Response.json({choices:[{message:{role:'assistant',content:'text'}}]})});
  assert.equal(json.completion.status,'unknown');assert.equal(json.completion.admission.admitted,true);
  const stream=new Response('data: {"choices":[{"delta":{"content":"text"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(collectTextStream(stream,{protocol:'openai',onDelta(){},error:(code,message)=>new AppError(code,message)}),{code:'STREAM_INTERRUPTED'});
});
test('workspace receipt separates failed decode, stored result and durable storage',()=>{
  const receipt=imageWorkspaceReceipt([{checks:{decoded:'failed',dimensions:'unknown'}}]);
  assert.equal(receipt.stage,'stored');assert.equal(receipt.checks.decoded,'failed');assert.equal(receipt.checks.persisted,'unknown');
  assert.equal(imageWorkspaceReceipt([]).stage,'empty');
  const effect=applyImageReceipt(receivedImageSummary({images:[{mimeType:'image/png'}]}),{...receipt,checks:{...receipt.checks,goalSatisfied:'passed'}});
  assert.equal(effect.checks.goalSatisfied,'unknown');
});
test('returned request outcome neither upgrades unknown completion nor leaks raw producer data',()=>{
  const out=requestOutcome({kind:'text',completion:{status:'unknown',reason:'private-marker',goalSatisfied:'passed'},apiKey:'synthetic-private'});
  assert.equal(out.operation,'returned');assert.equal(out.protocolCompletion,'unknown');assert.equal(out.goalSatisfied,'unknown');
  assert.doesNotMatch(JSON.stringify(out),/private-marker|synthetic-private/);
});
