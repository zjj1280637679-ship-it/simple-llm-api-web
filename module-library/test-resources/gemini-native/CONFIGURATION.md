# Editable configuration contract · API 0.2.0 / schema 1.0.0

`TR-GEMINI-001@0.2.0` adds a **local Node API and CLI**, not an HTTP service. Frozen v0.1 fixture/scenario/fixture-set versions stay `1.0.0` and their bytes are unchanged. The original `createGeminiSimulator()` remains compatible and fixed-output; opt in to `configuration.mjs` for editable profiles. Production `src/`, the browser UI, and Pages are unchanged.

## Actual interface

```js
import {createConfigurationStore} from './configuration.mjs';
import {generateText} from '../../functions/text-generation/index.js';
import {simulatorConfig} from './index.mjs';
const store = createConfigurationStore(); // ignored output/gemini-simulator-profiles
await store.restore('demo', {scenario:'text.ok'});
await store.set('demo', {parameters:{prompt:'Hello'}, timing:{latencyMs:100,tokensPerSecond:10}});
const sim = await store.start('demo', {
  sampleIndex:7, clock:()=>performance.now(),
  scheduler:{setTimeout,clearTimeout}, // explicit; no hidden real timer or network
});
const reply = await generateText({config:simulatorConfig(),
  messages:[{role:'user',content:'Hello'}],fetchImpl:sim.fetch});
const report = sim.assertComplete();
const fresh = sim.reset(); // same pinned revision/seed/index, new counters/events
sim.dispose(); fresh.dispose();
```

Exports:

- `getConfigurationPreset(scenario='text.ok')`: fresh editable configuration for one of the 17 registered scenarios.
- `validateConfiguration(json)`: validates exact keys, types, IDs, bounds and supported scenario controls; returns an independent clone. Unknown credential/URL/code/streaming fields are rejected.
- `createConfigurationStore({directory?})`: `show(profile='default', revision?)`, `history(profile)`, `set(profile, patch)`, `load(profile, configuration)`, `restore(profile, {scenario? ,revision?})`, `save(profile, newFile, {revision?})`, `start(profile, {revision?,sampleIndex?,clock?,scheduler?})`, `reset(profile, options)`.
- `set`: recursive object merge; arrays replace completely. A new profile starts from `text.ok`. To change scenario shape, use `restore` or `load`, not a partial scenario patch. Invalid settings append nothing.
- `load`: a full validated configuration becomes a new revision. CLI also accepts a validated exported snapshot and imports its configuration as a new revision; it does not overwrite the source profile/history.
- `save`: exports a complete pinned snapshot with no-clobber file creation. It does not create a revision.
- `restore`: registered preset or a previous revision's configuration is appended as a **new** revision. It never erases history. With `revision`, omit `scenario`.
- `start` / store `reset`: fresh runtime from specified/latest snapshot. Existing runtimes remain independent; they are **not cancelled**. Call their `dispose()` explicitly if needed.
- `createConfiguredSimulator({snapshot,sampleIndex=0,clock?,scheduler?})`: same `fetch/inspect/assertComplete/dispose` contract as the original runtime plus `snapshot()` and `reset()`.
- `validateConfigurationSnapshot(snapshot)` checks integrity and exact resource compatibility; `resolveConfiguration(snapshot,{sampleIndex})` returns a cloned derived fixture and deterministic decision for inspection, not a live call.

The CLI starts a new process per command; `reset` reports a newly initialized runtime and exits. It is **not** a persistent-daemon reset. API consumers can keep runtimes alive in their own test processes. CLI `replay` executes literal fixture requests, uses virtual time, explicitly cancels a hang scenario, and reports `adapterVerified:false`. It is a preview, not evidence that the actual production request builder was used.

## JSON shape and editable controls

Use `npm run simulator -- preset --scenario text.ok` to print a complete schema-valid starter.

Common fields:

| Field | Contract |
|---|---|
| `schemaVersion` | exactly `1.0.0` |
| `scenario` | one registered scenario; no arbitrary routes/code |
| `parameters` | exactly the selected fixture's declared keys; usually nonempty `prompt`, max 8192 chars |
| `seed` | integer `0..4294967295`; draws only apply to text-output scenarios |
| `timing.latencyMs` | integer `0..3600000`, per response; zero for transport reject/hang |
| `timing.tokensPerSecond` | zero disables; otherwise `0.001..1000000`; only text.ok/transport.delay, total duration ≤ one hour |

`text.ok`, `transport.delay`, `transport.hang` additionally have:

```json
{
  "output": {
    "presets": [
      {"id":"default","matchPrompt":null,"text":"Default output.","usage":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}},
      {"id":"hello","matchPrompt":"Hello","text":"Hello back!","usage":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}
    ],
    "selectedPresetId":"hello",
    "fallbackPresetId":"default",
    "missBehavior":"fallback"
  },
  "probabilities":{"presetHit":0.8,"success":0.95,"cacheHit":0.3},
  "error":{"httpStatus":429,"status":"RESOURCE_EXHAUSTED","message":"SIMULATED configured error"}
}
```

