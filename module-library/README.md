# 构件图书馆

按**效果目标**收藏功能、关系和组合，供开发态检索、实验和组合。生产构件继续借用 src/ 的唯一源码；共享模拟引擎的普通 F/R 构件则在本库入口内拥有唯一实现。旧 shared 路径仅为兼容转发，不算另一条实现途径。

**模块库提供候选，不是宿主的必选依赖。** 入库或合并只让候选可检索；是否借用、如何组合以及是否接入生产，分别由目标、当前条件和对应验收决定。未采用的候选可以继续保留。见 [候选借用与验收](BORROWING.md)。

日常操作遵循 [维护规则](MAINTENANCE.md)：入库、升版、依赖与配方、证据失效、隔离、弃用和归档。维护状态独立于验证等级。

每个模块现已绑定 [最简测试宿主](hosts/README.md)：提供实现其直接、间接或关系性效果所需的最小环境、输入和结果承接。宿主有独立版本及创建/更新时间，验证记录同时绑定模块与宿主修订。

## 分类目录

| ID / 类别 | 构件契约 | 局部实验范围 |
| --- | --- | --- |
| F-001 / 功能 | [图片能力与参数映射](functions/image-options/CONTRACT.md) | 默认值、选项映射、拒绝未知型号与不支持尺寸 |
| F-002 / 功能 | [文本请求与协议适配](functions/text-generation/CONTRACT.md) | 合成请求、协议历史、错误、取消 |
| F-003 / 功能 | [图片请求与响应提取](functions/image-generation/CONTRACT.md) | 合成请求、字节提取、签名、异常响应 |
| R-001 / 关系 | [图片命令到执行器](relations/image-command/CONTRACT.md) | 未确认零发送、确认后路由、参数责任 |
| R-002 / 关系 | [网页命令到处理器](relations/page-session/CONTRACT.md) | 命令绑定、确认与失败；相关页面 VM 用例 |
| F-004 / 功能 | [fixture 请求契约](functions/fixture-contract/CONTRACT.md) | 纯参数绑定、精确请求比较、字段脱敏 |
| F-005 / 功能 | [有界 PNG 检查](functions/png-inspection/CONTRACT.md) | CRC/zlib/尺寸边界，不评价图像内容 |
| R-003 / 关系 | [有序模拟会话](relations/simulator-session/CONTRACT.md) | 接纳次序、交付、取消/处置、实例状态隔离 |
| R-004 / 关系 | [配置修订与历史](relations/configuration-profile/CONTRACT.md) | 私有 adapter、哈希历史、固定快照和 reset |
| C-001 / 组合 | [Agent 图片对话轮次](compositions/agent-image-turn/CONTRACT.md) | 工具往返、同轮去重、取消、上下文保存 |

这些属于**局部验证架**，完整开发态准入仍未完成。使用命令确认当前证据是否仍匹配源码。

| 区域 | 用途 |
| --- | --- |
| [catalog.json](catalog.json) | ID、类型、目标、标签、入口、契约、测试、四项准入 |
| [场景草案](scenarios/workbench-v1.json) | 需求、条件、观测、奖罚通道与漂移判据 |
| [组合配方](recipes/agent-image-turn.json) | 组合成员、关系归属与整体义务；尚未完整准入 |
| [证据](evidence/) | 本地实验指纹与范围受限的历史真实观测 |
| [模板](templates/) | 新构件登记与契约 |
| [后续实验](experiments/README.md) | 未闭合的局部效果和候选途径 |

## 检索与借用

在仓库根目录的命令行运行：

```sh
npm run modules:list
npm run modules:list -- --kind relation
npm run modules:list -- --tag image
npm run modules:list -- --query image-options.normalize
npm run modules:list -- --lifecycle candidate
npm run modules:host -- R-002
npm run hosts:verify
npm run modules:check
npm run modules:verify
```

- list：按类型、标签、目标、名称或维护状态检索，逐项展示版本、时间、局部证据和 F/C/H/Q。
- check：检查模块和宿主登记、版本绑定、文件、配方引用、证据指纹，不运行 API。
- verify：重跑登记的本地测试并检查证据匹配，不写记录。
- record：评审变更后运行 `npm run modules:record`；逐个运行模块 `tests` 必需文件，只有每个文件非空、所有用例/套件完成且无失败、取消、skip、todo，期间输入未变，才原子刷新 schema 5 本地证据。失败不覆盖旧记录。

记录保存逐文件源码哈希、完成计数、结果摘要和模块归属；共享测试按声明归属多个模块，不做用例级独占声明。空文件自动包装 PASS 不算实际用例。旧 schema 证据仅显示 STALE，须真实重跑迁移。可选 MCP 测试未进入必需清单，其 skip 不阻止这一局部门禁。结构化证据需带源码位置的 Node 测试事件；早期 Node 20.x 缺字段时失败关闭，本次用 Node 24.22.1 验证。详见 [维护规则](MAINTENANCE.md)。

源码、测试、契约、目录、场景或追踪依赖改变，旧证据显示 STALE。首版保守地对整个收录批次失效，避免漏掉共享依赖。范围见 scripts/module-library.mjs；字面量相对 ESM 导入会继续追踪，动态计算依赖和外部运行环境需人工登记验收。指纹是可追溯检查，不是防伪签名或证明检查器。

直接使用单个构件，无需全局注册器：

```js
import { normalizeImageOptions } from './module-library/functions/image-options/index.js';
const options = normalizeImageOptions({
  protocol: 'ark',
  model: 'doubao-seedream-5-0-flash-260915'
});
// options.size === '2048x2048'：请求预设，不是生成结果的实测尺寸。
```

