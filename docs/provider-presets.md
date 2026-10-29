# 普通 API 供应商预设

核对时间：2026-10-29 UTC。版本：provider-presets-1。

## 恢复依据

`design/index.html` 原供应商数组包括 OpenAI、火山方舟、智谱 AI、DeepSeek，及三个自定义格式。运行版截至 `e3003c8a19714d4e1bd4c2daf7e520a55244e2c8` 仅保留 Google Gemini、OpenAI、两个自定义格式和火山方舟；截图 IMG_4933 的五项与源码一致，并非下拉被裁切。本次恢复遗漏的智谱和 DeepSeek，不扩张为未经验证的全厂商目录。

| 恢复项 | 基础地址 | 本应用协议 | 实际文本路径 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible | `/chat/completions` |
| 智谱 AI · 普通 API | `https://open.bigmodel.cn/api/paas/v4` | OpenAI-compatible | `/chat/completions` |

官方依据（访问于上述时间）：
- https://api-docs.deepseek.com/ ：OpenAI兼容基础地址及 chat/completions 示例。
- https://docs.bigmodel.cn/cn/guide/develop/openai/introduction ：OpenAI兼容普通 API 地址；不是 Coding Plan 的 coding 路径。

## 使用和边界

选择供应商时填入基础地址和协议，不填入 Key 或默认模型。用户可填本账号可用的模型 ID；支持模型列表的服务也可在确认地址及填写 Key 后拉取。模型列表权限、CORS、额度和模型可用性取决于供应商及账号，预设存在不等于真实调用已验证。

切换到不同目标会清除旧 Key、地址信任和旧模型；因此不会把 Gemini 默认模型发给 DeepSeek/智谱。再次选择同一个目标保留用户已填模型与 Key。选择只更新当前工作区。

这是文本兼容预设。应用当前图片生成适配仍为 Gemini/Ark；DeepSeek/智谱图片能力未接入。原设计的 Anthropic 自定义格式还没有运行时适配，不呈现成已可调用功能。

## 验证层级

新增离线测试：两家下拉项可见、协议/地址正确、跨厂商模型与凭证隔离、同目标重复选择不破坏配置、图片不误报支持、chat 路径仅追加一次。使用合成模型和合成返回值，无真实 Key、无真实 API 请求。浏览器可见性验收由集成候选进行，不把这些测试当作供应商联网验收。
