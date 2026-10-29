# 极简 LLM

无侧栏、无起始页的静态 AI 工作台：顶部切换「对话 / 图片生成 / 通讯日志」，API 配置与模型设置以卡片出现在当前历史中。使用你自己的 API Key，浏览器直接请求你确认的服务地址；没有共享网关、公共密钥或后台代付。

## 已实现

- **对话**：Gemini 原生、OpenAI 兼容、火山方舟普通 API。初始文本模型保留 `gemini-flash-lite-latest`；选择 Ark 后使用 `doubao-seed-2-1-lite-260915`，也可手填账号已开通的文本模型。
- **图片**：保留 Gemini Nano Banana 2.1 的 14×3 矩阵；新增 Ark Seedream 5.0 Flash/Pro 的 8×3 矩阵（`1K / 1.5K / 2K`，默认 2K）。显示 API 实际返回的图片，可下载。
- **配置**：两页分别保留内存中的 API 配置；无配置时先输入消息会出现配置卡片，填好后再次发送，不重复追加同一条待发送消息。
- **模型列表**：Gemini/OpenAI 在确认目标后调用所选地址的 `/models`，Gemini 取最多 1000 条的第一页。普通 Ark 的 Bearer 模型列表契约尚未核实，因此明确使用预设/手填，不伪装拉取。
- **Agent → 图片工作台**：模型的 `image_generate` 函数调用映射到受控 `image.generate` 命令。网页直接生成、Agent 工具、Node CLI 共用 `src/core.js` 的同一个 dispatcher / image generation core。每次生成前显示地址、模型、提示词与尺寸，确认后才发送。
- **请求状态**：防重复点击，取消请求，不自动重试。已到达供应商的请求即使取消也可能计费。
- **通讯日志**：真实 fetch 边界记录地址、方法、脱敏头、请求/响应、状态和耗时；真实网络、模拟测试明确区分，可导出 JSON。
- **网页会话命令**：`window.llmWorkbench` 和 WebMCP 提供七个受控命令，独立 `web-cli.mjs` 通过用户授权的浏览器宿主调用；不会启动任意 shell 或绕过网页确认。

不将网页模型输出作为 HTML、JavaScript 或 shell 执行。CLI 是可用的独立 Node 入口；浏览器内的 Agent 调用受控 JS 命令分发器，**不会启动操作系统 shell**。

## 本地运行

需要 Python 3；验证及 CLI 需要 Node.js 20+。网页、图片 CLI 和合成测试无 npm 依赖；可选的真实网页 MCP 连接需要另行安装/授权浏览器宿主及 MCP SDK，见 [WEB_SESSION.md](WEB_SESSION.md)。

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

图片的 `gemini-nano-banana-2.1` 必须有该项目实际可用的图片配额。本次检查环境的图片配额为 0，**没有进行 Gemini 真实图片调用**；这里不会引导你绑卡或自动转为付费。网页在每次实际图片调用前确认的是“可能消耗 API 额度”，不是承诺免费可调用。

## 火山方舟普通 API（文本＋图片）

在任一工作区 `+ → API 设置 → 供应商` 中选择 **火山方舟 · 普通 API**。两页各自填写普通 Ark API Key 并确认目标，不会自动复制另一页的密钥。

- 基础地址：`https://ark.cn-beijing.volces.com/api/v3`，**不是** `/api/plan/v3`，不使用 Agent/Coding Plan Key。
- 文本：`/chat/completions`；预设 `doubao-seed-2-1-lite-260915`。完整保留模型工具消息及 `encrypted_content`；输出预算使用 `max_completion_tokens`，不与 `max_tokens` 同发。
- 图片：`/images/generations`；预设 `doubao-seedream-5-0-flash-260915`，可手填 `doubao-seedream-5-0-pro-260628`。图片预设只覆盖这两个明确模型，不猜测未知 `ep-` 接入点的能力。
- 比例矩阵转成精确 `WxH`，不发送虚构 `aspect_ratio`。1.5K/2K 使用官方参考尺寸，1K 为已校验面积/比例范围的应用预设，界面明确区分。
- 请求 `b64_json + png`，没有组图、流式或联网搜索。若上游仅返回 URL，会明确提示尚未下载、生成可能已计费；不向图片链接附加 Key、不盲目下载、不自动重试。

**已完成一条严格限定的真实图片验证**：2026-10-29 04:50–04:53 UTC，公开工作台对 `doubao-seedream-5-0-flash-260915` 发起一次请求，返回 HTTP 200；2048×2048 PNG（4,788,089 字节）已在网页渲染并下载。页面耗时 18.9 秒，通讯日志 18,335 ms。这证明当时该页面、账号与图片请求路径可用，**不代表所有模型或环境的 CORS/权限/额度均已验证**。

