import assert from 'node:assert/strict';import {report} from './report.mjs';
import {geminiSettingsMarkup,geminiSnapshotRows} from '../../src/gemini-settings-markup.js';
await report('gemini-settings-markup',async()=>{
 const c={protocol:'gemini',url:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-3.8-flash'};
 const html=geminiSettingsMarkup({id:1},c,{geminiStopSequences:'<script>'});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|data-key="geminiTopK"/);
 assert.equal(geminiSettingsMarkup({id:1},{protocol:'openai'}),'');assert.match(geminiSettingsMarkup({id:1},{...c,model:'future'}),/未核验模型/);
 assert.deepEqual(geminiSnapshotRows({geminiSeed:0}),[['随机种子','0']]);
 const unknown={...c,model:'future',modelMetadata:{endpoint:c.url,model:'future',thinking:true}};
 assert.match(geminiSettingsMarkup({id:1},unknown),/geminiThinkingMode/);
 unknown.modelMetadata.thinking=false;
 assert.doesNotMatch(geminiSettingsMarkup({id:1},unknown),/geminiThinkingMode|geminiIncludeThoughts/);
 assert.deepEqual(geminiSnapshotRows({geminiIncludeThoughts:false,geminiMediaResolution:'MEDIA_RESOLUTION_HIGH'}),[['公开思考摘要','不请求摘要'],['输入媒体精度','高']]);
 return {escaped:true,protocolScoped:true,negativeCapabilityShrinks:true,unknownHasDeepRoute:true};
});
