// Verified provider contracts, not a model quality ranking. No selection => no fields.
const levels=['low','medium','high'];
const templates=[
 {id:'gemini-level',label:'Gemini 思考等级',protocol:'gemini',choices:['minimal',...levels]},
 {id:'gemini-budget',label:'Gemini 2.5 思考预算',protocol:'gemini',min:0,max:32768,specialValues:[-1],kind:'number'},
 {id:'openai-effort',label:'OpenAI Chat 思考强度',protocol:'openai',choices:['none','minimal',...levels,'xhigh','max']},
 {id:'ark-effort',label:'方舟 Chat 思考强度',protocol:'ark',choices:['none','minimal',...levels,'xhigh','max']},
 {id:'anthropic-effort',label:'Anthropic 自适应思考',protocol:'anthropic',choices:[...levels,'xhigh','max']},
 {id:'anthropic-budget',label:'Anthropic 手动思考预算',protocol:'anthropic',kind:'number',min:1024,max:1000000}
];
const hosts={'generativelanguage.googleapis.com':'gemini','api.openai.com':'openai','ark.cn-beijing.volces.com':'ark','api.anthropic.com':'anthropic'};
const copy=t=>({...t,...(t.choices?{choices:[...t.choices]}:{}),...(t.specialValues?{specialValues:[...t.specialValues]}:{})});
function identity(config) {
 try {const u=new URL(config.url);return u.protocol==='https:' ? hosts[u.hostname] || null : null;} catch {return null;}
}
const named=(id,overrides={})=>({...copy(templates.find(t=>t.id===id)),...overrides});
function official(config) {
 const p=identity(config),m=String(config.model||'').replace(/^models\//,'').trim();
 if(p!==config.protocol || /latest/i.test(m)) return [];
 if(p==='gemini') {
  if(['gemini-3.8-flash','gemini-4-argon'].includes(m)) return [named('gemini-level',{choices:levels})];
  if(['gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3-flash-preview'].includes(m)) return [named('gemini-level')];
  if(m==='gemini-2.5-pro') return [named('gemini-budget',{min:128,max:32768,specialValues:[-1]})];
  if(m==='gemini-2.5-flash') return [named('gemini-budget',{min:0,max:24576,specialValues:[-1]})];
  if(m==='gemini-2.5-flash-lite') return [named('gemini-budget',{min:512,max:24576,specialValues:[-1,0]})];
 }
 if(p==='openai') {
  // A conservative, documented common subset; expanding choices needs model evidence.
  if(/^(gpt-5|gpt-5\.1|gpt-5\.2|gpt-5\.5|gpt-6-astra|gpt-6\.1-sol)$/.test(m))
   return [named('openai-effort',{choices:levels})];
 }
 if(p==='ark') {
  if(['doubao-seed-2-1-pro-260915','doubao-seed-2-1-lite-260915','doubao-seed-2-1-pro-260628','doubao-seed-2-1-turbo-260628','doubao-seed-2-0-lite-260428','doubao-seed-2-0-mini-260428','doubao-seed-2-0-pro-260215','doubao-seed-2-0-lite-260215','doubao-seed-2-0-mini-260215','doubao-seed-2-0-code-preview-260215'].includes(m))
   return [named('ark-effort',{choices:['minimal',...levels]})];
 }
 if(p==='anthropic') {
  if(['claude-opus-4-6','claude-sonnet-4-6','claude-opus-4-7','claude-opus-4-8','claude-opus-5','claude-sonnet-5','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'].includes(m))
   return [named('anthropic-effort',{choices:levels})];
  if(['claude-sonnet-4-5','claude-sonnet-4-5-20250929','claude-opus-4-5','claude-opus-4-5-20251101','claude-haiku-4-5','claude-haiku-4-5-20251001'].includes(m))
   return [named('anthropic-budget')];
 }
 return [];
}
/** Unknown/rolling models expose manual templates, never an inferred recommendation. */
export function getReasoningTemplates(config={}) {
 const verified=identity(config) ? official(config) : [];
 const result=verified.length ? verified.map(copy) : templates.filter(t=>t.protocol===config.protocol).map(copy);
 return result.map(t=>({...t,verifiedModel:verified.length>0,...(t.choices ? {values:t.choices.map(value=>({value,label:value}))} : {}),
  note:!verified.length ? '手选模板：当前模型能力未核验，选择后才发送；服务端可能拒绝不支持的参数。' : t.kind==='number' ? '仅在应用后发送预算；-1（如支持）为动态，0（如支持）为关闭。' : '仅发送选中的请求档位；不是服务端实际思考程度证明。'}));
}
export function getRecommendedReasoningTemplate(config={}) {
 return identity(config) ? official(config)[0]?.id || null : null;
}
export function isOfficialReasoningEndpoint(config={}) {return Boolean(identity(config));}
function fail(message) {const e=new Error(message);e.code='REASONING_SETTINGS';throw e;}
/** Returns ONLY selected request controls. Caller merges generationConfig separately. */
export function reasoningBody(config={},selection,settings={}) {
 if(selection==null || selection==='' || selection.template==='' || selection.template==='default') return {};
 if(typeof selection!=='object' || Array.isArray(selection)) fail('思考设置格式无效。');
 const t=getReasoningTemplates(config).find(t=>t.id===selection.template);
 if(!t) fail('此地址、接口格式或模型尚未匹配该思考模板；请选择默认不发送或受支持模板。');
 if(selection.value===undefined || selection.value===null || selection.value==='') return {};
 let v=selection.value;
 if(t.kind==='number') {
  if(typeof v!=='number' && !(typeof v==='string' && /^-?\d+$/.test(v))) fail('思考预算必须为整数。');
  v=Number(v);
  if(!Number.isSafeInteger(v) || (!t.specialValues?.includes(v) && (v<t.min||v>t.max))) fail('思考预算超出此模板范围。');
 } else if(!t.choices.includes(v)) fail('此模型不支持所选思考档位。');
 if(t.id==='gemini-level') return {generationConfig:{thinkingConfig:{thinkingLevel:v}}};
 if(t.id==='gemini-budget') return {generationConfig:{thinkingConfig:{thinkingBudget:v}}};
 if(t.id==='openai-effort'||t.id==='ark-effort') return {reasoning_effort:v};
 if(t.id.startsWith('anthropic-')) {
  if(settings.temperature!==undefined && settings.temperature!=='' && Number(settings.temperature)!==1) fail('启用此 Anthropic 思考模板时请将温度留空或设为 1。');
  if(settings.topP!==undefined && settings.topP!=='') fail('启用此 Anthropic 思考模板时请先将 Top P 留空。');
  if(t.id==='anthropic-effort') return {thinking:{type:'adaptive'},output_config:{effort:v}};
  const output=Number(settings.maxOutputTokens??settings.output??4096)||4096;
  if(v>=output) fail('Anthropic 思考预算必须小于最大输出 Token；请先提高输出上限。');
  return {thinking:{type:'enabled',budget_tokens:v}};
 }
 fail('未实现该思考模板。');
}
