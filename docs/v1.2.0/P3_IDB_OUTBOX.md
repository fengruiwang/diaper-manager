# P3 离线队列持久化：v1.2.0 第一阶段

状态：独立功能库，未接入正式 PWA 或腾讯云真实数据。2026-11-10。

\`sync/idb-outbox.js\` 是 IndexedDB 原子存储封装，数据表为 \`operations\`，主键为稳定 UUID \`id\`，索引 \`by_identity=(familyId,actorUid)\`。创建实例需明确传入浏览器的 indexedDB 和 \`XBOutboxContract\`。加载文件**不会读取/修改旧 localStorage、不访问云端、不自动上传**。

## 已实现

- \`enqueue\`：校验 operation.id/familyId/actorUid 等；入队后只有 IDB 事务成功提交才返回成功。重复同 ID+相同所有业务参数保留之前状态；不同参数绝对拒绝，不能把一个已 ACK 的操作覆写成 pending。
- \`get/list/ready/stats\`：所有读操作必须提供用户和家庭作用域。被阻止、冲突和已经完成的操作都在本机保留，待同步列表不会把 ACK 后操作重新传出。
- \`recordResult\`：ACK、失败、冲突均在事务内更新。仅确认服务端回执 receiptId == 本地 operation ID 才允许 ACK；超时没有 ACK 仍保留 retry 状态和原始 id。
- IDB 关闭重开后按同一个库继续访问，不触碰原 PWA 数据键。无 IDB（浏览器存储被禁止）时明确报错，不假装已持久化。
- 允许同一浏览器中多个账号的操作共存，不允许以一个家庭账号读取另一账号的待上传内容。服务端仍需独立鉴权；本地隔离不代替 CloudBase RLS。

## 下一步阻断条件

1. **尚未集成 UI 的本地权威状态/重放投影**。旧版 localStorage 与新的 IndexedDB 两个存储之间没有跨存储原子事务。未来 UI 保存必须先以 IDB 事务保证事件落盘，再从本地事件重放/投影渲染，绝不可先修改旧 state 然后 enqueue 失败。
2. **尚未实现 sync runner、网络重试退避和全量/增量拉取**。这阶段没有任何云端数据同步，更不宣称断网 50 次事件最终到云。
3. **尚未加入同时打开多个标签页的租约/leader 机制**。服务端 operation_id 幂等可以容忍重复请求，但未来客户端要降低多标签页抢占和无谓网络重试。
4. 真实手机 WebView/Edge 的存储额度、PWA 重启、浏览器隐私模式、缓存被清理等边界待验收，不能保证浏览器删除本地数据后恢复。
5. \`recordResult\` 的持久 ACK 需要由可信 RPC 回执触发；API 由后续 runner 统一调用，绝不能允许用户 UI 随意勾选“已同步”。
6. 跨家庭切换时，旧队列保持隔离，禁止自动切换作用域后直接上传旧队列。手机号/邮箱改名也不能替代固定认证 UID。

## 迁移

当前未调用 \`xiaobao_diaper_planner_v1\`、未加载或清空历史 JSON。正式启用前完成完整备份、所有字段映射、首次导入幂等和用户明确授权。


## 2026-11-11 v2 原子库存投影升级（覆盖前文 v1 队列表描述）

- \`sync/idb-outbox.js\` 当前 IndexedDB schema 版本为 **2**，在原有 \`operations\` 之外增加 \`inventory_snapshots\`。v1 → v2 为纯增量升级，绝不删除或重新建立原 v1 队列。
- \`initializeInventory\` 仅供明确提供可信初始快照的开发流程使用，不能把 \`source='verified-server'\` 字符串本身当成真实性证明；存在原快照或未处理旧操作时拒绝重建。
- \`commitInventory\` 同一 readwrite 事务内更新库存投影和加入唯一 operation_id 的队列事件，**任何一步失败整笔回滚**；重复 ID 和相同参数不再次累计库存；更改金额、账号、数量会拒绝。
- \`readInventory\` 按家庭、账号和宝宝 ID 查本地快照；切换账号不能混用缓存。
- 配套纯函数 \`sync/inventory-local-projection.js\` 处理采购、消耗、盘点和本机已经缓存的撤销。旧版原机真实数据不通过该功能自动上传。
- 接下来的阻断项：真实 Edge 事务验证、旧版单一 localStorage → IDB 的明确迁移、与服务器增量修订重基同步、双手机恢复与线上 CloudBase RLS 测试。
- SDK 登录状态恢复由独立的 \`sync/cloudbase-session-recovery.js\` 完成，禁止复制访问/刷新令牌到业务缓存。
