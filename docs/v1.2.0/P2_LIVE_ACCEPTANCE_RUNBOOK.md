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

## P2-1 — 005/006 与 008/014 已通过；009 ACL 待 017 最小修复与复验（暂停 010）

2026-11-11 用户明确授权：**仅在现有 `xiaobao-family` PostgreSQL 执行 005/008/009/010 的空业务表、RLS、2 个 RPC，并执行 006/012 核验**。明确禁止真实历史数据迁移、虚拟/真实宝宝创建、向 main/develop 合并、生产发布。**授权不意味着现在可执行 DDL：用户要求先证实备份与恢复能力。2026-11-11 截图已确认 BACKUP_GATE=BLOCKED_SHARED_INSTANCE。**

两项真实预检均已通过（011=11/11，013=7/7）。开始实际安装前仍需单独确认：
- 用户已授权现有 `xiaobao-family` 的**空业务表**和安全 RPC，且明确接受仅限 P2-1 的无可用备份剩余风险。绝不导入历史数据、不创建真实或测试宝宝。
- 检查既有家庭为 1、成员为 2、xb 授权为 2；确认没有 P2 旧表和 007 旧接口，且 CloudBase 环境可备份/恢复 schema。
- 审核 `005`、`008`、`009`、`010` 的完整 SQL 与权限边界及失败回退方案；**每个 DDL 是真实数据库写操作，必须明确同意**。

**备份恢复前置检查（当前优先）**

**真实界面结论（2026-11-11）**：用户 CloudBase PostgreSQL 17.11 是**共享集群**；备份页面写明“当前共享集群暂不提供相关能力”；独立 TencentDB PostgreSQL 列表为空。没有证据表明当前账号能访问一个可验证恢复点。**用户后续已明确接受本次 P2-1 无可用备份的剩余风险；本段仅保留历史排查结果，不再阻止被授权的空结构增量部署。** 不能断言服务商内部不存在备份，也不能凭空认为可以恢复。

1. CloudBase PG 模式不能使用传统文档数据库回档功能，必须以 PostgreSQL 备份恢复链路为准：https://docs.cloudbase.net/database/backup
2. 在 CloudBase `xiaobao-family` → PostgreSQL 数据库 → 配置，先确认共享/独享实例类型与是否有备份入口。云开发控制台可见功能以实际界面为准：https://docs.cloudbase.net/database/postgresql/database-management
3. 若能访问腾讯云 PostgreSQL 实例，核对与 CloudBase 环境的真实关联及最近成功备份；如支持手动备份，确认备份完成并记录时间、恢复方式（不泄露实例 ID）。官方参考：https://cloud.tencent.com/document/product/409/33945 和 https://cloud.tencent.com/document/product/409/68277
4. 若无法找到/使用备份入口，客观能力记为 BACKUP_GATE=BLOCKED；不得默认可恢复，也不擅自升级共享实例。**用户已明确接受此风险，仅本次 P2-1 空结构部署可在严格逐阶段验收条件下继续。**
5. 备份可能是整实例级别、克隆恢复也可能产生新实例和费用。当前 CloudBase 的 `auth`、`storage` 与业务数据可能共用 PostgreSQL，不得为回退 P2 随意重放整库覆盖既有身份及家庭资料。
6. 一旦备份方案可操作，需留存备份完成状态、可恢复时间点与进入恢复流程的入口。**只查看恢复方案，不执行真正恢复。**
7. 旧版 v1.1.2 本地 JSON 备份仅是额外保护，不能代替 PostgreSQL 实例备份。

### 2026-11-11 风险知情变更与已提供的 CSV 文件

用户明确表示不需要因这次 P2-1 增量建空表而付费升级，接受共享 PostgreSQL 当前没有可用备份恢复入口的剩余风险，并要求继续按已授权范围执行。先前的 `BACKUP_GATE=BLOCKED_SHARED_INSTANCE` 是客观能力状态，不得改写为“已存在备份”；本阶段记录为 `BACKUP_EXCEPTION_USER_ACCEPTED_FOR_P2_1`。**此风险接受不适用于未来真实历史数据迁移。**

用户在本次会话上传 5 份原有业务 CSV，已离线检查：`families` 1 行、`family_members` 2 行、`family_app_access` 2 行、`family_member_alias_audit` 6 行、`family_invites` 2 行。家庭和成员引用校验通过，包含 owner/member 两种角色、2 个 xb 授权。**这些 CSV 仅是用户提供的数据备份，不含 schema、RLS、函数与角色授权；不能等同完整可恢复备份**。邀请 CSV 可能包含敏感一次性 token，**绝对不得提交至 GitHub、公开日志或测试页面**。