文本、对话 Agent 调图、终端图片 CLI 和终端网页会话 CLI 尚未完成真实 API 闭环；它们的合成测试不能替代实际验收。详情见 [VALIDATION.md](VALIDATION.md)。官方接口集成摘要保存于 [docs/ark-api.md](docs/ark-api.md)。

## 当前模型选型与凭据容器

- [普通 Ark 当前模型目录](docs/ark-model-catalog.md)（[机器可读 JSON](docs/ark-model-catalog.json)）：按文本、图片、视频、杂项列出官方现售/生命周期证据与实验候选；区分推荐、代码已适配和账号实际可用，不把“最新”自动等同“最适合”。
- [凭据容器说明](docs/credentials.md)：目标是仓库 Actions Secret `ARK_API_KEY`；语音可独立使用 `VOLC_SPEECH_API_KEY`。创建、消费和真实调用是分别验收的步骤。
- [空环境示例](.env.example)：不含密钥，不会自动导入浏览器或 CLI。

**当前 Pages 工作流不消费 `ARK_API_KEY`。** 将它存为 GitHub Secret 不会给静态网页增加安全的服务端密钥能力；不能把 Secret 编进公开站点。本文档不冒称容器已经写入，具体操作结果需另行核验。

## API 设置

点输入框左下角 `+ → API 设置`，或直接输入一条消息后发送。

| 字段 | 说明 |
| --- | --- |
| API 地址 | 基础地址，不含 `/models/...:generateContent` 、`/chat/completions` 或 `/images/generations`。Google：`https://generativelanguage.googleapis.com/v1beta`；OpenAI：`https://api.openai.com/v1`。 |
| 协议 | `Gemini 原生`、`OpenAI 兼容` 或 `火山方舟 · 普通 API`；供应商选择只是填写地址，不保证第三方实现所有字段。 |
| API Key | 用户自己的密钥，仅在当前页面内存中保存。可显示/隐藏及清除，刷新或关闭页面即丢失。 |
| 模型 ID | 文本默认 `gemini-flash-lite-latest`；图片初始为 `gemini-nano-banana-2.1`；Ark 选择后使用上面的 Lite/Flash 预设。自定义文本模型须与所选协议兼容。 |
| 确认目标地址 | 确认密钥及请求内容要发往哪里。更改地址或协议会清除旧密钥并要求重新确认。模型列表也需要确认。 |

两页的配置彼此独立；可在两页填同一个用户密钥，但不会自动跨页复制。API Key 不保存到 localStorage、sessionStorage、Cookie、URL、历史卡片或日志。卡片中的密钥输入框属于当前页面内存/DOM，浏览器扩展仍可能访问页面；请只使用可信浏览器与可信上游。

只有公开域名的 HTTPS 地址可用；拒绝带账号/密码、查询参数、片段、IP、本机或内网名称的地址。不跟随上游重定向。公开域名仍可能由第三方控制，地址检查不等于供应商可信认证，也不能替代 DNS/网络安全策略。

浏览器直连要求上游允许 **CORS**，包括 `x-goog-api-key` 或 `Authorization` 请求头。网络/CORS 错误无法由静态站点绕过；不要把密钥转发到不认识的“免 CORS”代理。如果上游只接受服务端调用，请自行配置可信后端；本项目不提供共享代理。

### 模型设置及边界

- 对话支持最大输出 Token、温度、Top P；留空使用上游默认。上下文为当前页内存中的完整对话，不进行后台持久化或自动截断；切换协议会从新的模型上下文开始，旧的界面历史仍可见。
- OpenAI 映射为 `max_completion_tokens / temperature / top_p`；部分兼容服务或模型不支持全部字段，留空或按服务文档配置。
- 图片支持 **Gemini Nano Banana 2.1** 和 **Ark Seedream 5.0 Flash/Pro**。通用 OpenAI 图片接口、Anthropic、上传图片编辑、多图批量、音视频、PDF、流式输出暂未实现。
- 图片固定一次调用，以供应商实际返回的格式下载，不做本地转码。Ark 请求 PNG；预设像素不是对实际输出尺寸的本地验收保证，1K 的应用预设并非官方像素表。
- API 模型名可变，拉取列表不代表账号拥有该模型的生成权限。**免费额度、项目配额、地区、计费激活及模型可用性均由供应商决定**，本项目不承诺某模型可免费调用。
- Agent 工具需文本模型支持 function calling；先在图片页填好并确认图片 API，才向文本模型开放工具。工具向对话返回图片参数、数量、格式及供应商文字，不把图片字节送回文本模型做视觉检查。每轮有有限工具调用次数，无任意命令执行。拒绝确认不会生成图片。

## 通讯日志与网页会话控制

