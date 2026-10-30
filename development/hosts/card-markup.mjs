import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {cardShell,chartCardMarkup,unknownCardMarkup} from '../../src/card-markup.js';
await report('card-markup',async()=>{
  const card={id:1,kind:'chart',version:1,values:{rows:[{label:'<x>',value:null},{label:'zero',value:0}]}};const body=chartCardMarkup(card);assert.match(body,/&lt;x&gt;/);assert.match(body,/>未知</);assert.match(cardShell(card,body,{live:false}),/fieldset disabled/);return {escaped:true,unknownDistinct:true,sharedShell:true};
});
