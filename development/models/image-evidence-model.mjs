import assert from 'node:assert/strict';
import {imageWorkspaceReceipt,applyImageReceipt,receivedImageSummary} from '../../src/image-evidence.js';

export function checkImageEvidenceModel() {
  const states=[];
  for(const decoded of ['passed','failed','unknown'])for(const dimensions of ['matched','mismatch','unknown'])states.push({checks:{decoded,dimensions}});
  let cases=0;
  function visit(images) {
    const receipt=imageWorkspaceReceipt(images);
    assert.equal(receipt.checks.delivered,images.length?'workspace':'unknown');
    for(const predicate of ['persisted','visible','goalSatisfied'])assert.equal(receipt.checks[predicate],'unknown');
    if(!images.length)assert.equal(receipt.checks.decoded,'unknown');
    if(images.some(i=>i.checks.decoded==='failed'))assert.equal(receipt.checks.decoded,'failed');
    if(images.some(i=>i.checks.dimensions==='mismatch'))assert.equal(receipt.checks.dimensions,'mismatch');
    cases++;
    if(images.length<3)for(const state of states)visit([...images,state]);
  }
  visit([]);
  const received=receivedImageSummary({images:[{mimeType:'image/png'}]});
  const forged={stage:'stored',checks:{decoded:'passed',dimensions:'matched',delivered:'workspace',persisted:'passed',visible:'passed',goalSatisfied:'passed'}};
  const projected=applyImageReceipt(received,forged);
  for(const predicate of ['persisted','visible','goalSatisfied'])assert.equal(projected.checks[predicate],'unknown');
  return {cases,scope:'All 9 decoding/dimension classes for lists of length 0..3 plus a forged receipt. Not a proof for arbitrary inputs or all list lengths.',
    emptySetNotSuccess:true,goalAndDurabilityNotInferred:true};
}
