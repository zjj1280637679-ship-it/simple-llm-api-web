# R-002 网页命令到页面处理器的关系

类型：relation。效果目标：`page-command.route`。版本、创建与更新时间以 [catalog.json](../../catalog.json) 为准。

## 输入与输出

- 输入：七种会话命令、参数和宿主 handlers。
- 输出：规范命令或 {ok,result/error}；无效输入抛错。

## 条件假设

- 宿主 handlers 实现对应页面效果
- confirmSend 返回值与实际用户确认绑定
- 宿主状态由调用方管理

## 待完整证明的保证

- 命令与参数按既定结构校验
- 请求发送先调用 confirmSend
- 已识别的失败状态不报告成功

这些是需要验收的契约。局部测试只支持其中的已覆盖情形，不能据此报告全域形式证明。

## 状态、关系和副作用

捕获 handlers 引用；页面状态由 handlers 持有，不能假定各会话隔离。

调用注入处理器；处理器可能改变页面并发送请求。

源码唯一来源：[src/session.js](../../../src/session.js)。入口仅封装导出边界；core.js 中的职责尚未物理拆开。独立入口不等于独立故障域。依赖闭包、测试与本文件均进入证据指纹。

## 已知限制与不保证的效果

- 本块不提供浏览器连接
- 本块不独自证明 handler 的业务正确性
- 设置范围及确认策略是当前实现政策

## 最低局部实验

运行 `npm run modules:verify`，执行登记的本地用例和借用入口用例；请求构造、错误、取消、组合历史按相关测试文件验收。网络由合成 fetch 提供，外部 API 可用性不在这份通过结论内。

登记用例：[tests/session.test.js](../../../tests/session.test.js)、[tests/app-controls.test.js](../../../tests/app-controls.test.js)。

## 四项准入及替代途径

F/C/H/Q 见 [catalog.json](../../catalog.json)。当前均未完整准入；未设定的候选数量、距离、真实效果阈值保持未知。不同包装入口不能充当同一目标的成功替代实现。修改保证、实现、条件或依赖后，需要重新检查相应证据。
