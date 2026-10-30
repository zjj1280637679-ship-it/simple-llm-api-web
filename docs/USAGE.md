# 使用与接口参考

v0.4.0。首次使用见 [项目首页](../README.md)，交互规则见 [交互卡](INTERACTION_CARDS.md)。本文保留详细参数、部署和带日期的历史验收说明。

## 已实现

- **对话**：Gemini 原生、OpenAI 兼容、火山方舟普通 API、Anthropic Messages 文本流式。初始文本模型保留 `gemini-flash-lite-latest`；选择 Ark 后使用 `doubao-seed-2-1-lite-260915`，也可手填账号已开通的文本模型。
- **图片**：保留 Gemini Nano Banana 2.1 的 14×3 矩阵；新增 Ark Seedream 5.0 Flash/Pro 的 8×3 矩阵（`1K / 1.5K / 2K`，默认 2K）。显示 API 实际返回的图片，可下载。
- **配置**：两页分别保留内存中的 API 配置；无配置时先输入消息会出现配置卡片，填好后再次发送，不重复追加同一条待发送消息。
- **模型列表**：Gemini/OpenAI/Anthropic 在点击拉取时应用当前填写配置，调用所选地址的 `/models`，Gemini 取最多 1000 条的第一页。普通 Ark 的 Bearer 模型列表契约尚未核实，因此明确使用预设/手填，不伪装拉取。
- **Agent → 图片工作台**：模型的 `image_generate` 函数调用映射到受控 `image.generate` 命令。网页直接生成、Agent 工具、Node CLI 共用 `src/core.js` 的同一个 dispatcher / image generation core。每次生成前显示地址、模型、提示词与尺寸，确认后才发送。
- **请求状态**：防重复点击，取消请求，不自动重试。已到达供应商的请求即使取消也可能计费。
- **本机保存**：IndexedDB 保存对话、草稿、附件、模型设置及指标；API Key、目标确认和自动通讯日志不持久化；主动插入的日志快照作为卡片随历史保存。失败会显示状态，详情见 [保存边界](../docs/LOCAL_PERSISTENCE.md)。
- **通讯日志**：在 fetch 调用边界记录地址、方法、脱敏头、请求/响应、状态和耗时，可导出 JSON。当前来源标签依据传输函数选择，不能单独证明发生过真实网络请求。
- **网页会话命令**：`window.llmWorkbench` 和 WebMCP 提供七个受控命令，独立 `cli/web-cli.mjs` 通过用户授权的浏览器宿主调用；不会启动任意 shell 或绕过网页确认。

不将网页模型输出作为 HTML、JavaScript 或 shell 执行。CLI 是可用的独立 Node 入口；浏览器内的 Agent 调用受控 JS 命令分发器，**不会启动操作系统 shell**。

## 本地运行

需要 Python 3；验证及 CLI 需要 Node.js 20+。网页、图片 CLI 和合成测试无 npm 依赖；可选的真实网页 MCP 连接需要另行安装/授权浏览器宿主及 MCP SDK，见 [WEB_SESSION.md](../WEB_SESSION.md)。

```sh
python3 -m http.server 8000
# 打开 http://localhost:8000
npm test
npm run check
node cli/cli.mjs --help
```

必须通过 HTTP(S) 打开，不能直接双击 `file://`（浏览器 ES module 限制）。

## Gemini 配置与配额

