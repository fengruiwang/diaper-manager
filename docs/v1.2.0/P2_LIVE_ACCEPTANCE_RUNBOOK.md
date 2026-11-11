# 小宝管家 v1.2.0：P2 CloudBase 真实部署与测试闸门

更新时间：2026-11-11。**此文档不是授权部署数据库。** 本轮只准备审计脚本和独立自动化测试，未经用户确认不得执行 005/008/009/010，也不迁移手机 v1.1.2 数据。

## 已完成的真实验证

- 家庭管理员 A、普通成员 B、昵称本人编辑/恢复、越权拒绝、邀请码权限、正式版原始数据核对：用户 2026-11-11 反馈全部通过。
- P3 虚拟 IndexedDB 库存、断网录入、离线刷新/重开、模拟 ACK：用户反馈 D1 + D2a/D2b/D2c 全部通过。
- 这些**不等于真实 CloudBase 业务数据双端同步已经通过**。

## P2-0 — 首次部署前只读预检（真实 CloudBase 11/11 已通过）

1. 使用腾讯云 CloudBase **现有** `xiaobao-family` 环境的 PostgreSQL SQL 控制台；不要创建新的环境或新的家庭，不要在客户端网页粘贴管理员数据库凭证。
2. 打开 GitHub 开发分支 `cloudbase/sql/011_xb_p2_predeploy_readonly.sql` 并完整复制到 SQL 编辑器。
3. 检查内容以一条 `SELECT` 开始和分号结束，仅查询 `pg_catalog`、`families`、`family_members`、`family_app_access` 等表及函数存在性。
4. 运行后应返回**一行 11 个布尔字段**，首次部署时预期**全部 true**。字段名包括 `existing_one_family_preserved`、`existing_two_members_preserved`、`first_deploy_business_tables_absent`、`legacy_stock_only_rpc_absent`。
5. 向开发对话反馈“11/11 true”即可；有 false 则仅提供字段名及 true/false，不要自行运行修复 SQL、不要泄露家庭 UUID、邮箱或凭证。

本检查不会触发迁移，不更改库存，也不授予后续写入操作权限。

**真实结果（2026-11-11）**：用户已执行 011，11 项全部为 true。该步骤标记 PASS_REAL，不需要重新运行。

### P2-0b — CloudBase 环境函数能力只读预检（真实 CloudBase 7/7 已通过）

真实 CloudBase 与 GitHub CI 的 PostgreSQL 16 容器可能有不同的系统函数或限制。因此在首次执行任何 DDL 之前，运行 `cloudbase/sql/013_xb_p2_capabilities_readonly.sql`：它只有一条 SELECT，不接触家庭私有资料，不创建业务表。

预期返回一行 **7 个 true**，依次核对 PostgreSQL 版本、SHA-256、UUID、家庭锁哈希、事务级咨询锁、auth.claim 函数和家庭 xb 权限函数。任何 false **立即停止**，不要继续 005/008/009/010。

**真实结果（2026-11-11）**：用户已执行 013，7 项全部 true。011（11/11）及 013（7/7）共 18 项真实环境检查均已通过，**无需重复执行**。

这不等于授权部署。即便 11 + 7 项全部通过，仍须取得用户对 005/008/009/010 数据库 DDL 的**明确同意**。

## P2-1 — 已获限定授权，但共享集群备份闸门受阻（尚未执行）

2026-11-11 用户明确授权：**仅在现有 `xiaobao-family` PostgreSQL 执行 005/008/009/010 的空业务表、RLS、2 个 RPC，并执行 006/012 核验**。明确禁止真实历史数据迁移、虚拟/真实宝宝创建、向 main/develop 合并、生产发布。**授权不意味着现在可执行 DDL：用户要求先证实备份与恢复能力。2026-11-11 截图已确认 BACKUP_GATE=BLOCKED_SHARED_INSTANCE。**

两项真实预检均已通过（011=11/11，013=7/7）。开始实际安装前仍需单独确认：
- 用户已授权在现有 CloudBase `xiaobao-family` PostgreSQL 里创建**空业务表**、安全 RPC；不会导入历史数据，**不会创建真实或测试宝宝**，但仅能在备份/恢复闸门通过后执行。
- 检查既有家庭为 1、成员为 2、xb 授权为 2；确认没有 P2 旧表和 007 旧接口，且 CloudBase 环境可备份/恢复 schema。
- 审核 `005`、`008`、`009`、`010` 的完整 SQL 与权限边界及失败回退方案；**每个 DDL 是真实数据库写操作，必须明确同意**。

**备份恢复前置检查（当前优先）**

