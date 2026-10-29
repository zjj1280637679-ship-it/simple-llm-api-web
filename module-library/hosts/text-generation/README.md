# H-F-002：text.request-response 的最简宿主

对应模块：F-002@0.1.0。宿主版本、创建与更新时间以 [宿主目录](../catalog.json) 为准。

在仓库根目录运行：

```sh
npm run modules:host -- F-002
```

也可直接运行 `node module-library/hosts/text-generation/run.mjs`，不依赖完整网页或测试套件。输出 JSON 包含模块与宿主修订、模式、验证时间、观察结果和限制；失败退出码为 1。

## 这个宿主提供什么

- 最小单轮用户消息
- 受控 fetch 或真实传输
- 非空文本结果观察

最简性依据：去掉对话 UI、长期会话和 Agent，只保留单请求和文本输出。 这是当前契约下的工程边界，不宣称全局最小。

## 环境与验收

- Node.js 20+ 与仓库源码
- 真实模式需要可用 Ark 文本 API 条件和 ARK_API_KEY

成功判据：

- 合成模式实际运行适配器并检查输入映射
- 真实探针收到非空模型文本，只支持传输结论；`adapterVerified:false`

默认模式为 `synthetic`。真实探针使用 `--live --live-plan FILE`，需要有效单次批准计划及环境 `ARK_API_KEY`；详细设置见 [总说明](../README.md)。本次只运行默认模式。

## 结论边界

- 合成回复不是真实模型能力证据
- 只覆盖单轮文本，参数与模型范围由具体实验决定

宿主通过只支持以上判据；不自动使 F/C/H/Q 通过。测试宿主、夹具、观测或判据改变后，需要更新宿主时间与必要版本并重新验证。

## Gemini 共享模拟资源（H-F-002 0.2.1）

默认 synthetic 模式现借用 `TR-GEMINI-001@0.2.0 / text.ok@1.0.0`，不再使用 always-200 的 Ark 文本夹具。方法、URL、headers、body 和 dummy key 全部严格匹配，再由原 Gemini 适配器解析固定回复。资源锁在 `resources.lock.json`；报告包含 `SIMULATED`、资源/场景/fixture 版本、哈希、UTC 起止时间、零真实网络调用及断言事件。

`--prompt` 只绑定 fixture 明确声明的 prompt 参数，不改变固定响应。`--live` 当前转入独立普通 Ark HTTP 探针，不再经过原生产适配器；本次未运行真实调用。完整范围与不覆盖项见 [共享资源说明](../../test-resources/gemini-native/README.md)。

可调配置使用独立 `npm run simulator -- ...` / `configuration.mjs`，不隐式改变此宿主的固定场景与成功判据；详见[配置契约](../../test-resources/gemini-native/CONFIGURATION.md)。

## Ark 可调模拟资源

旧默认 Gemini 路径与 `npm run simulator` 保持兼容。显式选择 Ark：

```sh
npm run modules:host -- F-002 --simulator ark --prompt 'Hello'
node scripts/ark-simulator.mjs restore --profile text-demo
node scripts/ark-simulator.mjs set --profile text-demo --json '{"parameters":{"prompt":"自定义输入"},"timing":{"latencyMs":20,"tokensPerSecond":2}}'
npm run modules:host -- F-002 --simulator ark --profile text-demo --revision 2 --sample-index 7
```

`--dir` 可选择本地配置历史目录。配置宿主只接受 `text.ok`；prompt、model、响应预设及 seed 均从指定快照读取，运行中不追随后续修改。显式 `--prompt` 不得与快照冲突。速度使用虚拟时间，不等待真实秒数，报告标明 `virtualTime:true`。实际生产适配器在严格 Ark dummy-key 传输上运行；报告资源为 `TR-ARK-001`，不是 Gemini 的封装回复，也不是调用真实模型。

## 单次真实探针的额外边界

本版本的 F-002 `--live` 不再仅凭一个环境 key 执行：还必须给 `--live-plan FILE`，包含经用户确认的精确模型、prompt、最多 1 次调用、显式输出上限、关闭思考、费用预估及批准额度、UTC 批准/失效时间。这里是独立的 HTTP 探针，不通过生产适配器或其请求日志，报告 `adapterVerified:false`。不输出 prompt、回复正文或凭据，不重试、不回退。

真实运行前必须另行取得授权；费用检查只比较批准的预估额，不是服务商硬计费上限。详见 [Live probe](../../test-resources/ark-native/LIVE.md)。本次宿主测试只使用 `SIMULATED` 传输，不构成真实调用证据。