运行方式采用“每阶段执行+立即核验+异常停止”：
- **已完成**：用户执行 `005_xb_core_schema_draft.sql`（含 BEGIN/COMMIT），006 实测 19/19 true；不要重跑 005/006。
- **已完成**：`006_xb_core_schema_postflight.sql` 实测 **19/19 true**，确认空业务表及原家庭权限正常。
- 如 SQL 控制台报错，**不自动重跑**；反馈脱敏错误与阶段，先查看当前已创建对象。可能存在部分事务影响，须核对状态再处置。
- **已完成**：用户执行 008 后运行 014，真实 CloudBase **15/15 true**；无需重跑。**当前下一步**：`009` → `015`（只读 21/21 true）；014 未通过前不能运行 009 的旧限制已经满足。009/015 通过后才进入 010 → 012。绝不执行旧 `007`。
- 始终不创建真实或虚拟宝宝、不插入采购或库存、不迁移旧版 localStorage、不同步正式 PWA、不合并 main/develop。
- 用户明示接受的是 P2-1 **增量空结构部署**的缺少可用备份风险，不代表同意其他高风险操作。该阶段可以在独立授权内推进，不需反复要求其购买/升级备份套餐。

**历史备份闸门说明**：以下早期“暂停”“不得执行”记录描述的是此前授权前状态；本次用户作出知情风险接受后，以本节新增决策为当前有效操作门槛。共享集群没有可验证恢复入口的事实仍然成立，不能因此声称已备份。

### 共享集群可选的额外保护措施（不影响已授权的本次 P2-1）

1. **优先向 CloudBase 官方工单咨询**：现有 PostgreSQL 共享集群是否提供可供用户验证的备份快照/受控恢复服务、是否允许 SQL/pg_dump 逻辑导出及恢复、是否支持只恢复指定业务 schema/表、需要哪些权限及费用。不提供 API Key、OTP 或其他凭证。
2. 如果不能提供备份，可先只在**完全独立的测试环境**排练全部迁移和反向脚本。创建新环境可能计费，须另得用户授权；无论隔离环境测试多成功，都**不是现有生产共享 PG 的备份**。
3. CloudBase PG “环境分支”虽支持复制，但官方截至 2026-11-11 标为 **Private Alpha、邀请开通、无 SLA、不适用生产链路**：https://docs.cloudbase.net/database/postgresql/branching 。不能将其视为已可用且可靠的恢复方法。
4. 对于任何后续带真实历史数据的迁移，须重新评估备份恢复或受控回退方案；本次明确的有限风险接受**仅适用于 P2-1 空结构部署**。

**安全边界：** 本次空表 DDL 可在用户有限风险接受下逐阶段执行；CI、011/013、CSV 均不代表完整数据库备份，也不授权更改既有家庭、成员或真实历史数据。

审批后按下列顺序执行（不可跳过或调换）：

| 顺序 | 文件 | 行为 | 是否会写 schema |
|---|---|---|---|
| 0 | 011_xb_p2_predeploy_readonly.sql | 检查已有家庭与未部署状态 | 否 |
| 0b | 013_xb_p2_capabilities_readonly.sql | 验证实际 CloudBase RPC 运行依赖（7 项） | 否 |
| 1 | 005_xb_core_schema_draft.sql | 仅建空宝宝、体重、库存、事件、迁移收据表 | 是，必须先审批 |
| 2 | 006_xb_core_schema_postflight.sql | **真实 CloudBase 19/19 true，已完成** | 否 |
| 3 | 008_xb_transactions_schema_draft.sql | **已完成**，空采购流水表 | 是 |
| 4 | 014_xb_p2_purchase_postflight_readonly.sql | **真实 CloudBase 15/15 true，已完成** | 否 |
| 5 | 009_xb_purchase_atomic_rpc_draft.sql | **当前下一步**，创建原子写入 RPC 及撤销唯一约束 | 是 |
| 5b | 015_xb_p2_atomic_purchase_postflight_readonly.sql | 009 安装后检查权限、旧接口、唯一约束和空数据（21/21 true） | 否 |
| 6 | 010_xb_inventory_reconcile_rpc_draft.sql | 安装受权限限制的库存一致性读取 RPC | 是 |
| 7 | 012_xb_p2_postdeploy_readonly.sql | 核实结构、权限、RPC、空数据状态 | 否 |

