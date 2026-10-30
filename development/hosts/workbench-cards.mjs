import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createWorkbenchCards} from '../../src/workbench-cards.js';
await report('workbench-cards',async()=>{
  let renders=0;const registry=createWorkbenchCards({apiMarkup:()=>'',modelMarkup:()=>'',settingsAction:()=>({ok:true}),field:()=>{},usage:()=>({rows:[{label:'input',value:3}]}),logs:()=>({entries:[]}),render:()=>renders++,confirmationAvailable:()=>false,settle:()=>({ok:false})});const d={messages:[]};const c=registry.create('chart',1,d);d.messages.push(c);assert.equal(registry.execute({id:1,action:'refresh-chart',args:{}},{workspace:d}).ok,true);assert.equal(c.values.rows[0].value,3);assert.equal(renders,1);return {types:registry.kinds,registeredAction:true};
});
