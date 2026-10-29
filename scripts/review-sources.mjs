import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),today=new Date().toISOString().slice(0,10);
const registry=JSON.parse(await readFile(new URL('docs/evidence/source-claims.json',root),'utf8'));
const catalog=JSON.parse(await readFile(new URL('docs/ark-model-catalog.json',root),'utf8'));
const records=[...registry.records,...catalog.models.map(model=>({id:model.id,recordedAt:model.evidence.observed_at,reviewAfter:model.evidence.review_after,sourceSnapshot:model.evidence.source_snapshot,liveRun:model.evidence.live_run}))];
for(const record of records)if(!record.id||!/^\d{4}-\d{2}-\d{2}$/.test(record.recordedAt)||!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewAfter))throw new Error('Invalid evidence review record');
console.log(JSON.stringify({today,mode:'advisory',records:records.map(record=>({id:record.id,
  review:record.reviewAfter<=today?'due':'scheduled',reviewAfter:record.reviewAfter,
  sourceEvidence:record.sourceSnapshot?'snapshot-reference':'missing-snapshot',
  liveEvidence:record.liveRun?'run-reference':'unknown'})),scope:'References and review dates do not verify claims; missing receipts remain unknown.'},null,2));
