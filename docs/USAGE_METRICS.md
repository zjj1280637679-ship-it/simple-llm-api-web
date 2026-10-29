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

指标只显示上游实报，0 是有效值，缺失/null/非整数为未知。总量不以输入+输出重新合计（思考等还可能计入总量）。缓存命中比例=缓存输入/输入；零分母、未知分母或缓存输入大于输入时不产生比例，不按耗时猜测缓存。

上下文显示**末次模型请求输入 Token**，包含上游计入的历史、工具等；不是尚未发送的草稿，不是整项任务累计量。当前没有经核实的模型窗口元数据，因此显示“窗口未知”，不展示伪造的上下文百分比。工具循环显示最终模型请求，而不是将各轮输入重复累计成上下文大小。缓存比例也不是账单折扣比例。

切换模型后旧指标仍属于末次请求；下一次请求开始清空，失败不会沿用旧指标冒充本次值。指标没有主动网络调用，不发送额外凭证。页面通讯日志保留实报 usage，可与底栏核对。

`node --test tests/usage.test.js` 使用多提供商合成响应验证适配器到指标的链路，不代表真实 API 验收。`tests/browser/usage.html` 是无网络的渲染样例（只用于开发，不进入 Pages 构建）。
