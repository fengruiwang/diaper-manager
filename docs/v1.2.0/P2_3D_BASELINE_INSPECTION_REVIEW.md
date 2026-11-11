# 小宝管家 v1.2.0 — P2-3D 首次库存基线只读检查（设计与隔离验收）

更新：2026-11-11。**开发分支已实现并在合成数据中验证；尚未部署真实 CloudBase，也没有实际读取生产库存或更改任何业务数据。**

## 为什么不能直接开启“首次同步”

P2-3C 已在真实电脑和手机网页通过“有效会话、同一家庭、本人 xb 授权”的只读权限检查。但这**不等于**某个宝宝的六尺码库存初始值、安全的 IndexedDB snapshot、历史已确认操作与现有 pending 队列能对应。

- 盲目把云端零库存覆盖手机已有纸尿裤，可能丢掉未迁移的历史。
- 盲目把本地 60 片和服务器已记过的 60 片再次相加，会重复入库。
- 旧的已 ACK 操作突然在云端找不到，可能是服务器回滚或数据恢复异常，不能再上传一次来“修复”。
- 初始库存已变化时，旧 revision 不能被当成新的权威版本。
- 需要继续兼容旧版 `localStorage['xiaobao_diaper_planner_v1']`；本轮不读取或修改旧版存储。

## 本轮已完成

**新模块**：`sync/inventory-baseline-inspector.js`。它复用现有真实接口：
- `sync/cloudbase-access-preflight.js` 的 `verifyAccess`，要求真实 SDK session、RLS 家庭成员与本人 xb 应用授权；
- `sync/cloudbase-child-reader.js` 的 `listActiveChildren`，要求该宝宝属于当前家庭、活跃且不是 `__xb_smoke_` 测试标识；
- `sync/idb-outbox.js` 的 `list(scope,{includeAcked:true})` 和 `readInventory(scope,childId)`；**只调用这些逻辑读取方法，不提交更改**。注意：第一次打开 IndexedDB adapter 可能创建/升级空的对象存储结构，但不会删除或重置现有库存/操作记录；
- `sync/cloudbase-inventory-client.js` 的 `readReconciliation`，只调用 `xb_read_inventory_reconciliation` 的服务器**读取 RPC**，在服务器范围内验证六尺码数量/修订号以及选定操作 ID 的 ACK；
- **不会调用** `initializeInventory`、`commitInventory`、`reconcileInventory`、`applyOperation`、`recordResult`、任何表写入、购买或历史迁移。

**合成测试**：`tests/p2-inventory-baseline-inspector.test.cjs` 的 **15 组用例**，并将新模块加入完整 Node 回归；对应开发分支完整测试已完成 **284/284 PASS**，隔离 PostgreSQL 合同另行通过。合成 SDK 集成测试含真实的三个已实现适配器（Access / Children / Inventory）和模拟服务器 RPC；**不等于云端业务真机通过**。

## 只读检查顺序

1. 必须由使用者**显式设置 `readEnabled:true`**，模块加载/创建本身零网络访问。
2. 核验 familyId、childId、actorUid 格式及真实登录授权；任何不确定均终止。
3. 检查该宝宝为授权家庭中**活跃、非测试**的宝宝。否则不读库存或 outbox。
4. 读取本设备对应家庭及 actor 的全部 IndexedDB 操作（**包括已 ACK**）和当前宝宝 snapshot；已存在操作不能因新云端快照而被清空。
5. 任意丢失/损坏 ID、跨 actor/family 行、超过当前 RPC 每请求 50 条限制或本地 snapshot 缺字段/非 `verified-server` 来源，都返回需人工核对；不会自动截断旧操作。
6. 调用一次真实只读 reconciliation RPC，要求完整六尺码、非负整数库存、合法 revision、同一个 family/child/actor、服务端返回全部待检查 ID，ACK 集合必须是请求集合的子集。
7. 对比本地与云端。**任意结果均返回 `uploadAllowed:false`、`localUnchanged:true`**，此模块永远不批准上传或更改本地库存。

