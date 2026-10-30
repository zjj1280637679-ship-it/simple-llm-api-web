import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {createSettingsViews} from '../../src/settings-markup.js';
import {makePage} from './conversation-fixture.mjs';
await report('settings-markup',async()=>{const d=makePage();d.api.model='<unsafe>';const views=createSettingsViews({get:()=>d,currentPage:()=> 'chat',activeCardId:()=>1,menuState:()=>'',reasoningAnchor:()=>null,providers:[],providerIdentity:()=>({name:'test'}),protocolLabel:x=>x,apiTrustText:()=>''});const card={id:1,values:{}};assert.ok(!views.api(card).includes('<unsafe>'));assert.ok(!views.api(card).includes('data-key="url"'));assert.match(views.connection(card),/data-key="url"/);assert.match(views.model(card),/data-setting-section="sampling"/);return {escapedFields:true,shallowConnection:true,deepParameters:true};});
