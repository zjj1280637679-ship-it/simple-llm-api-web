import assert from 'node:assert/strict';
import {report} from './report.mjs';
import {getImageCapabilities,imageGenerationConfig,imageSelection,normalizeImageOptions} from '../../src/image-capabilities.js';
await report('image-capabilities',async()=>{
 const wide={protocol:'gemini',model:'gemini-nano-banana-2.1'},narrow={protocol:'gemini',model:'gemini-2.5-flash-image'};
 const prefs={imagePreferredRatio:'1:8',imagePreferredSize:'4K',imageThinkingLevel:'medium',imageResponseMode:'image'};
 assert.deepEqual(imageSelection(narrow,{},prefs),{aspectRatio:'1:1',imageSize:'1K'});
 assert.deepEqual(imageSelection(wide,{},prefs),{aspectRatio:'1:8',imageSize:'4K'});
 const body=imageGenerationConfig(narrow,normalizeImageOptions(narrow),prefs);
 assert.equal(body.thinkingConfig,undefined);assert.equal(body.imageConfig.imageSize,undefined);assert.deepEqual(body.responseModalities,['IMAGE']);
 assert.equal(getImageCapabilities({...wide,model:'gemini-future-image'}),null);
 return {contractedControls:true,dormantPreferencesPreserved:true,hiddenFieldsOmitted:true,unknownModelNotGuessed:true,noNetwork:true};
});
