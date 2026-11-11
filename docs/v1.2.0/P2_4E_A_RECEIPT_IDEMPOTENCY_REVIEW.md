# 小宝管家 v1.2.0 — P2-4E-A 迁移收据去重、权限预检与双连接竞争

更新：2026-11-11。状态：**隔离 PostgreSQL 16 + JavaScript 合成测试通过；真实 CloudBase 未部署 021，正式旧版历史未迁移。**

## 本轮完成

1. `cloudbase/sql/021_xb_migration_receipt_preflight_DRAFT_DO_NOT_DEPLOY.sql`：
   - 基于现有私有 `public.xb_migrations` 表新增两个 **唯一性索引**：`(family_id,child_id,source_format)` 一宝宝一旧版首次导入，`(family_id,source_format,source_sha256)` 防止同一个家庭将同一份旧版备份导入另一个宝宝。原 `PRIMARY KEY(family_id,migration_id)` 继续防止相同 ID 重用。
   - 新增 `public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)`，**仅管理员 + xb 应用授权**可调用；函数体内再次检查 `auth.role()`、`auth.uid()`、owner 权限和当前 `primary` 非停用宝宝。即使 CloudBase RPC 网关绕过 SQL EXECUTE ACL，匿名及其他成员也必须在函数内部被拒绝。
   - 只检查收据/目标宝宝是否已有业务数据，返回固定状态；不接收 JSON 原始备份、不插入任何真实业务数据、**不预留迁移名额**。任何结果固定 `receipt_committed:false,can_upload:false,can_commit:false`。它是只读设计预检，不能绕过正式迁移审批。
   - **此文件虽不插入数据，但运行会 CREATE INDEX 和 CREATE FUNCTION（数据库 DDL）**，不能称为可直接运行的“只读 SQL”；文件名明确 `DRAFT_DO_NOT_DEPLOY`，没有授权在共享真实 CloudBase 安装。

2. `tests/postgres/p2_migration_receipt_preflight_contract.sql`：
   - 只在 disposable PG16 创建**合成家庭/宝宝/收据**测试数据，检查空正式宝宝计划状态、已有业务数据冲突、相同备份重复、不同备份重试、同备份映射到另一个宝宝。
   - 验证管理员访问许可；普通家庭成员、陌生人、匿名（特意模拟网关给 anon EXECUTE）均被函数体拒绝；客户端无法直接读取私有收据。
   - 验证两个唯一索引会拦截不同迁移 ID 导致的重复收据，模拟部分业务写入失败时 SQL 子事务回滚。不代表完整业务原子迁移 RPC 已经实现。

3. `tests/postgres/p2_migration_receipt_concurrency.sh`：
   - 在 CI 的临时 PostgreSQL 服务中启动**两个独立 psql 连接**，竞争同一家/宝宝的迁移收据，均采用与既有 009 采购 RPC 相同的 `xb.inventory.family:` 咨询事务锁域。
   - 两个请求用不同 migration_id 和不同 source_sha256。**实测只有一个事务 COMMIT，另一个被唯一索引拒绝，最终数据库只留一条收据**。这比顺序调用两次更接近夫妻设备同时提交的实际竞争，但目前只测试收据表，不是完整迁移业务。

4. `sync/cloudbase-migration-receipt-preview.js` 与 `tests/cloudbase-migration-receipt-preview.test.cjs`：
   - 显式调用才向草案 RPC 发起一次只读预览，必须有既有 CloudBase 会话；SDK 错误脱敏、不输出真实家庭/宝宝/哈希值。
   - 8 项合成 SDK 测试覆盖无会话、身份冲突、非法摘要、权限拒绝、返回恶意“可上传”等情形。所有输出固定 `canUpload:false,canCommit:false,canReplaceLocalState:false,receiptCommitted:false`。
   - 该 RPC **目前不存在于实际 CloudBase**，因此不可将这个客户端接入正式 PWA；需要单独授权 DDL 后才可能执行真实 SDK 只读验收。

## 结果和适用边界

| 验收环节 | 状态 |
|---|---|
| Node 回归 | **364/364 PASS**（较 P2-4D 新增 8 项） |
| PostgreSQL 基础权限/收据索引/原子回滚合同 | **PASS（独立临时 PG16）** |
| 两个真正数据库连接并发插入同宝宝收据 | **PASS（一个成功，一个 UNIQUE 拒绝）** |
| 真实 CloudBase 021 安装 | **NOT AUTHORIZED / NOT DEPLOYED** |
| 真实夫妻双账号尝试迁移 | **NOT TESTED** |
| 完整的历史记录、库存/成长/价格原子导入 | **NOT IMPLEMENTED** |
| 正式 v1.1.2、main / GitHub Pages | **UNCHANGED** |

## 必须先解决的 P2-4E-B 技术问题

1. **收据只能最后落库**。目前 021 只是预览/唯一性约束，不实现提交；不得直接向 `xb_migrations` 插入“成功”标志来解锁 `P2-3E`。必须在同一数据库事务里完整写入数据并核对数量、汇总、revision，然后最后写入收据；任何一步失败整笔回滚。
2. **服务器核验实际内容而非相信客户端哈希**。未来迁移 RPC 必须校验源备份内容及字段映射，并由服务器自己计算规范内容摘要。纯客户端给出的 `sourceSha256` 只是查询提示，不能作为迁移成功/身份/来源证明。
3. **历史采购不是新库存增量**。现有 `xb_transactions` 要求外键绑定库存操作，而早期购买记录不能再加到新库存。需设计准确可审计的 `migration_baseline` / `legacy_transaction_id` 表达及消费历史保存机制，保证所有历史购买/消耗记录既保留又不重复加减现存库存。
4. **当前表结构没有专门的报价/参考价明细表**，需明确用哪些不可丢失的 JSONB 归档或业务表保存，以及如何转换为未来可编辑、可同步的业务对象。宝宝资料、体重/成长、库存基线、目标、参考价、比价、所有历史记录都要完整映射；不能只迁库存、采购就生成成功收据。
5. **首次迁移与断网队列冲突**：和 009 一样使用家庭级咨询事务锁，并用唯一键阻止多端抢先导入；空白云端并不意味着允许丢弃旧版离线记录或覆盖本地 v1.1.2。初始基线恢复仍需独立备份/迁移收据核验。
6. **安全及发布**：将完整迁移提交接口纳入 PostgreSQL 单元/多连接测试、SDK 身份负面测试、真实虚拟宝宝隔离验收；完成可回退方案并获得用户分别对 DDL、真实写入和正式发布的明确批准。

## 本轮是否需要用户操作？

**不需要。** 不执行 021、019、020 任何真实 SQL，不上传历史 JSON，不登录新账号，不修改真实手机或云端业务数据。后续如确实需要真实网页验收，仍由开发对话直接提供所有文件、上传目录、完整操作步骤与预期脱敏状态，不要求用户自行寻找文档。