**禁止执行 007**。009 已替换早期不安全的 9 参数无采购流水接口。

### 第二阶段：008 → 014（当前待用户执行）

- 008 安装 **1 张空采购历史表** `public.xb_transactions`、`xb_transactions_history` 索引、库存事件关联的复合唯一约束和采购 RLS 读权限；不会插入任何采购或宝宝记录，不改动旧家庭内容。
- 在 SQL 控制台执行 **完整 008 文件**（含 BEGIN/COMMIT），显示执行成功后单独运行 **014 只读核验**。
- 014 返回 **1 行 15 列**：采购表存在、历史空、RLS 已启用、已登录可按 RLS 读取、匿名不可读取、普通客户端不能 INSERT/UPDATE/DELETE、家庭读策略存在、复合外键与库存事件唯一约束存在、历史索引存在、原家庭 1 / 成员 2 / xb 授权 2 保留。
- 任何 false 或 SQL 错误立即停止，不重跑 008，不开始 009/010，不清理真实家庭对象。仅反馈脱敏错误码或布尔字段，不上传数据库内容。
- `014` 新增的单行只读 SQL 不改变原 P2-1 授权范围，其 CI 已与 008 集成在隔离 PostgreSQL 中验证。

### 第三阶段：009 → 015（当前待用户执行）

- **009** 仅安装 `xb_apply_inventory_operation` 10 参数原子采购/库存写入 RPC，删除可能存在的旧 9 参数只写库存入口，并增加撤销唯一索引和反向操作一致性约束。009 代码本身不调用该 RPC，不创建任何宝宝或业务数据。
- 009 文件包含 `BEGIN;` 和 `COMMIT;`，**整份执行一次**；本次使用经过隔离 PostgreSQL 合同测试的开发分支版本。严禁执行 `007`。
- **真实反馈：**009 已安装后，用户执行 015，返回 `authenticated_can_execute_purchase_rpc=false`，所以该阶段**尚未通过验收**。其他收到的检查字段为 true。不能因为函数存在就跳过该权限异常。015 自身只读、不执行库存 RPC。
- **015 通过前禁止执行 010。** 若任何字段 false（尤其 `untrusted_roles_cannot_create_public`、`anonymous_cannot_execute_purchase_rpc`），立即停止，并将布尔结果发给开发对话审查；不自行执行 GRANT/REVOKE 或修复脚本。
- 009 和 015 不进行真实双账号购入测试，也不创建任何虚拟或真实宝宝；这一阶段仅验证数据库结构，实际联调后续另行授权。

### 009 / 015 权限异常：新增 016 只读诊断（当前唯一需要执行的 SQL）

- 状态：**009 已安装，015 未通过，010 未执行**；已得到用户真实 PostgreSQL 结果 `authenticated_can_execute_purchase_rpc=false`。
- 原因尚待核实：009 源文件有 `GRANT EXECUTE ... TO authenticated`，隔离 PG16 中 `has_function_privilege(..., 'EXECUTE')=true`，CloudBase 共享 PG17.11 的实际权限检查却为 false。不要推断是否是授权丢失、schema 使用权限或平台角色差异。
- 现在仅在 CloudBase 原数据库执行 `cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql`，一条只读 SELECT，返回 11 项诊断字段。**这里不要求全部 true**（例如 `effective_anon_execute=false` 是正常安全目标）；需按字段解释。
- 016 会展示是否确实有 authenticated 的显式 EXECUTE ACL、authenticated 对 public schema 的 USAGE、当前有效 EXECUTE、与已验证可用的别名 RPC 权限对比，以及函数所有者是否为 `cloudbase_postgres`。只返回布尔元数据，不读取家庭记录或隐私值。
- 如果 016 有异常，先提供字段名和值。后续只有确认根因之后才可制定**最小范围、仅针对该 RPC**的修复；不能直接重跑 009，不能修改任何已有家庭或身份系统对象，不修改整 schema 的授权。
- 官方文档提醒 CloudBase HTTP RPC 网关可能不严格依照 PG 函数 EXECUTE ACL 拦截请求；即使修复 GRANT，仍需后续以实际 SDK 负面测试确认函数体的身份和家庭权限检查。参考：https://docs.cloudbase.net/database/postgresql/rpc

### 016 实测回报与最小范围 ACL 修复 017（当前）

