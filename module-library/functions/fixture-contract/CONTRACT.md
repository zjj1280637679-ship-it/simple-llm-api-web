# F-004 — fixture 参数绑定与精确请求契约

版本 `0.1.0`；创建/更新时间在唯一 `catalog.json` 模块卡（UTC）。唯一实现 `index.js`；旧 shared/core.js 转发同一 SimulatorError 与 DUMMY_KEY，不是第二实现。

## 目标和接口

`bindFixtureSteps(fixture, parameters={}) → steps` 校验已声明参数只接受非空 string（缺省用 fixture 默认值）、拒绝未知参数，并递归替换单键 `{$parameter: name}`。返回新的 JSON 数组/对象，不改变输入；模板中的参数名须由可信 fixture 声明。

`assertFixtureRequest(actual, expected) → undefined` 对已规范化请求比较 method、完整 URL 字符串、Headers 转出的键值和 JSON body。对象键序无关，数组顺序、额外键和 URL query 有关；不匹配抛 `SimulatorError('SIMULATOR_REQUEST_MISMATCH', fields)`。fields 仅为 method/url/headers/body；diff 不回显输入值。`SimulatorError(code, fields)` 与 `DUMMY_KEY` 供关系块共用。调用者构造错误时必须只传安全字段名，不应传秘密。

## 条件、状态和副作用

- 同步纯功能，无持久/共享可变状态，无 clock、scheduler、fetch、fs 或生产请求构造器依赖；只依赖 JS 与 Headers iterable 契约。
- fixture/expected 是可信、有限、无环 JSON 数据，非任意 hostile JS 对象；actual.headers 提供标准 Headers.entries()。不承担 fixture schema、循环深度或 getter/proxy 隔离。
- 空/无 steps、非法参数抛 SIMULATOR_CONFIGURATION；归一化、请求流读取、排队、序号消耗和取消由 R-003 负责。此块不会消耗任何请求。
- 克隆出的对象与输入不共享可变对象；参数必须为 string。无异步等待或取消点。

## 最低效果与证据

H-F-004 仅提供一个参数化请求及比较/拒绝断言，独立观察默认/显式绑定、fixture 不变、完整契约比较和字段脱敏，不启动模拟器。`tests/shared-fixture-contract.test.js` 必需覆盖输入非变异、默认/非法参数、对象键序、精确字段比较、脱敏与旧入口同一性；模块卡还绑定宿主和治理测试。只验证已执行样本，F/C/H/Q 仍 UNKNOWN；不证明外部 API 或所有 JSON 输入。
