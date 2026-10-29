/** Local endpoint profiles. A match selects a rule set; it proves no remote capability. */
const profiles = Object.freeze([
  {provider:'gemini', protocol:'gemini', host:'generativelanguage.googleapis.com', paths:['/v1beta']},
  {provider:'openai', protocol:'openai', host:'api.openai.com', paths:['/v1']},
  {provider:'ark', protocol:'ark', host:'ark.cn-beijing.volces.com', paths:['/api/v3']},
  {provider:'anthropic', protocol:'anthropic', host:'api.anthropic.com', paths:['/v1']},
  {provider:'deepseek', protocol:'openai', host:'api.deepseek.com', paths:['', '/v1', '/chat/completions', '/v1/chat/completions']},
  {provider:'zhipu', protocol:'openai', host:'open.bigmodel.cn', paths:['/api/paas/v4', '/api/paas/v4/chat/completions']}
]);

export function identifyProvider(config = {}) {
  const unknown = {provider:null, profileMatched:false};
  if (typeof config.url !== 'string' || /[\s\\]/.test(config.url)) return unknown;
  let url;
  try { url = new URL(config.url); } catch { return unknown; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return unknown;
  const profile = profiles.find(item => item.host === url.hostname && item.protocol === config.protocol);
  if (!profile) return unknown;
  return {
    provider:profile.provider,
    profileMatched:profile.paths.includes(url.pathname.replace(/\/+$/, ''))
  };
}
