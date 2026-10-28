# 验证记录

日期：2026-10-28（UTC）。本文件记录实现交付时的证据，不将合成响应冒充真实 API 结果。

## 已完成

- `npm run check`：所有生产 JS、Node CLI、构建脚本语法检查通过。
- `npm test`：**44/44 通过**；Node.js 24，零依赖，网络调用均使用合成 `fetch`，不读取真实 API Key。
- `npm run build`：只生成 7 个白名单文件；逐文件字节一致性测试通过。`design/`、`tests/`、CLI、文档、配置文件不在产物中。
- 实际 `node cli.mjs --help` 进程 smoke test 通过，不读取环境密钥、不发请求。
- CLI 的共享 dispatcher 通过注入合成 fetch 写出真实 1×1 PNG；PNG 夹具已独立解码。
- `design/index.html`、`design/REQUIREMENTS.md` 与授权设计真源逐字节一致，生产入口与设计分离。
- 独立复核：7 个 VM UI 状态/事件用例通过；42 个图片比例×尺寸请求映射通过；无效图片数据、HTTP 失败、非信任目标、CLI 失败泄密/坏文件行为检查通过。VM UI 检查不等同完整真实浏览器验收。

### 合成测试范围

- Gemini 原生文本、OpenAI 兼容文本、真实请求路径与认证头形状。
- 两种协议模型列表，原生 function call 和 thought signature/id 回传。
- 图片 14 比例 × 3 分辨率；仅 PNG/JPEG/WebP 数据，拒绝伪造 MIME/坏签名。
- Agent 与图片页/Node CLI 共用受控 command dispatcher；不执行 shell 或模型代码。
- 每次图片调用确认、重复工具调用去重、普通文本无图片配置时不发送 tools、调用次数上限。
- 请求前/请求中/解析中取消，无隐式重试；完成图片后的工具历史 checkpoint，后续文本失败不重做图片。
- 私有/恶意 URL、认证目标不匹配、URL 路径误含密钥、不跟随重定向。
- HTTP/网络错误不展示上游原始 body、cause、key；错误消息是程序定义的安全文本。
- 无 localStorage/sessionStorage/Cookie 持久化；无生产模拟对话/图片、远程 script、eval 或日志输出。

## 未完成 / 不声称已经验证

- **没有真实 LLM API 调用**：未读取或使用用户真实密钥，未产生 API 费用；用户需在可信页面自行填写 Google AI Studio Key，免费文本额度以实际项目为准。
- **没有真实图片生成**：本次核对项目的图片配额为 0。没有开启 Billing、绑定信用卡或动用 Pro 赠金。
- 未保证所有第三方 OpenAI 兼容上游的字段、CORS 或 function-calling 支持。
- 未把模型列表中出现的模型等同于此账号拥有调用权限。
- 尚未在最终公网 URL 上验证真实浏览器、CORS、页面部署成功及免费文本请求；由发布/浏览器验收流程另行确认。
- GitHub Pages 工作流文件已准备，只有实际 Actions deploy 成功和公网回读才能证明发布完成。GitHub 账号的登录/2FA、Pages 设置和私有仓库计划限制不由此实现绕过。

## 保留的 MVP 边界

- 内存会话；刷新清空，暂无导出/恢复、自动上下文压缩或流式输出。
- 图像输入是文本提示词，固定一次生成；不支持图生图、上传附件、多模态聊天或批量图片。
- 图片工具向对话返回元数据/文字，不发送返回图片字节给文本模型做视觉复核。
- 核心只核对栅格文件签名，不实现完整图片编解码；浏览器实际解码失败会明确显示错误，不自动重试。
- 公共 HTTPS 域名的语法检查不提供 DNS 反绑定检测；仍需用户确认可信上游。
