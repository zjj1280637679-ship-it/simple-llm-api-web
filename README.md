# 极简 LLM

无侧栏、无起始页的静态 AI 工作台：顶部切换「对话 / 图片生成」，API 配置与模型设置以卡片出现在当前历史中。使用你自己的 API Key，浏览器直接请求你确认的服务地址；没有共享网关、公共密钥或后台代付。

## 已实现

- **对话**：Gemini 原生 `generateContent`；OpenAI 兼容 `chat/completions`。默认文本模型 `gemini-flash-lite-latest`。
- **图片**：Gemini 原生 `gemini-nano-banana-2.1`，14 个长宽比 × `1K / 2K / 4K`，共 42 个组合。显示真实返回图片，可下载原始格式。
- **配置**：两页分别保留内存中的 API 配置；无配置时先输入消息会出现配置卡片，填好后再次发送，不重复追加同一条待发送消息。
- **模型列表**：确认目标后真实调用所选地址的 `/models`；不是写死的候选模型。Gemini 取最多 1000 条的第一页。
- **Agent → 图片工作台**：模型的 `image_generate` 函数调用映射到受控 `image.generate` 命令。网页直接生成、Agent 工具、Node CLI 共用 `src/core.js` 的同一个 dispatcher / image generation core。每次生成前显示地址、模型、提示词与尺寸，确认后才发送。
- **请求状态**：防重复点击，取消请求，不自动重试。已到达供应商的请求即使取消也可能计费。

不将网页模型输出作为 HTML、JavaScript 或 shell 执行。CLI 是可用的独立 Node 入口；浏览器内的 Agent 调用受控 JS 命令分发器，**不会启动操作系统 shell**。

## 本地运行

需要 Python 3；验证及 CLI 需要 Node.js 20+，无 npm 依赖。

```sh
python3 -m http.server 8000
# 打开 http://localhost:8000
npm test
npm run check
node cli.mjs --help
```

必须通过 HTTP(S) 打开，不能直接双击 `file://`（浏览器 ES module 限制）。

## Google AI Studio 免费 API（无需信用卡）