**2026-11-11 016 真机诊断**：`authenticated` 的有效 EXECUTE 和显式 GRANT **都是 true**；`anon` 的有效 EXECUTE 和显式 GRANT 也**都是 true**。两者均能使用 public schema；`PUBLIC` 通用 EXECUTE=false。前一次 015 曾报 authenticated EXECUTE=false、anon EXECUTE=false，存在时序差异；不能据此归因 CloudBase 权限自动变化。

**修复动机**：已在真实库发现对 `anon` 有显式授权，而原 009 只撤销 `PUBLIC` 默认执行权限。最小回收方式是仅针对这一份已存在的 10 参数采购 RPC 显式从 `anon` 撤销 EXECUTE。

1. 在原 `xiaobao-family` PostgreSQL SQL 编辑器中，从 Feature 分支复制 `cloudbase/sql/017_xb_p2_purchase_rpc_acl_repair.sql` 的**完整 SQL**（含 BEGIN / COMMIT），只执行一次。这个脚本检查精确函数签名，且只操作它的 EXECUTE ACL：`REVOKE FROM PUBLIC, anon`、`GRANT TO authenticated`。不会更改任何业务表、函数定义、家庭或用户资料。
2. 执行成功后**立刻重跑 015 只读 SQL**：预计 21/21 true，其中 `authenticated_can_execute_purchase_rpc=true` 与 `anonymous_cannot_execute_purchase_rpc=true` 为重点。
3. 随后再执行 `016_xb_p2_rpc_acl_diagnostic_readonly.sql` 只读 SQL：预期 `effective_authenticated_execute=true`，`explicit_authenticated_execute_grant=true`，`effective_anon_execute=false`，`explicit_anon_execute_grant=false`，`public_execute_grant_present=false`。其余列有 true/false 都可能符合环境，不要求 11/11 true。
4. 若 017 报错、015 非 21/21 true 或 016 仍见 anon EXECUTE=true：**立即停止**，不重跑 009/017，也不运行 010。将脱敏结果发送至开发对话检查数据库授权是否被平台规则改变。不要操作函数所有者或更改 schema 级权限。
5. 如果通过，仅能证明数据库授权元数据符合预期；**CloudBase 官方 RPC 网关可能忽略函数 EXECUTE ACL**，后续实际匿名/越权调用的拒绝仍需 SDK 负面测试。`009` 函数体已经显式校验 auth.role、auth.uid 和家庭 xb 权限，但未经真实联调不可标记云端权限完成。

**隔离回归证据**：PG16 里人为给 anon 授予 RPC EXECUTE，再运行 017、检查 anon=false/authenticated=true 并复查 015；只读权限修复的结构测试已加入 GitHub 回归。**这一步不触发任何真实数据写入**（除 017 对这一 RPC 的 ACL 变更）。

### P2-1 具体授权边界与中止条件

- 授权范围（若用户同意）：只在**现有** `xiaobao-family` 的 PostgreSQL `public` schema 建立 7 张**空**业务表（`xb_children`, `xb_baby_profiles`, `xb_weight_records`, `xb_inventory`, `xb_inventory_operations`, `xb_migrations`, `xb_transactions`）、相应索引/RLS 和 2 个函数（`xb_apply_inventory_operation` 与 `xb_read_inventory_reconciliation`）。
- 005/008/009/010 含 `BEGIN`/`COMMIT`，应在 SQL 控制台**整份脚本**执行，不要手动截取分句；006 与 012 仅用于检查。
- 现有的 `families`、`family_members`、`family_app_access`、`family_invites`、成员备注和审计表**不重建、不删除、不更新**；新表通过外键关联已有家庭。受控 DDL 可能在执行期间对关联表造成短暂元数据锁定，正式操作前可安排短暂空闲窗口。
- **不创建任何宝宝（真实或虚拟）、库存数量、历史采购、体重；不做旧版备份导入、手机 PWA 更新或权限撤销。**
- 每份写入脚本执行后必须立即核对：005/006 **已通过**，008/014 **已通过**；009 后运行 015，只有 21/21 true 才能继续 010；010 后运行 012，预计 12/12 true。
- **任何 SQL 报错或检查 false，都立即停止。** 不能自动重复执行全套流程，不用 `DROP TABLE`、`TRUNCATE` 等方法“重来”，也不能假设每份 SQL 执行失败都已自动回滚；要确认具体事务状态和已创建对象。对生产现有家庭数据的操作始终禁止。
- 用户已明确接受本次 P2-1 缺少可验证云数据库备份的剩余风险，且已自行下载现有表数据 CSV。CSV 和 v1.1.2 JSON 均**不能替代云数据库 schema 备份**；该风险接受不延伸至历史迁移。

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
