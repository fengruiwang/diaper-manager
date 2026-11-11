# P3 服务器→本地库存核对流程（受控协调器）

状态：已实现独立协调模块 \`sync/inventory-sync-reader.js\`，未挂载到正式 PWA，也未连接正式 CloudBase 业务表。

每次需要用户端已有会话、完整 xb 家庭成员许可和初始化状态。只有明确 \`readEnabled=true\` 时才执行：

1. \`outbox.reconciliationIds(scope,childId)\` 读取全部当前本地操作 ID（包括已 ACK 的历史 ID），超过 50 条停止，并提示未来分页方案。
2. \`cloudbase-inventory-client.readReconciliation(...)\` 调用 \`010\` RPC 获取一致的六尺码库存与当前 actor 自己的操作回执。
3. \`idb-outbox.reconcileInventory(...)\` 重新读**最新**本地操作，验证与云端此次检查的 ID 集完全一致，并在同一 IndexedDB 事务中写入新的本地库存投影和批量 ACK。
4. 若部分库存修改尚待上传，展示“本地待同步”；全部当前记录均经云端回执核对，仅可展示“已核对至本次读取”，不可承诺其他设备此后没有更新。

**故障处理**：服务器访问失败、家庭权限失效、旧快照版本、盘点/撤销不安全、ID 数量过多、IDB 写入异常、读取期间有新操作，都不覆盖本地状态，保留操作队列。触发条件和重试策略由后续真实浏览器 UI 实现。该协调器本身不上传操作、不会发 OTP、不自动读旧 \`localStorage\`。

**部署闸门**：仍需 PostgreSQL 010 在 CloudBase 实际 SQL API 验收、双端端到端库存/购买流水一致、50 条 ID 上限的游标分页改造、跨宝宝及撤销合并以及旧版历史数据迁移。
