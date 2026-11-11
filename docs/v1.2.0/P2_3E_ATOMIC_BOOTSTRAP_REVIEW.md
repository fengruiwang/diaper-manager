# 小宝管家 v1.2.0 — P2-3E 首次本地库存基线的受控初始化协议

记录时间：2026-11-11。**仅 Feature 与合成 SDK/IndexedDB 测试；不在真实腾讯云调用采购、不安装 SQL、不初始化用户实际手机的库存。**

## 本轮代码交付

- `sync/inventory-bootstrap-coordinator.js`：首次本地库存快照的受控初始化协调器，默认**禁止实际写入**。允许在**明确、隔离的合成测试**中通过 `permitIsolatedLocalSeed:true` 加 `seedLocal:true` 模拟已获授权情况下的首次写入；真实产品不能照搬这个测试开关。
- `tests/p2-inventory-bootstrap-coordinator.test.cjs`：17 组源逻辑安全场景。
- `tests/idb-atomic-inventory.test.cjs` 新增 3 组对**实际 `idb-outbox.js` 事务实现**的隔离验证，不只 Mock 一个 `initializeInventory` 函数：跨页面持久快照、已有 pending 队列、初始化事务执行前临时插入队列的拒绝和完整回滚。
- 开发分支 GitHub Actions JS **304/304 PASS**；PG16 原隔离合同保持通过。未对真实 CloudBase 运行 P2-3E。

## 安全协议及检查顺序

1. **必须人为显式调用 `initialize({readEnabled:true,...})`**；加载模块、构造对象时不访问网络、存储。
2. 验证 UUID 与 actor，调用现有 CloudBase `verifyAccess`，要求**当前实际会话对应本人家庭与 xb 应用授权**，不能复用之前浏览器页面的“一次 PASS”当未来永久权限。
3. 通过 `listActiveChildren()` 验证目标宝宝活跃、属于当前家庭并**不属于 `__xb_smoke_` 测试前缀**。该协调器是未来正式宝宝的初始化路径，不允许复用在真实虚拟测试宝宝上绕过分类规则。
4. **强制历史数据安全闸门**：必须存在可信的 `verifyHistoryClearance` 提供者，并返回与 family/child/actor 严格对应、经服务端真实验证的历史迁移收据，且独立备份验证、迁移核对和收据验证全部通过。当前**没有真实的历史迁移收据服务或验证者**，所以默认返回 `history-clearance-required`，绝不假定旧版 v1.1.2 中没有数据。
5. 读取新 IndexedDB 的本设备当前 actor 的 `inventory_snapshots`：只接受“未初始化” `null`；已存在任何快照，哪怕当前云端与本地数量相同，也不允许覆盖。
6. 完整扫描本设备该身份的 `operations`（包括已 ACK）。对任意目标宝宝已有操作拒绝首次初始化；重复 ID、跨身份、无宝宝 ID 的库存操作和超过 50 条操作均阻断；不会裁剪或静默丢弃已有事件。
7. 连续两次只读 `xb_read_inventory_reconciliation`，要求请求 operationIds 为空，两个响应都属于相同 family/child/actor，都是完整六尺码合法整数、合法 revision，且两次六尺码数量和 revision 必须**逐项相同**。任一数据不完整、服务器中途变化或错误，禁止写入本地。
8. 上述全部通过后，默认返回 `verified-preview-local-seed-disabled`，且始终 `uploadAllowed:false`。**没有任何远端采购写入**。
9. **仅隔离测试明确开启双开关时**，在真正调用 `idb-outbox.initializeInventory()` 前再核验本人授权、迁移凭证及本地队列。由现有 IndexedDB v2 同一 `readwrite` 事务检查快照与队列，提交六尺码和服务端 revision。另一标签页刚好插入库存操作时，事务必须拒绝初始化，不能抹掉队列。
10. 本地事务提交后第三次只读服务器，检查六尺码/版本是否变化；若变化，保留已写入的快照、标记需核对，**不能回退到已过时快照或开放上传**。服务器调用失败则标记“需重新核对”。所有结果都保证 `uploadAllowed:false`。

