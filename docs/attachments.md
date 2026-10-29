# 本地附件与输入模态 v1

核对时间：2026-10-29 UTC。这里只提供可组合的工具能力，不限定 Dot、GPT 或 Codex 的工作流。

## 协议与模型是两层判断

| 协议 | 当前已编码输入 | 编码 |
|---|---|---|
| Gemini generateContent | 图片、PDF、UTF-8 文本、MP3/WAV/OGG/FLAC、MP4/WebM/MOV | 文本 `text`，其余 `inlineData: {mimeType,data}` |
| OpenAI-compatible Chat Completions | 图片、PDF、UTF-8 文本 | 图片 `image_url` data URI；PDF `file: {filename,file_data}`；文本 text part |
| 火山方舟普通 Chat Completions | 图片、UTF-8 文本 | `image_url` data URI；文本 text part |

协议能编码不表示任意模型都接受。DeepSeek 等兼容端点也不保证实现 OpenAI 全部功能；供应商的模型/额度/格式错误会正常显示为失败。音频、视频在 OpenAI/Ark 本适配尚未核实并实现，按钮禁用；这不是宣称供应商不具备能力。输出模态没有因此改变，音视频附件仅用于理解。

官方依据（不复制完整版权文档）：
- https://ai.google.dev/gemini-api/docs/file-input-methods — inlineData 和文件输入。文档当前总 inline 上限已提高，而分领域文档仍有较保守描述。
- https://ai.google.dev/gemini-api/docs/audio — 音频 inline 输入；当前页面仍有 <20 MB 请求示例。
- https://ai.google.dev/gemini-api/docs/video-understanding — 小视频 inline 输入。
- https://developers.openai.com/api/docs/guides/file-inputs — Chat Completions 的 PDF `file_data`，并非 Responses 的 `input_file`。
- https://platform.openai.com/docs/guides/images-vision — 图片 data URI 输入。
- https://docs.volcengine.com/docs/ark/image-understanding?lang=zh — 图片 URL/Base64 与普通 Chat Completions。

## 本地边界与操作

当前客户端采用保守的实现预算（不是官方通用上限）：单附件 5 MiB，一条消息 8 个/合计 8 MiB；编码后的整轮历史请求最多 16 MiB。累计历史超限可使用加号菜单“清空对话”。图片接入 PNG/JPEG/WebP；GIF 尚未接入。文本只接受 UTF-8；Office/压缩包未做解析。

加号 → 添加图片/文件 → 本地预览、名称和大小 → 可移除/清空 → 用户点击发送后才提交到当前 API。选择器取消不会清旧附件；切页保留草稿；失败/取消且没有工具检查点时恢复草稿。成功后附件留在内存历史，后续对话与工具循环继续携带附件。刷新页面会丢失。模型设置“输入模态”控制允许添加/发送的类型，不偷偷降级丢弃附件。

API 的“应用设置”本身不上传。选择文件不上传；切换协议不偷偷转换或发送，下一次发送前重新验证。图片工作台目前保持文本生成，不把聊天附件误送到生成端点。

## 隐私与诊断

附件没有持久化、没有进入仓库、没有 File API 单独上传；只以用户发送的请求体传输。附件请求及派生图片工具请求的日志只留角色、文件名、MIME、大小及状态/usage，省略请求正文和响应正文（避免上游回显文件内容）。文件名本身仍可包含个人信息，导出日志前自行判断。普通无附件请求沿用原日志策略。

## 验证

`npm test` 包含合成文件的本地读取、取消、累积、类型/大小、协议切换、真实序列化请求体、传输失败/Abort、无自动重试、重复发送闸门、UI 草稿恢复、模态选项、清空，以及日志不含原文/base64。测试替换 fetch，不消耗真实 API。需要浏览器验收本地 file chooser/视觉响应与自选模型的真实输入能力；模拟成功不等于模型真实验收。
