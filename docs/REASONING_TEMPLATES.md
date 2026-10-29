# Opt-in reasoning templates
Local profile snapshot dated 2026-10-29; endpoint evidence scope corrected 2026-10-30.
Default is **unspecified**: do not emit thinking, reasoning_effort,
reasoning, output_config, or generationConfig.thinkingConfig. This is not “disable
thinking”; provider/model defaults remain in effect. No real API test performed.

UI integration: settings.reasoning={template:id,value}. getReasoningTemplates(config)
returns id,label,protocol, choices + values[{value,label}] for enums, or kind:number,
min,max,specialValues for budgets. catalogMatch distinguishes curated matches;
legacy verifiedModel is a compatibility alias, not a live-verification flag.
evidence.kind identifies the local profile/manual schema and liveVerified remains false.
getRecommendedReasoningTemplate returns id only for exact official-host/model matches.
Unknown/rolling/latest aliases and proxies permit explicit manual selection, with
no automatic template/value. A template is a request schema, not a guarantee that an
unknown model supports it. Format-incompatible templates fail before transport.

Current protocols: Gemini generateContent, OpenAI Chat Completions (NOT Responses),
Ark ordinary Chat, Anthropic Messages API version 2023-06-01. No service-plan route.
The curated matrix is a dated local subset, not an exhaustive capability boundary;
add newer model entries after checking their vendor documentation.
Gemini 2.5 uses budgets (special -1 dynamic, zero only where supported); documented
3.x Flash/Flash-Lite and 4 Argon use levels. Minimal is not guaranteed zero reasoning.
OpenAI/Ark emit reasoning_effort only, not Responses reasoning.effort. Ark aliases
may map effort values: no claim that nominal levels imply equal internal work.
Anthropic adaptive template emits thinking:type adaptive plus output_config.effort;
manual emits thinking:type enabled plus budget_tokens. 4.5 is manual, supported
4.6+ adaptive; unknown endpoints are explicitly manual choice. Manual budget must
be less than max output (default Messages cap4096); never silently raise spend.
These thought templates apply the current local sampling profile. In particular,
omitting Anthropic topP is an implementation choice: some legacy model/API-version
combinations permit it. This profile does not claim all such combinations are invalid.
They do not
enable summaries or tools or change stream/signature/history behavior.

References:
- https://ai.google.dev/gemini-api/docs/generate-content/thinking
- https://developers.openai.com/api/docs/guides/reasoning
- https://docs.volcengine.com/docs/ark/deep-thinking?lang=en
- https://docs.volcengine.com/docs/ark/model-parameter-support?lang=en
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/claude_api_primer

Telemetry is separate: requested effort is not a measured actual effort. No latency,
animation, summary length, or token total can prove a selected level was applied.

## 网页入口与验证边界
发送按钮旁「思考」打开独立浮层。模板和数值先作为临时草稿；应用后才成为下一次发送的设置，取消、Escape、切页不提交。初始与「不指定」均不发送任何思考控制字段。预算清空会要求填写，绝不将空白偷偷转换为禁用思考的 0。更换模型/格式后只清除不兼容选择，官方未知或滚动别名没有自动推荐，可显式手选当前格式模板。

2026-10-29 离线 UI/核心回归覆盖默认省略、显式应用、取消、切协议清理、空预算、键盘焦点和批准后参数变化拒发。`tests/browser/reasoning.html` 对真实应用安装完全合成 fetch，报告仅展示请求参数，不调用真实供应商。供应商实际支持和手机真机表现仍以后续真实验收为准。

所有浏览器 QA 页内联 JavaScript 纳入 `tests/browser-syntax.test.js`；这只保证语法，不替代真实浏览器交互。Anthropic QA SSE 字符串使用转义换行；流式 QA 供应商选择器使用真实索引拼接。
