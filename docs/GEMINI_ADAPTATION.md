# Gemini 设置适配

项目 0.6.1；本地规则 0.1.0；2026-11-04（北京时间）。入口：设置 → 模型设置 → 更多参数 → Gemini 参数。思考强度继续在输入框旁操作；默认不额外发送新增参数。

当前按所选协议、端点、模型与已拉取的 Model 回执调整控件。无需从密钥前缀猜测身份；Google 官方 Gemini 原生地址获得具名模型规则，自定义 Gemini 网关保留协议格式并注明模型未核验。Google 的 OpenAI 兼容接口仍使用 OpenAI 协议控件，不自动改写请求格式。

- 新版明确忽略的采样字段自动收起，旧值保留但不发送。
- Gemini 2.5 显示预算方式；有明确记录的新模型显示对应等级，不提供文档排除的档位。
- 公开思考摘要、输入媒体精度、随机种子、停止序列进入深层设置。Top K 随能力显示；0 与不请求摘要的 false 均能保存、发送。
- 拉取模型仍由按钮触发。列表中不支持 generateContent 的模型进入“其他方法模型”；未知方法不会被当成不支持。模型回执可补充 thinking、Top K 和输出上限；这些字段不证明当前密钥的生成配额。
- 更换密钥、地址、协议会清除旧模型列表和本次能力回执；刷新后需要重新拉取。旧卡保留当时解释；其快照不能授权后续请求。

本轮保留了旧模型列表的一页上限（1000），不声称覆盖分页后的所有模型。账号配额、地区限制、付费层级和临时错误仍以实际接口结果判断，不自动变成永久不可用。

## 来源记录

2026-11-04 使用官方资料核对；以下是来源定位和人工摘要，不是上游原文镜像，也不构成真实供应商验收。不同接口的参数不可互换。

| 命题 | 官方来源 | 本地使用 |
| --- | --- | --- |
| GenerateContent 参数与采样变化 | [API reference](https://aistudio.google.com/api-reference/generate-content) | thinkingConfig.includeThoughts、seed、stopSequences、全局 mediaResolution；已登记新版模型不发送温度/Top P/Top K |
| 模型元数据的语义 | [Model reference](https://aistudio.google.com/api-reference/models) | supportedGenerationMethods、thinking、outputTokenLimit、topK；缺 topK 与未知回执区分 |
| 具名模型的思考方式 | [Generate Content thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en) | 2.5 预算范围、3.x 等级集合；未记录模型保留未知 |
| 媒体精度与成本/细节取舍 | [Media resolution](https://aistudio.google.com/docs/media-resolution) | UI 只提供 generateContent 已接入的全局 low/medium/high；没有 per-part ultra_high 或 Interactions 参数 |

Google 文档正在将主要示例移向 Interactions；本项目保持当前 generateContent 路径。本轮未实现 JSON Schema、grounding、系统指令编辑器、Live、TTS 或缓存资源管理，这些是可独立扩展的分工，不显示成已可用选项。

目标模型见 [设计](../design/GEMINI_ADAPTATION.md)，局部证据见 `tests/gemini-adaptation.test.js`、`development/hosts/gemini-*.mjs` 及 `development/models/gemini-adaptation-model.mjs`。完整 F/C/H/Q 仍为独立待证义务。
