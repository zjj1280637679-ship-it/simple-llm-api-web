/** 开发态课题：当前公共网页允许哪个规范化目标及凭据绑定？
 * 状态/边界：无持久状态；URL解析器为信任基，任意URL输入未完整形式化。
 * 扩展：另一个本机/私有宿主单独定义网络策略；无需把当前范围升为永久禁令。
 * 契约：docs/contracts/api-target.json；局部宿主不替代完整 F/C/H/Q。
 */
import {AppError} from './app-error.js';
const fail=(code,message)=>{throw new AppError(code,message);};

/** Current public-web target policy D-01. URL parsing, target consent and
 * credential checks have distinct failure codes. No DNS/ownership/account proof.
 * A local-model host may supply a different policy through a separate adapter;
 * this module intentionally describes the current host, not all possible routes. */
/** URL approval is bound to the full canonical base URL, never just a provider label. */
export function canonicalEndpoint(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || !value.trim() || /[\s\\]/.test(value.trim()))
    fail('ENDPOINT', '请填写不含空白字符的 HTTPS API 基础地址。');
  let url;
  try { url = new URL(value.trim()); } catch { fail('ENDPOINT', 'API 基础地址格式不正确。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    fail('ENDPOINT', 'API 地址必须使用 HTTPS，且不能含用户名、密码、查询参数或片段。');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Current public-web transport profile excludes IP/local names. A local-model
  // host needs its own network/credential policy; this is not a product-wide ban.
  // No DNS resolution or ownership verification is performed here.
  if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/.test(host))
    fail('ENDPOINT', '仅支持公开域名的 HTTPS 地址；不支持 IP、内网或本机地址。');
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function validateEndpoint(config) {
  if (!config || !['gemini','openai','ark','anthropic'].includes(config.protocol))
    fail('PROTOCOL', '当前支持 Gemini、OpenAI、Anthropic Messages 和火山方舟格式。');
  const base = canonicalEndpoint(config.url);
  let approved;
  try { approved = canonicalEndpoint(config.trustedTarget); } catch {
    fail('UNTRUSTED_ENDPOINT', '请先确认此 API 地址；密钥尚未发送。');
  }
  if (base !== approved) fail('UNTRUSTED_ENDPOINT', 'API 地址已改变，请重新确认后再发送密钥。');
  if (typeof config.key !== 'string' || !config.key.trim() || /[\r\n]/.test(config.key))
    fail('KEY', '请填写有效的 API Key。');
  let decoded = base;
  try { decoded = decodeURIComponent(base); } catch { /* URL parser already checked structure. */ }
  if (config.protocol === 'ark' && /\/api\/plan\/v3(?:\/|$|[?#])/i.test(decoded))
    fail('ARK_PLAN_ENDPOINT', '当前接入的是火山方舟普通 API，不支持 Coding Plan 地址；请使用普通 API 基础地址与对应密钥。');
  if (base.includes(config.key.trim()) || decoded.includes(config.key.trim()))
    fail('ENDPOINT', 'API 地址中不能包含密钥；请将密钥只填写在 API Key 字段。');
  return base;
}
