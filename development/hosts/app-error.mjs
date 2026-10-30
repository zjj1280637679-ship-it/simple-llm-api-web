import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {AppError} from '../../src/app-error.js';
await report('app-error',async()=>{
  const error=new AppError('HTTP','fixture',429);assert.equal(error.code,'HTTP');assert.equal(error.status,429);assert.equal(error.message,'fixture');
  assert.equal(Object.hasOwn(error,'cause'),false);return {localIdentityPreserved:true,noRootCauseInvented:true};
});