## 核验结果码（都不是开放上传许可）

| 状态码 | 意义 / 后续处理 |
|---|---|
| `disabled` | 未主动打开只读检查，零请求 |
| `authorization-unverified` | 登录/家庭/app 授权未获证实 |
| `child-read-unverified` / `child-not-active-or-test-excluded` | 宝宝身份、活跃状态或测试排除规则未通过 |
| `local-baseline-or-queue-review-required` | 本地库存来源不可信、记录异常、过多操作/不可读取 |
| `cloud-snapshot-or-receipt-unverified` | RPC 数据不完整、身份/ID 回执不匹配、网络错误等 |
| `previous-ack-missing-server` | 本地已经确认的操作从云端“消失”，需调查恢复/回滚 |
| `manual-queue-conflict-review` | 有冲突或被阻断的操作，不能无声覆盖 |
| `pending-queue-preserved` | 尚有待发送/重试事件；即便云端已经收到，也不能擅自把 IDB 标记 ACK |
| `initial-baseline-not-created` | 尚无当前宝宝的正式、经验证 IndexedDB 基线；**不能默认初始化为零** |
| `snapshot-differs-from-cloud` | 两端六尺码/修订号不同，需独立的安全 reconciliation |
| `snapshot-matches-cloud-upload-still-disabled` | 本地已验来源的 snapshot 与当前云端读一致，但仍**不允许上传** |

结果只暴露状态、六尺码已核验与否、操作计数、最多六个不一致的尺码名称。不会输出真实 family ID、child ID、actor UID、价格、Token、具体库存数值或购买明细。

## 下一阶段必须另行完成的“可提交初始化”协议

只读检查在设计上不具备写入许可。真正的 `initialized:true` 必须另外经过严格审查、明确发布开关及真实环境验收：

1. 定义明确的“历史迁移先后关系”：正式 v1.1.2 旧数据在迁移前，云端新库空并不代表手机本地库存为零。必须先完成**可恢复备份、历史 schema 对照和去重核验**，不能因为云端是空库就初始化空历史。
2. 明确云端属于哪个非测试宝宝、六尺码完整快照、版本号及每设备/每账号的待同步队列范围。
3. 使用事务安全方式写入新的 IDB 初始化快照；若该宝宝已有任意旧队列/快照，必须**拒绝自动初始化**而非清空。
4. 在首次初始化与随后启用上传之间再次核对服务器 revision 和会话/权限，防止检查后库存已变化（TOCTOU）。
5. 旧库存快照或真实采购仍不能依赖“填入 `source:'verified-server'` 字符串”就被视为证明：需要由受审查的服务器读取和本地原子写入链路实际生成。
6. 实际 CloudBase 创建/采购、备份迁移、修改正式 PWA、启用 outbox 上传依旧是**需要用户单独授权的后续阶段**。当前 `P2-3D` 不应被标为 `PASS_REAL`。

## 用户当前是否需要测试？

**本轮不需要手工测试、上传文件或执行 SQL。** 目前真实 CloudBase 新业务表仍尚未建立测试宝宝；即使现在上传检查页，也只能得出“宝宝不存在/没有库存基线”的结果，反复测试不能证明同步正确。

下一轮如果准备让用户真实测试，必须**在对话正文直接发送测试文件链接、上传目标、完整操作步骤、预期代码、失败反馈和不可触碰的数据边界**，不能只放 GitHub 文档中。

## 文件

- `sync/inventory-baseline-inspector.js`
- `tests/p2-inventory-baseline-inspector.test.cjs`
- `docs/v1.2.0/P2_3D_BASELINE_INSPECTION_REVIEW.md`

仅保存在 `feature/cloudbase-sync-v1.2.0`。真实生产 `main` 与现有 CloudBase 业务数据、两名成员和 v1.1.2 本地存储均未修改。
