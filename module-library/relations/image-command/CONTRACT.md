# R-001 图片命令到执行器的关系

类型：relation。效果目标：`image-command.dispatch`。版本、创建与更新时间以 [catalog.json](../../catalog.json) 为准。

## 输入与输出

- 输入：{command:'image.generate',args} 与独立 context。
- 输出：图片核心结果或命令/参数/确认错误。

## 条件假设

- context 提供 imageConfig、confirmed 与可选取消信号
- 调用方负责确认语义及结果交付

## 待完整证明的保证

- 只接受声明的命令与参数
- 目标地址、密钥、模型来自 context
- 未确认时不发送生成请求

这些是需要验收的契约。局部测试只支持其中的已覆盖情形，不能据此报告全域形式证明。

## 状态、关系和副作用

不保存任务队列；下游使用共享日志。

符合条件时调用图片功能块。

源码唯一来源：[src/core.js](../../../src/core.js)。入口仅封装导出边界；core.js 中的职责尚未物理拆开。独立入口不等于独立故障域。依赖闭包、测试与本文件均进入证据指纹。

## 已知限制与不保证的效果

- confirmed 是调用方契约，不是授权机制的完整证明
- 同一 dispatcher 的不同入口不构成多种生成实现

## 最低局部实验

运行 `npm run modules:verify`，执行登记的本地用例和借用入口用例；请求构造、错误、取消、组合历史按相关测试文件验收。网络由合成 fetch 提供，外部 API 可用性不在这份通过结论内。

登记用例：[tests/core.test.js](../../../tests/core.test.js)、[tests/cli.test.js](../../../tests/cli.test.js)。

## 四项准入及替代途径

F/C/H/Q 见 [catalog.json](../../catalog.json)。当前均未完整准入；未设定的候选数量、距离、真实效果阈值保持未知。不同包装入口不能充当同一目标的成功替代实现。修改保证、实现、条件或依赖后，需要重新检查相应证据。

## 最简测试宿主

对应宿主：H-R-001@0.1.0。运行命令：`npm run modules:host -- R-001`。宿主的条件、判据、模式、版本及时间见 [宿主说明](../../hosts/image-command/README.md)。
