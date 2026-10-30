import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {observeCompletion} from '../../src/completion-evidence.js';
await report('completion-evidence',async()=>{
  assert.equal(observeCompletion({protocol:'openai',reason:'new-marker'}).status,'unknown');
  assert.equal(observeCompletion({protocol:'openai',reason:'length'}).status,'incomplete');
  return {futureMarkerUnknown:true,truncationDistinct:true};
});
