// Verified provider contracts, not a model quality ranking. No selection => no fields.
const levels=['low','medium','high'];
const templates=[
 {id:'deepseek-effort',label:'DeepSeek 思考强度',provider:'deepseek',protocol:'openai',choices:['none','low','high','max']},
 {id:'deepseek-thinking',label:'DeepSeek 思考开关',provider:'deepseek',protocol:'openai',choices:['enabled','disabled']},
 {id:'zhipu-effort',label:'智谱 思考强度',provider:'zhipu',protocol:'openai',choices:['none','minimal',...levels,'xhigh','max']},
 {id:'zhipu-thinking',label:'智谱 思考开关',provider:'zhipu',protocol:'openai',choices:['enabled','disabled']},
 {id:'gemini-level',label:'Gemini 思考等级',protocol:'gemini',choices:['minimal',...levels]},
 {id:'gemini-budget',label:'Gemini 2.5 思考预算',protocol:'gemini',min:0,max:32768,specialValues:[-1],kind:'number'},
 {id:'openai-effort',label:'OpenAI Chat 思考强度',protocol:'openai',choices:['none','minimal',...levels,'xhigh','max']},
 {id:'ark-effort',label:'方舟 Chat 思考强度',protocol:'ark',choices:['none','minimal',...levels,'xhigh','max']},
 {id:'anthropic-effort',label:'Anthropic 自适应思考',protocol:'anthropic',choices:[...levels,'xhigh','max']},
 {id:'anthropic-budget',label:'Anthropic 手动思考预算',protocol:'anthropic',kind:'number',min:1024,max:1000000}
];
const hosts={'generativelanguage.googleapis.com':'gemini','api.openai.com':'openai','ark.cn-beijing.volces.com':'ark','api.anthropic.com':'anthropic','api.deepseek.com':'deepseek','open.bigmodel.cn':'zhipu'};
const copy=t=>({...t,...(t.choices?{choices:[...t.choices]}:{}),...(t.specialValues?{specialValues:[...t.specialValues]}:{})});
function identity(config) {
 try {const u=new URL(config.url);return u.protocol==='https:' ? hosts[u.hostname] || null : null;} catch {return null;}
}
function canonicalVendor(config,provider) {
 try {const u=new URL(config.url);if(u.port||u.username||u.password||u.search||u.hash)return false;
 const path=u.pathname.replace(/\/+$/,'');
 return provider==='deepseek' ? ['', '/v1','/chat/completions','/v1/chat/completions'].includes(path) : provider==='zhipu' ? ['/api/paas/v4','/api/paas/v4/chat/completions'].includes(path) : true;
 } catch {return false;}
}
export function isDeepSeekChatEndpoint(config={}) {return config.protocol==='openai' && identity(config)==='deepseek' && canonicalVendor(config,'deepseek');}
const named=(id,overrides={})=>({...copy(templates.find(t=>t.id===id)),...overrides});
function official(config) {
 const p=identity(config),m=String(config.model||'').replace(/^models\//,'').trim();
 if((['deepseek','zhipu'].includes(p)?'openai':p)!==config.protocol || /latest/i.test(m) || !canonicalVendor(config,p)) return [];
 if(p==='deepseek') {
  if(['deepseek-flash','deepseek-v4-pro'].includes(m)) return [named('deepseek-effort'),named('deepseek-thinking')];
  return [];
 }
 if(p==='zhipu') {
  if(['glm-5.3','glm-5.3-flash','glm-5.3-flashx'].includes(m)) return [named('zhipu-effort',{choices:['low','high','max']}),named('zhipu-thinking',{choices:['enabled']})];
  if(m==='glm-5.2') return [named('zhipu-effort'),named('zhipu-thinking')];
  if(['glm-5.1','glm-5','glm-5-turbo','glm-5v-turbo','glm-4.7','glm-4.6','glm-4.5'].includes(m)) return [named('zhipu-thinking')];
  return [];
 }
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
 const provider=identity(config);
 const manual=templates.filter(t=>t.protocol===config.protocol && (!provider || (t.provider||t.protocol)===provider));
 // An unrecognised gateway may explicitly select a vendor template. A known vendor never inherits another vendor's recommendation.
 const result=verified.length ? verified.map(copy) : manual.map(copy);
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
 if(t.id==='deepseek-thinking'||t.id==='zhipu-thinking') return {thinking:{type:v}};
 if(t.id==='openai-effort'||t.id==='ark-effort'||t.id==='deepseek-effort'||t.id==='zhipu-effort') return {reasoning_effort:v};
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

export const REASONING_FAMILIES=Object.freeze([
 {id:'anthropic',label:'Claude 模板',protocol:'anthropic'},
 {id:'deepseek',label:'DeepSeek 模板',protocol:'openai'},
 {id:'openai',label:'OpenAI 模板',protocol:'openai'},
 {id:'gemini',label:'Gemini 模板',protocol:'gemini'},
 {id:'ark',label:'火山方舟模板',protocol:'ark'},
 {id:'zhipu',label:'智谱模板',protocol:'openai'}
].map(Object.freeze));
export function reasoningFamilyFor(config={},templateId) {
 const explicit=templates.find(t=>t.id===templateId);
 if(explicit)return explicit.provider||explicit.protocol;
 return identity(config);
}
export function resolveReasoningFamily(config={},familyId) {
 const family=REASONING_FAMILIES.find(f=>f.id===familyId);
 if(!family || family.protocol!==config.protocol)fail('该模板与当前接口格式不匹配，请先在 API 设置选择对应格式；没有自动修改接口。');
 const candidates=getReasoningTemplates(config).filter(t=>(t.provider||t.protocol)===familyId);
 if(!candidates.length)fail('该模板与当前供应商地址或模型不匹配；没有修改现有设置。');
 const recommended=getRecommendedReasoningTemplate(config);
 const referenceUrls={anthropic:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta',openai:'https://api.openai.com/v1',deepseek:'https://api.deepseek.com',zhipu:'https://open.bigmodel.cn/api/paas/v4',ark:'https://ark.cn-beijing.volces.com/api/v3'};
 const modelSchema=official({...config,url:referenceUrls[familyId]})[0];
 const known=candidates.find(t=>t.id===recommended)||candidates.find(t=>t.verifiedModel)||candidates.find(t=>t.id===modelSchema?.id);
 // Explicit family selection chooses a stable request schema, not a claim of upstream model support.
 const canonical={anthropic:'anthropic-effort',gemini:'gemini-level',openai:'openai-effort',deepseek:'deepseek-effort',zhipu:'zhipu-effort',ark:'ark-effort'};
 const selected=known || candidates.find(t=>t.id===canonical[familyId]) || candidates[0];
 return {family,template:selected||null};
}