This is the **text-only portion**, not a complete import file; use `set --json` to merge it into an existing text profile. At most 100 presets, unique lowercase IDs `[a-z][a-z0-9_-]{0,63}`, text ≤65536 characters. `usage` is artificial: each counter is a nonnegative integer ≤10,000,000 and total must equal input + output. It is not tokenization or billable usage. IDs referenced by selected/fallback must exist. Any `http.*` profile instead exposes only editable `error` with HTTP status `400..599`, uppercase error-status identifier and nonempty message; other output fields are rejected.

### Matching and probabilities

These are three **separate provisional meanings of “hit”**, not a claim about a provider's real hit rate:

1. Only the **explicitly selected** preset is considered; this is not automatic scanning of the list. `matchPrompt:null` is unrestricted; a string must equal the configured `parameters.prompt` exactly. A matching preset hits when its seeded draw is below `presetHit`. Wrong prompt or failed draw is a miss.
2. Miss with `missBehavior:'fallback'` chooses `fallbackPresetId` (its own match rule is intentionally ignored). Miss with `'error'` chooses the configured synthetic HTTP error. Separately, `success` determines HTTP success/error; error probability is `1-success`. A mismatch may therefore force error even if success=1.
3. On a successful selected/fallback response, `cacheHit` independently adds `cachedContentTokenCount = promptTokenCount` to usage and marks the report. **No real cache exists**, and it neither reuses previous outputs nor changes timing. The report is explicit about synthetic cache only.

All rates must be finite numbers `0..1`; endpoints are exact. Draws use SHA-256 of `gemini-config-v1:seed:sampleIndex:label`, first uint32 / 2³², with separate labels for the three controls. `sampleIndex` is an explicit safe nonnegative integer, recorded in reports. Repeating seed+index repeats draws; vary index for a deterministic sample sequence. There is no hidden global counter. Launch decisions are deterministic intent, not proof a delayed/hanging response was actually delivered; assert request/event outcomes too. Non-text fixtures do not use probability controls and reject them; their common seed is inert and no draws are reported.

**Matching never relaxes requests.** The launched instance still requires the exact URL, method, dummy key, header set and fixture body with the configured prompt. An actual different prompt is a contract mismatch, not a fallback trigger; set the profile's prompt before launch to exercise exact preset matching. Invalid calls do not consume the step, permanently latch failure, and never reach real network. This remains a finite ordered script, not an unlimited chat service.

### Speed versus latency

Successful single-response text duration = `latencyMs + ceil(candidatesTokenCount / tokensPerSecond × 1000)`, with the generation term zero when rate=0. Errors use latency only. `transport.delay` starts with 50 ms latency; hang remains pending until explicit abort/dispose and therefore requires zero configured timing. Other scripts accept latency only (applied to each step). `transport.reject` cannot be delayed by this API.

This is **non-streaming generation-duration simulation**: one JSON response after the delay, not a token/SSE stream. It does not verify streaming parsers, real model speed, tokenizer output or network throughput. Delayed/hanging API instances need an explicitly supplied scheduler. CLI preview uses virtual time, so a modeled 2150 ms returns immediately while reporting 2150 logical ms. No streaming mode is accepted or implied.

## Revision, history and report guarantees

- Each configuration change creates `profileId`, contiguous numeric `revision`, profile `version` (`1.0.0`, `1.0.1`, …), original `createdAt`, strictly increasing millisecond UTC `updatedAt`, reason, parent snapshot SHA-256, configuration SHA-256 and full snapshot SHA-256. These are configuration versions, distinct from resource/API/schema/fixture versions.
- Canonical hashing recursively sorts object keys and preserves array order. Immutable revisions are published through atomic no-overwrite hard links after complete writes, with read-only file mode; simultaneous writers retry against the new head and merge on the latest configuration. History is append-only through the API. This is integrity checking, **not cryptographic authentication or protection against a filesystem administrator**.
- Every load verifies the complete contiguous hash chain and timestamps. Changed/missing intermediate revisions, corrupted snapshots, resource-version drift and symlink records/directories fail closed. A matching resource checkout is required for future cross-version replay; there is no automatic silent migration.
- Default history stays in ignored `output/`; external `--dir` is allowed but a directory inside checked source (outside `output/`) is rejected. Histories/exports may contain your prompts and custom outputs: use synthetic test data, not real credentials/private production content. Only dummy authentication is supported.
- Runtime launch clones and pins the snapshot. Editing profiles, restoring defaults or mutating returned objects cannot change an existing test. Reset creates fresh counters/events while preserving the same snapshot/seed/index.
- Reports include exact resource revision plus `configurationRevision` ID/version/UTC/hash and `configurationDecision` seed/index/draws/preset/match/success/cache/timing metadata. They remain `SIMULATED`, `realApiCalled:false`.

## Verification and limits

`node --test tests/gemini-configuration.test.js` covers real CLI workflow, all 17 scenario previews, unchanged actual text adapter, preset outputs, 0/1 and intermediate rates, sample replay, isolation, cancellation, delay/speed, concurrency, corruption and validation. Original fixture tests remain in `tests/gemini-simulator.test.js`. A throwing timer cleanup is now settled and latched as a scheduler configuration failure instead of leaving active work stuck.

No real Google API, keys, fallback transport, arbitrary code execution, HTTP server, manager UI, global fetch override or Pages integration is introduced by the configuration API. Test guards alone reject accidental real network. Preset/error/usage knobs are scoped to the stated subset; image bytes, tool execution and model-list contents stay frozen fixtures.