在自己的 [Google AI Studio](https://aistudio.google.com/) 管理 API Key、模型权限与项目配额。代码初始模型为 `gemini-flash-lite-latest`，这是实现预设，不是实时选型建议。是否有免费额度及是否计费以当前账号/项目配置为准；网页不负责开通 Billing。

图片预设 `gemini-nano-banana-2.1` 需要目标项目支持。早期检查记录的图片配额为 0，未做该路径真实验收；这不表示当前账号仍为零。图片确认提示表示可能消耗额度，不承诺免费可调用。

## 火山方舟普通 API（文本＋图片）

在任一工作区 `+ → API 设置 → 供应商` 中选择 **火山方舟 · 普通 API**。两页各自填写普通 Ark API Key，发送时应用当前目标，不会自动复制另一页的密钥。

- 基础地址：`https://ark.cn-beijing.volces.com/api/v3`，**不是** `/api/plan/v3`，不使用 Agent/Coding Plan Key。
- 文本：`/chat/completions`；预设 `doubao-seed-2-1-lite-260915`。完整保留模型工具消息及 `encrypted_content`；输出预算使用 `max_completion_tokens`，不与 `max_tokens` 同发。
- 图片：`/images/generations`；预设 `doubao-seedream-5-0-flash-260915`，可手填 `doubao-seedream-5-0-pro-260628`。图片预设只覆盖这两个明确模型，不猜测未知 `ep-` 接入点的能力。
- 比例矩阵转成精确 `WxH`，不发送虚构 `aspect_ratio`。1.5K/2K 使用官方参考尺寸，1K 为已校验面积/比例范围的应用预设，界面明确区分。
- 请求 `b64_json + png`，没有组图、流式或联网搜索。若上游仅返回 URL，会明确提示尚未下载、生成可能已计费；不向图片链接附加 Key、不盲目下载、不自动重试。

**已完成一条严格限定的真实图片验证**：2026-10-29 04:50–04:53 UTC，公开工作台对 `doubao-seedream-5-0-flash-260915` 发起一次请求，返回 HTTP 200；2048×2048 PNG（4,788,089 字节）已在网页渲染并下载。页面耗时 18.9 秒，通讯日志 18,335 ms。这证明当时该页面、账号与图片请求路径可用，**不代表所有模型或环境的 CORS/权限/额度均已验证**。

目前仓库可追溯记录尚不足以验收所有文本、Agent 调图、终端图片 CLI 和终端网页会话 CLI 路径；不能由此断言用户从未成功调用。详情见 [VALIDATION.md](../VALIDATION.md)。官方接口集成摘要保存于 [docs/ark-api.md](../docs/ark-api.md)。

## 当前模型选型与凭据容器

- [普通 Ark 模型目录快照](../docs/ark-model-catalog.md)（[机器可读 JSON](../docs/ark-model-catalog.json)）：按文内核验日期记录生命周期与实验候选，采用前复核当前模型条件。
- [凭据容器说明](../docs/credentials.md)：目标是仓库 Actions Secret `ARK_API_KEY`；语音可独立使用 `VOLC_SPEECH_API_KEY`。创建、消费和真实调用是分别验收的步骤。
- [空环境示例](../.env.example)：不含密钥，不会自动导入浏览器或 CLI。

**当前 Pages 工作流不消费 `ARK_API_KEY`。** 将它存为 GitHub Secret 不会给静态网页增加安全的服务端密钥能力；不能把 Secret 编进公开站点。本文档不冒称容器已经写入，具体操作结果需另行核验。

## API 设置

点输入框左下角 `+ → API 设置`，或直接输入一条消息后发送。

| 字段 | 说明 |
| --- | --- |
| API 地址 | 通常填写基础地址。Google：`https://generativelanguage.googleapis.com/v1beta`；OpenAI：`https://api.openai.com/v1`。文本 Chat 也识别末尾 `/chat/completions`，不会重复追加；拉取模型仍需基础地址。 |
| 供应商与格式 | 预设自动绑定地址与协议，不再单列协议字段；自定义 Gemini / OpenAI / Anthropic 格式提供空白地址、密钥及模型 ID，不保证第三方实现全部字段。 |
| API Key | 用户自己的密钥，仅在当前页面内存中保存。可显示/隐藏及清除，刷新或关闭页面即丢失。 |
| 模型 ID | 文本默认 `gemini-flash-lite-latest`；图片初始为 `gemini-nano-banana-2.1`；Ark 选择后使用上面的 Lite/Flash 预设。自定义文本模型须与所选协议兼容。 |
| 当前目标地址 | 点击发送或拉取模型时应用当前配置；填写本身不发送。更改地址或协议清除旧密钥，删空密钥即时清除。 |

两页的配置彼此独立；可在两页填同一个用户密钥，但不会自动跨页复制。API Key 不保存到 localStorage、sessionStorage、Cookie、URL、历史卡片或日志。卡片中的密钥输入框属于当前页面内存/DOM，浏览器扩展仍可能访问页面；请只使用可信浏览器与可信上游。

当前公共网页传输策略接纳公开域名的 HTTPS 基础地址，暂不接纳含账号/密码、查询参数、片段、IP、本机或内网名称的地址，也不自动跟随重定向。这是当前宿主范围；本机模型可另建有明确网络与凭据边界的宿主。地址检查不等于供应商可信认证，也不替代 DNS/网络策略。

浏览器直连要求上游允许 **CORS**，包括 `x-goog-api-key` 或 `Authorization` 请求头。网络/CORS 错误无法由静态站点绕过；不要把密钥转发到不认识的“免 CORS”代理。如果上游只接受服务端调用，请自行配置可信后端；本项目不提供共享代理。

### 模型设置及边界

- 对话支持输出 Token、温度、Top P 和可选思考模板；未指定字段保留上游默认（Anthropic 的 max_tokens 默认为4096）。已提交上下文按本机保存策略恢复，密钥需重填；不自动压缩上下文。切换协议会从新的模型上下文开始，旧界面历史仍可见。
- OpenAI 映射为 `max_completion_tokens / temperature / top_p`；部分兼容服务或模型不支持全部字段，留空或按服务文档配置。
- 图片生成适配 **Gemini Nano Banana 2.1** 和 **Ark Seedream 5.0 Flash/Pro**；通用 OpenAI 图片接口、Anthropic 图片生成、图生图编辑和批量生成尚未接入。对话已支持流式及按协议划分的附件输入，见 [附件范围](../docs/attachments.md)。这些范围不代表供应商全产品能力。
- 图片固定一次调用，以供应商实际返回的格式下载，不做本地转码。Ark 请求 PNG；预设像素不是对实际输出尺寸的本地验收保证，1K 的应用预设并非官方像素表。
- API 模型名可变，拉取列表不代表账号拥有该模型的生成权限。**免费额度、项目配额、地区、计费激活及模型可用性均由供应商决定**，本项目不承诺某模型可免费调用。
- Agent 工具需文本模型支持 function calling；先在图片页填好并确认图片 API，才向文本模型开放工具。工具向对话返回图片参数、数量、格式及供应商文字，不把图片字节送回文本模型做视觉检查。每轮有有限工具调用次数，无任意命令执行。拒绝确认不会生成图片。

## 通讯日志与网页会话控制

「日志」页面保留最多 100 条内存记录，可展开查看或导出。日志在 fetch 调用前后生成：网络失败记录为未取得响应。当前 `source` 根据 global/injected fetch 判断；替换全局 fetch、注入真实 transport 时不可靠，不能作为真实验收证据。已登记凭据及已识别敏感字段按规则脱敏，图片数据省略，大文本截断；这不保证识别任意秘密。HTTP 错误体最多读取 8 KiB、等待 1.2 秒；只保留脱敏后的 message/code/type/request_id，并标为上游说明、未独立核实。宿主可通过 declareTransport 绑定传输来源声明；声明本身也不是实网证明。导出仍可能包含私人对话。

七个网页命令为 `session.state / session.logs / page.navigate / settings.update / draft.set / request.send / request.cancel`，操作当前已连接的真实页面内存状态。状态不返回密钥；MVP 不提供 endpoint/Key/trust setter。每次工具发送都需要网页内用户确认，图片生成确认仍保留。

```sh
node cli/web-cli.mjs --help
```

真实 CLI→浏览器连接需要用户已安装、明确授权并选择的浏览器宿主；本次只完成代码和无网络合成测试，**没有验证真实浏览器宿主闭环**。普通浏览器未提供 WebMCP 时不会假装注册成功。详细安装/连接方式及权限边界见 [WEB_SESSION.md](../WEB_SESSION.md)。

## Node 图片 CLI

```sh
node cli/cli.mjs --help
# 在你的本机安全设置 GEMINI_API_KEY 后，再运行：
node cli/cli.mjs image.generate \
  --prompt '雨夜的未来都市，电影摄影风格' \
  --endpoint https://generativelanguage.googleapis.com/v1beta \
  --model gemini-nano-banana-2.1 \
  --aspect-ratio 16:9 --image-size 2K \
  --out ./output/city --yes
```

Ark 使用单独环境变量与同一 dispatcher：

```sh
# 在本机安全设置 ARK_API_KEY 后：
node cli/cli.mjs image.generate --protocol ark \
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

生产文件清单由 `scripts/build.mjs` 定义，`tests/build.test.js` 检查产物与相对依赖。当前为 42 个文件；开发规格、宿主、测试与文档不进入站点产物。

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

构建为 CSS/JS 入口及全部相对模块引用加入一致的内容哈希版本；不下载依赖、不读取环境密钥。工作流参考 [GitHub 官方 Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。候选 PR 的 `review.yml` 只检查，不部署；main 的 Pages 发布另行运行。
CSS/JS 均使用相对路径，兼容 `https://<owner>.github.io/<repository>/`。GitHub 私有仓库的 Pages 可用性和访问范围依账号计划/组织设置而定；启用前检查站点是否会公开。**不要在页面、配置或提交中放共享 API Key。**

若 GitHub 要求重新登录或 2FA，应由账号持有人完成，不能通过代码绕过。代码提交成功不等于 Pages 已部署成功。

## 文件与验证

```text
index.html              生产入口（真实 transport，无模拟回复）
src/app.js              浏览器启动入口
src/workbench.js        显式 ready/dispose 的工作区组合
src/canvas-geometry.js  视口、焦点、菜单和诊断订阅的独立所有者
src/view-position.js    各标签阅读位置与过期回调隔离
src/request-lifecycle.js 请求阶段、计时与取消生命周期
src/workspace-storage.js 先水合后写入、日志与快照协调
src/image-delivery.js   解码、实际尺寸、下载保留和 URL 释放
src/usage.js            可追溯用量归一化与缓存/末次输入指标
src/attachments.js      本地附件校验、预览与协议部件转换
src/core.js             协议/业务 facade、文本/图片核心、typed dispatcher
src/request-transport.js HTTP/流、取消、脱敏日志与凭据观察
src/api-target.js       当前公共网页目标和凭据绑定策略
src/completion-*.js     结束证据解释与入口接纳策略
src/image-evidence.js   图片效果坐标与宿主回执
src/request-outcome.js  控制流返回与独立效果投影
src/native-json.js      有界原生 JSON 数据保真复制
src/provider-identity.js 供应商/协议/路径的本地规则匹配
src/image-capabilities.js 按 provider/model 分离的图片能力与尺寸
src/logs.js             脱敏、限量的内存通讯日志
src/session*.js         受控网页会话命令及可选 WebMCP 注册
src/agent.js            模型 function call ↔ dispatcher ↔ 模型结果循环
cli/cli.mjs             Node CLI（同一 dispatcher）
cli/web-cli.mjs         真实页面命令 CLI（需要授权浏览器宿主）
cli/cli-mcp-transport.mjs 可选标准 MCP 传输，不自动安装或连接
docs/ark-api.md         官方 API 来源与版本化集成摘要
docs/ark-model-catalog.md 带日期的历史模型目录与复核条件
docs/credentials.md    密钥容器、授权消费者与静态站点边界
.env.example           空凭据字段与非秘密参考默认值
scripts/build.mjs       生成 42 个白名单生产文件，带内容哈希资源版本
development/hosts/      独立最简测试宿主与可追溯本机报告
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

本适配采用 GenerateContent。Interactions 等其他协议是独立适配候选，请按各自入口映射字段，不直接混用请求体。

响应式与悬浮导航验证见 [布局说明](../docs/floating-navigation.md)；缓存命中、末次输入与未知值语义见 [用量说明](../docs/USAGE_METRICS.md)。

状态动画与客户端截止、缓存版本方案详见 [请求状态说明](../docs/loading-status.md)。

供应商菜单说明：[格式选择](../docs/provider-formats.md)。Anthropic 请求头、原生流事件与能力边界：[Messages 适配](../docs/anthropic-messages.md)。

## 本机刷新恢复

对话、草稿、附件、模型设置和独立指标自动保存到当前网站路径的 IndexedDB；API Key/目标确认与通讯日志不保存。失败/配额不足/多标签页冲突会明确提示，不会静默删附件或覆盖其他标签页。+ 菜单可查看状态、导出和恢复本地备份。浏览器清理、无痕结束或系统回收空间仍可能丢失数据，详见 [本机持久化说明](../docs/LOCAL_PERSISTENCE.md)。

当前开发态库与维护规则见 [模块图书馆](../module-library/README.md)，状态归属见 [组合说明](../docs/WORKBENCH_MODULES.md)。运行 `npm run hosts` 检查全部 26 个独立宿主；`npm run review:sources` 输出资料复核状态，不据此宣称模型可用。
