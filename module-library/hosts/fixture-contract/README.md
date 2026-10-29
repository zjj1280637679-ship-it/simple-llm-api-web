# H-F-004 — 独立 fixture 请求契约宿主

目标：在无模拟运行时、供应商适配器、文件存储或网络的条件下，局部验证一个参数化 JSON 请求被非变异绑定、完全匹配被接受、URL/body 错配被按字段拒绝而不回显值。

运行：`node module-library/hosts/fixture-contract/run.mjs`，或 `npm run modules:host -- F-004`。

宿主直接导入 F-004 唯一实现，提供单步 inline fixture、Headers 与断言。观测绑定值、原 fixture 不变、错配字段和零网络；未知参数也须拒绝。版本/UTC 时间以 `hosts/catalog.json` 为准。LOCAL 不表示任何真实 API 能力，亦不涵盖 R-003 的顺序、取消或交付责任。
