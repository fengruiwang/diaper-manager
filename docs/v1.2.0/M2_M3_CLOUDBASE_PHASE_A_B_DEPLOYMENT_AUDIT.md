# 小宝管家 V1.2.0｜正式 CloudBase 025–027 部署前审查及独立授权方案

审查基线：`7fcf224850da719b891cf7b863e065f91a6c64f7`；本文件对应后续 Feature 的阶段 A 默认锁定修订。**本文件不是用户授权**。本轮只读审计、代码修复、隔离 PostgreSQL CI；严禁在现有 `xiaobao-family` 执行 DDL/DML、RPC 业务写入，严禁修改 `main` / V1.1.2 和测试宝宝的 S140/两笔采购及审计。

## 1. 现有数据库状态：区分“历史实际验收”与“此刻实时结果”

真实 M1-02 浏览器与 SQL 验收曾证实：

- `001/003` 家庭、成员、授权与昵称体系正常；已完成 011、013、017、018、012 等专项只读/修复验收；
- `005/008/009/010` 提供正式共享模式的基础宝宝、库存、采购、审计以及受 RLS/权限保护的原子 RPC；不得执行废弃 `007`；
- `019` 创建/停用**测试宝宝**的 RPC 已安装，019A 与 020 后检曾通过；
- 两位账号真实测试购买 S60+S80 后，测试宝宝 `__xb_smoke_v1__` 的 S 为 **140，revision=2**，有对应采购和操作记录，必须原样保留；
- 已确认共享型 CloudBase PostgreSQL 环境的现有控制台未提供用户可验证的数据库恢复点。此前为**空表结构增量部署**接受过的风险，不自动扩展至正式历史迁移。

**截至本审查，尚未读取当前真实 CloudBase 系统目录。** 所以上述只能称作“此前真实验收过”，不能声称此刻亲自确认对象/权限未发生变化。首次阶段 A 授权申请前，运行集中只读脚本：

`cloudbase/sql/M2_M3_PHASE_A_READONLY_INVENTORY.sql`

它只包含 SELECT，分 6 个结果表核对服务器版本、对象/RLS/权限、精确 RPC 签名、必要字段、索引、匿名/已登录权限及不含家庭标识的 S140 计数。保留输出；如有异常，不执行任何部署脚本。**勿提供 SQL 控制台凭据、JWT、OTP、备份原文或家庭标识。**

CloudBase 官方目前将 Web SDK 的 `app.rdb().rpc(functionName, namedParams)` 说明为数据库函数调用，前端必须经数据库 RLS/服务端权限保护；SDK 本身并不提供跨多次调用的事务，M2 必须使用 022/023 各自单笔事务的服务端原子函数。真实 CloudBase PG17.11、网关响应、负载限制和 RLS 还须与 Docker PG16 结果单独区分。

## 2. 阶段 A 的七份 SQL：必须使用同一个获批 Feature SHA

| 顺序 | SQL | 建立的对象/权限 | 依赖 | 主要风险与阶段 A 限制 |
|---|---|---|---|---|
| 1 | `025_xb_create_primary_child_owner_only_DRAFT_DO_NOT_DEPLOY.sql` | 仅新建 `xb_create_primary_child(uuid)` 函数；**不执行，不 INSERT** | 005 `xb_children`、部分唯一索引、owner/grant 辅助函数、鉴权 | 新增 owner-only `primary` RPC；阶段 A **authenticated 无 EXECUTE**，不得建宝宝 |
| 2 | `021_xb_migration_receipt_preflight_DRAFT_DO_NOT_DEPLOY.sql` | `xb_migrations` 上 2 个防重复唯一索引；owner-only **只读** `xb_preview_legacy_migration_receipt` RPC | 005、008、009、家庭鉴权、空白/唯一约束兼容性 | 建索引时如已有重复收据会失败；不能盲重跑；不插入收据 |
| 3 | `022_xb_legacy_archive_atomic_STAGE_DRAFT_DO_NOT_DEPLOY.sql` | 2 个 RLS 私有归档表 `xb_legacy_staging`、`xb_legacy_stage_records`；2 个私有验证辅助函数；1 个暂存 RPC | 021、005、鉴权、SHA-256 / 原始 JSON 校验 | 存储原始历史文本，仅在**阶段 B 调用 RPC**才写；阶段 A 暂存 RPC 不授 EXECUTE |
| 4 | `023_xb_legacy_promotion_atomic_DRAFT_DO_NOT_DEPLOY.sql` | 2 个受 RLS 保护的历史/设置表 `xb_legacy_history_entries`、`xb_legacy_settings`；历史索引与 2 个只读 SELECT 策略；1 个原子提升 RPC | 022 + 021 + 005/008/009 | 阶段 A 不调用提升、不生成基线；提升 RPC 不授 EXECUTE |
| 5 | `024_xb_legacy_history_read_DRAFT_DO_NOT_DEPLOY.sql` | 2 个已登录家庭成员只读 RPC，分别分页读取已完成迁移的历史和设置 | 023、021、家庭授权 | 未有完成收据时拒绝读取；不能把一次 50 条当完整历史 |
| 6 | `026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql` | 2 张私有文档/命令收据表；1 个私有基线 helper、2 个只读 RPC、1 个 CAS PUT RPC | 023 历史设置/资料、迁移收据、家庭权限 | 候选价/参考价/成长/资料/设置的版本化修改；阶段 A **PUT 不授 EXECUTE**，原历史不修改 |
| 7 | `027_xb_primary_stocktake_batch_DRAFT_DO_NOT_DEPLOY.sql` | 私有批量盘点收据表，1 个写入 RPC，1 个只读收据 RPC | 005 库存/审计、023 完成收据、现有 009 家庭锁 | 原子多尺码盘点；阶段 A **盘点写 RPC 不授 EXECUTE** |

