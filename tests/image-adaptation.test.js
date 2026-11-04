import test from 'node:test';
import assert from 'node:assert/strict';
import {getImageCapabilities,normalizeImageOptions,imageEffectiveSettings,imageGenerationConfig,imageSelection,getImageTool,ARK_FLASH_MODEL} from '../src/image-capabilities.js';
import {imageSettingsMarkup,imageSnapshotRows} from '../src/image-options-markup.js';
import {generateImage,dispatchCommand} from '../src/core.js';
const config=model=>({protocol:'gemini',model,url:'https://generativelanguage.googleapis.com/v1beta',key:'synthetic-image-key',trustedTarget:'https://generativelanguage.googleapis.com/v1beta'});
const models=['gemini-nano-banana-2.1','gemini-3.1-flash-image','gemini-3.1-flash-lite-image','gemini-3-pro-image','gemini-2.5-flash-image'];
const settings={imageResponseMode:'image',imageThinkingLevel:'medium',temperature:'0.7',geminiTopK:'3',reasoning:{template:'gemini-budget',value:1024}};
test('five exact Gemini image profiles contract ratios, resolution and thinking independently',()=>{
 const expected=[[14,['1K','2K','4K'],['minimal','medium','high']],[14,['512','1K','2K','4K'],['minimal','high']],[10,['1K'],['minimal','high']],[10,['1K','2K','4K'],[]],[10,['1K'],[]]];
 models.forEach((model,i)=>{const cap=getImageCapabilities(config(model));assert.deepEqual([cap.ratios.length,cap.sizes,cap.thinkingLevels],expected[i]);assert.deepEqual(getImageTool(config(model)).parameters.properties.imageSize.enum,cap.sizes);});
 assert.equal(getImageCapabilities(config('gemini-new-image')),null);
 assert.equal(getImageCapabilities(config('models/gemini-2.5-flash-image')).id,models[4]);
 assert.equal(normalizeImageOptions(config(models[1]),{imageSize:'512'}).pixels,null);
 assert.throws(()=>normalizeImageOptions(config(models[4]),{imageSize:'4K'}),/未收录/);
});
test('image projection omits incompatible fields and preserves dormant preference without mutating it',()=>{
 for(const model of models){
  const c=config(model),before=JSON.stringify(settings),projected=imageGenerationConfig(c,normalizeImageOptions(c),settings);
  assert.deepEqual(projected.responseModalities,['IMAGE']);
  assert.equal(projected.thinkingConfig?.thinkingLevel,model===models[0]?'MEDIUM':undefined);
  assert.equal(projected.imageConfig.imageSize,model===models[4]?undefined:'1K');
  for(const key of ['temperature','topK','thinkingBudget','responseMimeType','tools'])assert.equal(projected[key],undefined);
  assert.equal(JSON.stringify(settings),before);
 }
 assert.equal(imageEffectiveSettings(config(models[1]),settings).dormantThinking,true);
 assert.equal(imageGenerationConfig({protocol:'ark',model:ARK_FLASH_MODEL},{},settings),null);
});
test('ratios and sizes restore across narrower models; explicit choices replace only their own preference',()=>{
 const preferred={imagePreferredRatio:'1:8',imagePreferredSize:'4K'};
 const small=imageSelection(config(models[4]),{},preferred);assert.deepEqual(small,{aspectRatio:'1:1',imageSize:'1K'});
 assert.deepEqual(imageSelection(config(models[0]),small,preferred),{aspectRatio:'1:8',imageSize:'4K'});
 assert.deepEqual(imageSelection(config(models[0]),small,{...preferred,imagePreferredSize:'2K'}),{aspectRatio:'1:8',imageSize:'2K'});
});
test('image controls expose only active model levels; dormant settings are explained and legacy snapshots stay unknown',()=>{
 const nano=imageSettingsMarkup({id:1},config(models[0]),settings,{aspectRatio:'1:1',imageSize:'4K'});
 assert.match(nano,/value="medium" selected/);assert.doesNotMatch(nano,/data-key="temperature"/);
 const small=imageSettingsMarkup({id:2},config(models[4]),settings,{aspectRatio:'1:1',imageSize:'1K'});
 assert.doesNotMatch(small,/data-key="imageThinkingLevel"/);assert.match(small,/已保存思考偏好 medium/);
 assert.deepEqual(imageSnapshotRows({}).slice(0,3),[['模型','未记录'],['比例','未记录'],['分辨率','未记录']]);
});
test('real command route serializes image settings, preserves default behavior and omits size on 2.5',async()=>{
 for(const model of models) {
  let body;
  const fetchImpl=async(url,request)=>{body=JSON.parse(request.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'final'},{inlineData:{mimeType:'image/png',data:'iVBORw0KGgo='}}]},finishReason:'STOP'}]}),{status:200,headers:{'Content-Type':'application/json'}});};
  const result=await dispatchCommand({command:'image.generate',args:{prompt:'synthetic image'}},{imageConfig:config(model),imageSettings:settings,confirmed:true,fetchImpl});
  assert.deepEqual(body.generationConfig.responseModalities,['IMAGE']);
  assert.equal(body.generationConfig.thinkingConfig?.thinkingLevel,model===models[0]?'MEDIUM':undefined);
  assert.equal(body.generationConfig.imageConfig.imageSize,model===models[4]?undefined:'1K');
  assert.equal(result.imageSettings.responseMode,'image');
  await generateImage({config:config(model),prompt:'default',fetchImpl});
  assert.deepEqual(body.generationConfig.responseModalities,['TEXT','IMAGE']);assert.equal(body.generationConfig.thinkingConfig,undefined);
 }
});
