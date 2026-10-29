# 凭据容器与使用边界

更新：2026-10-29。本文只描述存放位置和授权使用方式，不含任何真实密钥。文档或 `.env.example` 的提交不会创建 GitHub Secret；容器是否已写入，须另行核验 GitHub 中的名称和更新时间，不能用占位值冒充配置成功。

## 目标、条件、策略、验收

- **目标**：把凭据与公开源码、静态站点和日志分离，让用户及经授权的程序、CI 或 Agent 在指定范围内复用。
- **条件**：具备该仓库的 Secret 管理权限；密钥具有目标产品/模型权限；实际调用仍需相应额度与用户授权。
- **策略**：仓库级 GitHub Actions Secret 保存生产凭据；浏览器保留现有内存 BYOK；需要服务端或 CI 消费时再显式接线，不把当前实现选择固化为“只能人工”或“只能某个 Agent”。
- **验收**：先确认容器元数据存在，再单独验证授权消费者。**有 Secret ≠ 已接入网页 ≠ 已获准调用 API ≠ 该模型必定可用。**

## 仓库容器

目标仓库：`zjj1280637679-ship-it/simple-llm-api-web`。

| 名称 | 类型与用途 | 当前消费状态 |
| --- | --- | --- |
| `ARK_API_KEY` | Repository Actions Secret；普通 Ark API 的 Bearer 凭据 | 当前 Pages 工作流**未引用或注入**此 Secret |
| `VOLC_SPEECH_API_KEY` | 可选、独立命名的语音产品凭据；有语音接入需求后再配置 | 当前项目未实现语音调用，也未消费此变量 |

可以经授权通过 GitHub **Settings → Secrets and variables → Actions → New repository secret** 创建或更新；也可以使用受信任的 GitHub CLI/加密 API 流程。避免把值放在 shell 命令参数、聊天记录、截图或文件提交中。创建后的验收只需检查名称、更新时间及授权范围，无需把原值回显。

GitHub Secret 必须在工作流中明确引用才会交给该任务。当前 `.github/workflows/pages.yml` 只运行离线测试、构建和发布，没有读取 `ARK_API_KEY`。以后增加消费者，应限制任务权限与触发来源，明确请求目标、模型、次数/预算，并避免在日志或 artifact 中输出凭据；自动遮罩不是对所有编码变体的泄漏保证。[GitHub Secret 使用文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[GitHub Secret 安全说明](https://docs.github.com/en/actions/concepts/security/secrets)。

### Ark 与语音凭据不是自动互换

语音服务单独配置 `VOLC_SPEECH_API_KEY`，不要因为已有 `ARK_API_KEY` 就自动向语音目标发送它。官方 IAM API Key 可以在**明确授予相应产品权限**时用于跨产品访问，所以也不能断言两类凭据永远不兼容。应逐个核实产品权限、请求头和资源标识；是否复用同一底层凭据是授权策略，而非由变量名推断。[火山 IAM API Key 最佳实践](https://docs.volcengine.com/docs/ark/iam-api-key-best-practices?lang=zh)。

## 静态 Pages 的关键边界

GitHub Pages 向浏览器交付公开的 HTML/CSS/JavaScript，没有能保管服务端密钥的运行环境。**不能把 Actions Secret 在构建时替换进 JS、HTML、公开配置、source map 或 Pages artifact**；这样会将密钥发给访问者，而不是建立安全的网页连接。

目前网页仍由用户或经明确授权的页面操作在 API 设置中填入密钥，只在该页内存使用。仓库 Secret 不会自动出现在网页中，也不为网页提供安全的 Secret 读取接口。若以后要从仓库/部署密钥容器驱动应用，应另行实现可信服务端消费者，带访问控制、固定上游范围及请求预算；是否采用该方案需单独决定，而不是偷偷添加共享网关。

## 本地环境示例

仓库提供 [`.env.example`](../.env.example)：所有凭据字段为空，其他内容只有非秘密参考值。`.gitignore` 已忽略 `.env`、`.env.*`，仅允许提交 `.env.example`；Pages 构建采用生产文件白名单，不复制这些环境文件。

- 实际值可来自授权的环境变量、受信任的密钥管理器或被忽略的本地环境文件，不要求唯一操作人或唯一注入工具。
- 当前图片 CLI 只读取 `ARK_API_KEY` 或 `GEMINI_API_KEY`；不会自动加载 `.env.example`，不会用一个供应商的 Key 回退另一个。
- 示例中的 `ARK_BASE_URL`、`ARK_TEXT_MODEL`、`ARK_IMAGE_MODEL` 是配置参考，**不是当前 CLI 自动读取的开关**。图片 CLI 仍用 `--endpoint`、`--model` 等参数；网页模型配置也独立保留。
- 示例文件中列出的模型是当前实现预设，不保证等同最新选型建议。请看 [当前模型目录](ark-model-catalog.md)，并保留“文档推荐”“代码支持”“账号权限”“真实验证”的区别。

## 轮换、撤销与后续验证

发现意外提交或对外暴露时，先在供应商侧撤销/轮换，再更新容器；删除文件或清理历史不能使已经泄漏的密钥重新安全。清理浏览器内存与导出日志时也要考虑旧值。

后续使用容器做真实测试，应单独记录所用消费者、目标、模型、时间、结果和费用边界，不记录凭据原文。单次成功只证明该次路径可用，不证明所有文本、图片、视频或语音模型及所有环境均可调用。