**关键区分：** SQL 025 本身**只安装函数**，没有 `primary` 行；022/023 本身**只安装结构**，没有真实历史、库存或迁移收据。026/027 也不产生真实业务行。阶段 A 并不修改已有 009/019 权限，测试宝宝原有访问路径仍保持。

### 当前修改后的安装授权默认值

这五个新写入函数在 `CREATE FUNCTION` 后明确 `REVOKE ALL ... FROM PUBLIC,anon,authenticated`：

- `public.xb_create_primary_child(uuid)`
- `public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text)`
- `public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)`
- `public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)`
- `public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)`

只有读收据、读迁移历史、读共享文档及读请求 ACK 的新 RPC，才按 SQL 原设计给 `authenticated` 只读执行权限。私有原文暂存、迁移收据和业务操作审计表不直接赋予客户端 INSERT/UPDATE/DELETE。

**执行边界**：每个 SQL 文件自行 `BEGIN; ... COMMIT;`。这意味着一个脚本出错会回滚它自身；之前已经成功安装的脚本**不会因为后面脚本出错而自动撤销**。不能在失败后全套重跑，也不能未经逐项确认自行 DROP 表/函数或清空现有行。021/022/023/025/026/027 首次安装均使用 CREATE 而非静默替换，已经存在的对象必须先核对定义、权限和版本后再决定处置。

## 3. 阶段 A：数据库对象部署（独立申请，不包含任何真实数据迁移）

### 需要用户单独批准的最小范围

**环境**：仅腾讯云现有 `xiaobao-family` PostgreSQL 环境。**代码**：审批时固定同一个 Feature 完整 SHA，不使用漂移的 HEAD。**允许操作**：在当前对象审查无冲突后，严格按 025→021→022→023→024→026→027 各执行完整 SQL **一次**，接着运行只读核验。若任何一步发生 SQL 错误立即停止，不执行后续步骤。

**明确不允许**：`CREATE primary` RPC 调用、对 `xb_legacy_staging` 上传备份、历史提升、修改六尺码库存、真实文档 PUT/批量盘点、放开五个写入 RPC 的授权、修改 M1-02 smoke、部署正式网站或更换登录。

### 阶段 A 验收清单

- 相应新表/唯一索引/函数存在，所有表 RLS 与必要只读 ACL 符合预期；
- 五个新增写 RPC 的 `authenticated_execute=false`、`anon_execute=false`；匿名用户也不能读私有暂存/迁移收据；
- 新表没有实际家庭业务记录（不在正式 SQL 中试造模拟个人数据）；
- 原家庭/成员/xb 授权数量保持；`__xb_smoke_v1__` S140/rev2 与采购、审计笔数保持；
- 无新 `primary`、无新 `xb_migrations` 收据、无历史提升、无新的库存/交易副作用；
- 018/019 既有对象权限和原主链路未改变；不重复进行真实 S60/S80 采购。

如果一个函数已经存在、ACL 值异常、某张表已有业务数据或 SQL 报错，只保留成功的先前结构，停止审批范围，先核对对象指纹和差异；不得自动重置或删除。

## 4. 阶段 B：正式历史迁移（独立于 A 的后续授权）

**阶段 B 当前完全未授权**。即使 A 部署全部成功，也不得跳过下列任一条件：

