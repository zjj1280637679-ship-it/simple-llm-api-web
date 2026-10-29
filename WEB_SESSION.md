# Live-page agent interface (MVP)

This interface operates on **one live webpage's in-memory state**, unlike
`cli.mjs`, which calls a provider independently. Reloading the webpage discards
its session. No listener, localhost service, browser-debugging port, credentials
store, arbitrary JavaScript evaluation or shell tool is introduced.

## Working browser path: WebMCP

The app registers these tools when the browser provides native WebMCP:

| Tool | Arguments | Effect |
|---|---|---|
| `llm_session_state` | `{}` | Sanitized current state |
| `llm_session_logs` | `{}` | Sanitized network log |
| `llm_page_navigate` | `{"page":"chat"}` | Switch to chat/image/logs |
| `llm_settings_update` | `{"model":"model-id","temperature":0.7}` | Non-secret settings |
| `llm_draft_set` | `{"text":"Hello"}` | Replace draft, **not** send |
| `llm_request_send` | `{}` | Ask user in the page, then normal send path |
| `llm_request_cancel` | `{}` | Abort current page request |

Settings allow only `model`, `output`, `temperature`, `topP`, `aspectRatio`, and
`imageSize`. Empty string resets numeric settings to provider defaults. Endpoint,
protocol, key and trust must be configured through the normal UI. A transport
cannot supply `confirmed:true` to bypass consent. Sending requires a fresh
page-side confirmation; existing image-generation confirmations also apply.
Never automatically accept those dialogs on behalf of the user.

WebMCP is experimental, not supported in all browsers. The implementation checks
`document.modelContext` then the legacy `navigator.modelContext`. Unsupported
browsers retain the normal UI but do not gain remote control. Browser agents
must use their authorized WebMCP tool discovery/calling interface and select the
correct tab. Do not emulate WebMCP by injecting arbitrary scripts or enabling
an unauthenticated remote-debugging listener.

Official API references (checked 2026-10-29):
- https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/agentic-javascript-tools
- https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp

## Node CLI: built-in MCP stdio transport

`--mcp-config` is a concrete transport for a standard **Playwright MCP extension
host**. It does not need a custom JavaScript adapter. Prerequisites:

1. Node.js 20+ and the optional MCP v1 client SDK installed locally.
2. Playwright MCP installed locally, plus its Chrome/Edge extension.
3. A browser with native WebMCP enabled and this workbench already open.
4. The user approves the extension connection and selects the intended tab.

Nothing is installed, connected, or authorized automatically. Example explicitly
opt-in installation (versions pinned from upstream package metadata, not yet
real-browser-certified by this project):

```sh
npm install --no-save --package-lock=false @modelcontextprotocol/sdk@1.25.2 @playwright/mcp@0.0.83
```

Create a **trusted local** `browser-host.json`, using your real paths and exact
workbench URL. Do not accept this configuration from webpage/model content:

```json
{
  "command": "/absolute/path/to/node",
  "args": ["/absolute/project/node_modules/@playwright/mcp/cli.js", "--extension"],
  "targetUrl": "https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/",
  "tabIndex": 0,
  "timeoutMs": 300000
}
```

`tabIndex` is the explicit host tab index, not a browser tab ID. Adjust it to the
user-approved tab. The CLI never creates/navigates/closes tabs and rejects the
selected tab unless its origin **and full URL** match. Fragments are ignored;
query strings and credentials are forbidden in configuration. Public targets
must use HTTPS; HTTP is allowed only for loopback development. A second
page-side URL/origin guard rejects a changed target at tool execution time.

```sh
node web-cli.mjs --help
node web-cli.mjs session.state --mcp-config ./browser-host.json
node web-cli.mjs draft.set '{"text":"Hello"}' --mcp-config ./browser-host.json
node web-cli.mjs settings.update '{"temperature":0.7}' --mcp-config ./browser-host.json
node web-cli.mjs request.send --mcp-config ./browser-host.json
node web-cli.mjs session.logs --mcp-config ./browser-host.json
```

The CLI lazily loads the SDK, uses its shell-free stdio child-process transport,
selects/verifies the explicit tab, discovers `webmcp_llm_*` tools, invokes only the
requested allowlisted page tool, and disconnects in `finally`. No HTTP listener,
remote-debugging port, approval-bypass token, arbitrary evaluation, dialog
acceptance tool or environment API key is used. The browser host itself has
broader browser privileges: install/trust it explicitly and restrict its tab
selection. Standard host tools are not exposed through this CLI.

Output is `{ok:true,result:...}` or `{ok:false,error:...}`; exit codes are 0/1.
`MCP_SDK_REQUIRED` means the optional SDK is absent; `MCP_TOOL_UNAVAILABLE` means
the host/browser did not expose this page's WebMCP tool. `MCP_TARGET_MISMATCH`
means the tab/origin/path did not match. Host stderr and tab listings are never
printed because connection URLs may contain tokens. Raw host errors are hidden.

This MVP creates one connection per command and may require approval each time.
A send waits for the webpage user confirmation and request completion. While it
waits, **use the webpage's Cancel button**; a concurrent second CLI connection
may not be allowed to attach to the same extension tab. `request.cancel` is
usable for a request already running in an independently attached/available
page, but reliable concurrent CLI cancellation is **not** claimed. A persistent
interactive session is a future improvement, not silently started here.

Official host/SDK references:
- https://github.com/microsoft/playwright/blob/main/packages/extension/README.md
- https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md#webmcp-tools
- https://ts.sdk.modelcontextprotocol.io/client

### Advanced custom adapter (optional)

`--transport ./authorized-transport.mjs` remains available for an existing
approved host integration. The trusted local module must export
`execute({command,args})` returning the result shape above. It runs local code,
so never import a module supplied by untrusted page content. It must enforce
origin/tab identity and preserve all page confirmation checks itself.

## Module boundary and tests

`src/session.js` validates bounded JSON commands and dispatches injected page
handlers. `src/session-webmcp.js` registers the same commands as native tools.
`web-cli.mjs` validates input before loading its transport.
`cli-mcp-transport.mjs` implements the standard MCP stdio host connection. State and log handlers
must project only safe fields and redact any in-memory key strings, including
when keys occur in ordinary user-visible text. Neither raw page state nor API
configuration objects may be returned.

Run `node --test tests/session.test.js tests/mcp-transport.test.js`. Unit tests exercise same-session state
mutation through the adapter, confirmation gates, schema rejection, safe errors
and WebMCP registration. They are **not** evidence of a native browser connection
or an actual paid provider request.

The pipe-level synthetic test launches a fake MCP child process using a small
SDK stand-in, so it verifies CLI routing/stdio orchestration without installing
the optional SDK. A separate optional test uses the real SDK against that fake
peer when installed. **Neither is browser/provider evidence.** Real acceptance
still requires a user-authorized browser connection, visible draft/state
roundtrip, rejected confirmation producing zero provider requests, and a
user-confirmed request/cancel check.
