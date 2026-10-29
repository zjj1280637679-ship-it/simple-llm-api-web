# Text streaming

The web chat now calls `generateText` with `onDelta`. This opts into actual network SSE, not replaying a buffered response. Existing CLI callers without this callback retain their JSON API. Image generation remains nonstreaming.

- Gemini: `:streamGenerateContent?alt=sse`, unchanged GenerateContent request body. Preserve every native response part (including empty text carrying thoughtSignature); show only non-thought text.
- OpenAI compatible and ordinary Ark: `/chat/completions`, `stream:true`, `stream_options.include_usage:true`. Accumulate `choices[0].delta.content` and indexed tool-call argument fragments. Read through finish_reason to usage-only tail and `[DONE]`. Unknown compatibility endpoints may reject streaming/usage; errors are surfaced without costly retries or an artificial typing fallback. Ark Coding Plan remains unsupported.
- Tool execution starts only after normal complete response + JSON validation. Native assistant content is kept for subsequent rounds. Partial replies remain visible with an unfinished label but are not committed as successful history; completed tool checkpoints survive later failures.
- HTTP errors, in-stream errors, malformed data, early EOF, cancellation and non-success finish reasons are explicit failures. `length`/`MAX_TOKENS` is intentionally marked incomplete, not silently saved as complete. Cancellation stops the reader; usage may be unavailable. No speculative zero counts.
- Streaming reuses trusted endpoint checks, credentials handling, attachment redaction, safe network logs and existing per-request usage reporting. Latest response metadata/model version are retained in diagnostics. Provider chunks are rendered by updating one reply node with textContent; readers above the bottom are not forcibly scrolled.

## Offline validation

`npm test` includes byte-split UTF-8/CRLF, multiline SSE, first delta before completion, usage-only tail, Gemini empty signatures into the second request, indexed tools, unfinished/error/length/malformed streams, abort and HTTP failure. No real API requests.

Serve the repository and visit `tests/browser/streaming.html`. It intercepts all iframe fetch requests and emits five chunks 900ms apart. Test all three protocols, second turns, cancellation, error and disconnect modes. This fixture is not in the production build. Existing attachments/reflow fixtures were updated to return SSE.

## Official references checked 2026-10-29

- https://ai.google.dev/gemini-api/docs/generate-content/text-generation
- https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
- https://developers.openai.com/api/docs/guides/function-calling
- https://docs.volcengine.com/docs/ark/chat-api?lang=zh

Synthetic tests establish application behavior only. This change does not claim live provider/model/CORS acceptance.

## JSON completion alignment (2026-10-30)

Nonstream Gemini/OpenAI/Ark now also reject explicit truncated, blocked or unrecognized finish reasons before tool execution/history commit; a refusal is honored even with accompanying text. Compatible JSON endpoints that omit finish metadata retain the prior return path with `completion.status: "unknown"`, not a completed-response guarantee. Normal stop is protocol completion, not proof of task quality. Text Chat URLs already ending in `/chat/completions` are no longer suffixed twice.
