# Anthropic Messages format (verified 2026-10-29)

This is a native Messages adapter, not OpenAI chat/completions with a different label. Select the custom Anthropic format and provide a trusted HTTPS base, key and model. Official base: `https://api.anthropic.com/v1`. Requests happen only on user actions, not configuration edits. No live credential/API tests were performed.

## Implemented contract

- POST `/messages`: `x-api-key`, explicit compatibility version `anthropic-version: 2023-06-01`, JSON `model`, `messages`, top-level `system`, `max_tokens` (4096 default), `stream`. No OpenAI `stream_options` or `max_completion_tokens`.
- This deliberately retains the legacy version/key contract for compatible providers. Current official SDK defaults to 2026-10-21; we do not claim support for its new features, federated credentials, or workspace-selection headers. A key requiring `anthropic-workspace-id` is not supported.
- For the **exact canonical official base** above only, sends SDK-documented `anthropic-dangerous-direct-browser-access: true`. Never sends that proprietary opt-in to gateways. UI must clearly disclose browser-visible key risk before active use. Existing explicit target approval, memory-only secrets, no redirects/credentials/referrer, and safe error handling remain. This header is not a promise of working CORS: genuine browser/API connectivity remains unverified.
- SSE handles message/block start/delta/stop, cumulative partial usage merge, pings and unknown top-level events. Text renders incrementally. Thinking text/signatures and redacted thinking remain native blocks in history; thinking is not displayed as answer text. The UI does not request extended thinking.
- Only `end_turn` / `stop_sequence` responses commit history. Missing message_stop, abort, stream error, unsupported blocks, malformed indexes or truncation fail without committing the partial response or retrying. Cancellation may not prevent upstream billing.
- GET `/models?limit=1000` returns one page, newest first; never follows a provider-provided URL. It does not promise a complete paginated catalog.
- Usage input = uncached input + cache write + cache read, output = final reported output; cache hit numerator = cache read only. Missing counters stay unknown; no fabricated zeros or summed cumulative snapshots.

## Explicitly limited capabilities

Text conversation and UTF-8 text attachments only. Image, PDF, audio, video attachments and image generation are disabled for this adapter. Tools are not advertised even when a separate image workspace is configured; explicit tools/tool history or returned tool_use are rejected. We do not pretend OpenAI tool_call_id or image_url/file blocks are native Anthropic data.

Potential future mappings (not enabled): native image `source:{type:'base64',media_type,data}`; PDF `document` with a base64 application/pdf source; tool declarations use `input_schema`, assistant `tool_use` has id/name/input, following user content contains `tool_result` keyed by `tool_use_id`. These require separate full round-trip, validation, signed-thinking and capability tests before enabling.

## Official references

- [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Version history and compatibility](https://platform.claude.com/docs/en/api/versioning)
- [Streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Official TypeScript SDK browser opt-in and headers](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts)
- [Authentication/API overview](https://platform.claude.com/docs/en/api/overview)
- [Models list](https://platform.claude.com/docs/en/api/models/list)
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), [PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)

Offline tests use synthetic keys and split every UTF-8 byte, verify real native second-turn history, usage, cancellation, errors, max-token truncation, missing termination, unsupported tools/modalities, official-only browser header and model listing. They do not substitute for a live API test.
