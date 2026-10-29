// Synthetic stdio peer only: NOT a browser and never makes provider requests.
import { createInterface } from 'node:readline';
const target = 'https://workbench.example/app/';
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (!Object.hasOwn(request, 'id')) continue;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-browser', version: '1' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'webmcp_llm_draft_set', description: 'Synthetic', inputSchema: { type: 'object' } }] };
  else if (request.method === 'tools/call' && request.params.name === 'browser_tabs') result = { content: [{ type: 'text', text: `### Open tabs\n- 0: (current) [Workbench](${target})` }] };
  else if (request.method === 'tools/call' && request.params.name === 'webmcp_llm_draft_set') {
    const args = request.params.arguments;
    result = { content: [{ type: 'text', text: JSON.stringify(args.__expectedOrigin === 'https://workbench.example' && args.__expectedUrl === target ? { ok: true, result: { draft: args.text, synthetic: true } } : { ok: false, error: 'MCP_TARGET_MISMATCH' }) }] };
  } else result = { isError: true, content: [{ type: 'text', text: 'Unsupported synthetic request' }] };
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
