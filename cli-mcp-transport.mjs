// Optional real browser transport: MCP stdio -> user-configured Playwright MCP
// extension host -> native page WebMCP. Never starts a shell or HTTP listener.
import { readFile } from 'node:fs/promises';
import { validateSessionCommand, sessionCommandResult } from './src/session.js';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const safeErrors = new Set(['INVALID_MCP_CONFIG','MCP_SDK_REQUIRED','MCP_TARGET_MISMATCH','MCP_TOOL_UNAVAILABLE','MCP_COMMAND_FAILED','MCP_RESULT_INVALID']);
export function validateMcpConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !['command','args','targetUrl','tabIndex','timeoutMs'].includes(k))) fail('INVALID_MCP_CONFIG');
  if (typeof config.command !== 'string' || !config.command.trim() || config.command.includes('\0') || !Array.isArray(config.args) || !config.args.every(x => typeof x === 'string' && !x.includes('\0'))) fail('INVALID_MCP_CONFIG');
  if (!Number.isSafeInteger(config.tabIndex) || config.tabIndex < 0) fail('INVALID_MCP_CONFIG');
  let url; try { url = new URL(config.targetUrl); } catch { fail('INVALID_MCP_CONFIG'); }
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) fail('INVALID_MCP_CONFIG');
  const timeoutMs = config.timeoutMs ?? 300000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) fail('INVALID_MCP_CONFIG');
  return { command: config.command, args: [...config.args], targetUrl: url.href, origin: url.origin, tabIndex: config.tabIndex, timeoutMs };
}
export async function loadMcpSdk() {
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js')
    ]);
    return { Client, StdioClientTransport };
  } catch { fail('MCP_SDK_REQUIRED'); }
}
function textContent(result) {
  if (result?.isError) fail('MCP_COMMAND_FAILED');
  return (result?.content || []).filter(x => x.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n');
}
// Fail closed on host output format changes. Never print tab lists: extension
// connection-page URLs can contain sensitive tokens.
export function assertCurrentTarget(result, config) {
  const rows = textContent(result).split('\n');
  const matches = rows.map(line => line.match(/^- (\d+): \(current\) \[.*\]\((https?:\/\/[^\s]+)\)\s*$/)).filter(Boolean);
  if (matches.length !== 1) fail('MCP_TARGET_MISMATCH');
  const [, index, href] = matches[0];
  let url; try { url = new URL(href); } catch { fail('MCP_TARGET_MISMATCH'); }
  url.hash = '';
  if (Number(index) !== config.tabIndex || url.origin !== config.origin || url.href !== config.targetUrl) fail('MCP_TARGET_MISMATCH');
}
export function normalizeMcpResult(result) {
  if (result?.isError) fail('MCP_COMMAND_FAILED');
  let payload = result?.structuredContent;
  if (!payload || typeof payload.ok !== 'boolean') {
    // Playwright's WebMCP tool formatter can wrap JSON in a Result section.
    const text = textContent(result).trim();
    const candidates = [text, text.match(/(?:^|\n)### Result\n([\s\S]*?)(?=\n### |$)/)?.[1]?.trim()];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try { const parsed = JSON.parse(candidate.replace(/^```(?:json)?\n([\s\S]*)\n```$/, '$1')); if (typeof parsed?.ok === 'boolean') { payload = parsed; break; } } catch { /* fail closed below */ }
    }
  }
  if (!payload || typeof payload.ok !== 'boolean') fail('MCP_RESULT_INVALID');
  if (payload.ok) return { ok: true, result: payload.result ?? null };
  const failure = { ok: false, error: typeof payload.error === 'string' && /^[A-Z_]{1,80}$/.test(payload.error) ? payload.error : 'MCP_COMMAND_FAILED' };
  const diagnostic = sessionCommandResult('request.send', payload.result);
  if (!diagnostic.ok) failure.result = diagnostic.result;
  return failure;
}
export async function executeMcpCommand(input, rawConfig, { loadSdk = loadMcpSdk } = {}) {
  const command = validateSessionCommand(input), config = validateMcpConfig(rawConfig);
  let client, transport;
  try {
    const { Client, StdioClientTransport } = await loadSdk();
    client = new Client({ name: 'simple-llm-web-cli', version: '1.0.0' }, { capabilities: {} });
    // SDK's StdioClientTransport uses spawn(..., {shell:false}). No env secrets
    // are forwarded; its default limited OS environment is used.
    transport = new StdioClientTransport({ command: config.command, args: config.args, stderr: 'ignore' });
    await client.connect(transport, { timeout: config.timeoutMs });
    const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: config.timeoutMs });
    // Only this narrowly scoped host operation is used, besides page tools.
    // Selecting is explicit by index; never navigate, create or close a tab.
    const selection = await call('browser_tabs', { action: 'select', index: config.tabIndex });
    assertCurrentTarget(selection, config);
    const name = `webmcp_llm_${command.command.replaceAll('.', '_')}`;
    const listed = await client.listTools();
    if (!listed.tools?.some(tool => tool.name === name)) fail('MCP_TOOL_UNAVAILABLE');
    assertCurrentTarget(await call('browser_tabs', { action: 'list' }), config);
    return normalizeMcpResult(await call(name, { ...command.args, __expectedOrigin: config.origin, __expectedUrl: config.targetUrl }));
  } catch (error) {
    return { ok: false, error: safeErrors.has(error?.code) ? error.code : 'MCP_COMMAND_FAILED' };
  } finally {
    try { if (client) await client.close(); else if (transport) await transport.close(); } catch { /* safe disconnect */ }
  }
}
export async function executeMcpConfigFile(input, path, options) {
  let config;
  try { config = JSON.parse(await readFile(path, 'utf8')); } catch { return { ok: false, error: 'INVALID_MCP_CONFIG' }; }
  return executeMcpCommand(input, config, options);
}
