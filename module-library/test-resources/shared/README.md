# Shared simulator engine

Provider-neutral implementation borrowed by Gemini and ordinary Ark:

- `core.js`: strict closed ordered request script, exact method/URL/headers/body, synthetic Response/rejection, deterministic scheduler, cancellation/disposal and redacted latched failures. Async Request body normalization is cancellable; a disposed runtime cannot later consume/deliver.
- `configuration.mjs`: provider callback mappings; common validation, seed/sample decisions, timing, immutable pinned snapshots and append-only hash-linked profile store. Namespace and default store remain separate per provider. Gemini's v0.2 configuration schema and snapshot bindings are unchanged.
- `png.mjs`: bounded complete chunk CRC/zlib/noninterlaced PNG validation. Unsupported PNG features fail closed; no quality claim.

Provider schemas, error envelopes, fixture data and model metadata remain in their own packages. No production request-builder imports or network fallback in this engine. Scripts share only command parsing/profile replay (`scripts/simulator-cli.mjs`).
