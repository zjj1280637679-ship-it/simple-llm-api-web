#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeMcpConfigFile } from './cli-mcp-transport.mjs';
import { validateSessionCommand, sessionCommandResult } from './src/session.js';

export const help = `Live webpage session CLI (explicit authorized browser host required)
Usage: node web-cli.mjs COMMAND [JSON_ARGS] --mcp-config ./browser-host.json
   or: node web-cli.mjs COMMAND [JSON_ARGS] --transport ./authorized-transport.mjs
Commands: session.state, session.logs, page.navigate, settings.update,
          draft.set, request.send, request.cancel
Examples:
  node web-cli.mjs session.state --transport ./authorized-transport.mjs
  node web-cli.mjs draft.set '{"text":"Hello"}' --transport ./authorized-transport.mjs
The transport module must export execute(command) connected to an explicitly
selected, user-authorized live page session. --mcp-config uses a standard
Playwright MCP extension host and optional MCP SDK; neither is auto-installed.
This is NOT the independent provider/image CLI (cli.mjs). No API keys accepted.
request.send still requires confirmation inside the page. See WEB_SESSION.md.
`;
export async function main(argv, { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s), loadTransport = p => import(pathToFileURL(resolve(p)).href), runMcp = executeMcpConfigFile } = {}) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { stdout(help); return 0; }
  try {
    const mode = argv.includes('--mcp-config') ? '--mcp-config' : '--transport';
    const index = argv.indexOf(mode);
    if (index < 1 || index > 2 || index !== argv.length - 2 || !argv[index + 1] || argv[index + 1].startsWith('-')) throw new Error();
    const command = validateSessionCommand({ command: argv[0], args: index === 2 ? JSON.parse(argv[1]) : {} });
    let result;
    if (mode === '--mcp-config') result = await runMcp(command, argv[index + 1]);
    else {
      const transport = await loadTransport(argv[index + 1]);
      if (typeof transport.execute !== 'function') throw new Error();
      result = await transport.execute(command);
    }
    if (!result || typeof result.ok !== 'boolean') throw new Error();
    if (result.ok) result = sessionCommandResult(command.command, result.result);
    stdout(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch {
    stderr('Web session command failed. Check command syntax and the authorized transport; browser host installation and connection require explicit setup.\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