默认面向 **Google AI Studio 的 Gemini API Key 和免费项目**，不要求信用卡，不会开启 Billing，也不使用 Google AI Pro 赠金。先在你自己的 [Google AI Studio](https://aistudio.google.com/) 取得 API Key，在「对话」页使用默认 `gemini-flash-lite-latest`，免费使用仍受账号/地区支持与项目额度限制；是否有可用免费额度以 AI Studio 显示为准。

图片的 `gemini-nano-banana-2.1` 必须有该项目实际可用的图片配额。本次检查环境的图片配额为 0，**没有进行真实图片调用**；这里不会引导你绑卡或自动转为付费。网页在每次实际图片调用前确认的是“可能消耗 API 额度”，不是承诺免费可调用。

## API 设置

点输入框左下角 `+ → API 设置`，或直接输入一条消息后发送。

| 字段 | 说明 |
| --- | --- |
| API 地址 | 基础地址，不含 `/models/...:generateContent` 或 `/chat/completions`。Google：`https://generativelanguage.googleapis.com/v1beta`；OpenAI：`https://api.openai.com/v1`。 |
| 协议 | `Gemini 原生` 或 `OpenAI 兼容`；供应商选择只是填写地址，不保证第三方实现所有字段。 |
| API Key | 用户自己的密钥，仅在当前页面内存中保存。可显示/隐藏及清除，刷新或关闭页面即丢失。 |
| 模型 ID | 文本默认 `gemini-flash-lite-latest`；图片默认 `gemini-nano-banana-2.1`。自定义文本模型须与所选协议兼容。 |
| 确认目标地址 | 确认密钥及请求内容要发往哪里。更改地址或协议会清除旧密钥并要求重新确认。模型列表也需要确认。 |

两页的配置彼此独立；可在两页填同一个用户密钥，但不会自动跨页复制。API Key 不保存到 localStorage、sessionStorage、Cookie、URL、历史卡片或日志。卡片中的密钥输入框属于当前页面内存/DOM，浏览器扩展仍可能访问页面；请只使用可信浏览器与可信上游。

只有公开域名的 HTTPS 地址可用；拒绝带账号/密码、查询参数、片段、IP、本机或内网名称的地址。不跟随上游重定向。公开域名仍可能由第三方控制，地址检查不等于供应商可信认证，也不能替代 DNS/网络安全策略。

浏览器直连要求上游允许 **CORS**，包括 `x-goog-api-key` 或 `Authorization` 请求头。网络/CORS 错误无法由静态站点绕过；不要把密钥转发到不认识的“免 CORS”代理。如果上游只接受服务端调用，请自行配置可信后端；本项目不提供共享代理。

### 模型设置及边界

- 对话支持最大输出 Token、温度、Top P；留空使用上游默认。上下文为当前页内存中的完整对话，不进行后台持久化或自动截断；切换协议会从新的模型上下文开始，旧的界面历史仍可见。
- OpenAI 映射为 `max_completion_tokens / temperature / top_p`；部分兼容服务或模型不支持全部字段，留空或按服务文档配置。
- 图片目前仅支持 **Gemini 原生 Nano Banana 2.1**。OpenAI 兼容图片接口、Anthropic、上传图片编辑、多图批量、音视频、PDF、流式输出暂未实现。
- 图片固定一次调用，不强制转换格式；以供应商实际返回的 PNG/JPEG/WebP 下载。像素表是官方参数映射，不是对每次输出尺寸的本地验收保证。
- API 模型名可变，拉取列表不代表账号拥有该模型的生成权限。**免费额度、项目配额、地区、计费激活及模型可用性均由供应商决定**，本项目不承诺某模型可免费调用。
- Agent 工具需文本模型支持 function calling；先在图片页填好并确认图片 API，才向文本模型开放工具。工具向对话返回图片参数、数量、格式及供应商文字，不把图片字节送回文本模型做视觉检查。每轮有有限工具调用次数，无任意命令执行。拒绝确认不会生成图片。

## Node CLI

```sh
node cli.mjs --help
# 在你的本机安全设置 GEMINI_API_KEY 后，再运行：
node cli.mjs image.generate \
  --prompt '雨夜的未来都市，电影摄影风格' \
  --endpoint https://generativelanguage.googleapis.com/v1beta \
  --model gemini-nano-banana-2.1 \
  --aspect-ratio 16:9 --image-size 2K \
  --out ./output/city --yes
```

密钥从环境变量读取，不要把真实密钥写进仓库、命令行参数或共享日志。`--yes` 是对本次目标和额度消耗的明确批准；未给出时不发送请求。具体环境变量和输出文件命名以 `--help` 为准。CLI 与网页调用同一个图片实现，不是第二套模拟实现。

## GitHub Pages 部署

本项目是原生 ES modules，零依赖白名单构建，无服务端 secret。

1. 把源码提交到仓库 `main` 分支根目录，设计原件继续保留在私有仓库。
2. GitHub 仓库 **Settings → Pages → Source → GitHub Actions**。
3. `.github/workflows/pages.yml` 会先执行语法检查与合成测试，再运行 `npm run build`，仅发布 `dist/` 白名单产物。
4. 等待 **build + deploy** 成功，再打开实际站点检查。若设置完成前初次运行失败，可从 Actions 手动重新运行。

白名单只有 `index.html`、`.nojekyll`、`src/{app,core,agent,icons}.js` 和 `src/styles.css`。**不发布 design、tests、CLI、README、配置文件或仓库的其他内容**。不要使用全仓库根目录上传或 `main / (root)` 的分支发布来绕过这层隔离。

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

构建只复制上述七个文件，不下载依赖、不读取环境密钥。工作流参考 [GitHub 官方 Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
CSS/JS 均使用相对路径，兼容 `https://<owner>.github.io/<repository>/`。GitHub 私有仓库的 Pages 可用性和访问范围依账号计划/组织设置而定；启用前检查站点是否会公开。**不要在页面、配置或提交中放共享 API Key。**

若 GitHub 要求重新登录或 2FA，应由账号持有人完成，不能通过代码绕过。代码提交成功不等于 Pages 已部署成功。

## 文件与验证

```text
index.html              生产入口（真实 transport，无模拟回复）
src/app.js              原设计风格 UI，内存配置及费用确认
src/core.js             两种文本适配器、模型列表、图片核心、typed command dispatcher
src/agent.js            模型 function call ↔ dispatcher ↔ 模型结果循环
cli.mjs                 Node CLI（同一 dispatcher）
scripts/build.mjs       仅复制七个生产文件到 dist
.github/workflows/      测试通过后发布 dist 的 Pages 工作流
design/index.html       原始交互设计，原样保留，不作为生产入口
design/REQUIREMENTS.md   当时的设计需求记录（保留历史语境）
tests/                  无密钥、无真实网络的合成测试
VALIDATION.md           本次验证结果与尚未完成的真实环境验证
```

原始设计中的样图/模拟对话仅存在于 `design/index.html`；生产入口为空历史，不假装已经生成成功。`design/REQUIREMENTS.md` 中“仅记录要求”的描述指原设计阶段，不是当前实现状态。

### 官方协议参考（2026-10-28 核对）

- [Google GenerateContent 图片生成与比例/分辨率](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Google GenerateContent API](https://ai.google.dev/api/generate-content)
- [Google function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Google models.list](https://ai.google.dev/api/models#method:-models.list)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI 模型列表](https://platform.openai.com/docs/api-reference/models/list)

Google 当前同时提供较新的 Interactions 协议。本 MVP 有意使用仍有官方文档的 GenerateContent 接口，不能将 Interactions 的 `response_format` 参数混入此请求。
