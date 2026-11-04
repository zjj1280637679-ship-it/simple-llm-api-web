import assert from 'node:assert/strict';
import {CARD_TYPES,captureCard} from '../../src/card-types.js';
import {createSettingsViews} from '../../src/settings-markup.js';
import {imageOptionsMarkup,changeImageOption} from '../../src/image-options-markup.js';
import {GEMINI_CAPABILITY,getImageCapabilities,ARK_FLASH_MODEL,ARK_PRO_MODEL} from '../../src/image-capabilities.js';

/** Bounded representatives, not a complete DOM/IME/string or provider model. */
export function checkInteractionEffectsModel() {
 let frozenComparisons=0,imageTransitions=0;
 const protocols=['gemini','openai','ark','anthropic'];
 for(const captured of [...protocols,null])for(const output of ['',0,'2048','<unsafe>']){
   const d={api:{protocol:captured||'gemini',url:'https://example.com',model:'fixture'},model:{output,inputs:['text']}};
   const card={id:1,kind:'model',version:1,values:{}};card.values=captureCard(card,d);
   if(captured===null)delete card.values.displayContext;
   const frozen=JSON.stringify(card.values);
   const view=createSettingsViews({get:()=>d,currentPage:()=> 'chat',activeCardId:()=>2,menuState:()=>'',reasoningAnchor:()=>null});
   const expected=view.model(card);
   assert.doesNotMatch(expected,/<details|data-action=|<input|<button/);
   for(const current of protocols){d.api.protocol=current;d.model.output='new';assert.equal(view.model(card),expected);assert.equal(JSON.stringify(card.values),frozen);frozenComparisons++;}
 }
 const caps=[...['gemini-nano-banana-2.1','gemini-3.1-flash-image','gemini-3.1-flash-lite-image','gemini-3-pro-image','gemini-2.5-flash-image'].map(model=>getImageCapabilities({protocol:'gemini',model})),...[ARK_FLASH_MODEL,ARK_PRO_MODEL].map(model=>getImageCapabilities({protocol:'ark',model}))];
 for(const cap of caps)for(const a of cap.ratios)for(const z of cap.sizes){
   const current={aspectRatio:a.ratio,imageSize:z},html=imageOptionsMarkup(cap,current);
   assert.equal((html.split('<details')[0].match(/data-axis="ratio"/g)||[]).length,3);
   for(const b of cap.ratios)for(const w of cap.sizes){
     const next=changeImageOption(cap,changeImageOption(cap,current,'ratio',b.ratio),'size',w);
     assert.deepEqual(next,{aspectRatio:b.ratio,imageSize:w});imageTransitions++;
   }
 }
 return {frozenComparisons,imageTransitions,scope:'Fixed rendering version; 5 context classes × 4 representative outputs × 4 later protocols; all pairs of currently registered image presets. No DOM/IME or provider proof.'};
}
