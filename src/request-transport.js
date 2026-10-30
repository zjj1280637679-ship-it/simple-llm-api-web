/** 开发态课题：实际传输边界观察到什么，哪些只是上游说明？
 * 状态/边界：请求计数与页面/进程观察者集合；每调用 reader/信号；完整响应大小未全域界定。
 * 扩展：替换 fetch/协议收集器保留声明、取消、脱敏与不自动重试的当前策略。
 * 契约：docs/contracts/request-transport.json；局部宿主不替代完整 F/C/H/Q。
 */
import {AppError} from './app-error.js';
import {validateEndpoint} from './api-target.js';
import {describeTransport} from './transport-evidence.js';
import {readErrorDiagnostic} from './error-diagnostic.js';
import {collectTextStream} from './stream.js';
import {recordNetwork,setLogSecrets,sanitizeLogValue} from './logs.js';
const fail=(code,message,status)=>{throw new AppError(code,message,status);};
const isRecord=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const cancelled=()=>new AppError('CANCELLED','请求已取消；已到达供应商的请求仍可能产生费用。');
function checkAbort(signal){if(signal?.aborted)throw cancelled();}

/** Transport boundary: only observed HTTP/framing, bounded diagnostics and logs.
 * It does not choose model parameters, infer task success or retry requests.
 * fetch injection is an effect seam; a source label is never a network proof.
 * Credential observers are page/process scoped; subscriptions own their release. */
// Memory-only observer for the exact credential used at the transport boundary.
// Does not persist or expose request payloads; consumers decide their local policy.
const credentialUseObservers=new Set();
export function subscribeCredentialUse(observer) { credentialUseObservers.add(observer);return ()=>credentialUseObservers.delete(observer); }
function announceCredentialUse(key) { for(const observer of credentialUseObservers)try{observer(key);}catch{} }

/** Error diagnostics select bounded JSON fields and redact registered credentials.
 * The upstream message remains an unverified report, not a root-cause diagnosis.
 */
let nextRequestId = 0;
export async function requestJSON(config, path, {body, logBody, signal, onDelta, onReasoningDelta, onPhase, fetchImpl = globalThis.fetch} = {}) {
  const base = validateEndpoint(config);
  if (config.attachmentContext && logBody === undefined) logBody = {model:config.model, note:'附件会话派生请求；正文不写入日志'};
  checkAbort(signal);
  if (typeof fetchImpl !== 'function') fail('FETCH', '运行环境不支持 fetch；请使用现代浏览器或 Node.js 20+。');
  const headers = {Accept:onDelta ? 'text/event-stream' : 'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (config.protocol === 'gemini') headers['x-goog-api-key'] = config.key.trim();
  else if (config.protocol === 'anthropic') { headers['x-api-key'] = config.key.trim(); headers['anthropic-version'] = '2023-06-01';
    // Official SDK browser opt-in, restricted to the exact official API base.
    if (base === 'https://api.anthropic.com/v1') headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  else headers.Authorization = `Bearer ${config.key.trim()}`;
  const started = Date.now();
  const event = {
    requestId:`request-${started}-${++nextRequestId}`, startedAt:new Date(started).toISOString(),
    method:body === undefined ? 'GET' : 'POST', endpoint:`${base}${path}`, provider:config.protocol,
    source:fetchImpl === globalThis.fetch ? 'network' : 'mock', transport:describeTransport(fetchImpl), requestPayload:logBody ?? body,
    requestHeaders:{Accept:headers.Accept,...(body === undefined ? {} : {'Content-Type':'application/json'}),[config.protocol === 'gemini' ? 'x-goog-api-key' : config.protocol === 'anthropic' ? 'x-api-key' : 'Authorization']:'[REDACTED]'},
  };
  // Diagnostic failures must never affect a request, and credentials never enter log headers.
  try { setLogSecrets([config.key]); } catch { /* Diagnostics are optional. */ }
  const record = details => { try { recordNetwork({...event,durationMs:Date.now() - started,...details}); } catch { /* Never break a request for logging. */ } };
  record({status:'pending'});
  let response;
  const responseHeaders = () => {
    const safe = {};
    for (const name of ['content-type','x-request-id','request-id','x-tt-logid']) {
      try { const value = response?.headers?.get?.(name); if (typeof value === 'string' && value) safe[name] = value; } catch { /* Stub or nonstandard header access cannot affect transport. */ }
    }
    return safe;
  };
  try {
    try {
      onPhase?.('waiting_headers');
      checkAbort(signal);
      announceCredentialUse(config.key.trim());
      response = await fetchImpl(`${base}${path}`, {
        method:event.method, headers,
        ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal,
        redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store', mode:'cors',
      });
    } catch {
      if (signal?.aborted) throw cancelled();
      fail('NETWORK', '连接失败：请检查网络、API 地址及供应商 CORS 设置。重定向不会自动跟随。');
    }
    checkAbort(signal);
    if (!response.ok) {
      const status = response.status;
      const details = {400:'可能与请求参数或模型配置有关。',401:'鉴权未通过，请核对凭据及目标。',403:'请求被拒绝，请核对访问条件。',404:'未找到请求资源，请核对路径及模型。',408:'服务返回请求超时。',429:'可能与请求频率、配额或容量有关。'};
      const diagnostic=await readErrorDiagnostic(response,{sanitize:value=>sanitizeLogValue(value),signal});
      checkAbort(signal);
      record({status,responsePayload:diagnostic,responseHeaders:responseHeaders()});
      const reported=typeof diagnostic?.fields?.message==='string' ? ` 上游说明（未独立核实）：${diagnostic.fields.message}` : '';
      fail('HTTP', `API 请求失败（HTTP ${Number.isInteger(status) ? status : '错误'}）：${details[status] || (status >= 500 ? '服务端返回错误。' : '请检查配置与服务状态。')} 具体原因尚未核实。${reported}`, status);
    }
    onPhase?.('headers_received');
    let json;
    try { json = onDelta ? await collectTextStream(response, {protocol:config.protocol,signal,onDelta,onReasoningDelta,onPhase,error:(code,message)=>new AppError(code,message)}) : await response.json(); } catch (error) {
      if (onDelta && error instanceof AppError) throw error;
      if (signal?.aborted) throw cancelled();
      fail('RESPONSE', 'API 返回了无法解析的 JSON。');
    }
    checkAbort(signal);
    if (!isRecord(json)) fail('RESPONSE', 'API 响应格式不正确。');
    const responsePayload = config.protocol === 'ark' && path === '/images/generations' && Array.isArray(json.data)
      ? {...json,data:json.data.map(item => isRecord(item) && Object.hasOwn(item,'url') ? {...item,url:'[OMITTED: image URL]'} : item)} : json;
    record({status:response.status,responsePayload:logBody ? {omitted:'attachment request response content',usage:responsePayload?.usage || responsePayload?.usageMetadata || null} : responsePayload,responseHeaders:responseHeaders()});
    return json;
  } catch (error) {
    record({status:error?.code === 'CANCELLED' ? 'cancelled' : response?.status || 'error',responseHeaders:responseHeaders(),error:{code:error?.code || 'REQUEST',message:error instanceof AppError ? error.message : '请求未完成。'}});
    throw error;
  }
}

