# Shared simulator compatibility paths

共享引擎不是宿主，也不再是目录外的特殊实现。唯一实现与治理已进入普通 F/R 构件，仍由 `module-library/catalog.json` 登记：

| 兼容路径 | 唯一实现 / 普通构件 | 责任 |
| --- | --- | --- |
| `core.js` | F-004 `functions/fixture-contract/index.js` | 纯参数绑定、精确请求契约、脱敏错误 |
| `core.js` | R-003 `relations/simulator-session/index.js` | 请求归一化、顺序接纳、响应交付、取消/处置 |
| `configuration.mjs` | R-004 `relations/configuration-profile/index.mjs` | adapter 绑定的配置校验、确定性解析、固定快照和追加历史 |
| `png.mjs` | F-005 `functions/png-inspection/index.mjs` | 有界非隔行 PNG 的 CRC/zlib/结构检查，不评价内容质量 |

这三个旧路径仅兼容转发，保持原导出、函数及 SimulatorError 身份。Gemini/Ark 公共 API、配置 schema、历史哈希与旧 fixture 语义不变。资源包保留协议/模型元数据、envelope、fixture 及 adapter；不把数据资源登记混同为功能实现登记。

每个新构件有独立版本、UTC 创建/更新时间、契约、最小宿主和 schema 5 必需文件归属。依赖为 R-003 → F-004、R-004 → F-004 + R-003；PNG 不依赖其他构件。运行状态、外部 clock/scheduler、adapter、目录副作用及限制见各契约。无生产请求构造器、真实 fetch 回退或密钥读取。旧入口不代表另一条途径，局部 PASS 不提升完整准入。