**真实界面结论（2026-11-11）**：用户 CloudBase PostgreSQL 17.11 是**共享集群**；备份页面写明“当前共享集群暂不提供相关能力”；独立 TencentDB PostgreSQL 列表为空。没有证据表明当前账号能访问一个可验证恢复点。**暂停在此，后续安装步骤仅供审查，不要执行。** 不能断言服务商内部不存在备份，也不能凭空认为可以恢复。

1. CloudBase PG 模式不能使用传统文档数据库回档功能，必须以 PostgreSQL 备份恢复链路为准：https://docs.cloudbase.net/database/backup
2. 在 CloudBase `xiaobao-family` → PostgreSQL 数据库 → 配置，先确认共享/独享实例类型与是否有备份入口。云开发控制台可见功能以实际界面为准：https://docs.cloudbase.net/database/postgresql/database-management
3. 若能访问腾讯云 PostgreSQL 实例，核对与 CloudBase 环境的真实关联及最近成功备份；如支持手动备份，确认备份完成并记录时间、恢复方式（不泄露实例 ID）。官方参考：https://cloud.tencent.com/document/product/409/33945 和 https://cloud.tencent.com/document/product/409/68277
4. 若无法找到/使用备份入口，标记 BACKUP_GATE=BLOCKED，**不执行 005/008/009/010**，不因“物理数据库有自动备份的说法”而默认可恢复，也不擅自升级共享实例。
5. 备份可能是整实例级别、克隆恢复也可能产生新实例和费用。当前 CloudBase 的 `auth`、`storage` 与业务数据可能共用 PostgreSQL，不得为回退 P2 随意重放整库覆盖既有身份及家庭资料。
6. 一旦备份方案可操作，需留存备份完成状态、可恢复时间点与进入恢复流程的入口。**只查看恢复方案，不执行真正恢复。**
7. 旧版 v1.1.2 本地 JSON 备份仅是额外保护，不能代替 PostgreSQL 实例备份。

### 共享集群当前可行的后续选项（均不代表现在可写库）

1. **优先向 CloudBase 官方工单咨询**：现有 PostgreSQL 共享集群是否提供可供用户验证的备份快照/受控恢复服务、是否允许 SQL/pg_dump 逻辑导出及恢复、是否支持只恢复指定业务 schema/表、需要哪些权限及费用。不提供 API Key、OTP 或其他凭证。
2. 如果不能提供备份，可先只在**完全独立的测试环境**排练全部迁移和反向脚本。创建新环境可能计费，须另得用户授权；无论隔离环境测试多成功，都**不是现有生产共享 PG 的备份**。
3. CloudBase PG “环境分支”虽支持复制，但官方截至 2026-11-11 标为 **Private Alpha、邀请开通、无 SLA、不适用生产链路**：https://docs.cloudbase.net/database/postgresql/branching 。不能将其视为已可用且可靠的恢复方法。
4. 若将来以**不依赖备份的严格受限回退方案**取代原要求，必须明确说明与真正备份的差距，准备经审查且在隔离库演练的反向操作，仅在用户重新批准风险后才讨论部署。当前限定授权不包含放弃恢复能力这一前提。

**安全边界：** 不因 P2 代码已通过 CI、011/013 全 true 或正式 v1.1.2 在本机有备份就放行数据库 DDL。

审批后按下列顺序执行（不可跳过或调换）：

| 顺序 | 文件 | 行为 | 是否会写 schema |
|---|---|---|---|
| 0 | 011_xb_p2_predeploy_readonly.sql | 检查已有家庭与未部署状态 | 否 |
| 0b | 013_xb_p2_capabilities_readonly.sql | 验证实际 CloudBase RPC 运行依赖（7 项） | 否 |
| 1 | 005_xb_core_schema_draft.sql | 仅建空宝宝、体重、库存、事件、迁移收据表 | 是，必须先审批 |
| 2 | 006_xb_core_schema_postflight.sql | 检查空表、RLS、现有家庭不变 | 否 |
| 3 | 008_xb_transactions_schema_draft.sql | 创建空采购历史表 | 是，必须先审批 |
| 4 | 009_xb_purchase_atomic_rpc_draft.sql | 安装带采购详情的原子库存 RPC | 是，必须先审批 |
| 5 | 010_xb_inventory_reconcile_rpc_draft.sql | 安装受权限限制的库存一致性读取 RPC | 是，必须先审批 |
| 6 | 012_xb_p2_postdeploy_readonly.sql | 核实结构、权限、RPC、空数据状态 | 否 |

**禁止执行 007**。009 已替换早期不安全的 9 参数无采购流水接口。

