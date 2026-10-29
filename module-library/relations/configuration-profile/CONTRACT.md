# R-004 配置修订、历史与运行快照关系

类型：relation。效果目标：`simulator.profile-history`。独立版本、UTC 创建/更新时间及候选状态以 [catalog.json](../../catalog.json) 为准。

## 唯一实现和依赖

唯一实现为本目录 `index.mjs`，不是调用旧 shared 引擎的 facade。`test-resources/shared/configuration.mjs` 仅兼容转发同一个 `createConfigurationApi` 函数。

- F-004：`SimulatorError` 的统一错误身份和删值诊断。
- R-003：将已解析 fixture、固定资源修订、参数和显式时钟/调度器组合成独立模拟会话。
- Node 内置 crypto、fs/promises、path；运行时 structuredClone、Date、JSON。

构件准确版本在目录依赖中固定；协议适配器是调用者注入的条件，不是新的隐式全局模块。验证、规范化哈希、修订、解析和持久化辅助算法保持私有：它们共同服务于同一 adapter/schema/namespace 下的配置快照契约，不单独登记为伪独立功能块。

## 输入与输出边界

`createConfigurationApi({getManifest,getFixture,adapter,repoRoot,defaultDirectory,namespace,apiVersion='0.2.0',schemaVersion='1.0.0'})` 返回既有 API：版本常量、`getConfigurationPreset`、`validateConfiguration`、`validateConfigurationSnapshot`、`resolveConfiguration`、`createConfiguredSimulator` 和 `createConfigurationStore`。

配置仅接收规定键：schema/scenario/parameters/seed/timing，以及适用场景中的 output/probabilities/error。所有参数为非空字符串；seed 为 uint32；时延、速率、概率、预设引用有界校验。协议输出字段与错误 envelope 由 adapter 校验。合法输入返回深拷贝，不把调用者对象作为可变配置状态保留。

`resolveConfiguration(snapshot,{sampleIndex})` 返回 `{fixture,decision}`。以 namespace、seed、显式 sampleIndex 和 draw 标签确定性生成选择值；不推进隐藏随机计数器。配置预设、概率和合成 cache 元数据只改响应，不放宽请求契约。延迟为整份非流式响应延迟；不是 token streaming。generationMs 仅适用单步骤 text，其他脚本的 latency 施加到各步骤。

`createConfiguredSimulator({snapshot,clock,scheduler,sampleIndex})` 提供 R-003 的 fetch/inspect/assertComplete/dispose，并增加 snapshot/reset；报告绑定配置与资源修订及确定性 decision。

store 提供 `history/show/set/load/restore/save/start/reset`。set 只允许已存在键的递归对象补丁；load 接收完整合法配置。restore 选择默认/指定场景或历史修订，二者互斥。所有修改均追加新修订，restore 不回退或改写链。

## 调用者必须提供的条件

- `getManifest` 返回具有已验证身份、fixture SHA-256、场景引用和 API/schema 版本的可信清单。模块比较其配置绑定，但不会在此工厂内重新读取/哈希协议 fixture 文件；资源包检查器负责清单和文件真实性。
- **每次 `getFixture(scenario)` 必须返回独立可变深拷贝**，并与清单的场景/fixture 对应；resolve 会修改返回副本。共享同一可变对象违反契约，不能据此保证工厂隔离。该模块不验证任意未知 fixture schema。
- adapter 是可信代码，而非插件沙箱。它提供 outputKind/presetFields/readPreset/validatePreset/outputTokens/applyPreset/defaultError/readError/validateError/applyError，可选 isHttp。验证/读取函数应确定、无外部副作用；apply 仅修改传入 response，不持有或修改其他会话、配置、fixture 或全局状态。
- 该 factory 的 namespace、adapter、manifest 语义在运行期间保持稳定。跨协议互换快照不是保证；资源/API/schema 不匹配应失败。若只改变 namespace，确定性抽样值可能变化，需单独管理调用者版本。
- repoRoot 为实际受检源码根目录；输出目录为可信本机文件系统，支持原子同文件系统 hard link。正常并发写者使用本 API；敌对 TOCTOU、崩溃期间持久性和任意外部编辑不在保证范围。

## 状态所有权与副作用

factory 只捕获显式依赖，不设模块级可变配置缓存。每次返回配置/快照/报告均深拷贝。已启动会话内部保存冻结快照；后续 store 修改、调用者修改返回对象、其他 factory 不改变它。runtime.reset 新建独立空会话，保留原快照/sampleIndex，不取消旧会话。store.reset 则重新从指定/最新持久修订启动，二者语义不同。

store 状态归指定目录及 profileId 所有。追加记录含 revision、独立 profile version、createdAt/updatedAt、parentSha256、configurationSha256、resourceRevision 和 snapshotSha256。createdAt 不变，updatedAt 严格递增（系统时钟与前一时间+1ms 取较大值）。哈希规范化 JSON 键序；哈希只检查一致性，不是签名、认证或加密。

history 检查连续文件序号、profile、parent、创建时间和更新时间；快照内容或绑定漂移失败关闭。append 以临时文件 + no-overwrite hard link 发布；冲突最多重试 100 次，finally 清理临时文件。save 使用 wx，拒绝覆盖已有导出文件。拒绝源码根目录内非 output 路径及检查到的 symlink 祖先/记录，但不宣称防恶意竞态。

副作用：store 创建目录、读写/链接/删除自身临时文件；save 写入显式目的文件；读取系统时间、生成临时 UUID、计算 hash。运行模拟器仅调用显式提供的时钟/调度器；本构件无网络、eval、凭据读取或真实 API 请求。

## 错误、取消和终止

非法配置/快照/历史绑定抛 `SIMULATOR_CONFIGURATION`；缺失 profile/revision 为 `SIMULATOR_PROFILE_NOT_FOUND`；持续写冲突为 `SIMULATOR_STORE_BUSY`。文件系统错误可原样传播。adapter 内部抛错不是沙箱化错误，也不能保证删值；可信 adapter 必须自行避免泄露秘密。错误对象不替代对非受信适配器的隔离。

store 操作为有界任务，没有独立 AbortSignal。读取历史的工作量随修订文件数增加；尚无磁盘配额/历史上限管理。会话取消、挂起、dispose 及完成判据由 R-003 承担，reset 不隐式取消旧会话。调度器条件不满足时保留原有失败语义。

## 最低局部效果、宿主与证据

最小宿主 H-R-004 运行：`npm run modules:host -- R-004`，详见 [README](../../hosts/configuration-profile/README.md)。必须观察追加 3 修订、父链、旧文件不变、固定运行快照、历史 replay、独立 reset 及输入 fixture 不变。

直接测试 `tests/shared-configuration-profile.test.js` 验收 factory/adapter 边界、隔离、历史完整性、资源漂移和兼容转发身份；旧 Gemini/Ark 配置测试继续验收实际协议适配器。模块 tests、宿主代码、依赖源码和契约均由既有 schema 5 文件结果/哈希证据绑定，不创建额外 registry。

通过仅是限定本地关系验证，不证明真实 API、概率统计质量、用户响应内容质量、恶意文件系统安全、形式正确性或全域 F/C/H/Q；完整准入保持 UNKNOWN。
