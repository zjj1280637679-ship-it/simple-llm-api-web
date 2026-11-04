/** Gemini 深层设置的纯视图；不读取密钥或执行网络。 */
import {esc} from './view-markup.js';
import {geminiProfile} from './gemini-capabilities.js';
export function geminiSettingsMarkup(card,config,settings={}) {
 const p=geminiProfile(config);if(!p)return '';
 // Model.thinking proves a capability, not the accepted level/budget schema.
 const manualFormat=p.thinking!=='unsupported'&&!p.thinkingTemplate;
 const field=(label,key,body)=>`<div class="formfield"><label for="${key}${card.id}">${label}</label>${body}</div>`;
 const attrs=key=>`id="${key}${card.id}" data-card="${card.id}" data-key="${key}"`;
 const select=(label,key,choices)=>field(label,key,`<select class="native-select" ${attrs(key)}>${[['','API 默认'],...choices].map(([value,text])=>`<option value="${esc(value)}" ${String(settings[key]??'')===value?'selected':''}>${esc(text)}</option>`).join('')}</select>`);
 const numeric=(label,key)=>field(label,key,`<input class="block-input" type="number" ${attrs(key)} value="${esc(settings[key]??'')}" placeholder="API 默认" step="1">`);
 return `<details data-setting-section="gemini"><summary>Gemini 参数</summary>
${p.thinking!=='unsupported'?select('公开思考摘要','geminiIncludeThoughts',[['true','请求摘要'],['false','不请求摘要']]):''}
${select('输入媒体精度','geminiMediaResolution',[['MEDIA_RESOLUTION_LOW','低'],['MEDIA_RESOLUTION_MEDIUM','中'],['MEDIA_RESOLUTION_HIGH','高']])}
${numeric('随机种子','geminiSeed')}
${p.topK!=='unsupported'?numeric('Top K','geminiTopK'):''}
${field('停止序列（每行一个，最多 5 个）','geminiStopSequences',`<textarea class="block-input gemini-stop-sequences" rows="2" ${attrs('geminiStopSequences')}>${esc(settings.geminiStopSequences??'')}</textarea>`)}
${manualFormat?`<details data-setting-section="gemini-unknown"><summary>未核验模型的思考格式</summary>${select('思考参数格式','geminiThinkingMode',[['gemini-level','等级参数'],['gemini-budget','预算参数']])}<p class="model-note">当前模型未匹配具体格式记录。手选格式后仍由服务端判断支持性。</p></details>`:''}
<p class="model-note">${p.thinking==='unknown'?'当前模型能力未核验。':''}留空沿用 API 默认。摘要仅在上游提供时显示；媒体精度影响输入处理，随机种子不保证完全复现。</p>
</details>`;
}
export function geminiSnapshotRows(values={}) {
 const labels={geminiIncludeThoughts:'公开思考摘要',geminiMediaResolution:'输入媒体精度',geminiTopK:'Top K',geminiSeed:'随机种子',geminiStopSequences:'停止序列',geminiThinkingMode:'手选思考格式'};
 const choices={geminiIncludeThoughts:{true:'请求摘要',false:'不请求摘要'},geminiMediaResolution:{MEDIA_RESOLUTION_LOW:'低',MEDIA_RESOLUTION_MEDIUM:'中',MEDIA_RESOLUTION_HIGH:'高'},geminiThinkingMode:{'gemini-level':'等级参数','gemini-budget':'预算参数'}};
 return Object.entries(labels).filter(([key])=>values[key]!==undefined&&values[key]!=='').map(([key,label])=>[label,Object.hasOwn(choices[key]||{},String(values[key]))?choices[key][String(values[key])]:String(values[key])]);
}
