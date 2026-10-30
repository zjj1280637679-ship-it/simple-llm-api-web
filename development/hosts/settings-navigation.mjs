import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {canNavigateSettings} from '../../src/settings-navigation.js';
await report('settings-navigation',async()=>{const expected=new Set(['api:model','api:connection','model:api','connection:api']);let cases=0;for(const from of ['api','model','connection','chart','__proto__'])for(const to of ['api','model','connection','chart','__proto__']){assert.equal(canNavigateSettings(from,to),expected.has(`${from}:${to}`));cases++;}return {cases,edges:expected.size,scope:'Declared finite relation only; dispatcher admission tested separately.'};});
