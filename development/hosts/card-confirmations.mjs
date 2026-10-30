import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createCardConfirmations} from '../../src/card-confirmations.js';
await report('card-confirmations',async()=>{
  const d={messages:[]};let id=0;const owner=createCardConfirmations({append:(d,values)=>{const c={id:++id,type:'card',values};d.messages.push(c);return c;},record:()=>{}});const waiting=owner.request(d,{text:'fixture'});assert.equal(owner.settle(d,1,true).ok,true);assert.equal(await waiting,true);assert.equal(owner.settle(d,1,true).ok,false);const pending=owner.request(d,{text:'dispose'});owner.dispose();assert.equal(await pending,false);return {exactlyOnce:true,disposeReleases:true};
});
