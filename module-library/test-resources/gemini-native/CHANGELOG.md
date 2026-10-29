# Changelog

## 0.2.0 — 2026-10-29 (configuration candidate)

- Add local editable profile API/CLI, versioned UTC/hash-linked append-only snapshots, isolated pinned runtimes, reset and preset/historical restore.
- Editable text presets/match/fallback/error, scoped usage/HTTP overrides, separate seeded hit/success/synthetic-cache controls and explicit sample index.
- Explicit latency versus non-streaming generation-duration speed; no SSE, HTTP server, manager UI or real cache implied.
- Keep all 17 fixture bytes/scenario versions unchanged and original fixture API compatible; resource lock bumps to 0.2.0, H-F-002 to 0.2.1.
- Timer cleanup exceptions settle and latch instead of leaving active work stuck. Production modules/src/Pages stay unchanged.

## 0.1.0 — 2026-10-29 (initial candidate)

- M0 strict fixture oracle, zero-network injected transport, original Gemini adapter and H-F-002 resource-locked evidence.
- 17 narrow scenarios covering text, model-list/direct pagination, HTTP/transport errors, virtual cancellation, a valid PNG and one tool/signature roundtrip.
- Millisecond UTC resource/scenario/fixture revisions, SHA-256 pins and registry validation.
- Correct the old shared host PNG IDAT CRC; independently verify full decoded pixel data.
- Not real API verification; no change to production src/ or the 11-file Pages package.

- H-F-002 is 0.2.0; the other five hosts are 0.1.1 for the shared report provenance additions (image-consuming hosts also receive the PNG correction). Production module contracts remain 0.1.0.
