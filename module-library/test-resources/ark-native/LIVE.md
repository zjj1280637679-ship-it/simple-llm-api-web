# Optional ordinary Ark live probe

`live.mjs` is separate from the simulator. Import and the default call are inert: `enabled` defaults to `false`. No simulator configuration, replay, fixture, or host default can trigger live fetch. No credentials were needed for its tests; all injected `testTransport` tests are reported **SIMULATED**, `realApiCalled:false`, even though they exercise the `mode:"live"` request path.

The probe uses only `https://ark.cn-beijing.volces.com/api/v3/chat/completions` or `/images/generations`. It never accepts a custom base URL, redirects, Plan Key, control-plane credentials, automatic retries, alternate models, or simulator fallback. The normal key is read only at the explicit live invocation from `ARK_API_KEY`; the dummy simulator key (including surrounding whitespace) is rejected. Do not put keys in command arguments, profile JSON, approval plans, source, reports, or fixtures.

## Preconditions and exact scope

A real request requires all of:

1. User authorization for this specific test, not just a desire to eventually test real credentials.
2. Explicit `enabled:true`, or F-002/F-003 host `--live --live-plan FILE`.
3. A fresh exact-schema plan with `approved:true`, unique `approvalId`, canonical UTC `approvedAt` and `expiresAt`; maximum validity is 24 hours.
4. `maxRequests:1`, an exact model ID, prompt of 1–2000 characters, positive `estimatedCostCny <= maxCostCny <= 100`. These monetary fields are approved **preflight estimates**, not a hard billing cap enforceable by this runner. Recheck current pricing; actual provider charges are not measured here.
5. For text: integer `maxOutputTokens` 1–1024 and `thinking:{"type":"disabled"}`. Request uses `max_completion_tokens`, never both token-limit fields.
6. For image: `size:"1536x1536"`; one ordinary request, `response_format:"b64_json"`, `output_format:"png"`, no group generation or streaming options. Response must contain exactly one complete, CRC/zlib-valid noninterlaced PNG to pass.

Common plan fields are `schemaVersion:1`, `operation:"text"|"image"`, `model`, `prompt`, `maxRequests`, `maxCostCny`, `estimatedCostCny`, `approved`, `approvalId`, `approvedAt`, and `expiresAt`, plus the operation-specific fields above. Unknown fields are rejected. A plan file is an execution constraint, **not proof that user permission exists**; the operator must obtain approval first. No ready-to-run approved plan is shipped.

Programmatic API: `runArkLiveProbe({enabled:false, plan, signal})`. Root/operator supplies the approved plan only when ready; the key stays in the ephemeral environment. `testTransport` is solely for tests: when supplied it uses the dummy key, does not read `process.env`, and cannot produce `LIVE_RUN` evidence.

The text/image hosts can execute this probe, but unlike synthetic host runs it does not use the production adapter; reports say `adapterVerified:false`. They check that a nonempty text response or one valid PNG exists, without logging response text, prompt, image bytes, key, upstream errors, URLs, or headers. Reports contain model, approval ID, UTC timing, attempt count, safe usage totals, effect summary and real-vs-simulated provenance. `realApiCalled:true` denotes an attempted real HTTP call, not guaranteed success or measured billing. A transport/HTTP/parse/cancellation failure is terminal with zero retries and fallbacks. The 120-second timeout bounds fetch lifetime; cancellation cannot promise the provider stopped generation or billing.

## Official protocol references

Protocol checked 2026-10-29 against [Base URL/authentication](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=en), [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en), [image API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1) and the repository's dated [Ark integration reference](../../../../docs/ark-api.md). Current access, per-model parameter support, cost, generation quality, production adapter correctness and browser CORS are not established by fake-transport tests. Unsupported live parameters fail visibly; no automatic downgrade is attempted.
