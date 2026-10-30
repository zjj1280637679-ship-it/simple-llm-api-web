# 文档入口

第一次使用从 [首页三步开始](../README.md) 进入；不需要先阅读开发态理论或验收报告。

| 想做什么 | 从这里开始 |
| --- | --- |
| 配置 API、对话、图片、CLI 或部署 | [使用与接口参考](USAGE.md) |
| 理解“最后一项才可交互”或新增卡片 | [交互卡协议](INTERACTION_CARDS.md) |
| 看代码职责与状态归属 | [工作台模块](WORKBENCH_MODULES.md) |
| 理解目标、条件、策略与证据为何分开 | [认识论设计](../design/EPISTEMIC_DESIGN.md) |
| 查找已登记模块、版本和最简宿主 | [模块目录](../module-library/README.md) |
| 看哪些路径真正跑通过 | [实网验收表与执行步骤](LIVE_ACCEPTANCE.md) |
| 运行本地验证、查看证据范围 | [验证入口](../VALIDATION.md) |
| 让 Agent 按课题理解当前版本 | [知识图](../knowledge/README.md) |
| 探索网页会话控制（实验性） | [实验功能范围](EXPERIMENTAL.md)、[会话 CLI](../WEB_SESSION.md) |
| 了解本机保存与旧存档迁移 | [保存说明](LOCAL_PERSISTENCE.md) |

## 仓库目录各负责什么

| 目录 | 内容 | 什么时候读 |
| --- | --- | --- |
| `src/` | 网页生产实现 | 修改行为 |
| `cli/` | 图片 CLI、页面会话 CLI 与可选 MCP 传输 | 终端使用或连接宿主 |
| `docs/` | 使用、设计接口、契约及专项记录 | 按上表定位 |
| `design/` | 目标模型、决策依据及原始设计 | 判断为什么这样做 |
| `module-library/` | 模块索引与维护规则 | 复用或登记模块 |
| `development/` | 可运行的最简宿主、有限模型及验证证据 | 独立验证一个课题 |
| `knowledge/` | 绑定提交的知识快照和查询工具 | 快速导航与检查资料漂移 |
| `tests/` | 组合与回归测试 | 验证改动影响 |
| `qa/` | 可选浏览器检查脚本 | 查看具体脚本的执行条件；存在不等于已跑过 |
| `scripts/` | 构建和仓库检查 | 维护工具链 |

契约放在 `docs/contracts/`，其索引放在 `module-library/catalog.json`，真实宿主放在 `development/hosts/`；三者分别描述、定位和执行同一个模块，不复制生产实现。

v0.4.0 把原根目录三个 CLI 文件移入 `cli/`。终端示例按仓库根目录执行，旧 `node cli.mjs` 路径需改为 `node cli/cli.mjs`。
