# 共享测试资源

测试资源 ID 使用 `TR-*`，与生产功能 `F-*`、关系 `R-*`、组合 `C-*` 和宿主 `H-*` 分开。资源不是新的测试宿主，也不是外部 API 的可用性证明。

`catalog.json` 登记资源 manifest。manifest 独立记录资源版本、fixture 集版本、协议快照、创建/更新时间和 `SIMULATED` 属性；每个 fixture 记录版本、毫秒 UTC 时间、包内相对路径及 SHA-256。场景引用一个 fixture，可由 fixture 定义多个请求步骤。

宿主通过可选的 `resourceLock` 路径借用资源。锁文件格式：

```json
{
  "schemaVersion": 1,
  "resources": [{
    "resourceId": "TR-GEMINI-001",
    "resourceVersion": "0.1.0",
    "scenarioId": "text.ok",
    "scenarioVersion": "1.0.0",
    "fixtureSetVersion": "1.0.0",
    "fixtureSha256": "实际 fixture 文件的 SHA-256",
    "protocolSnapshot": "gemini-developer-v1beta-generateContent@2026-10-29"
  }]
}
```

`validateHosts` 在独立启动宿主时同样核验资源锁，不只在完整目录检查时核验。未知资源/场景、版本不匹配、fixture 字节变化或不合法路径都会失败，不能静默借用“最新版”。

本地批次证据 schema 4 追加 `resourceRevisions`、运行开始/结束时间。资源修订记录包含宿主、所有锁定字段、manifest 创建/更新时间以及 manifest/锁文件 SHA-256。任何修订变化或任意输入文件变化使旧证据变为 `STALE`。无资源的旧 schema 3 单元记录仍可读取，不意味着旧记录已验证新资源。

升级顺序：修改资源并更新相应资源/场景/fixture 版本与更新时间 → 核对 fixture 哈希 → 显式升级借用宿主的锁和宿主版本 → 运行完整测试 → 最后 `npm run modules:record`。模块生产契约未变时不必升级模块版本；宿主绑定或测试清单改变时更新模块卡 `updatedAt`。共享资源升级不能自动修改其他宿主的锁。
