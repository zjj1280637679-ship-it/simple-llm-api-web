# Agent 项目入口

本项目是原生 ES modules 的静态 BYOK AI 工作台。目标是以少量必要操作组合 AI 能力，并保留条件、效果及证据的可解释性。产品目标、实现事实和验收范围分别阅读。

## 快速进入

1. 读 [知识图入口](knowledge/README.md) 与 [当前快照导览](knowledge/snapshots/v0.2.0-70290ba6f00b/README.md)。当前指针以 [current.json](knowledge/current.json) 为准。
2. 运行 `node knowledge/check.mjs`。MATCH 只表示被记录文件和本地内容一致；DRIFT 列出变化，历史快照仍可参考，当前结论需重读变更来源。
3. 用 `node knowledge/query.mjs route <主题>` 找到源码、条件文档、宿主及测试。修改某文件前可运行 `node knowledge/query.mjs impact src/persistence.js` 辅助定位消费者；动态注入和事件关系仍需人工检查。

## 按任务选入口

| 任务 | 路由 |
| --- | --- |
| 目标、约束、奖励/惩罚与开发态理论 | `model` |
| 状态归属、生命周期、模块库 | `ownership` |
| 供应商、地址、鉴权、错误、日志 | `transport` |
| 文本流、工具循环、网页会话命令 | `conversation` |
| 思考模板及其证据 | `reasoning` |
| 图片参数、生成与交付 | `image` |
| 保存、导入导出、原生上下文保真 | `storage` |
| 附件、指标、布局、资料、发布 | `attachments` / `metrics` / `layout` / `catalog` / `validation` |

## 判断与变更

- [开发态模型](design/DEVELOPMENT_MODEL.md)规定要达到的理想；[决策记录](design/DECISIONS.md)解释当前场景的策略及替代方向。实现范围、未知值、偏好与必要条件各有语义；限制需带目标和触发条件。
- 当前行为从对应源码、契约及针对性观察确认；历史研究按其日期/提交读取。遇到冲突，指出涉及的文件、版本和不同命题，再决定修改；不以某份摘要替代全部证据。
- 模块及宿主的身份以 [catalog](module-library/catalog.json) 和具体契约为准。14 个本地宿主通过不代表全仓原子化或 F/C/H/Q 完成。完整形式证明、成功替代途径池及阶段投影等效性仍有独立义务。
- 对已登记构件的效果、接口或宿主改变，按 [维护规则](module-library/README.md)更新相应版本、时间、反例与证据。生产构建白名单之外的知识维护可单独验证。
- 验证命令及边界见 [VALIDATION.md](VALIDATION.md)。本地测试使用合成条件；真实模型实验另需明确目标、资源及授权范围，当前知识整理不会发起真实调用。

## 快照维护

知识图是带来源身份的导航，未实现为产品业务逻辑。项目变更后按照 [更新规则](knowledge/README.md#更新快照)生成新的快照；阶段是否改变仍由需求/条件漂移判断。用户当前指令优先，不由本文件额外引入审批或多人流程。
