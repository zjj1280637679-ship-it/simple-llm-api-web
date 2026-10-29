# Reasoning 模型规则证据索引

复核：2026-10-29T16:43Z。推荐只指参数模板，不表示推荐采用该模型或验证当前账号可访问。精确 ID 白名单，无未来家族前缀匹配。自定义、latest 和未核验模型允许显式手选；默认不发送。

## Gemini
来源：https://ai.google.dev/gemini-api/docs/generate-content/thinking （Controlling thinking 两张表）。

|规则 key|采用的参数范围|
|---|---|
|gemini-3.8-flash、gemini-4-argon|low / medium / high|
|gemini-3.6-flash、gemini-3.5-flash-lite、gemini-3.1-flash-lite、gemini-3-flash-preview|minimal / low / medium / high|
|gemini-2.5-pro|128–32768，另 -1 动态|
|gemini-2.5-flash|0–24576，另 -1 动态|
|gemini-2.5-flash-lite|512–24576，另 -1 动态、0 关闭|

## OpenAI Chat
以下每个独立模型页面正文列明支持档位包含 low / medium / high。本实现取这三个公共子集，使用 Chat 的 reasoning_effort，非 Responses 的 reasoning.effort。

- gpt-5：https://developers.openai.com/api/docs/models/gpt-5
- gpt-5.1：https://developers.openai.com/api/docs/models/gpt-5.1
- gpt-5.2：https://developers.openai.com/api/docs/models/gpt-5.2
- gpt-5.5：https://developers.openai.com/api/docs/models/gpt-5.5
- gpt-6-astra：https://developers.openai.com/api/docs/models/gpt-6-astra
- gpt-6.1-sol：https://developers.openai.com/api/docs/models/gpt-6.1-sol

Chat 字段区别：https://developers.openai.com/api/docs/guides/reasoning

本轮没有收齐 mini / nano / o3 / o4-mini 的明确枚举证据，因此这些 ID 仅手选、不推荐；不意味着 API 不支持。

## Ark Chat
来源：https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh （调节思考长度表）。精确列明以下 ID，支持 minimal / low / medium / high；其他兼容档位会映射，本实现用这四个实际档位。

- doubao-seed-2-1-pro-260915
- doubao-seed-2-1-lite-260915
- doubao-seed-2-1-pro-260628
- doubao-seed-2-1-turbo-260628
- doubao-seed-2-0-lite-260428
- doubao-seed-2-0-mini-260428
- doubao-seed-2-0-pro-260215
- doubao-seed-2-0-lite-260215
- doubao-seed-2-0-mini-260215
- doubao-seed-2-0-code-preview-260215

## Anthropic
来源：
- https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting （Thinking support by model）
- https://platform.claude.com/docs/en/build-with-claude/effort （Effort levels）
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking （Budget rules / migration）

adaptive + effort low / medium / high：claude-opus-4-6、claude-sonnet-4-6、claude-opus-4-7、claude-opus-4-8、claude-opus-5、claude-sonnet-5、claude-opus-5-5、claude-sonnet-5-5、claude-haiku-5-5。

manual budget：claude-opus-4-5、claude-sonnet-4-5、claude-haiku-4-5（及代码列明的同版本日期 ID）。预算至少 1024 且本应用非 interleaved 模式下小于 max_tokens。4.6 manual 已弃用，4.7+ 不支持 manual；4.5 不支持 adaptive。

该证据索引核验模型配置规则，不把任何离线序列化测试当作真实供应商调用成功。
