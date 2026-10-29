# F-005 有界 PNG 结构检查

类型：function。效果目标：`png.inspect-bounded`。独立版本、UTC 创建/更新时间以 [catalog.json](../../catalog.json) 为准。唯一实现源是本目录 `index.mjs`；原 `test-resources/shared/png.mjs` 仅兼容转发同一个函数，不是另一条实现途径。

## 输入、输出与条件

- `inspectPng(input, {maxBytes=16777216, maxPixels=16777216, maxDimension=8192}={})` 同步检查一份内存 PNG。
- 条件：Node.js 20+，输入为可由 `Buffer.from` 复制的字节序列；调用者负责在复制前限制输入大小，并提供可信的正整数上限。选项不是用于处理任意不可信配置的独立校验器。
- 成功返回新对象：`width`、`height`、`bitDepth`、`colorType`、`interlaced:false`、输入 `bytes`、解压 `decodedBytes` 与固定 `validation:'complete-chunks-crc-zlib-noninterlaced'`。
- 签名、完整 chunk 边界、CRC、必要 chunk 顺序、支持的 IHDR 参数、尺寸/像素/字节上限、zlib 数据长度或行 filter 类型不符合当前支持子集时抛出 `Error('INVALID_PNG')`。无法转换为 Buffer 的输入仍可能抛出 Node 的原生类型错误，不承诺所有错误都统一编码。

## 状态、效果和依赖

- 无持久或共享可变状态；每次调用创建独立 Buffer、副本、chunk 集合及返回值。不会改写传入字节。
- 无网络、密钥、文件系统、定时器、墙钟或随机依赖；不写文件，不收费。同步内存分配与 CPU 运算是其全部效果。
- 外部运行库依赖：Node `Buffer` 和 `node:zlib.inflateSync`。无其他构件效果依赖；CRC 实现是本模块私有算法，不另登记空壳构件。
- 解压上限由已通过尺寸检查的行跨度和高度确定。同步执行，无取消 API；资源耗尽和调用前输入分配不在取消/内存安全保证内。

## 最低效果与可观察量

最简宿主 [H-F-005](../../hosts/png-inspection/README.md) 直接调用唯一实现：已知 1×1 RGBA 样本返回实测尺寸、5 个解压字节；损坏 CRC 和不足字节上限被拒绝；输入字节保持不变。运行 `npm run modules:host -- F-005`。

登记测试 `tests/shared-png-inspection.test.js` 独立检查兼容导出身份、重复调用隔离、有效结构、CRC/截断/尾随数据、三个上限、zlib 和不支持交错格式。证据复用 schema 5 逐文件归属、模块修订和源码指纹门禁。

## 不保证的效果

这是当前非交错 PNG 子集的结构检查，不是 PNG 全规范认证器、图像渲染器或图像质量评价。不会重建像素、检查提示词符合度或声称图片由某个模型生成；不验收真实账户、供应商 API 或浏览器可解码性。支持子集拒绝不等于输入绝非合法 PNG。局部通过不自动提升 F/C/H/Q；未知的完整准入仍保持 UNKNOWN。
