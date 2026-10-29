# H-F-003：image.request-response 的最简宿主

对应模块：F-003@0.1.0。宿主版本、创建与更新时间以 [宿主目录](../catalog.json) 为准。

在仓库根目录运行：

```sh
npm run modules:host -- F-003
```

也可直接运行 `node module-library/hosts/image-generation/run.mjs`，不依赖完整网页或测试套件。输出 JSON 包含模块与宿主修订、模式、验证时间、观察结果和限制；失败退出码为 1。

## 这个宿主提供什么

- 单条图片提示词
- 受控响应或真实传输
- 字节落盘和读回

最简性依据：不需要图片页，只保留提示词、传输和可检查的返回文件。 这是当前契约下的工程边界，不宣称全局最小。

## 环境与验收

- Node.js 20+ 与可写目录
- 真实模式需要 Ark 图片 API 及额度

成功判据：

- 收到图片字节
- 文件写入后读回字节一致

默认模式为 `synthetic`。真实模式使用 `--live`，需要从环境提供 `ARK_API_KEY`；详细设置见 [总说明](../README.md)。本次只运行默认模式。

## 结论边界

- 默认响应是 1x1 PNG 夹具
- 请求为 2048x2048 不代表实际文件尺寸
- 不完整解码，不验收内容拟合度；真实模式未在本次执行

宿主通过只支持以上判据；不自动使 F/C/H/Q 通过。测试宿主、夹具、观测或判据改变后，需要更新宿主时间与必要版本并重新验证。

## Ark 严格模拟场景与可调版本

保留不带选项的旧 1×1 PNG 默认测试；显式 `--simulator ark` 使用 `TR-ARK-001 / image.output` 的普通 Ark 请求 oracle：

```sh
npm run modules:host -- F-003 --simulator ark --out /tmp/ark-images
node scripts/ark-simulator.mjs restore --profile image-demo --scenario image.output
npm run modules:host -- F-003 --simulator ark --profile image-demo --revision 1 --out /tmp/ark-images
```

可加 `--dir DIRECTORY`、`--sample-index N`。宿主只接受 `image.output` 快照；快照 prompt/model 不被命令行隐式覆盖。未改生产图片适配器，采用其已登记 Flash 模型能力及 `1:1 / 1.5K` 请求（1536×1536）。fixture 是合成 1536×1536 PNG；可编辑预设的输出尺寸由 PNG 本身决定，不由请求尺寸推断。文件写入后读回一致；模拟 latency 使用虚拟时间。报告 `SIMULATED`、`realApiCalled:false`、配置/资源修订与哈希，不代表模型画质、账户权限或服务可用性。

F-003 `--live` 现在还要求 `--live-plan FILE`，并运行最多一张、固定 1536×1536 PNG 的独立普通 Ark HTTP 探针。真实模式只报告完整 PNG 验证和非敏感摘要，不保存/打印响应图片正文，也不通过生产适配器日志；`adapterVerified:false`。每次须另行获批模型、费用预估和额度；不自动重试或回退。详见 [Live probe](../../test-resources/ark-native/LIVE.md)。
