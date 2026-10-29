# Ark 可调模拟配置 v0.2 API / TR-ARK-001 v0.1.0

这是本地 Node API＋CLI，不是 HTTP 服务或后台网页。所有模拟证据为 `SIMULATED` / `realApiCalled:false`，不读取 `ARK_API_KEY`。普通 Ark 严格请求协议独立于 Gemini；两者仅共享协议无关的匹配、取消、存储和决策引擎。

```sh
npm run simulator:ark -- restore --profile demo
npm run simulator:ark -- set --profile demo --json '{"parameters":{"prompt":"你好"},"output":{"presets":[{"id":"default","matchPrompt":null,"text":"方舟自定义回复","usage":{"prompt_tokens":2,"completion_tokens":4,"total_tokens":6}}]},"timing":{"latencyMs":50,"tokensPerSecond":2}}'
npm run simulator:ark -- replay --profile demo
npm run simulator:ark -- show --profile demo
npm run simulator:ark -- history --profile demo
npm run simulator:ark -- save --profile demo --file /tmp/ark-export-new.json
npm run simulator:ark -- load --profile imported --file /tmp/ark-export-new.json
npm run simulator:ark -- restore --profile demo --revision 1
npm run simulator:ark -- reset --profile demo
npm run modules:host -- F-002 --simulator ark --profile demo
npm run simulator:ark -- restore --profile image --scenario image.output
npm run modules:host -- F-003 --simulator ark --profile image
```

`--dir DIRECTORY` 选择独立配置目录，默认 `output/ark-simulator-profiles`；Gemini 默认目录保持不变。`--revision N` 固定历史版本；`--sample-index N` 固定第 N 个抽样，默认0。`reset` 创建新的进程内实例，旧实例和其他进程不受影响。`restore` 也只追加修订，不覆写历史。

## 配置字段

- `parameters.prompt/model` 是严格请求预期值，不是任意路由或凭据配置；静态 fixture 使用 dummy Bearer key。
- 文本 `output.presets`: `{id,matchPrompt,text,usage:{prompt_tokens,completion_tokens,total_tokens}}`。`matchPrompt:null` 匹配任何已登记预期提示；字符串做精确相等匹配。
- 图片 `output.presets`: `{id,matchPrompt,b64Json}`。默认完整1536×1536纯色PNG；允许≤3MiB、≤4096边长、≤16777216像素的完整非交错PNG。检查全部chunk CRC、结构、zlib与扫描线长度/滤波类型。响应size始终按预设实测尺寸更新；配置图片usage只报告合成generated_images:1，不推测实际图片token用量。它不是图片质量验收。请求尺寸与修改后的图片实际尺寸可能不同；检查实际像素信息，不能把请求尺寸当输出事实。
- `selectedPresetId/fallbackPresetId` 必须指向存在的预设；`missBehavior` 为 `fallback` 或 `error`。
- `probabilities.presetHit/success/cacheHit` 都在[0,1]。seed+sampleIndex+独立Ark命名空间确定复现；`cacheHit`只模拟文本usage，不建立真实缓存。图片 `cacheHit` 必须0。
- `timing.latencyMs`＋文本 `tokensPerSecond` 换算为一个非流式响应的总延迟。0表示不加生成延迟；不是逐token流。图片只支持latency，tokensPerSecond必须0。每步最多1小时逻辑延迟。hang/reject场景不支持延迟参数。
- `error:{httpStatus,code,message}` 使用 Ark 独立错误封套，支持文本/图片错误场景与概率失败。不能混用 Gemini `status`。

API exports 与 Gemini 同名：`getConfigurationPreset/validateConfiguration/createConfigurationStore/createConfiguredSimulator/resolveConfiguration/validateConfigurationSnapshot`。导入 `ark-native/configuration.mjs`。实例 `fetch/inspect/assertComplete/dispose/snapshot/reset`；store `show/history/set/load/save/restore/start/reset`。

每个修订有独立资源/配置版本、UTC创建/修改时间、SHA256及parent hash；原子无覆盖发布。运行固定快照，随后set不会影响运行中实例。资源错配、参数错误、损坏历史、symlink和未知字段拒绝。保存导出文件同样不覆盖旧文件。源目录禁止写配置；共享目录混放Gemini/Ark同名profile会报错，而不是跨协议加载。

## 范围

17个静态场景覆盖单轮文本、HTTP/网络/取消/非法JSON、空文本、图片、tool_calls和encrypted_content不透明往返。工具仅测试纯函数allowlist stub；不执行真实工具。无模型列表、视频、语音、流式、HTTP服务器、GUI或账户权限保证。真实联调完全独立，默认关闭，见 [LIVE.md](LIVE.md)。
