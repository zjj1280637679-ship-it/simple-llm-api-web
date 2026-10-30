import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {checkCardPositionModel} from '../models/card-position-model.mjs';
await report('interaction-cards',async()=>{
  return checkCardPositionModel();
});