### P2-1 具体授权边界与中止条件

- 授权范围（若用户同意）：只在**现有** `xiaobao-family` 的 PostgreSQL `public` schema 建立 7 张**空**业务表（`xb_children`, `xb_baby_profiles`, `xb_weight_records`, `xb_inventory`, `xb_inventory_operations`, `xb_migrations`, `xb_transactions`）、相应索引/RLS 和 2 个函数（`xb_apply_inventory_operation` 与 `xb_read_inventory_reconciliation`）。
- 005/008/009/010 含 `BEGIN`/`COMMIT`，应在 SQL 控制台**整份脚本**执行，不要手动截取分句；006 与 012 仅用于检查。
- 现有的 `families`、`family_members`、`family_app_access`、`family_invites`、成员备注和审计表**不重建、不删除、不更新**；新表通过外键关联已有家庭。受控 DDL 可能在执行期间对关联表造成短暂元数据锁定，正式操作前可安排短暂空闲窗口。
- **不创建任何宝宝（真实或虚拟）、库存数量、历史采购、体重；不做旧版备份导入、手机 PWA 更新或权限撤销。**
- 每份写入脚本执行后只进入计划中的下一步；005 执行完必须先检查 006 全部 true 后再运行 008；全部完成后在任何业务写入之前运行 012，预计 12/12 true。
- **任何 SQL 报错或检查 false，都立即停止。** 不能自动重复执行全套流程，不用 `DROP TABLE`、`TRUNCATE` 等方法“重来”，也不能假设每份 SQL 执行失败都已自动回滚；要确认具体事务状态和已创建对象。对生产现有家庭数据的操作始终禁止。
- 在 DDL 前由用户确认 CloudBase 可恢复的数据库备份/快照或其它可验证恢复方案。旧版 v1.1.2 本机 JSON 备份只保护旧版业务数据，**不能替代云数据库 schema 备份**。

如果某一 SQL 报错，立即停止后续步骤；不重复运行所有脚本，也不删除家庭/成员或原有旧版记录。收集脱敏错误码、脚本文件名、执行步骤，由开发评估修复。除已审查的 SQL 外，不执行临时补丁。

## P2-2 — 初次安装验收（待审批）

部署完成后，在**创建任何测试宝宝和测试库存之前**运行 012，期望一行 **12 个 true**，重点：
- 七张业务表存在，七张表启用 RLS；
- 原家庭 1、成员 2、xb 授权 2；
- 首次业务表全部空，没有自动导入真实旧版数据；
- authenticated 角色不能直接 INSERT/UPDATE/DELETE 库存/采购；
- anon 不能读取库存/采购；迁移收据对客户端不可见；
- 旧 9 参数库存 RPC 不存在；新原子采购 RPC 和一致性读取 RPC 存在且为 SECURITY DEFINER；
- 昵称修改 RPC 仍保留。

这只是结构/权限的静态验收；**还需要真实 SDK 的权限和采购流程负面测试**。

## P2-3 — 真实业务联调（独立开发项，尚未开始）

必须先提供独立的测试操作入口和显式创建虚拟宝宝的安全途径。当前 `xb_children` 对浏览器只有 SELECT，无直接 INSERT 权限；不能为了“测试成功”让浏览器直接写表或偷偷调用管理员 SQL。先设计并隔离测试创建虚拟宝宝的授权 RPC，再让用户批准测试数据写入。

之后真实联调最低测试集：
- A/B 同家庭登录；操作的是**虚拟宝宝 / 虚拟库存**，不与旧版主宝宝 `legacy_slot='primary'` 混淆。
- A 采购 +60，B 采购 +80，两人查询同一 S 库存 140，购买流水两条、金额为整数分。
- 同 ID 原样重试不重复入库；同 ID 换金额/品牌拒绝；ACK 丢失后恢复能去重。
- 消耗、撤销与盘点版本冲突；不得出现负库存或无采购详情的加库存。
- 普通成员及陌生用户权限验证；现有 A/B 两人不删除、不撤权。
- PWA 断网操作在本地事务落盘，恢复后自动补传；刷新/离线重开安全；服务端故障时不伪造成功。
- 全部测试与原本 v1.1.2 数据隔离。历史迁移另开一项，经用户批准。

## 通过条件与发布限制

SQL CI 成功、P1 双账号成功、P3 纯本地离线成功，是 P2 的前置条件，**不能替代 P2 云端部署 + 真双端联调**。

未经用户明确批准，不合并 `main` 或 `develop`、不发布版本、不变更现有 GitHub Pages 生产站点、不上传真实历史 JSON。
