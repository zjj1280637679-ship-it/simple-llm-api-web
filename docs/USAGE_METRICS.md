# 末次请求指标 v1

核对日期：2026-10-29。以下是本应用目前使用的 generateContent / Chat Completions 协议，不把 Responses API 字段混入。

| 协议 | 输入 | 输出 | 总量 | 命中缓存的输入 |
| --- | --- | --- | --- | --- |
| Gemini | usageMetadata.promptTokenCount | candidatesTokenCount | totalTokenCount | cachedContentTokenCount |
| OpenAI Chat Completions / Ark 普通 API | usage.prompt_tokens | completion_tokens | total_tokens | prompt_tokens_details.cached_tokens |

来源：
- https://ai.google.dev/api/generate-content#UsageMetadata
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/cookbook/examples/prompt_caching101
- https://docs.volcengine.com/docs/ark/context-api
- https://docs.volcengine.com/docs/ark/context-cache

指标区分上游字段与按协议归一化的派生值。0 是有效值；一般缺失/null/非整数为未知，UI 用三个 ASCII 点 `...`。特定官方 Gemini 条件下缺失缓存字段按 proto 默认值归一化为 0，并记录 cacheCountSource，详见 [其推导前提](GEMINI_CACHE_ZERO.md)。Gemini/Chat 的总量读取实报字段；Anthropic 的输入为未缓存/缓存写入/缓存读取之和，总量再加输出，任一必要字段未知则不补算。缓存命中比例=缓存输入/输入，零/未知分母或分子大于分母时不产生比例；不按耗时猜测缓存。

上下文显示**末次模型请求输入 Token**，包含上游计入的历史、工具等；不是尚未发送的草稿，不是整项任务累计量。当前没有经核实的模型窗口元数据，因此显示“窗口 ...”，不展示伪造的上下文百分比。工具循环显示最终模型请求，而不是将各轮输入重复累计成上下文大小。缓存比例也不是账单折扣比例。

切换模型后旧指标仍属于末次请求；下一次请求开始清空，失败不会沿用旧指标冒充本次值。指标没有主动网络调用，不发送额外凭证。页面通讯日志保留实报 usage，可与底栏核对。

`node --test tests/usage.test.js` 使用多提供商合成响应验证适配器到指标的链路，不代表真实 API 验收。`tests/browser/usage.html` 是无网络的渲染样例（只用于开发，不进入 Pages 构建）。

## 每回复快照与速度（v2）

底栏将耗时改为 `速度 ≈ N.N Token/s`。每个成功的模型 response 保存一份冻结的浅拷贝用量及速率快照，显示在对应回复下面。多轮工具对话的每个有正文的模型 response 分别绑定自身统计；底栏只取最终模型 response，不把整项工具任务时长配给最后一轮词元。图片结果也保留用量快照，但没有正文流时间所以速度为 `...`。下一次发送清空底栏不修改已有快照；失败/取消的 partial 不获得成功快照，之前已成功的 response 不被抹除。

**速率不是模型内部实测生成速度。** 使用该 response 首个到末个非空正文 delta 的客户端单调时钟到达间隔，分子为可靠可分离的正文输出 Token；排除首字等待、尾部 usage 等待及其他工具轮。首个 chunk 可能已经包含多个 token，网络/代理缓冲也会影响估算，所以显示 `≈` 且 title 明确说明。它不是字符/s，不按字符反推 token。单 chunk、零/无效时间、无可靠正文计数均为 `...`，不显示 Infinity。

分子规则：
- OpenAI Chat Completions/兼容 Ark：要求显式合法 `completion_tokens_details.reasoning_tokens`，用 `completion_tokens - reasoning_tokens`；缺失不假设零。工具、音频、拒答和被拒绝的预测输出不用于正文速率。
- Gemini：单文本候选的 `candidatesTokenCount`，不加 `thoughtsTokenCount`；含 functionCall/inlineData 等非文本部分时未知。
- Anthropic：只在请求未启用 thinking 且返回全为 text block 时使用 `output_tokens`；thinking/redacted_thinking 或开启 thinking 时无法分离，显示未知，不把思考输出当正文。

官方字段核对：
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create （completion_tokens_details）
- https://ai.google.dev/api/generate-content#UsageMetadata （candidatesTokenCount 与 thoughtsTokenCount 分列）
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking （thinking 的输出计费包含于 output tokens，摘要长度不等于计费 token）

离线回归：`node --test tests/reply-metrics.test.js tests/app-controls.test.js`，覆盖时序、两轮快照、连续发送、partial取消、缺失/零计数、正文/思考拆分。`tests/browser/reply-metrics.html` 为无网络视觉 QA fixture；检查 320/390px、桌面与深色模式换行，成功回复四指标均显示，未完成回复不出现成功用量。流式增量仍只更新已有文本节点；成功时在该回复内追加指标，不重建 spinner 或整页，不添加额外滚动写入。
