import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {requestOutcome} from '../../src/request-outcome.js';
await report('request-outcome',async()=>{
  const out=requestOutcome({kind:'text',completion:{status:'unknown',goalSatisfied:'passed'}});
  assert.equal(out.protocolCompletion,'unknown');assert.equal(out.goalSatisfied,'unknown');return {workflowAndGoalSeparated:true};
});
