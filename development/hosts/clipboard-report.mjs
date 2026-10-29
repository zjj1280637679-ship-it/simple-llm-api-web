import assert from 'node:assert/strict';
import {copyDiagnosticReport} from '../../src/clipboard-report.js';
import {report} from './report.mjs';
await report('clipboard-report',async()=>{
  let resolve,page='logs';const status={},field={isConnected:false};const app={querySelector:s=>s.includes('text')?field:status};const p=copyDiagnosticReport({app,getPage:()=>page,text:'{}',clipboard:{writeText:()=>new Promise(r=>resolve=r)}});page='chat';resolve();await p;assert.equal(status.textContent,undefined);return {staleViewUntouched:true};
});