跨项目借用要携带入口、规范源码及依赖、契约和证据，重新确认宿主条件。生产借用入口只复制 index.js 不能独立运行；F-004 等无相对导入的实现可以在满足契约的消费者最简环境中单独借用，具体看依赖闭包及实验。当前没有统一独立 npm 包。生产 src/core.js 内部职责尚未全部物理分离，共享生产日志也不是独立状态。共享模拟器此次仅抽出边界清晰的 4 块：F-004/F-005 无共享可变状态；R-003 每会话独占状态；R-004 显式捕获 adapter/namespace/目录。配置算法保持同一修订契约的私有辅助，不为每个 helper 建小块。

## 模块版本与时间

每个模块在 catalog.json 中维护自己的版本，不与仓库 package.json 的版本绑定。

| 字段 | 含义 |
| --- | --- |
| id | 稳定身份，例如 F-001；升级时保持不变 |
| version | 三段版本号，例如 0.1.0 |
| createdAt | 构件首次入库时间，升级时保留 |
| updatedAt | 本次模块登记、契约或实现更新的时间 |
| 证据 recordedAt | 本地实验实际完成的时间，与模块更新时间分开 |

首批六个生产借用模块沿用契约已有的 0.1.0；后入库的四个共享模拟模块独立从 0.1.0 开始。创建时间取首次入库提交的时间；此次补充版本管理字段，更新时间取本次编辑时间。时间以 UTC ISO 8601（含毫秒、以 Z 结尾）保存，列表按北京时间显示。模板时间为 null，新增模块时需填写真实时间，可用 JavaScript 的 new Date().toISOString() 取得。

版本策略及维护状态以 [维护规则](MAINTENANCE.md) 为准。升级保留 createdAt，版本和 updatedAt 不倒退；只重跑测试只产生新的证据 recordedAt。依赖与配方固定准确版本，更新依赖后重新验收使用者。

验证记录的 moduleRevisions 和 hostRevisions 分别绑定模块与宿主的 ID、版本、创建及更新时间，宿主还固定被测模块和实验模式，同时保留源码指纹。旧版本的 PASS 不会自动传给新版本；任一绑定变化会显示 STALE。旧版本和时间可通过 Git 历史追溯，record 不自动改版本、时间或四项准入状态。

## 验证等级

**局部 PASS**只表示记录中的本地实验通过且指纹匹配。纯函数确实在本机执行，网络由合成 fetch 提供；不由此推出外部 API 可用。

**完整准入**需要 F 形式证明、C 客观条件、H 同目标途径距离、Q 最低真实效果及组合验收。PASS 登记必须带证据路径；目录检查器只检查登记和引用，不判断证明本身正确。证明方法、预算、信任基和真实条件仍要各自验收。当前十个构件均不宣称完整准入，record 不自动提升任何 gate。

[历史 Ark 观测](evidence/reported-ark-image.json)仅转录仓库已有记录：北京时间 2026-10-29 12:50–12:53，一次网页 Flash 图片成功。本轮建库未重跑该 API，不推广到其他模型或 Agent/CLI，也没有从该记录确定当时部署的源码 commit。

## 入库与组合

1. 固定目标与观察范围，检索已有目标。按效果归类，不按按钮或供应商重复造目标。
2. 用模板登记输入输出、条件、状态、副作用、错误、最低效果与限制。
3. 提供独立入口，保留唯一实现源。功能和关系都需要独立验收。
4. 用能够区分成败的实验验证，并把反例保存为用例；运行 record 后提交证据。
5. F/C/H/Q 分别取证，未决定的门槛保持 null / UNKNOWN，不能用零门槛冒充通过。
6. 对同一目标预先固定途径编码与数量/距离要求，再比较成功候选；包装不算新途径，公共故障依赖另列。
7. 组合额外检查前后置条件、关系归属、共享状态、取消/终止、结果归属和整体效果。配方不是仅列模块 ID。
8. 组合通过后可作为新构件；开发态保留内部结构和证据。未完成准入的组合保持 candidate。

奖励、惩罚和硬约束分别登记。需求关系、客观环境、当前实现政策、待检验假设分别标注来源。当前实现限制不能自动变成所有途径的限制。

## 运行投影

此目录服务开发态，Pages 仍只复制原来的 11 个生产文件。本次不搬动生产实现；借用入口引用实际生产函数。

阶段需要需求、条件、策略与指标稳定，commit 只是源码快照。场景草案未替用户决定证明预算、途径距离门槛或效果容差。将来每个运行产物对齐自己的开发参考和阶段契约，不必从上一运行版本继承。


## 共享引擎不是宿主

共享能力按普通构件维护：`R-003 → F-004`，`R-004 → R-003 + F-004`，`F-005` 无其他构件依赖。调用关系可由源码和精确版本依赖同时检查。独立宿主 H-F-004/H-F-005/H-R-003/H-R-004 只提供最小刺激、环境和判据，不能冒充被测实现。它们不加载生产 provider，也不借现有供应商宿主的成功结果。

Gemini/Ark 协议 envelope、17+17 fixture、manifest 和配置适配器仍属于原测试资源；资源身份、模块身份、宿主身份分别管理。新构件同样使用本 catalog、hosts/catalog、维护规则与 schema 5 严格证据门禁，无第二套 engine registry。旧 `test-resources/shared/{core.js,configuration.mjs,png.mjs}` 保留原公共导出且转发同一函数/错误类；外部消费者无需迁移，复制使用则须携带普通实现及依赖闭包。此轮不修改生产 src 或 Pages 产物语义。
