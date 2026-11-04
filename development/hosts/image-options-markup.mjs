import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {imageOptionsMarkup,changeImageOption} from '../../src/image-options-markup.js';
import {GEMINI_CAPABILITY} from '../../src/image-capabilities.js';
await report('image-options-markup',async()=>{
  const initial={aspectRatio:'1:1',imageSize:'1K'};
  const ratio=changeImageOption(GEMINI_CAPABILITY,initial,'ratio','1:8');
  const both=changeImageOption(GEMINI_CAPABILITY,ratio,'size','4K');
  assert.deepEqual(both,{aspectRatio:'1:8',imageSize:'4K'});assert.deepEqual(initial,{aspectRatio:'1:1',imageSize:'1K'});
  assert.equal(changeImageOption(GEMINI_CAPABILITY,initial,'ratio','invalid'),null);
  const html=imageOptionsMarkup(GEMINI_CAPABILITY,both),shallow=html.split('<details')[0];
  assert.equal((shallow.match(/data-axis="ratio"/g)||[]).length,3);
  assert.match(html,/更多比例 · 1:8/);assert.match(html,/1536×12288/);
  return {independentDimensions:true,rareSelectionVisible:true,shallowRatios:3,noNetwork:true};
});
