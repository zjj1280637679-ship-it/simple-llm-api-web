# TR-ARK-001 · Ordinary Volcano Ark API simulator

**Resource 0.1.0 · SIMULATED · real API calls: zero.** This independently versioned fixture resource models a narrow ordinary Ark data-plane protocol, not Agent/Coding Plan, a cloud backend, or an account availability test. Authoritative versions, UTC millisecond timestamps, protocol/model snapshots and SHA-256 descriptors are in [manifest.json](manifest.json).

## Protocol evidence

Official documentation checked on **2026-10-29**; the checks retrieved documentation only, never API inference endpoints. Some direct English page fetches returned a language shell; the Chinese authentication page and indexed official Chat/Image/Agent/error pages supplied the fields below. This is an original factual integration summary, not a mirror of platform documentation.

- [Authentication](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh): ordinary base `https://ark.cn-beijing.volces.com/api/v3`, JSON body, `Authorization: Bearer <key>`. This resource substitutes only `SIMULATOR_ONLY_NOT_A_REAL_KEY`; any other header value is a contract mismatch. `/api/plan/v3` and the management API are outside this resource.
- [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1): `POST /chat/completions` carries `model`, `messages` and explicit `stream:false`; results use `choices[].message`, `finish_reason` and `usage` input/output/total token counts. Tool definitions use `type:function` plus `function`, arguments are a JSON string, and replies use `role:tool` with the matching `tool_call_id`.
- [Agent invocation guidance](https://docs.volcengine.com/docs/ark/agent-model-invocation-practice?lang=en): preserve the complete assistant message on subsequent turns, including the opaque `encrypted_content` and tool calls. Our marker is deliberately synthetic, not real encrypted content or a valid cryptographic signature; the tests prove byte-preserving history only.
- [Image API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1): `POST /images/generations` carries `model`, `prompt`, `size`, `response_format:b64_json`, and `output_format:png`; the result is `data[].b64_json`, `size`, `output_format`, plus synthetic image usage. The selected 1536×1536 size falls within the documented profile. No Gemini `generationConfig`, `imageConfig` or inlineData wrapper is used.
- [Error catalogue](https://docs.volcengine.com/docs/ark/error-codes?lang=en): fixture HTTP status, error type and string code follow the ordinary Ark mapping; error messages and request IDs are synthetic. `401` is distinct from `403`, and `429` is distinct from transport rejection. These are intentional fixtures, not observed service outages.

`sim-ark-text-v1` is a test-only model selector. The image selector `doubao-seedream-5-0-flash-260915` solely allows the unchanged application's capability table to select Ark image behavior; it does not assert that an account can call the model. Both model and prompt are declared string parameters. Exact model IDs can therefore be exercised offline without any real key or network permission. The resource does not simulate a Bearer-authenticated `/models` endpoint because no such ordinary Ark guarantee was established.

## Closed requests and shared machinery

Each fixture independently declares exact method, URL/query, normalized headers and structural JSON request. `Accept: application/json` is this test-client contract, not a claim that the service mandates that header. Unknown routes, extra headers, query credentials, wrong bodies, extra calls, and non-dummy credentials fail closed without advancing the script. Errors expose field names rather than supplied values. There is no fetch fallback or retry and no global fetch replacement in this resource.

`index.mjs` verifies every fixture and asset hash before exporting `createArkSimulator`, `getFixture`, `getManifest`, `simulatorConfig`, `DUMMY_KEY`, `TEXT_MODEL`, and `IMAGE_MODEL`. Only transport admission/cancellation/assertion machinery is shared with Gemini in `../shared/core.js`; Ark responses, request oracles, model/protocol snapshots and revisions are independent. Configuration is described in [CONFIGURATION.md](CONFIGURATION.md), when using the configuration API.

```js
import {createArkSimulator, simulatorConfig} from './index.mjs';
const sim=createArkSimulator({parameters:{prompt:'Hello',model:'sim-ark-text-v1'}});
// Inject sim.fetch into the existing adapter; never replace it with global fetch.
// simulatorConfig() uses only the dummy key.
const report=sim.inspect(); // evidenceType: SIMULATED, realApiCalled: false
```

Image adapter callers pass `simulatorConfig(IMAGE_MODEL)` and `imageSize:'1.5K'`, `aspectRatio:'1:1'` to obtain the strict 1536×1536 request. In raw fixture replay, model/prompt bindings are substituted in both request and response.

## Registered subset

| Area | Scenarios |
|---|---|
| Text | `text.ok`, `text.empty`, `text.encrypted-follow-up` |
| Tools | `tools.follow-up`: two requests; a caller may run only an explicitly allowlisted pure `sim_add` stub, never arbitrary tools |
| Images | `image.output`, `image.http.400` |
| HTTP | `http.400`, `http.401`, `http.403`, `http.404`, `http.429`, `http.500`, `http.503` |
| Transport/robustness | `transport.reject`, `transport.delay`, `transport.hang`, `robust.invalid-json` |

Delay/hang require an explicit scheduler. The shared core preserves abort reason and cleans listeners/timers. This validates client-side cancellation, not whether a real server stopped generation or billing. `assertComplete()` means the closed script finished with no harness mismatch or pending work, not that an intentionally failing scenario produced a successful answer. Assert event outcomes separately.

`assets/solid-blue-1536.png` is a genuine 1536×1536, 8-bit RGBA, non-interlaced PNG. Every pixel is `(0,128,255,255)`; compressed rows and chunk CRCs are valid. It is deterministic synthetic test data, **not an AI-generated cup**. File dimensions match `data[].size`; image output token metadata is synthetic and is not billed usage.

No streaming, complete provider schema validation, tokenizer, inference quality/safety assessment, URL download, video/audio, embeddings, 3D, model discovery or actual credential acceptance is claimed. There are no live requests in this resource. A separate, explicit bounded live-runner opt-in does not convert these fixtures into real evidence. Production source/Pages changes and real-key lookup are outside this addition.
