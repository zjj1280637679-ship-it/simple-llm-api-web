# 知识图数据约定 1.0.0

这是仓库知识导航格式，不是生产协议或形式证明语言。

| 层 | 字段与语义 |
| --- | --- |
| 指针 | `current.json` 的 `graph` / `guide` 是相对 knowledge 目录的路径；绑定 snapshotId、sourceCommit、projectVersion、knowledgeVersion |
| 快照身份 | `snapshotId`、`createdAt`（带时区）、`source.repository/ref/commit/tree/projectVersion`；commit/tree 才是冻结身份，ref 只表示采集来源 |
| 节点 | `id/kind/label/status/refs`；文件另有 `path/bytes/gitBlobSha/sha256`；模块包含 module、host、gates、conditions、tests、limits |
| 关系 | `id/source/relation/target/refs`，必要时另有 basis、scope、value；source/target 必须存在 |
| 来源 | `refs[].path/gitBlobSha` 指向冻结清单中的源文件；可附 1 起始行号 `line` 和逐字 `anchor`。无行号表示整文件或结构化记录 |
| 路由 | `readingRoutes[].read/inspect/verify` 分别为条件文档、实现位置、应阅读的测试；verify 不是执行结果 |
| 数量 | `counts` 是实际节点/边计数，检查器复算，不是质量指标 |

主要节点种类：file、project、module、host、concept、evaluation-shape、dimension、gate、decision、topic、flow、evidence、boundary、candidate、source-claim。

主要陈述类型：`snapshot-file` 为冻结文件；`source-derived` 为源码梳理；`catalog-declaration` 为契约登记；`recorded-observation` 为带范围的观察记录；`historical-report` / `historical-candidate` 为旧记录/候选；`design-intent` 为目标；`current-policy` 为当前策略；`open-obligation` 为未完成义务；`document-discrepancy` 为已定位口径差异；`navigation-index` 为阅读分类。每种类型都需要原始来源，不能单凭标签提升为已证明。

| 关系 | 解释 |
| --- | --- |
| `references_import` | 有行锚点的静态 import / re-export 字面引用；不代表执行到或完整依赖关系 |
| `implemented_by` / `specified_by` / `has_host` | 模块/宿主到唯一实现、契约、最简宿主的登记关系 |
| `declares_test` / `inspect_test` | 契约或主题列出的测试位置，不代表覆盖充分或此次已执行 |
| `checks_abstract_properties_of` | 有限模型直接检验对应生产纯函数的特定性质；抽象、实现、宿主对应仍保留范围 |
| `has_output` / `fingerprints` / `records` | 证据记录的命令输出、输入身份、宿主观察 |
| `guides` / `distinguishes` / `includes_dimension` / `requires` / `has_gate` | 理论和验收关系；不是代码已实现相应机制 |
| `uses_policy` / `has_boundary` / `references_candidate` | 当前策略、范围、历史候选，不自动继承候选能力 |
| `documented_in` / `inspect_implementation` / `traverses` / `concerns` | 人工阅读索引、流程经过位置、外部资料对应对象 |

`gates` 的 UNKNOWN、宿主的 localStatus=PASS、HTTP 状态、completion=unknown、工作区 delivered 和用户目标是不同命题。查询工具原样保留这些字段，不把它们合成为一个“成功率”。

所有 path 均相对仓库根目录；可用 `https://github.com/<repository>/blob/<source.commit>/<path>#L<line>` 定位冻结来源。读取当前工作区同路径前先检查漂移。

`check.mjs` 检查本格式的基本结构、引用和本地指纹；它不是 JSON Schema 通用验证器，也不验证理论语义、所有关系的完备性或远程服务。
