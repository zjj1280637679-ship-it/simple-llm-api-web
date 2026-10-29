# 请求状态动画与资源版本（2026-10-29）

## 可观察事实
- fetch 开始：等待响应头；这不表示 TCP 未连通，服务端也可能正在排队或推理。
- HTTP 成功头到达：等待回复。首个字节可能仅 SSE 心跳，不代表推理。
- Gemini 非空 thought:true 文本、兼容接口非空 reasoning_content：已有显式思考信号。
- 文本或工具调用增量：正在接收输出。opaque thoughtSignature / encrypted_content 本身不触发思考动画；保留其上下文原值，但不显示明文或写日志。
- 成功、HTTP/网络/流格式错误、取消：结束动画，沿用现有回复/错误处理，不自动重试。

等待15/45秒的慢转、黄/红只是界面延迟提示，不是服务端故障阈值。明确推理/输出信号才绿色加速与三点。无显式信号的闭链模型只显示等待。屏幕阅读器只在阶段变化通知；每秒动画时钟不重写live region。减少动态效果时不旋转、不跳动；颜色之外有可访问状态名称及悬停说明。

## 客户端截止与清理
网页单次发送/拉取最多等待30分钟，可随时取消。截止由本地计时器终止，错误明确为 CLIENT_TIMEOUT，说明供应商可能已计费，未自动重试。此数值是本产品保守上限，不是模型完成时间承诺；Ark官方提示长思考客户端需较长超时，所以没有采用“几十秒没文字就失败”的策略。请求结束/错误/取消 finally 清除deadline和动画时钟。工具确认等待也计入整体请求时间；用户可重新发起。

## 缓存修复
实查GitHub Pages资源Cache-Control:max-age=600，HTML和JS固定URL会使不同发布资源错配。构建用14个白名单源文件计算稳定SHA256摘要，给index中的CSS/JS入口及全部相对模块imports写入同一?v=摘要。源文件不改、没有用户数据参与、无额外产物、相同输入重复构建一致。浏览器仍持有旧index时可能在其缓存生命周期内继续旧版本；没有声称强制刷新所有现有标签页。测试核对所有模块引用、白名单、版本一致和可复现。

## 官方依据
- Fetch响应头与body分离：https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- SSE/ReadableStream：https://developer.mozilla.org/en-US/docs/Web/API/Response/body
- Gemini思考摘要：https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en
- DeepSeek thinking字段：https://api-docs.deepseek.com/guides/thinking_mode/
- Ark普通Chat字段：https://docs.volcengine.com/docs/ark/chat-api?lang=en
- Ark长推理超时说明：https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh
- MDN缓存版本化：https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching

## 验证边界
tests/browser/streaming.html提供零外部网络的响应头延迟、headers后静默、显式思考、仅心跳、正常输出、流错误、断流、HTTP503。它验证真实浏览器渲染而非真实供应商可用性。30分钟deadline以可控时钟单元验证，不要求测试实际等待30分钟。iPhone真实键盘仍需单独验收。