## 必须特别说明的当前不足

- **历史清理证明仍是一个模拟接口**。`verifyHistoryClearance` 在 Node 测试里由合成对象提供，尚没有服务器端实际可信迁移收据、历史备份验证链及签名/鉴权协议。普通浏览器对象或单纯选择“我已备份”并不可信，不能当作正式初始化权限。
- **现有 IndexedDB `initializeInventory()` 仍是可直接调用的底层接口**，其 `source:'verified-server'` 是数据字段，不是独立安全证明。正式发布必须限制它的调用路径，只通过已审核的协调器与真实历史凭据初始化，且需要清理旧 UI 中潜在的直接调用路径。当前模块未加载进生产 PWA。
- 即使成功初始化本地快照，也**没有**云端库存与客户端写入之间的原子锁或持久授权令牌；后续库存可被另一设备修改。因此不能因三次读取一致就永久设为 `initialized:true`，必须另行设计上传前实时 revision / 幂等回执检查。
- **测试宝宝不能经正式业务宝宝列表读取**，这是正常的测试数据隔离。未来要真实创建 `__xb_smoke_v1__` 并联调，需用单独受控的“test-only child”客户端路径，而不是放宽 `child-scope-guard`。
- 这不代表已经完成夫妻两账号真实采购、历史自动迁移、购买记录编辑或正式版本发布。

## 可观察状态（全部 uploadAllowed=false）

| 状态 | 含义 |
|---|---|
| `disabled` | 未打开显式只读检查，无调用 |
| `history-clearance-required` | 缺少真实可信的历史备份与迁移验证者，默认应出现 |
| `history-clearance-unverified` | 迁移收据缺失、字段不完整或错误范围 |
| `existing-local-snapshot` | 已有当前宝宝的 IDB 快照，禁止重建覆盖 |
| `existing-child-queue-preserved` | 目标宝宝存在任意队列记录，禁止重置 |
| `local-queue-or-snapshot-review-required` | IDB 操作不完整、重复、跨身份或读取错误 |
| `server-baseline-unverified` | 只读云端响应不完整、范围不符、缺少尺码等 |
| `server-changed-before-bootstrap` | 双次只读之间数量或 revision 不同 |
| `verified-preview-local-seed-disabled` | 通过两次云端检查，但未授权写本地快照 |
| `local-bootstrap-transaction-rejected` | IDB 事务并发冲突或存储写入失败，视为未创建 |
| `local-seeded-upload-still-disabled` | **仅合成测试**已提交新 IDB 快照且第三次云端检查通过；仍禁止上传 |
| `local-seeded-cloud-changed-review-required` | IDB 写入后服务器版本变化，保留快照但必须复查 |
| `local-seeded-cloud-recheck-unverified` | IDB 写入后服务器读取失败，保留快照但必须复查 |

## 下一轮开发顺序

1. **真实历史兼容性审计及收据协议**：以只读方法检查旧版 v1.1.2 存储结构，先提供完整备份和可验证的恢复方式，再设计迁移幂等和冲突处理；不得用“服务器空”推断“历史空”。
2. **限权初始化入口**：删除普通 UI 直接调用 `initializeInventory` 的可能路径，确保所有 bootstrap 经过真实服务端证明，不能通过设置布尔值绕过。
3. **测试宝宝独立联调**：对实际 CloudBase 中安装 019/020、新建测试宝宝、测试库存/采购/停用及保留审计，**用户必须单独明确授权后才可运行**；需要独立测试页面，不能穿透正式宝宝筛选守卫。
4. **上传前最终一致性复核**：设计 revision/回执和账号切换安全检查，然后才可考虑 Outbox 的首次真实发送。
5. **用户测试文件交付**：任何需要手动测试的轮次，必须在对话正文给出全部文件、上传位置、步骤、预期状态和安全限制。

## 本轮用户操作

**无需用户上传文件、运行 SQL 或重新登录。** 目前默认`verifyHistoryClearance` 缺失，真实浏览器运行只会被安全阻断。隔离测试已经覆盖拟议条件；下一轮要先完成可验证的历史迁移与备份方案。
