import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD_TYPES,captureCard,persistCard} from '../src/card-types.js';
import {historicalModelMarkup,createSettingsViews} from '../src/settings-markup.js';
import {snapshotWorkspace,restoreWorkspace} from '../src/persistence.js';
import {makePage,makeData} from '../development/hosts/conversation-fixture.mjs';

test('model capture preserves protocol context across persistence without copying endpoint credentials',()=>{
  const data=makeData(),d=data.chat;d.model.output='1024';d.model.temperature='0';d.api.key='synthetic-secret';
  const card={id:1,type:'card',kind:'model',version:1,values:CARD_TYPES.model.capture(CARD_TYPES.model.initial(d))};
  d.messages=[card];card.values=captureCard(card,d);d.messages.push({id:2,type:'status',text:'freeze'});
  const before=historicalModelMarkup(card,'chat');d.api.protocol='anthropic';d.model.output='9999';
  const saved=snapshotWorkspace({data,page:'chat',nextId:3,views:{}});
  const restored=restoreWorkspace(saved,makePage).data.chat.messages[0];
  assert.equal(restored.values.displayContext.protocol,'gemini');assert.equal(restored.values.displayContext.gemini.evidence,'protocol-schema-only');
  assert.equal(historicalModelMarkup(restored,'chat'),before);
  assert.doesNotMatch(JSON.stringify(restored),/synthetic-secret|example.com/);
  assert.match(before,/>1024</);assert.match(before,/<dt>温度<\/dt><dd>0<\/dd>/);
});

test('legacy protocol absence remains unknown through load/save and never uses current protocol',()=>{
  const legacy={id:1,type:'card',kind:'model',version:1,values:{output:'2048',inputs:['text'],reasoningFamily:null}};
  assert.equal(persistCard(legacy).values.displayContext,undefined);
  const d=makePage();d.api.protocol='anthropic';
  const view=createSettingsViews({get:()=>d,currentPage:()=> 'chat',activeCardId:()=>2,menuState:()=>'',reasoningAnchor:()=>null});
  const html=view.model(legacy);
  assert.match(html,/历史协议未记录/);assert.doesNotMatch(html,/max_tokens/);
  assert.doesNotMatch(html,/<details|<input|<button|data-action=/);
  assert.match(html,/>2048</);
});

test('static history escapes values and retains zero and selected modalities as readable text',()=>{
  const html=historicalModelMarkup({values:{output:'<script>',temperature:0,topP:'0',inputs:['text','<img>'],displayContext:{protocol:'ark'}}},'chat');
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<script|<img/);
  assert.match(html,/max_completion_tokens/);assert.match(html,/<dt>Top P<\/dt><dd>0<\/dd>/);
});

test('Gemini preferences and frozen capability context round-trip but current model response metadata does not',()=>{
 const data=makeData(),d=data.chat;d.api.modelMetadata={thinking:false,endpoint:'https://private-context.example',observedAt:'fixture'};
 Object.assign(d.model,{geminiIncludeThoughts:'false',geminiSeed:'0',geminiStopSequences:'END\n STOP ',geminiThinkingMode:'gemini-budget'});
 const card={id:1,type:'card',kind:'model',version:1,values:CARD_TYPES.model.capture(CARD_TYPES.model.initial(d))};d.messages=[card,{id:2,type:'status',text:'freeze'}];
 const saved=snapshotWorkspace({data,page:'chat',nextId:3,views:{}}),restored=restoreWorkspace(saved,makePage).data.chat;
 for(const key of ['geminiIncludeThoughts','geminiSeed','geminiStopSequences','geminiThinkingMode']){assert.equal(restored.model[key],d.model[key]);assert.equal(restored.messages[0].values[key],d.model[key]);}
 assert.equal(restored.api.modelMetadata,undefined);assert.doesNotMatch(JSON.stringify(saved),/private-context/);
});

test('image history freezes effective controls and preferences across model changes and persistence',()=>{
 const data=makeData(),d=data.image;
 d.api.model='gemini-nano-banana-2.1';d.aspectRatio='1:8';d.imageSize='4K';
 Object.assign(d.model,{imageResponseMode:'image',imageThinkingLevel:'medium',imagePreferredRatio:'1:8',imagePreferredSize:'4K'});
 const card={id:1,type:'card',kind:'model',version:1,values:{}};card.values=captureCard(card,d);d.messages=[card,{id:2,type:'status',text:'freeze'}];
 const before=historicalModelMarkup(card,'image');d.api.model='gemini-2.5-flash-image';d.aspectRatio='1:1';d.imageSize='1K';
 const restored=restoreWorkspace(snapshotWorkspace({data,page:'image',nextId:3,views:{}}),makePage).data.image;
 assert.equal(historicalModelMarkup(restored.messages[0],'image'),before);
 assert.match(before,/>1:8</);assert.match(before,/>4K</);assert.match(before,/>medium</);assert.match(before,/仅图片/);
 assert.doesNotMatch(before,/<select|<details|<input/);
 assert.equal(restored.model.imageThinkingLevel,'medium');assert.equal(restored.model.imagePreferredSize,'4K');
});