「通讯日志」页面保留最多 100 条内存记录，可展开查看或导出。日志在实际 fetch 前后生成，不由 UI 生成成功记录：CORS/网络失败会显示没有响应的网络错误，不冒充供应商响应。认证值、已使用的 Key、签名查询参数会脱敏；图片数据仅显示元数据，大文本会截断。HTTP 错误原始 body 不读取/保存，只保留真实状态及安全错误；**它不是字节级抓包**。导出仍可能包含私人提示词与回复，请检查后再分享。

七个网页命令为 `session.state / session.logs / page.navigate / settings.update / draft.set / request.send / request.cancel`，操作当前已连接的真实页面内存状态。状态不返回密钥；MVP 不提供 endpoint/Key/trust setter。每次工具发送都需要网页内用户确认，图片生成确认仍保留。

```sh
node web-cli.mjs --help
```

真实 CLI→浏览器连接需要用户已安装、明确授权并选择的浏览器宿主；本次只完成代码和无网络合成测试，**没有验证真实浏览器宿主闭环**。普通浏览器未提供 WebMCP 时不会假装注册成功。详细安装/连接方式及权限边界见 [WEB_SESSION.md](WEB_SESSION.md)。

## Node 图片 CLI

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

Ark 使用单独环境变量与同一 dispatcher：

```sh
# 在本机安全设置 ARK_API_KEY 后：
node cli.mjs image.generate --protocol ark \
  --endpoint https://ark.cn-beijing.volces.com/api/v3 \
  --prompt '海边日出插画' --aspect-ratio 16:9 --image-size 2K \
  --out ./generated --yes
```

密钥从环境变量读取，不要把真实密钥写进仓库、命令行参数或共享日志。`--yes` 是对本次目标和额度消耗的明确批准；未给出时不发送请求。具体环境变量和输出文件命名以 `--help` 为准。CLI 与网页调用同一个图片实现，不是第二套模拟实现。

## GitHub Pages 部署

本项目是原生 ES modules，零依赖白名单构建，无服务端 secret。

1. 把源码提交到仓库 `main` 分支根目录，设计原件继续作为仓库源文件保留。
2. GitHub 仓库 **Settings → Pages → Source → GitHub Actions**。
3. `.github/workflows/pages.yml` 会先执行语法检查与合成测试，再运行 `npm run build`，仅发布 `dist/` 白名单产物。
4. 等待 **build + deploy** 成功，再打开实际站点检查。若设置完成前初次运行失败，可从 Actions 手动重新运行。

白名单只有 `index.html`、`.nojekyll`、`src/{app,core,agent,icons,image-capabilities,logs,session,session-webmcp}.js` 和 `src/styles.css`，共 11 个文件。**不发布 design、tests、CLI、README、配置文件或仓库的其他内容**。不要使用全仓库根目录上传或 `main / (root)` 的分支发布来绕过这层隔离。

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

