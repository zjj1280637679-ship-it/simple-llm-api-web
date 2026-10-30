import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {checkImageEvidenceModel} from '../models/image-evidence-model.mjs';
await report('image-evidence',async()=>{
  return checkImageEvidenceModel();
});
