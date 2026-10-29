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
- 真实模式收到非空模型文本

默认模式为 `synthetic`。真实模式使用 `--live`，需要从环境提供 `ARK_API_KEY`；详细设置见 [总说明](../README.md)。本次只运行默认模式。

## 结论边界

- 合成回复不是真实模型能力证据
- 只覆盖单轮文本，参数与模型范围由具体实验决定

宿主通过只支持以上判据；不自动使 F/C/H/Q 通过。测试宿主、夹具、观测或判据改变后，需要更新宿主时间与必要版本并重新验证。

## Gemini 共享模拟资源（H-F-002 0.2.0）

默认 synthetic 模式现借用 `TR-GEMINI-001@0.1.0 / text.ok@1.0.0`，不再使用 always-200 的 Ark 文本夹具。方法、URL、headers、body 和 dummy key 全部严格匹配，再由原 Gemini 适配器解析固定回复。资源锁在 `resources.lock.json`；报告包含 `SIMULATED`、资源/场景/fixture 版本、哈希、UTC 起止时间、零真实网络调用及断言事件。

`--prompt` 只绑定 fixture 明确声明的 prompt 参数，不改变固定响应。`--live` 仍是原有 Ark 路径；本次未运行。完整范围与不覆盖项见 [共享资源说明](../../test-resources/gemini-native/README.md)。
