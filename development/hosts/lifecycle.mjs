import assert from 'node:assert/strict';
import {createScope} from '../../src/lifecycle.js';
import {report} from './report.mjs';
await report('lifecycle',async()=>{
  const scope=createScope();let n=0;scope.own(()=>n++);scope.dispose();scope.dispose();scope.own(()=>n++);assert.equal(n,2);return {releasedOnce:true,lateRegistrationReleased:true};
});
