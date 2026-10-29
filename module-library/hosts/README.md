# 最简测试宿主

每个构件除了代码入口，还绑定一个能承载其目标效果的最小环境。目标可以是直接输出，也可以是参数转换、关系路由、状态联系或组合效果。宿主提供必要条件、刺激、结果承接和验收判据。

## 首批宿主

| 模块 | 宿主 | 可观察效果 | 默认模式 |
| --- | --- | --- | --- |
| F-001 | [图片参数宿主](image-options/README.md) | 参数转换和无效选项拒绝 | local |
| F-002 | [文本宿主](text-generation/README.md) | 请求映射和文本返回 | synthetic |
| F-003 | [图片宿主](image-generation/README.md) | 图片字节提取、落盘和读回 | synthetic |
| R-001 | [命令关系宿主](image-command/README.md) | 未确认不调用、确认后执行及结果传回 | synthetic |
| R-002 | [状态关系宿主](page-session/README.md) | 命令改变最小状态，后续命令能观察该变化 | local |
| C-001 | [组合宿主](agent-image-turn/README.md) | 工具请求、图片结果、上下文保存、后续对话 | synthetic |

`local` 表示本机实际执行目标功能；`synthetic` 表示执行真实模块，但外部服务由受控响应代替。四个联网构件另有 `live` 模式，运行相同宿主并接真实 Ark API。本次没有运行 live 模式。

## 如何使用

位置：仓库根目录的命令行。需要 Node.js 20+；本轮使用 Node.js 24。

```sh
npm run modules:host -- F-001
npm run modules:host -- R-002
npm run modules:host -- F-003 --out /tmp/image-host-results
npm run modules:host -- C-001
npm run hosts:verify
```

每个宿主的 run.mjs 可直接运行。共享 support.mjs 仅提供输入、配置、夹具、文件承接和报告，功能仍由已登记的模块实现。

每次输出独立 JSON 结果，包含模块版本、宿主版本及时间、验证时间、模式、观察与限制。图片文件写入指定目录内的唯一子目录；未指定时写入系统临时目录。合成图片是可检查的 1x1 PNG，不能把请求尺寸当作夹具的实测尺寸。

## 真实模式

设置环境变量后运行，例如：

```sh
npm run modules:host -- F-002 --live --prompt "Reply with one short sentence."
npm run modules:host -- F-003 --live --prompt "One blue cup on white."
npm run modules:host -- C-001 --live --prompt "Use image_generate to draw one blue cup, then briefly describe the tool result."
```

| 环境变量 | 作用 |
| --- | --- |
| ARK_API_KEY | 真实模式必填，不作为命令参数或报告字段 |
| ARK_BASE_URL | 可选，覆盖代码中的普通 Ark 基础地址 |
| ARK_TEXT_MODEL | 可选，覆盖当前文本默认模型 |
| ARK_IMAGE_MODEL | 可选，覆盖当前图片默认模型，仍需现有适配支持 |

默认模式不读取这些凭据，且真实 fetch 被阻止。真实模式的 --live 明确选择实际请求，可能消耗额度；R-001 将其映射为本次已确认 context，C-001 只批准第一次图片工具请求。C-001 可能发生多次文本请求；用户取消或请求失败不证明已发送请求未计费。宿主设置 120 秒信号期限，不自动重试。

真实文本模型如果没有调用工具，C-001 报告该宿主目标未达成，而不是仅凭文本成功就判组合通过。真实模式当前只为 Ark 提供配置接线；其他协议需另补宿主场景，不能从现有结果推断可用。

## 身份、维护和证据

宿主是独立版本化的验证设施。登记包含 ID、version、createdAt、updatedAt、被测模块 ID/版本、效果目标、必要条件、提供的环境、验收判据、模式、限制和最简性依据。

- 模块与宿主的版本独立，目录固定具体绑定。
- 宿主实现、夹具、模式或验收语义变化时，更新宿主版本和时间；纯登记修正可以只更新时间。
- 宿主也保留创建时间、版本不倒退；依据已有验证记录检查。
- 证据同时绑定模块修订、宿主修订和源码指纹。旧宿主的 PASS 不会自动传给新宿主。
- 每个默认宿主以独立 Node 进程纳入本地验证。真实模式报告需另存并评审其条件范围；不会被本地 record 冒充。
- 宿主不能偷偷完成被测模块的工作；受控服务、状态处理器和结果接收器均写明责任。
- 增加宿主不增加生成算法的替代途径数量，也不替代形式证明和组合真实验收。

隔离或归档构件仍可借助宿主做诊断，报告会显示其维护状态；测试通过不自动解除隔离。单个宿主只校验自身与被测模块的绑定，不要求无关模块或整套网页可运行。

完整网页不是每个模块的必要宿主。R-002 使用内存状态即可检验关系效果，但它不证明网页 DOM 或 MCP 宿主已跑通。图片宿主目前验证字节传输和文件承接，不负责完整解码、实测尺寸或内容质量。
