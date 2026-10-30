import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {checkCompletionModel} from '../models/completion-model.mjs';
await report('completion-policy',async()=>{
  return checkCompletionModel();
});