构建只复制上述 11 个文件，不下载依赖、不读取环境密钥。工作流参考 [GitHub 官方 Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
CSS/JS 均使用相对路径，兼容 `https://<owner>.github.io/<repository>/`。GitHub 私有仓库的 Pages 可用性和访问范围依账号计划/组织设置而定；启用前检查站点是否会公开。**不要在页面、配置或提交中放共享 API Key。**

若 GitHub 要求重新登录或 2FA，应由账号持有人完成，不能通过代码绕过。代码提交成功不等于 Pages 已部署成功。

## 文件与验证

```text
index.html              生产入口（真实 transport，无模拟回复）
src/app.js              原设计风格 UI，内存配置及费用确认
src/core.js             Gemini/OpenAI/Ark 文本、图片核心、typed command dispatcher
src/image-capabilities.js 按 provider/model 分离的图片能力与尺寸
src/logs.js             脱敏、限量的内存通讯日志
src/session*.js         受控网页会话命令及可选 WebMCP 注册
src/agent.js            模型 function call ↔ dispatcher ↔ 模型结果循环
cli.mjs                 Node CLI（同一 dispatcher）
web-cli.mjs             真实页面命令 CLI（需要授权浏览器宿主）
cli-mcp-transport.mjs    可选标准 MCP 传输，不自动安装或连接
docs/ark-api.md         官方 API 来源与版本化集成摘要
docs/ark-model-catalog.md 当前模型目录与生命周期依据
docs/credentials.md    密钥容器、授权消费者与静态站点边界
.env.example           空凭据字段与非秘密参考默认值
scripts/build.mjs       仅复制 11 个生产文件到 dist
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

## 开发态构件图书馆

[模块目录与借用指南](module-library/README.md)将功能、关系和组合分别收录。首批六个独立入口复用唯一生产实现，附契约、条件、测试和已知限制。`npm run modules:list` 可按目标/类型/标签查找，`npm run modules:check` 检查证据指纹，`npm run modules:verify` 复现局部实验。修改后先评审，再用 `npm run modules:record` 刷新通过的本地证据；它不会将 F/C/H/Q 自动升级为通过。

该目录不进入 Pages 的 11 文件运行产物。历史真实 Ark 图片成功保留具体场景范围，不转写为所有构件完整准入。

### 可调 Gemini 模拟后台（开发态 v0.2）

已提供**本地配置 API + CLI**，不是在线服务器或网页管理界面。可改输出预设、预设匹配/成功/模拟缓存命中率、延迟、非流式生成速度；可重置运行状态、恢复默认或历史配置。所有响应为 `SIMULATED`，不使用真实 Key、不连接 Google、不进入 Pages 产物。

```sh
# 创建/恢复 text.ok 预设；每次修改追加新版本和 UTC 时间，旧版本不覆盖
npm run simulator -- restore --profile demo --scenario text.ok
# 设置请求提示词、固定返回文本、人工 usage、延迟和生成速度
npm run simulator -- set --profile demo --json '{"parameters":{"prompt":"你好"},"output":{"presets":[{"id":"default","matchPrompt":null,"text":"这是可调的模拟回复。","usage":{"promptTokenCount":10,"candidatesTokenCount":40,"totalTokenCount":50}}]},"timing":{"latencyMs":150,"tokensPerSecond":20},"seed":42}'
# 分开设置三个概率（0~1），seed + sample-index 决定可回放的抽样
npm run simulator -- set --profile demo --json '{"probabilities":{"presetHit":0.8,"success":0.95,"cacheHit":0.3}}'
npm run simulator -- replay --profile demo --sample-index 7
npm run simulator -- reset --profile demo        # 新建空运行实例，不改配置、不影响其他运行
npm run simulator -- show --profile demo
npm run simulator -- history --profile demo
npm run simulator -- restore --profile demo --revision 1  # 将旧配置另存成新版本
npm run simulator -- save --profile demo --file /tmp/gemini-demo-export.json
npm run simulator -- load --profile another --file /tmp/gemini-demo-export.json
```

- 默认历史在已忽略的 `output/gemini-simulator-profiles/`；`--dir` 可指定外部目录。导出目标必须不存在，避免覆盖。
- 每次运行固定启动时的配置版本/hash/seed/sampleIndex；运行中改设置只影响之后启动的实例。
- 这里“命中”暂拆为**选定预设匹配率、HTTP 成功比例、模拟缓存命中率**三个独立控制，不代表真实模型/缓存命中。详细匹配、回退和错误规则见[配置契约](module-library/test-resources/gemini-native/CONFIGURATION.md)。
- 当前是非流式 JSON：上例成功回复耗时模型为 `150 + 40/20×1000 = 2150 ms`，不是逐 token/SSE。CLI 回放用虚拟时钟直接展示该逻辑耗时，不让终端实际等待；API 可显式注入真实计时器。
- `replay` 是 fixture 传输预览，明确输出 `adapterVerified:false`；实际生产适配器兼容由测试另行验证。管理界面、HTTP 服务和流式输出尚未实现。

### 普通火山方舟模拟后台（独立于 Gemini）

新增 `TR-ARK-001@0.1.0`：17个独立普通Ark严格fixture，文本 `/chat/completions`、图片 `/images/generations`、Bearer鉴权、tool_calls与encrypted_content不透明往返、HTTP/网络/取消及完整合成PNG。它是本地可调用API/CLI，不是HTTP服务或网页控制台。生产 `src/` 与Pages不变。

```bash
npm run simulator:ark -- restore --profile ark-demo
npm run simulator:ark -- replay --profile ark-demo
npm run modules:host -- F-002 --simulator ark --profile ark-demo
npm run simulator:ark -- restore --profile ark-image --scenario image.output
npm run modules:host -- F-003 --simulator ark --profile ark-image
```

[Ark配置](module-library/test-resources/ark-native/CONFIGURATION.md)支持文本/PNG预设、独立seed与命中/成功率、延迟/非流式文本速度、append-only版本/UTC/hash、固定快照和历史replay。共享中性引擎但不混用协议数据，Gemini17个fixture与CLI保持兼容。所有模拟输出均为 `SIMULATED`，不读真实密钥，不回退联网。

[独立真实探针](module-library/test-resources/ark-native/LIVE.md)默认关闭；必须另有一次调用授权计划和临时 `ARK_API_KEY`，固定官方地址、不重试、不回退、不记录密钥/提示/响应文本。费用限制是预检估算，不是平台账单硬封顶。测试只注入假传输并标为 `SIMULATED`；不能用其证明真实模型、费用、CORS或账号权限。视频/语音/流式、GUI/HTTP服务另行实现，不伪造支持。
