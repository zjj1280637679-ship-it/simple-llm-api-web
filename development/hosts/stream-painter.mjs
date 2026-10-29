import assert from 'node:assert/strict';
import {createStreamPainter} from '../../src/stream-painter.js';
import {report} from './report.mjs';
await report('stream-painter',async()=>{
  const answer={},label={},d={};const node={querySelector:s=>s==='.reply-text'?answer:label};const app={scrollTop:10,scrollHeight:1000,clientHeight:100,querySelector:()=>node};const paint=createStreamPainter({app,get:()=>d,saveLocal(){},recordScrollDiagnostic(){},render(){throw Error('unexpected full render');}});paint(d,{id:1,text:'delta',streaming:true});assert.equal(answer.textContent,'delta');assert.equal(app.scrollTop,10);return {incrementalText:true,readingPreserved:true};
});
