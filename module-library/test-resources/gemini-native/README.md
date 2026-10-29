# TR-GEMINI-001 · Gemini native REST simulator

**Resource 0.2.0 · SIMULATED · no real API calls.** Versions and UTC millisecond creation/update times are authoritative in [manifest.json](manifest.json). This is a reusable test resource, not a new F/R/C module or a seventh host. Target protocol: Gemini Developer API `v1beta`, `generateContent`, JSON camelCase; not Vertex or Interactions.

## Editable profiles (new in 0.2.0)

[Configuration API / CLI contract](CONFIGURATION.md): editable text presets, exact preset matching/fallback, separate seeded success/preset/cache rates, latency and non-streaming token-rate duration; immutable UTC/hash-linked history, runtime reset and preset/historical restore. `npm run simulator -- help` shows management commands. This is a local reusable backend layer, not an HTTP service or browser UI.

## Run

```sh
node --test tests/gemini-simulator.test.js
npm run modules:host -- F-002
npm run modules:host -- F-002 --prompt '你好 🧪'
```

The existing H-F-002 borrows `text.ok` through its exact [resource lock](../../hosts/text-generation/resources.lock.json), calls the **unchanged production Gemini adapter**, and emits version/hash-bound `SIMULATED` evidence. Its old explicitly selected `--live` mode remains Ark-only; it was **not run** for this delivery. No Gemini live mode or credentials are introduced.

```js
import {createGeminiSimulator, simulatorConfig} from './index.mjs';
import {generateText} from '../../functions/text-generation/index.js';
const sim = createGeminiSimulator({scenario:'text.ok', parameters:{prompt:'Hello'}});
const output = await generateText({config:simulatorConfig(),
  messages:[{role:'user',content:'Hello'}], fetchImpl:sim.fetch});
const evidence = sim.assertComplete();
```

`index.mjs` is a Node convenience loader that verifies local fixture SHA-256 before use. `core.js` is a browser/Node kernel with no Node imports or network dependency; browser tests can pass the same already-loaded JSON fixture and revision to `createSimulatorCore`. No browser UI/CORS/HTTP-server integration is claimed. Create a new instance to reset; instances do not share mutable script state.

## Closed request contract

- Every step has its own literal method, exact URL/query, exact normalized headers, and structural JSON body. Fixture oracles do **not** import production request builders. Only the declared `prompt` parameter is bindable in text scenarios; the original fixture API keeps responses fixed. The opt-in [configuration API](CONFIGURATION.md) derives scoped editable responses without changing fixture bytes.
- Only `SIMULATOR_ONLY_NOT_A_REAL_KEY` is accepted. Key-in-query, Authorization, unknown URLs, extra calls and body/header mismatches fail closed; there is no real fetch reference or fallback. The resource never overrides global fetch. Tests/hosts alone install a fail-on-use network guard.
- Contract mistakes throw `SIMULATOR_REQUEST_MISMATCH`, do not consume the expected step, and permanently latch an assertion failure even if a caller later sends the correct request. Diffs contain field names, not submitted values, prompt text, URLs or keys.
- Intentional HTTP errors are separate registered scenarios and **resolve** native `Response` objects with a synthetic Google-style error envelope. Network failure rejects. The production adapter intentionally maps transport exceptions to `NETWORK`, so inspect the simulator's failure latch to distinguish harness errors.
- `Request` input is cloned (the original body remains unread), and init overrides preserve headers, method, body and signal. Admission is serialized in invocation order; responses can complete out of order. The supported body transport is JSON text; other body encodings are explicitly unsupported.

## Implemented, not implied

| Stage | Registered scenarios / evidence |
|---|---|
| M0 | `text.ok`: strict POST → fixed response → actual text adapter → existing H-F-002 report, binding resource/scenario/fixture versions and SHA-256 |
| M1 subset | `models.list`, `models.empty`: actual one-page list adapter; `models.paged`: direct two-page simulator contract only |
| M2 subset | `http.400/403/404/429/500/503`, `transport.reject/delay/hang`, `robust.invalid-json`, `safety.prompt-blocked`; adapter errors/no retries, cancellation and ordered admission |
| M3 subset | `image.output`: actual image adapter and valid 1×1 pixel; `tools.follow-up`: actual text adapter + `makeToolResult`, one allowlisted pure `sim_add` stub, opaque signature and call ID roundtrip |

The existing client reads **one** models page. Filtering is asserted by the test on returned method metadata, not added to `listModels`; automatic pagination/filtering is not claimed. The production adapter does not automatically retry. No UI loading/race-state test was added. Tool simulation does not execute arbitrary names or any external action. The image model selector mirrors the existing capability table only so the request reaches the adapter; it is not confirmation of any real model's existence or availability.

Delay/hang require an explicit scheduler `{setTimeout, clearTimeout}`; tests use a virtual clock. Abort rejects the exact `signal.reason` before, during, and immediately before response delivery; timers/listeners are cleaned up. `dispose()` rejects unfinished work and closes the instance. `assertComplete()` means all expected requests were consumed, no request/delivery harness failures occurred, and no work remains pending; it does **not** mean an HTTP error/cancel scenario returned a successful answer. The event outcomes must also be asserted. Missing scheduler or invalid Response configuration cannot produce a false PASS.

## Fixture provenance and PNG correction

Fixture and scenario version: `1.0.0`; fixture-set version: `1.0.0`. This initial unpublished resource was implemented in stages before its first release, not by rewriting a previously released fixture version. Every JSON fixture has ID/version, UTC creation/update timestamps, intent and source refs; manifest descriptors hash the exact bytes. Any future behavior/fixture changes must update the corresponding versions, changelog, host locks and fresh evidence.

`assets/pixel-1x1.png` is a 70-byte synthetic non-interlaced 8-bit RGBA image, one opaque `(0,128,255,255)` pixel. Tests validate every PNG chunk CRC, the full zlib scanline, exact pixel bytes, dimensions and SHA-256. The pre-existing host PNG had a bad IDAT CRC; `hosts/support.mjs` now uses the valid bytes, and H-F-003/H-R-001/H-C-001 received patch versions. Those three hosts still use their existing Ark synthetic response harness; they are **not** relabeled as Gemini scenario consumers.

No streaming, Live, uploads, cache/batch/audio/video, complete Google schema validation, real tokenizer/quality/safety classification, server-side cancellation, billing or account/model availability is tested. Synthetic usage is not real usage. No production `src/`, Pages allowlist or app deployment content is changed.

Protocol references: [generateContent REST](https://ai.google.dev/api/generate-content), [models REST](https://ai.google.dev/api/models), [Google error envelope](https://google.aip.dev/193). Protocol snapshot and source-check time reflect the approved design, not a live API verification.
