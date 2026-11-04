import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createSettingsViews,historicalModelMarkup} from '../../src/settings-markup.js';
import {makePage} from './conversation-fixture.mjs';
await report('settings-markup',async()=>{const d=makePage();d.api.model='<unsafe>';const views=createSettingsViews({get:()=>d,currentPage:()=> 'chat',activeCardId:()=>1,menuState:()=>'',reasoningAnchor:()=>null,providers:[],providerIdentity:()=>({name:'test'}),protocolLabel:x=>x,apiTrustText:()=>''});const card={id:1,values:{}};assert.ok(!views.api(card).includes('<unsafe>'));assert.ok(!views.api(card).includes('data-key="url"'));assert.match(views.connection(card),/data-key="url"/);assert.match(views.model(card),/data-setting-section="sampling"/);
 const old={id:2,values:{output:'1024',temperature:0,inputs:['text'],displayContext:{protocol:'gemini'}}};const before=views.model(old);d.api.protocol='anthropic';assert.equal(views.model(old),before);assert.doesNotMatch(before,/<details|<input|<button/);assert.match(before,/>1024</);assert.match(historicalModelMarkup({values:{}},'chat'),/历史协议未记录/);
 return {escapedFields:true,shallowConnection:true,deepParameters:true,historicalContextIndependent:true,staticHistoryReadable:true};});
