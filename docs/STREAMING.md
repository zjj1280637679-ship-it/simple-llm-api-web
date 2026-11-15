# Text streaming

The web chat now calls `generateText` with `onDelta`. This opts into actual network SSE, not replaying a buffered response. Existing CLI callers without this callback retain their JSON API. Image generation remains nonstreaming.

- Gemini: `:streamGenerateContent?alt=sse`, unchanged GenerateContent request body. Preserve every native response part (including empty text carrying thoughtSignature); show only non-thought text.
- OpenAI compatible and ordinary Ark: `/chat/completions`, `stream:true`, `stream_options.include_usage:true`. Accumulate `choices[0].delta.content` and indexed tool-call argument fragments. A recognized `finish_reason` plus either `[DONE]` or **clean SSE EOF** is admissible; a missing reason, explicit `length`/`content_filter`, actual reader error, abort or malformed payload is not. `stream_options` usage tail may be absent when a gateway closes without `[DONE]`; no token usage is inferred. Ark Coding Plan remains unsupported.
- Tool execution starts only after normal complete response + JSON validation. Native assistant content is kept for subsequent rounds. Partial replies remain visible with an unfinished label but are not committed as successful history; completed tool checkpoints survive later failures.
- HTTP errors, in-stream errors, malformed data, **EOF without a recognized complete finish marker**, actual reader interruption, cancellation and non-success finish reasons are explicit failures. `length`/`MAX_TOKENS` is intentionally marked incomplete, not silently saved as complete. Cancellation stops the reader; usage may be unavailable. No speculative zero counts.
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

## 结束证据与兼容模式（2026-11-16）

之前的完成策略对 OpenAI 兼容/Ark 流即使看到 `finish_reason: stop` 或 `tool_calls`，仍要求额外的 `[DONE]`；部分网关发送已完成的最后一帧后自然关闭 HTTP 流，会被误判为 `STREAM_INTERRUPTED` 并拒绝加入对话历史。现将 `readSSE` 的**自然 EOF** 与 `reader.read()` 错误、取消、显式 `[DONE]` 分开记录。在自然 EOF 且已观察到本地完整结束标记时，才把回复提交上下文；仅有 EOF、仅有 `[DONE]` 而没有 `finish_reason`，或只收到 `length`，仍不作为完整答复。已执行的工具不自动重做。此兼容接纳不证明服务商严格发送了 `[DONE]`，也不代表外部模型完成了用户目标。

模型设置新增「响应方式 / 流式兼容」：默认**实时流式 SSE**，也可手动切换到**完整 JSON · 稳定兼容（非流式）**。JSON 模式从发送前就选择非流协议，不会因为 SSE 失败而再发送第二次可能收费的请求；在 JSON 完成前页面不会增量显示正文，但成功后会正常写入原始助手历史和对话上下文。`streamMode` 存在模型偏好白名单中，不包含密钥。已有存档未保存此设置时沿用 SSE。

新回归覆盖 OpenAI/Ark 的完成标记+EOF、工具调用、缺失完成标记、`length`、真实 reader 错误，以及 Gemini/OpenAI/Ark JSON 模式。只使用合成 HTTP 响应；实际中转站 CORS、断流原因、模型完成原因及计费仍需服务器日志佐证。
