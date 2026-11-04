import assert from 'node:assert/strict';
import {getImageCapabilities,imageGenerationConfig,imageEffectiveSettings,imageSelection,normalizeImageOptions} from '../../src/image-capabilities.js';
import {imageSettingsMarkup,changeImageOption} from '../../src/image-options-markup.js';
/** Complete enumeration of the registered finite controls; not all DOM or provider states. */
export function checkImageAdaptationModel(){
 let requestCases=0,preferenceTransitions=0;
 const models=['gemini-nano-banana-2.1','gemini-3.1-flash-image','gemini-3.1-flash-lite-image','gemini-3-pro-image','gemini-2.5-flash-image'];
 for(const model of models){
  const config={protocol:'gemini',model},cap=getImageCapabilities(config);
  for(const ratio of cap.ratios)for(const size of cap.sizes)for(const level of ['','minimal','medium','high'])for(const mode of ['','image']){
   const options=normalizeImageOptions(config,{aspectRatio:ratio.ratio,imageSize:size}),prefs={imageThinkingLevel:level,imageResponseMode:mode};
   const body=imageGenerationConfig(config,options,prefs),effective=imageEffectiveSettings(config,prefs);
   assert.equal(body.imageConfig.aspectRatio,ratio.ratio);assert.equal(body.imageConfig.imageSize,cap.sendImageSize?size:undefined);
   assert.equal(body.thinkingConfig?.thinkingLevel,cap.thinkingLevels.includes(level)?level.toUpperCase():undefined);
   assert.deepEqual(body.responseModalities,mode==='image'?['IMAGE']:['TEXT','IMAGE']);
   const html=imageSettingsMarkup({id:1},config,prefs,options);assert.equal(html.includes('data-key="imageThinkingLevel"'),cap.thinkingLevels.length>0);
   assert.equal(effective.thinkingLevel,cap.thinkingLevels.includes(level)?level:'');requestCases++;
  }
  for(const ratio of cap.ratios)for(const size of cap.sizes)for(const other of models){
   const prefs={imagePreferredRatio:ratio.ratio,imagePreferredSize:size};
   const narrow=imageSelection({protocol:'gemini',model:other},{},prefs),restored=imageSelection(config,narrow,prefs);
   assert.deepEqual(restored,{aspectRatio:ratio.ratio,imageSize:size});
   assert.deepEqual(changeImageOption(cap,restored,'ratio','1:1'),{aspectRatio:'1:1',imageSize:size});preferenceTransitions++;
  }
 }
 return {requestCases,preferenceTransitions,scope:'Five exact profiles; all registered ratios/sizes × four level preferences × two response modes; no account, network, DOM or complete F/C/H/Q proof.'};
}