1. 对当前仍在使用的 V1.1.2 **不提前停写**。进入迁移窗口时先枚举所有可能保存独立本地数据的电脑、手机与浏览器；逐台做**只读差异核对**。存在差异时阻断自动迁移，先人工明确补全，不能静默只选一台覆盖其他设备。
2. 用户明确确认统一停写时点。停写**之后**再导出最终完整原始备份（按原始字节保存文本），记录 SHA-256、导出时间、原始设备来源。独立离线留至少一份不可改写副本；不将个人资料粘贴到 GitHub/公网日志。
3. 校验旧版数据结构、全量交易/候选价/成长及设置、库存六尺码，所有未知字段和价格精度明确处置；严格通过 `XBFinalCutoverGate` 和 `XBStrictMigrationGate`。
4. 明确真实 CloudBase 的可恢复备份能力或双方已单独知情批准的恢复限制。**P2-1 空表部署的“无可验证云端恢复点”风险例外，不适用于真实家庭历史迁移。**
5. 用真实 SDK 的**已认证家庭 owner**对现有 `primary` 作用域确认；需要时经单独授权短时开放 `025` RPC，并创建一个、仅一个正式 `primary`（永不碰 `__xb_smoke_v1__`）。必须确认该 `primary` 目标没有业务行。
6. 在另外明确的迁移上传授权内，短时开放 022 与 023 的 EXECUTE，**保留原 stageId、migrationId、sourceSha256**，由现有 `XBLegacyMigrationRuntime` / executor 受控执行：021 owner 预检 → 022 原文 SHA 暂存 → 023 一次原子提升 → 024 全分页历史/设置读回及全部业务对账。任何未验证状态停止。
7. 全量对账要求：迁移收据源 SHA；采购、消费、候选价、成长的原始 ID/顺序/字段/条数；库存六尺码和六条 `migration_baseline` 操作事件；真实原生成长记录；参考价千分位及全部设置、宝宝资料、未知字段。**历史采购只能展示，不能再入账库存**。
8. 全量一致前不让 V1.2.0 正式读写替代旧版，不删除旧版本机数据和原始备份。确认成功后，按后续独立授权撤回 025/022/023 的临时 EXECUTE，并做一次真实 A/B 只读核验。

### 异常恢复判定（无需破坏既有数据）

| 异常 | 必须采取的动作 |
|---|---|
| 025 已创建 `primary`，后续失败 | 保留同一个空 `primary`；不反复创建，也不覆盖 smoke |
| 022 暂存成功但客户端 ACK 丢失 | 保留同一原文与 stage ID；先核对 021 尚未收据、022 可能已暂存；绝不导入另一份快照覆盖 |
| 023 失败/事务回滚 | 正式表不会半套提交；保留只读审计和原始暂存，不清空 staging；检查失败原因 |
| 023 已提交但 ACK 丢失 | 先调用 021 预检；若 `ALREADY_RECEIPTED_SAME_SOURCE`，只做全量读回，不再提升 |
| 021 显示不同来源已完成收据 | **立刻阻断**；不得通过更换新 migration UUID 来掩盖冲突 |
| 024 历史分页/原生体重读取不完整 | 不宣布迁移成功、不启用正式五页写入；返回人工核对 |
| A/B 库存/金额/成长/设置不一致 | 不清空服务器或旧版任何行；保存审计证据，暂停切换 |

`legacy-migration-executor.js` 已有 021/022/023/024 调用协调与全量读回，JS RPC 参数和 SQL 签名已纳入源代码定向测试；**但与真实 CloudBase PG17.11 网关进行一次正式历史导入的端到端联网验收尚未进行**。正式审批前仍须确认真实 SDK 权限、失败码、分页与最大请求大小，尤其原生记录多页查询与 SDK 的 DATE/TIME/NUMERIC 返回格式。源码测试/PG16 CI 不能代替真实家庭数据验收。

## 5. 026/027 的真实业务授权不能混入历史迁移

阶段 A 安装后 026、027 的写 RPC 仍保持禁用。阶段 B 历史迁移 **不需要**启用它们，历史成功不自动开放未来的采购、成长、参考价和盘点写入。

未来阶段 C 才在**新的一次明确授权**下为正式 primary 的 A/B 端开启需要的 026/027 写入、现有 009 原子库存操作，以及独立测试页面的受控写入开关；检验 2 位账号读取、修订冲突、消息回执、断网原 operation ID、刷新后读回、采购金额与库存一致性，再另外审批主站/PWA 发布。

## 6. 最短剩余路径（不偷跑权限）

**本轮**：执行一次集中只读目录盘点，确认当前 CloudBase 对象/权限与先前实际验收无偏差 → **下一轮阶段 A 授权**：固定 SHA 安装 7 个 DDL 脚本、立即核对权限/RLS/S140 → **独立阶段 B 准备与授权**：备份及最终停写+原始 SHA，先创建 primary、再一份最终备份原子迁移及全量核对 → **阶段 C 正式业务受控验收**：再审查开启 026/027/正式 UI 权限，用 A/B 验证各业务读写 → **阶段 D 正式发布审批**。

### 需要用户在腾讯云控制台做什么？

**现在仅需一项只读操作**：CloudBase 现有环境 → PostgreSQL → SQL 控制台，将 `cloudbase/sql/M2_M3_PHASE_A_READONLY_INVENTORY.sql` 内容作为一批 SELECT 执行。反馈返回结果（可截图，不含家庭 UUID/个人资料）。不运行 025–027 中任何 CREATE/GRANT/INSERT，也不用停用 V1.1.2、提交历史备份或重做 S140 采购。

**下一次阶段 A 真正授权后**，才按固定 SHA 逐份执行上述 7 份 SQL；每一步失败立即停止，使用相同只读脚本复核。所有授权需列明有效环境、准确文件 SHA、允许对象/步骤、前置核验、禁止操作、失败停止条件；不接受“全权部署/顺手迁移”的笼统授权。
