# 小宝管家 v1.2.0 — 联网同步完整测试执行矩阵

更新：2026-11-11（UTC+8）。本文件记录**已取得的测试证据**与**尚未完成的真实验收**；不以“有测试代码”冒充“真机测试通过”。

## A. 发布与数据安全红线

- 开发、测试仅限 `feature/cloudbase-sync-v1.2.0`；未经用户明确同意，不合并 `main` 或 `develop`，不更新正式 GitHub Pages。
- 既有 v1.1.2 `localStorage['xiaobao_diaper_planner_v1']`、旧 JSON 备份、手机 PWA 不得被自动清除/覆盖。
- P2-1 安装范围已获用户限定授权，并在真实 CloudBase 完成；后续 **不得重复执行 005/008/009/010/017**。继续禁止历史库存迁移、虚拟宝宝/采购测试写入、正式发布，除非获得对应阶段明确授权。
- 不要在聊天、截图、GitHub 中展示邮箱地址、Publishable Key 原值、OTP、邀请码、会话 Token 或真实家庭 UUID。
- 三种证据分开：自动化测试、CloudBase 真实 SDK/SQL 测试、真实双手机端到端测试。任何一类失败都不能视为整体验收完成。

## B. 当前测试证据

| 范围 | 状态 | 证据 / 说明 |
|---|---|---|
| JavaScript 回归 | PASS_AUTOMATED | P2-4C 新增 12 项**从正式 index.html 原样提取并执行 importData/save/load** 的一次性 Node VM 导入/重载合成测试后，完整 **338/338 PASS**；PG16 隔离合同 PASS；无真实手机/CloudBase 数据写入 |
| P1 成员备注 RBAC、revision、审计 | PASS_ISOLATED_PG | 新增真实 SQL 隔离执行（owner 改本人/成员、member 改本人、拒绝越权/旧revision/直接UPDATE、陌生人、匿名伪造、审计条数）；https://github.com/fengruiwang/diaper-manager/actions/runs/42942398249 |
| P2 采购/库存/撤销/RLS/回执 | PASS_ISOLATED_PG | PostgreSQL 16 临时测试容器通过；**并非腾讯云真实业务表部署** |
| CloudBase 家庭基础表 + 备注脚本 | PREVIOUSLY_VERIFIED | 此前反馈 002 为 15/15、004 为 12/12；未在本次真实数据库重跑 |
| CloudBase 既有 A/B 双账号与成员权限 | PASS_REAL_6_OF_6 | 用户 2026-11-11 实际验证 A、B1、B2、B3、B4、C 全部通过；不得要求重复创建家庭 |
| CloudBase 陌生账号 C / 撤权 | PENDING_REAL | 不能为了测试擅自撤销当前家庭成员 |
| P2 真实 CloudBase 业务结构 | P2_1_SCHEMA_PASS_REAL | 011/013 真实预检 18/18；005→006 19/19、008→014 15/15、009→017→015 21/21 + 016 安全 ACL、010→018 20/20、012 12/12 均通过。7 张表全部空、RLS 生效、2 个 RPC 已安装；未开展真机业务调用 |
| P2-3A 独立只读云端联调 | A_B_BOTH_PASS_ANON_RPC_ORIGIN_INCONCLUSIVE | 真实管理员 A 10/10 PASS；用户反馈老婆以自己的账号运行检查项全部 PASS，按 B 已登录 10/10 PASS 存档（未逐项抄录）；手机新浏览器的匿名 6/7 PASS，剩余只读 RPC 为 DENIED_UNCLASSIFIED，证明请求被拒绝但拒绝来源未确认；未写入宝宝、库存和采购 |
| P2-3B 虚拟宝宝受控初始化 | MEMORY_BROWSER_12_OF_12_PASS_REAL_CLOUD_UNTOUCHED | 用户 2026-11-11 反馈已在真实网页端测试 p2-smoke-preview 的全部 12 步，全部 PASS（未逐项转录）；该结果仅为真实浏览器内存模拟，**不代表真实云端购买/库存**。019/020 仍仅隔离 PG16 18/18 true，未在 CloudBase 安装、未写宝宝/库存/采购，尚无 P2-3B 写入授权 |
| P2-3C 库存上传前置检查 | PC_AND_PHONE_READONLY_PASS_UPLOAD_BLOCKED | 用户提供真实浏览器截图：session PASS(SESSION_PRESENT)、family PASS(ONE_VISIBLE_FAMILY)、member PASS(MEMBERSHIP_VERIFIED)、grant PASS(XB_GRANT_VERIFIED)、upload_gate BLOCKED(DURABLE_BASELINE_NOT_VERIFIED)，总体 AUTH_PASS_UPLOAD_BLOCKED；用户反馈手机侧相同。两端均存在已有 SDK 登录会话，无需本页重新登录；未显示账号角色，因此不能仅由两端同结果断言是不同 UID。未上传库存/历史或安装 019/020 |
| P2-3D 首次库存基线核验 | CODE_AND_MOCK_PASS_LIVE_NOT_RUN | 新增只读 sync/inventory-baseline-inspector.js：受控读取真实家庭/非测试宝宝、当前设备 IDB 含 ACK 的完整队列、云端六尺码库存和操作回执；对未迁移历史、待同步、错 ID、已 ACK 回执消失、六尺码缺失/版本不同等全部拒绝自动上传。**所有结果 uploadAllowed=false、localUnchanged=true**。15 组合成安全测试已加入 Node 回归；真实 CloudBase 未跑该核验、无测试宝宝或库存写入 |
| P2-3E 首次本地基线受控初始化 | DESIGN_ISOLATED_IDB_PASS_LIVE_UNDEPLOYED | 新增 inventory-bootstrap-coordinator.js，默认只读、需要可信历史迁移收据、双次服务器库存/revision 一致检查、IDB 无既有快照与队列；仅隔离模拟双开关可写 IDB 并第三次读取。17+3 合成用例通过：重复初始化阻止、模拟晚到 pending 队列导致事务拒绝、持久保存验证。**真实历史收据服务尚不存在，所有结果 uploadAllowed=false**，未在真实 CloudBase 运行 |
| P2-4A 旧版备份完整性与恢复预览 | REAL_BROWSER_BACKUP_VAULT_PASS_RESTORE_IMPORT_NOT_TESTED | 2026-11-11 用户提交两张网页截图：选取正式 v1.1.2 导出 JSON，保护副本生成/自检 PASS；重新选择下载的保护副本后核验 PASS，原始文件字节长度 3265，SHA-256 一致，原始备份取回预览 PASS。此为**真实浏览器备份文件完整性验收**，非正式软件导入恢复、历史数据库迁移或业务记录逐项校验。JS 316/316 PASS，页面不写旧 localStorage/云端 |
| P2-4B 旧版导入内存差异审计 | SYNTHETIC_PROJECTION_PASS_REAL_IMPORT_NOT_RUN | 新增 legacy-restore-projection.js：在内存模拟正式 index.html 导入默认值、六尺码修正及 XBGrowth.extras 处理，对原 JSON 逐字段比对；补字段、库存舍入、体重记录过滤、未知嵌套字段丢失均标记需审核，输出只有类别/差异计数不含个人资料。10 组合成测试 PASS，总 326/326。**不在用户手机运行真实导入，不代表真正恢复无损** |
| P2-4C 旧版真实导入器隔离执行 | REAL_IMPORT_FUNCTION_IN_SYNTHETIC_VM_PASS_USER_DATA_UNTOUCHED | 从正式 index.html 提取**原样 importData/save/load** 代码，用一次性 Node VM、合成 FileReader/Map localStorage 执行导入及重载；12 项测试验证规范数据/购买和参考价保留、取消不写、库存修正、缺省/体重/未知字段变化、版本号未校验；完整 JS 338/338 PASS。**不是用户真实 3265 字节备份的正式导入，也不是 CloudBase 数据迁移** |
| P3 Edge IndexedDB 浏览器测试 | PASS_REAL | D1 虚拟库存及刷新、D2a 离线录入、D2b 离线刷新重开、D2c 模拟回执：用户 2026-11-11 反馈全部正常；不代表真实云端同步 |
| P3 云同步 UI、云端补传、真机双端 | NOT_INTEGRATED | 现有模块只在隔离代码/模拟器中 |
| 全业务同步、v1.1.2 迁移、CloudBase 故障恢复 | NOT_IMPLEMENTED_END_TO_END | 不得宣告通过 |
| 正式发布升级 | NOT_STARTED | 需等全部发布闸门通过 |

## B.1 2026-11-11 实测反馈与研发处理

- A 管理员读取家庭与备注：PASS_REAL
- B1 成员读取相同家庭：PASS_REAL
- B2 成员修改本人备注并恢复：PASS_REAL
- B3 成员越权修改管理员备注被拒绝：PASS_REAL
- B4 成员生成邀请码被拒绝：PASS_REAL
- C 最终家庭关系和正式版历史数据核对：PASS_REAL
- D1 独立 IndexedDB 虚拟库存与刷新持久化：PASS_BROWSER
- D2a 断网录入、D2b 离线刷新和重开、D2c 模拟云端确认：PASS_REAL（用户反馈全部正常）。这是离线本地验证，不是 CloudBase 真实补传。
- 研发措施：新增独立作用域的 `cloudbase/smoke/idb-offline-sw.js` 和页面缓存状态提示，已完成测试页重新部署与真实复测；该 D2 阻塞已关闭，不需要重复验收。
- P1 第三方 C 账号与成员撤权仍未实测；不撤销当前家庭的两名成员。
- P2 正式业务表已于本日完成结构验收；真实双手机、云端实际调用、全业务同步与历史迁移仍未通过。
- 2026-11-11：011 真实 CloudBase 11/11、013 真实 CloudBase 7/7 true；依序完成 P2-1 全部数据库结构安装和验收，见下文 B.10。历史中间阶段各条“待执行”状态不代表最新状态。

## B.2 P2 下一验收节点（2026-11-11）

**2026-11-11 最新授权：P2-1 限定授权已收到。** 仅允许在现有 `xiaobao-family` 安装 7 张空业务表、RLS、两个 RPC，以及 006/012 的只读核对。不允许历史数据迁移、创建任何宝宝、合并分支或发布。**已根据用户截图确认目标是 CloudBase PG17.11 共享集群，备份页面不提供相关能力，BACKUP_GATE=BLOCKED_SHARED_INSTANCE；不得执行任何 P2 SQL DDL。** 未证明无后台备份，但用户侧没有可验证的恢复入口，不能按备份闸门通过处理。备份检查步骤见 `P2_LIVE_ACCEPTANCE_RUNBOOK.md`。



**P2-0b 真实腾讯云结果：**用户已在既有 CloudBase 执行 013，7 个布尔项均 true。P2 预部署两次真实验证共 18/18 通过。**仍未授权任何 DDL、业务数据写入、历史迁移或正式版本合并。**


**P2-0 真实腾讯云预检结果已收到**：011 的 11 个布尔结果全部 true（用户于 2026-11-11 手动运行），确认为现有 1 家庭/2 成员/2 个 xb 授权，已有别名权限基础保持正常，首次 P2 业务表/RPC 全部尚未部署。该项标记 PASS_REAL，不能与 PG16 CI 混淆。

009 库存 RPC 依赖的 `pg_catalog.sha256`、`gen_random_uuid`、`hashtextextended` 和 `pg_advisory_xact_lock` 等已通过 `013_xb_p2_capabilities_readonly.sql` 的真实 CloudBase 7/7 检查。**P2-1 用户限定授权已落实；后续按 009→015→010→012 逐阶段验收。**



- `cloudbase/sql/011_xb_p2_predeploy_readonly.sql` 已在真实 CloudBase 执行并反馈 11/11 true，不再要求重复运行。
- 已新增 `cloudbase/sql/012_xb_p2_postdeploy_readonly.sql`，首次安装后只读 12 项结构、RLS、事务/迁移空表和 RPC 签名检查；隔离数据库全 true。真实环境还未安装/运行。
- `tests/postgres/p2_purchase_contract.sql` 在隔离 PG16 中覆盖 011、013、012 三个检查脚本；JS 安全测试保证三者为只读查询。
- 具体操作见 `docs/v1.2.0/P2_LIVE_ACCEPTANCE_RUNBOOK.md`；用户确认前禁止执行 005/008/009/010，禁止部署 007。

### B.3 2026-11-11 真实 CloudBase 备份恢复排查结果

- 用户提供三张截图，显示 PostgreSQL **17.11**、实例类型 **共享集群**、状态运行中。
- CloudBase 管理 → 备份页面明确提示“当前共享集群暂不提供相关能力，可以升级至独享集群后启用能力”。
- 独立 TencentDB PostgreSQL 控制台在所选地域没有实例，不能假定共享 CloudBase PG 可由此控制台执行手动备份/回档。
- **BACKUP_GATE=BLOCKED_SHARED_INSTANCE**，这只是确认“当前用户没有可操作的恢复通道”，不推断腾讯云后台一定没有任何备份。
- 官方文档：<https://docs.cloudbase.net/database/backup> 明确 PG 模式与传统文档数据库回档机制不同；<https://docs.cloudbase.net/database/postgresql/branching> 环境分支在 2026-11-11 仍属 Private Alpha、邀请开通且无 SLA，不得视为已具备可靠的生产恢复能力。
- 不升级独享实例，不购买额外服务，不执行 005/008/009/010，不创建新家庭或虚拟宝宝，不导入旧版数据。
- 后续可通过腾讯云 CloudBase 工单确认共享 PG 是否支持逻辑导出、受控快照/恢复、恢复入口与权限，或者准备**严格受范围限制的回退 SQL**。逻辑备份/回退脚本的存在不等于经过验证的数据库备份；若要改用无可恢复备份的风险方案，必须单独告知并重新获用户明确同意。
- 当前继续开展只读方案研究、编写离线隔离测试和安全审查即可。

### B.4 2026-11-11 有限范围风险知情接受（最新）

- 用户在获知共享 CloudBase PostgreSQL **无可操作备份入口**后明确提出继续部署 P2-1 的增量空表和 RPC，不升级套餐；先前 BACKUP_GATE=BLOCKED 仍为客观事实，但用户**接受仅限 P2-1 的未备份剩余风险**。
- 用户在对话中提供 5 份 CSV，离线解析后数量为 `families=1`、`family_members=2`、`family_app_access=2`、`family_member_alias_audit=6`、`family_invites=2`；关联检查通过。CSV 可能含邀请令牌、账号 UID，**不得提交至公开 GitHub/日志**；CSV 不含数据库 DDL、RLS、授权及 RPC 定义，不能称作完整备份。
- 当前允许按顺序先 005（空表，整体事务）后 006（只读检查，预计 19 个 true）。后续 008/009/010/012 必须分阶段执行、核对，不一次运行整套脚本。每阶段失败立即停止，不自动修复、不重建家庭。
- 此前文档中所有“备份未确认不允许 DDL”的限制，现仅对 **P2-1 增量空业务结构**由用户明确承担剩余风险而豁免；不延伸至真实旧版库存、采购、体重、历史数据迁移或正式发布。
- 截至本状态更新，**真实 CloudBase 005 尚未执行；不得把用户风险接受误记作数据库迁移已成功**。

### B.5 2026-11-11 P2-1 第一阶段真实验收

- 用户在 CloudBase 共享 PostgreSQL 17.11 控制台执行 `005_xb_core_schema_draft.sql`，随后提供 `006_xb_core_schema_postflight.sql` 的一行结果：**19/19 true**。
- 实测确认新创建 `xb_children`, `xb_baby_profiles`, `xb_weight_records`, `xb_inventory`, `xb_inventory_operations`, `xb_migrations` 六张表；所有新表空，RLS 已启用，客户端关键直写/迁移收据读取受限，原家庭1/成员2/xb授权2均保留。
- **状态：STAGE_005_006_PASS_REAL；不再让用户重跑005/006。**
- 新增只读 `014_xb_p2_purchase_postflight_readonly.sql`，在 `008_xb_transactions_schema_draft.sql` 之后、`009` 之前运行，预计 **15 个 true**，核对采购表空数据、RLS、角色权限、家庭 RLS policy、采购与库存操作复合外键、操作唯一约束、历史索引和原家庭/成员/xb 授权。014 是额外验收，不增加业务表或功能。
- 下一阶段仅：`008`（创建空采购流水表）→`014`（只读15项结果）。**待用户反馈 014 全 true 后才进入009**。
- **尚未实际执行 008、009、010、012**。本阶段也不创建测试宝宝、不迁移历史、不更新 v1.1.2 或 main/develop。
- 本次用户已接受仅 P2-1 空结构变更缺少用户可操作备份的剩余风险，不能错误记为已有数据库备份。

### B.6 2026-11-11 P2-1 第二阶段真实验收及下一检查

- 用户提供 `014_xb_p2_purchase_postflight_readonly.sql` 的真实 CloudBase 一行 15 列结果：**15/15 true**，判定 008 创建采购流水表、约束、索引、RLS 和只读权限成功。
- 新 `xb_transactions` 仍为空；已确认 `xb_inventory_operations` 的复合 UNIQUE 存在、采购表的组合外键存在；原有 1 家庭/2 成员/2 项 xb 应用授权保持不变。
- **P2-1 阶段 008/014 标记 PASS_REAL，不再重跑；与 005/006 19/19 PASS_REAL 一起关闭。**
- 下一阶段仅执行 `009_xb_purchase_atomic_rpc_draft.sql` 安装原子采购库存 RPC；之后执行新增 `015_xb_p2_atomic_purchase_postflight_readonly.sql`，需实际 CloudBase **21/21 true** 后才允许继续 010。
- 015 核验 10 参数原子采购 RPC、旧 9 参数接口不存在、SECURITY DEFINER、只授予 authenticated 运行、anon 不可运行、反向撤销唯一索引/约束、七张表仍无新数据、原家庭成员不变和 public schema 对非可信角色不可 CREATE 等。
- 015 是纯 SELECT 且只返回布尔值，不执行库存 RPC，也不创建测试宝宝、采购、库存或虚拟用户。
- 当前 009、010、012 尚未在真实 CloudBase 执行；正式 main/develop 及 v1.1.2 历史业务数据保持不变。

### B.7 2026-11-11 P2-1 第三阶段：009 安装后 015 权限异常

- 用户发送的真实 CloudBase 015 检查结果中 **`authenticated_can_execute_purchase_rpc=false`**。因此 **015 未通过，不得把 009 标记为验收完成，也不能执行 010/012**。
- 009 安装成功的迹象：10 参数 SECURITY DEFINER RPC 存在、旧 9 参数接口不存在、反向操作唯一约束存在。用户返回的其他布尔项为 true，空表及原家庭/成员/xb 授权保持。
- 009 源 SQL 结尾包含对 `PUBLIC` 的 `REVOKE ALL` 和对 `authenticated` 的显式 `GRANT EXECUTE`。为何真实库检查仍为 false 尚**未确定**；隔离 PG16 下对应项为 true，不能直接认定是腾讯云故障、也不能根据 CI 自动修复。
- 已新增 `cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql`，仅单条 SELECT，读取 PostgreSQL 元数据，比较函数存在性、`authenticated` 的有效调用权限、`pg_proc.proacl` 显式 GRANT、public schema USAGE、与既有别名 RPC 的授权对照。不执行任何 RPC，也不输出 UID 或家庭记录。
- **严格暂停：不重跑 009，不执行 010、012，不手动 GRANT/REVOKE，不执行 007，不创建测试宝宝/采购/库存。** 等用户提供 016 诊断结果后，分析真实原因，再编写最小范围修复脚本和独立验收。
- Tencent Cloud 官方 PostgreSQL 文档既有对 EXECUTE GRANT 的推荐，也特别提示 CloudBase PostgREST RPC HTTP 网关可能不强制检查 SQL 函数 EXECUTE 权限；因此不能依赖 GRANT 作为唯一授权边界。现有 009 RPC 具备自身 `auth.role()/auth.uid()/xb_private.can_use_app()` 校验，但本阶段尚未做真实 SDK 权限联调。

### B.8 2026-11-11 P2-1 016 真实权限诊断及 017 最小范围修复

- 016 的真实结果（用户逐列反馈）：
  - `purchase_function_found=true`，`authenticated_role_exists=true`，`authenticated_public_schema_usage=true`；
  - `effective_authenticated_execute=true`、`explicit_authenticated_execute_grant=true`；
  - **`effective_anon_execute=true`、`explicit_anon_execute_grant=true`**（需要纠正）；
  - `public_execute_grant_present=false`、`purchase_function_has_default_acl=false`；
  - `comparison_alias_authenticated_execute=true`；
  - `purchase_function_owned_by_cloudbase_postgres=false`（仅说明函数不属于该特定角色，不能认定出错）。
- 与前一次 015 的 `authenticated_can_execute_purchase_rpc=false` / `anonymous_cannot_execute_purchase_rpc=true` **存在时序差异**；目前未知是平台异步角色同步还是执行环境变化，不得假设已确认根因。
- 009 已部署版本只 `REVOKE ... FROM PUBLIC`，但没有显式 `REVOKE ... FROM anon`。现已编写 `017_xb_p2_purchase_rpc_acl_repair.sql`，其范围仅为现有 **10 参数** `public.xb_apply_inventory_operation`：先检查函数存在，`REVOKE EXECUTE ... FROM PUBLIC,anon`、`GRANT EXECUTE ... TO authenticated`，整体事务执行一次，**不调用函数、不重建函数、不写业务数据**。
- 对未来新安装的 009/010 SQL 草案，也已增加 `FROM PUBLIC,anon` 显式撤销匿名执行权限；**已部署的 009 不可重跑**。
- 在隔离 PG16 中，先模拟对 `anon` 显式授予该 RPC 权限，再运行 017，随后断言 anon EXECUTE=false、authenticated EXECUTE=true，并复查 015；测试通过。这个模拟不能代替真实 CloudBase 的运行结果。
- **当前需用户只执行 017 一次，然后紧接着执行原 015 和 016（都是只读），提交两份布尔结果。直到真实 015=21/21 true，且 016 中 authenticated=true/anon=false，才允许继续 010。**
- 官方 CloudBase RPC 文档：<https://docs.cloudbase.net/database/postgresql/rpc> 提醒 HTTP RPC 网关不强制按函数 EXECUTE ACL 限制调用。017 是 PostgreSQL ACL 加固，**不构成端点层匿名隔离证明**；函数内部必须保持 `auth.role()/auth.uid()/can_use_app` 权限校验，后续需要真实 SDK 负面测试。
- 始终禁止创建测试宝宝、采购/库存数据或迁移真实 v1.1.2 历史；不修改家庭、成员、备注或正式 main/develop。

### B.9 2026-11-11 017 修复后 015/016 真实 CloudBase 验收通过

- 用户完成 017 最小 ACL 修复，并返回 **015 一行 21/21 true**。已确认 10 参数采购 RPC 存在、旧入口无残留、SECURITY DEFINER、登录可执行、匿名不可执行、业务表仍为空、家庭1/成员2/xb授权2保留。
- 真实 016 返回 `effective_authenticated_execute=true`、`explicit_authenticated_execute_grant=true`、`effective_anon_execute=false`、`explicit_anon_execute_grant=false`、`public_execute_grant_present=false`。
- 016 `purchase_function_owned_by_cloudbase_postgres=false` 表示函数不属于该特定角色，不是此次验收阻断；`purchase_function_has_default_acl=false` 符合显式授权。
- **结论：009→017→015→016 完成 PASS_REAL，旧 015 异常关闭。不再重跑 009 或 017。**
- 已准备 `018_xb_p2_reconciliation_postflight_readonly.sql`：010 安装后的 20 项只读检查，额外确认新的读取 RPC 对 anon 未授权、authenticated 授权有效、函数自身限制读取本人 ACK、库存与原家庭均保持不变。隔离 PG16 **20/20 true**。
- 接下来仅执行 `010_xb_inventory_reconcile_rpc_draft.sql`（创建读取 RPC）→`018`（20/20 true）→`012`（12/12 true），先检查 018 通过再执行 012。如中途有错误或 false 必须停止。
- 任何核验通过只证明静态数据库结构与授权，不等于真实 CloudBase SDK、双端同步及离线补传已经通过。没有创建测试宝宝、没有迁移历史业务、没有合并 main/develop。

### B.10 2026-11-11 P2-1 CloudBase 首次安装最终验收（最新状态）

**状态：P2_1_SCHEMA_PASS_REAL。** 用户已在现有 `xiaobao-family` PostgreSQL 17.11 共享集群执行 `010_xb_inventory_reconcile_rpc_draft.sql`，随后回传：
- `018_xb_p2_reconciliation_postflight_readonly.sql`：**20/20 true**。读取 RPC 已安装，`SECURITY DEFINER`、STABLE、返回 JSONB、固定 search_path，`authenticated` 有有效和显式执行授权，`anon` 无授权；库存、采购、宝宝记录为空，原采购 RPC 授权仍正确，原家庭 1 / 成员 2 / xb 授权 2 不变。
- `012_xb_p2_postdeploy_readonly.sql`：**12/12 true**。七张新业务表、七张 RLS、两套 RPC、客户端表权限和原家庭记录均符合预期；七张表无任何业务数据；既有成员备注 RPC 保留。

**完整真实 SQL 验收轨迹**：011 11/11 → 013 7/7 → 005/006 19/19 → 008/014 15/15 → 009/017/015 21/21 + 016 角色 ACL 复核 → 010/018 20/20 → 012 12/12。

**界限与后续闸门**：
- P2-1 是**结构与静态权限**验收，不等于 CloudBase HTTP/SDK 实际匿名权限、两成员跨设备同步、采购幂等或断网补传验收。
- 原有家庭、成员、两份 xb 授权保持；历史 v1.1.2 localStorage 和 JSON 未迁移，未创建测试宝宝或库存。**不要重跑任何已完成 DDL。**
- 当前下一阶段为 **P2-3 真实业务联调的准备**：先在开发分支完成只读端点鉴权测试设计和**独立虚拟宝宝创建入口的权限设计**，在隔离测试环境验证并审查数据隔离/回收方案。未获得用户对向真实 CloudBase **新增虚拟宝宝/模拟采购**的单独授权前，不实际创建数据，不打开业务写入测试开关。
- 用户已明确知情接受共享 PostgreSQL 无用户可验证备份能力的**仅 P2-1 空结构部署风险**；本授权**不自动延伸到任何真实数据迁移或测试业务写入**。
- GitHub 开发仅限 `feature/cloudbase-sync-v1.2.0`；不修改 main/develop，不发布正式 v1.1.2。

### B.11 2026-11-11 P2-3A 零业务写入诊断准备完成（尚未真实联调）

- 新增 `cloudbase/smoke/p2-readonly-test.html` 和 `p2-readonly-diag.js`，是**独立**于正式 v1.1.2 的浏览器测试页，需用户手动上传到现有 CloudBase 静态网站专用 `xb-test/` 目录才能使用。
- 页面无自动调用，点击“连接”后可显式运行 anon 或登录 A/B 的只读检查。只读取 `families` / `family_members` / `family_app_access` 和新业务表的有限字段/行数；唯一 RPC 目标是 `xb_read_inventory_reconciliation`，只用合成的不存在宝宝/其他家庭标识请求应拒绝，不调用库存采购写入函数，不执行直接表写入。
- 匿名检查预期 7 个子项 PASS；已登录 A 或 B 各自预期 10 个子项 PASS。对权限拒绝、网络失败及 SDK 无法区分的异常，返回 FAIL/INCONCLUSIVE/BLOCKED，不能伪造成功。
- `tests/p2-readonly-browser-diagnostics.test.cjs` 使用纯合成 Fake CloudBase，验证模拟会话、匿名不可见、已有成员访问、非法 RPC 意外成功为 FAIL、无法分类网络错误为 INCONCLUSIVE、不会调用 DML/write-RPC、不会泄露 ID/Token。合成测试不等于真实云端验收。
- 专用步骤见 `docs/v1.2.0/P2_3A_READONLY_ACCEPTANCE_RUNBOOK.md`。未在真实 CloudBase 新建任何宝宝、库存、采购，未部署测试页面、未合并 main/develop 或更新正式网站。
- P2-3B/C 虚拟宝宝初始化及模拟采购将涉及真实业务数据库写入，**不在本次“继续”开发授权范围内执行**。

### B.12 2026-11-11 P2-3A 首次真实浏览器反馈（当前最新状态）

- 用户已打开独立 `p2-readonly-test.html` 并反馈三轮诊断。无需重复已成功的管理员 A 已登录检查：
  1. 点击匿名检查：**BLOCKED**，唯一字段 `anonymous_session=BLOCKED(LOGIN_SESSION_PRESENT_USE_PRIVATE_WINDOW)`；因有当前会话，页面**没有执行匿名表/RPC 检查**，不能记为 anon PASS 或权限漏洞。
  2. 用户认为“未登录”时点击已登录成员检查：**10/10 PASS**，其中 `authenticated_session=PASS(SESSION_PRESENT)`。CloudBase SDK 已存在持久会话，所以这是**有效的已登录角色**，不能作为匿名测试，也不能把它自动算成 B 账号验收。
  3. 管理员明确登录后点击已登录成员检查：**10/10 PASS**。包含家庭 1、成员 2、xb 授权 2，四张业务表全部无可见记录、无效宝宝和伪造家庭两次只读 RPC 均返回预期拒绝（`EXPECTED_DENIAL`）。
- **当前分类：A 管理员已登录 P2-3A 10/10 PASS_REAL；匿名项 BLOCKED（环境已有会话）；B 妻子独立身份 P2-3A 尚未验证。**
- 根据 CloudBase Web SDK v3 官方指引，`auth.getSession()` / `data.session` 是实际会话状态依据，不以是否在当前页面手工输入 OTP 判断；有会话时匿名测试正确停止。官方文档：<https://docs.cloudbase.net/api-reference/webv3/authentication>。
- 下一步测试：A 的正式和诊断浏览器均保留会话、不清理 localStorage、不强制退出。为 anon 新建**独立 Chrome 访客浏览器档案**，或关闭**所有**无痕窗口后新开单一无痕窗口（同一无痕会话多标签会共享登录状态），在从未登录的窗口执行匿名检查。预计 7/7 PASS，若仍显示 BLOCKED 原样反馈。
- B 已有家庭成员的测试仅在配偶本人独立手机/浏览器登录后进行；若已有有效会话直接执行 10 项，不重复验证码。未取得 B 单独反馈前，不能把两次 PASS 归为 A/B 双成员独立实测。
- 所有检查仅只读。禁止创建测试宝宝、采购、库存，禁止旧版迁移、发布或再执行已经验收的 P2-1 DDL。

### B.13 2026-11-11 手机新浏览器匿名复核：6 个 PASS + 1 个拒绝未分类

用户说明结果是在手机上**手动转录，可能存在字段拼写误差**；以下以语义和已知代码流程解读，不根据可疑前缀作越权推断：

- **未登录时点击④检查登录成员权限**：总体 `BLOCKED`，用户抄录 `anonymous_session: BLOCKED(LOGIN_REQUIRED)`。按照 `p2-readonly-diag.js` 源码，此流程的字段实际应为 `authenticated_session`，手动误写不影响结论：未登录者**不能通过已登录成员检查**，这是正确拦截。
- **点击②检查匿名权限**：整体 `INCONCLUSIVE`，第一项 `anonymous_session=PASS(NO_SESSION)`；`anonymous_families` 和 `anonymous_xb_children` / `xb_inventory` / `xb_inventory_operations` / `xb_transactions` 共五项均 `PASS(DENIED_NO_ROWS)`。代表已排除上轮“浏览器保留登录会话”的测试阻塞，匿名无法通过 SDK 读到这批数据。
- 最后一项 `anonymous_reconciliation_rpc=INCONCLUSIVE(DENIED_UNCLASSIFIED)`。源码 `denyReason` 仅在错误码为 `42501`、`DATABASE_42501`、`401`、`403` / `HTTP_401`、`HTTP_403` 但**错误文字未包含 `authentication_required`**时使用该标签。因此请求**确实被拒绝**，且没有返回成功的库存结果；但拒绝来自网关 ACL、函数体或 SDK 包装目前不可判定。不能记录为 `EXPECTED_DENIAL` 的 RPC 函数体已证实，也不属于访问成功或安全漏洞。
- **阶段结论**：匿名访问控制（不暴露家庭和库存数据）已得到正面证据；严格的 P2-3A `7/7 PASS` 仍未达到（实际 `6 PASS + 1 INCONCLUSIVE`）。**不要求重复匿名测试或重传已有 SQL**。将“RPC 内部身份保护证明”保留为后续 SDK 负面测试覆盖点。
- 管理员 A 的 10/10 真机 PASS 继续有效，无需重测。仍待现有成员 B 在独立账号上运行 ④ 检查（可直接使用持久会话，只有缺失才 OTP），不自动假设手机测试是 B 身份。
- 本轮没有新增宝宝、模拟采购、修改库存或迁移历史数据。只更新文档；正式 main/develop 仍禁止修改。

### B.14 2026-11-11 B 家庭成员独立账号的真实检查通过

- 用户明确反馈：“老婆的运行后都是 pass”，承接上一轮要求 B 在自己手机使用已有账号执行 `④ 检查登录成员权限`；记为 **B / 10 项全部 PASS_REAL（用户汇总反馈，未提供逐项表格）**。
- 此前管理员 A 独立检查 10/10 PASS_REAL 继续有效，不必重跑。
- 新浏览器匿名检查已确认 `NO_SESSION`，家庭及四张业务表拒绝访问，计 6 个 PASS；`anonymous_reconciliation_rpc=INCONCLUSIVE(DENIED_UNCLASSIFIED)` 仍只能表明请求被拒绝、未取得库存信息，**不能将网关拒绝冒充函数体鉴权证明，也不能强行记为 7/7**。
- **最新 P2-3A 结论：夫妻 A/B 两账号已登录只读链路均通过；匿名读取无数据泄露的已覆盖项通过；匿名读取 RPC 的拒绝来源仍为已知的单独安全验收余项。** 不要求用户重跑 A、B 或 005–018 SQL。
- 下一阶段可以在 feature 分支开展 P2-3B **虚拟宝宝受控创建入口的离线/隔离环境设计和验证**；但真实 CloudBase 写入测试宝宝、模拟采购和清理测试数据，均须另行获得用户明确授权；不得影响 v1.1.2 本地历史记录、家庭成员或生产版本。

### B.15 2026-11-11 P2-3B 虚拟宝宝隔离代码与合同测试完成（仅模拟环境）

- 已在 `feature/cloudbase-sync-v1.2.0` 新增 `cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql`（两个 owner-only 创建/软停用测试宝宝 RPC 草案）以及 `020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql`（18 项只读检查）。
- SQL 使用专用 `legacy_slot='__xb_smoke_v1__'`，避开正式 `primary`；同一家庭最多一个此版本的测试宝宝，重复创建返回原 ID，停用后不再复活。所有真实授权必须同时满足 `auth.role/uid`、`is_family_owner`、`can_use_app('xb')`；客户端仍不能直接 INSERT/UPDATE 宝宝表。
- `tests/postgres/p2_smoke_child_contract.sql` **只在 GitHub Actions 一次性 PostgreSQL16 容器**中创建和停用合成测试宝宝，覆盖成员/陌生人/anon 拒绝、owner 无 xb grant 拒绝、重复创建、停用审计、错误 ID 不能停用正式 primary、停用后买入拒绝、库存/采购数据不变。020 **18/18 true**、整个 PG 合同 PASS；JS 还提供静态安全锁定用例。
- 已整理 `docs/v1.2.0/P2_3B_SMOKE_CHILD_REVIEW.md`，列明不能再次创建已停用测试宝宝、不能删除测试审计、未来正式 UI 和历史迁移必须排除测试标识。
- **从未运行 019/020 到真实腾讯云；也没有创建任何真实 CloudBase 虚拟宝宝、库存、采购、迁移记录**。019/020 仅草案，正式执行必须另行得到用户对新增测试数据、权限/函数安装以及软停用审计保留的明确授权。
- 正式 main / develop 和生产 PWA 未修改；不让用户重跑旧版 005–018 SQL。

### B.16 2026-11-11 P2-3B 并发审查、纯内存演练页面和后续真实数据过滤守卫

- 安全审查发现 `019` 原来与 `009` 使用不同的家庭事务咨询锁，极端并发下可能使“采购检查活跃”与“停用宝宝”交错。**已只修改未部署的 019**，使创建/停用共享 `009` 的 `xb.inventory.family:` 锁键；改用首次 `CREATE FUNCTION` 防止已有同签名 RPC 被静默覆盖。PG16 合同与静态 lock-key 验证通过；未重跑或修改真实 CloudBase 的 009。
- 新增 `cloudbase/smoke/p2-smoke-preview.html` + `p2-smoke-preview.js`，只有浏览器内存状态，**不存在 CloudBase SDK/网络/持久化/真实写入调用**；12 个模拟操作覆盖 A/B +60/+80=140、重发去重、ID 冲突、各读本人 ACK、成员无权创建/停用、停用后拒绝买入。可选手动上传到 `xb-test/` 专用测试目录预览，不覆盖旧页，真实云端写入按钮永久禁用。
- 新增 `sync/child-scope-guard.js` 及纯函数测试：未来正式云端宝宝列表必须同时查询 `legacy_slot`、`deleted_at`，排除 `__xb_smoke_` 及停用记录；历史数据迁移只能匹配活跃的 `primary`。缺字段即报错，不能把测试宝宝混入真实宝宝。**该守卫尚未集成生产 PWA**。
- `tests/p2-smoke-preview.test.cjs` 与 `tests/p2-child-scope-guard.test.cjs` 已加入 Node 回归；最新 245/245 PASS，isolated PG16 PASS。预演运行和真实两账号云端同步严格分开。
- `docs/v1.2.0/P2_3B_PREVIEW_RUNBOOK.md` 记录可选手机预览步骤、12 项预期和后续真实授权闸门。P2-3B 真实安装 019/020/创建测试宝宝、采购、软停用依然**未获授权**。历史本地数据、1 家庭/2 成员/2 授权以及 main/develop 不变。

### B.17 2026-11-11 虚拟宝宝网页模拟全部 PASS；采购编辑需求与测试交付格式

- 用户反馈：通过 P2-3B 独立网页测试页面，**全部步骤 PASS**。按预定共 12 项标记 `BROWSER_MEMORY_ONLY_12_OF_12_PASS_REAL`（用户汇总反馈，未传逐项日志）。它只测试本地内存模拟的 A/B +60/+80、ACK、撤销权限和停用，不是云端数据库读写。正式 CloudBase 019/020 仍未部署且原业务表继续视为未经 P2-3B 写入。
- 用户明确提出后期购买录入错误需要**支持编辑已存购买信息**：品牌/系列/日期/价格为元数据修改、数量/尺码为事务差量库存调整，需要追踪修订历史、冲突、幂等和两端一致性。现有已部署 009 只有 `buy/use/stocktake/reverse`，**还没有云端编辑 API**。新增完整需求文档 `docs/v1.2.0/PURCHASE_EDIT_CORRECTION_REQUIREMENTS.md`，要求正式发布前实现和验证，不承诺现已支持。
- 用户明确要求：**后续每次发送测试任务时，在聊天对话正文同时给出测试文件直接链接、测试页面上传位置/地址、逐步操作步骤、预期结果、错误反馈格式和安全注意事项**，不可只把步骤写在 GitHub MD 后让用户自己寻找。
- 仍维持不触碰 v1.1.2 旧版历史、只在 Feature 开发、非授权不在真实 CloudBase 写测试宝宝/采购或迁移数据的闸门。

### B.18 2026-11-11 六阶段开发路线图与只读宝宝列表接口

- 新增总体开发计划：`docs/v1.2.0/ROADMAP_TO_RELEASE.md`；阶段依次为受控测试环境、真实 A/B 库存采购、采购后编辑、全业务云端同步、旧版历史可恢复迁移、PWA 集成验收与发布。
- 用户要求的**采购记录修改、历史数据兼容、长效会话、后续测试文件及步骤直接通过对话发送**已固定为阶段验收和发布要求。
- 开发分支新增 `sync/cloudbase-child-reader.js` + `tests/p2-cloudbase-child-reader.test.cjs`：在有有效登录、当前家庭可见和 xb 应用授权时只读宝宝行，查询强制包括 `legacy_slot` 与 `deleted_at`，使用既有 `child-scope-guard` 排除 smoke 及停用宝宝；无会话、无授权、不完整字段、重复 ID 等错误不当作“零宝宝成功”。
- 历史迁移目标仅限 **活跃的 `primary`**，`inspectLegacyTarget` 返回 `readyForMigration:false`，不会自动写入或替换 v1.1.2 历史；后续须单独完成数据恢复方案与迁移授权。
- 兼容后续新增家庭成员，不写死当前两个 xb grant 的数量；Mock SDK 用例包含三位成员的家庭扩展。
- CI JavaScript 254/254、PG16 合同已通过（以 8dfa197c0a2d 为代码验收基准）；尚未导入正式 v1.1.2 / main，不创建真实测试宝宝、采购或历史迁移。

### B.19 2026-11-11 P2-3C 上传前置检查实现与真实只读浏览器测试准备

- 已增补 `sync/cloudbase-access-preflight.js`：`getSession()` 的 `data.user.id` / `data.session.user.id` 必须与 actorUid 一致，且通过 CloudBase RLS 的 `families`、`family_members`（本人 `user_uid`）、`family_app_access`（本人 xb grant）实时只读校验。仅基于真实会话和服务端授权做有限判断，错误消息必须脱敏，绝不通过本地昵称或按钮自我声明。
- 新前置检查将 `initialized:false` 固定写入返回值。**不是声称服务器库存为空，也不是自动创建/验收初始库存**；没有独立完成的 server+IDB durable baseline handshake 之前，原有 `inventory-outbox-runner` 和 `inventory-sync-reader` 均返回 `family-not-initialized`，不能发送/确认任何库存操作。合成测试刻意传入 `uploadEnabled:true` 仍阻断写入。
- 新增独立网页 `cloudbase/smoke/p2-upload-readiness.html`、`p2-upload-readiness-bridge.js`、原 `sync/cloudbase-access-preflight.js` 三文件组合。只含登录状态、家庭成员/应用权限只读查询及“上传保持阻断”的显示；**所有真实创建、购买、迁移按钮禁用**，不读旧版 localStorage，不上传库存。
- `tests/p2-cloudbase-access-preflight.test.cjs` + `tests/p2-upload-readiness.test.cjs` 合成测试通过，累计 **269/269 JS PASS**、PG16 合同 PASS。前置检查真实 CloudBase SDK 浏览器验收仍 `LIVE_PENDING`。
- 本轮后续需要用户真实测试时，在对话正文直接交付三个文件链接、`xb-test/` 目录位置、点击步骤、预期 `AUTH_PASS_UPLOAD_BLOCKED` 和五项字段、脱敏反馈方法；完整文档 `docs/v1.2.0/P2_3C_UPLOAD_READINESS_RUNBOOK.md`。
- 仍无 P2-3B 虚拟宝宝 SQL/测试数据写入授权：不部署 019/020、不模拟真实采购、不更改 main/develop 或正式 v1.1.2、不迁移本地历史。

### B.20 2026-11-11 P2-3C 电脑截图与手机实测，双端前置检查符合预期

- 用户截图清楚显示：总体 **`AUTH_PASS_UPLOAD_BLOCKED`**；`session PASS(SESSION_PRESENT)`、`family PASS(ONE_VISIBLE_FAMILY)`、`member PASS(MEMBERSHIP_VERIFIED)`、`grant PASS(XB_GRANT_VERIFIED)`、`upload_gate BLOCKED(DURABLE_BASELINE_NOT_VERIFIED)`。用户反馈手机端也得到相同结果。
- **正确验收分类：P2-3C 两个浏览器端真实 SDK/RLS 只读核验通过；上传安全闸门按设计保持关闭。** 这是合格状态，`BLOCKED` 不是错误。尚未证明 IDB 与服务器库存初始快照一致，也不代表真实两人购买/同步可用。
- 用户表示没看到登录账号步骤：本页**设计上没有登录入口**，只调用 `getSession()` 检查有效会话。电脑/手机两侧均有 `SESSION_PRESENT` 且后续真实 RLS 读通过，所以无需此页再次发送 OTP；会话持久化的多日/过期/刷新行为仍需独立生命周期测试。
- **区分身份**：此前 P2-3A 已分别得到夫妻 A/B 两账号 10/10 PASS，但本轮新页面仅报告权限结果，不显示角色或 UID。因此“电脑与手机结果相同”本身不能独立证明本轮是在两种不同身份下执行；下一版诊断可仅展示 `owner/member` 角色而不泄漏 UID，避免用户为了证明身份再执行无意义登录。
- 用户不需要重测本轮 P2-3C、不需要再传任何文件或运行 SQL。真实 CloudBase 仍不允许未经新授权写入虚拟宝宝、采购和历史迁移；不改正式 `main` 与 v1.1.2 本地存储。
- 接下来准备**服务器库存六尺码与 IndexedDB outbox 的安全初始基线握手**，必须能拒绝既有待同步操作、不一致 revision、错误家庭/child 或过期权限，不能人为把 `initialized` 改成 true 来放行真实上传。

### B.21 2026-11-11 P2-3D 库存初始化基线只读验证（代码与模拟测试完成）

- `sync/inventory-baseline-inspector.js` 实现独立的**显式触发、全结果禁上传、永不更新本地库存/ACK**的 P2-3D 只读核验：先核查 SDK 登录与家庭 xb 授权，再核查当前非测试、未停用宝宝；随后只读本设备按家庭/actor 的含 ACK 队列和 snapshot；最后使用现有 `xb_read_inventory_reconciliation` 检查服务器六尺码及每条操作回执。
- 拦截缺失/重复尺码、负库存、版本不合法、服务端 actor/family/child 不一致、回执集合不全、已 ACK 操作在云端消失、队列待补传/冲突/blocked、IDB snapshot 不可信/与服务器不同、超过 50 条回执请求上限。所有状态 `uploadAllowed:false` 和 `localUnchanged:true`，**不存在初始化、采购、清理、IDB ACK 或真实上传调用**。IDB adapter 第一次被打开可能建空 schema，但不会改库存/旧版 localStorage。
- `tests/p2-inventory-baseline-inspector.test.cjs` 新增 **15 组用例**，含复用真实 Access / ChildReader / InventoryClient 适配器与合成 SDK 的端到端只读 RPC 演练。完整 JS CI **284/284 PASS**，PG16 隔离合同 PASS；并不代表当前真实 CloudBase 已进行库存基线检查。
- 文件 `docs/v1.2.0/P2_3D_BASELINE_INSPECTION_REVIEW.md` 说明“云端空库不等于旧版手机零库存”、不同结果码及下一阶段安全基线初始化、历史兼容与权限重新核查要求。下次如需用户测试，务必在对话直接发文件、上传位置与步骤。
- 本轮不要求用户手动测试：真实 CloudBase 仍无测试宝宝，空表检查不能证明双端同步；不执行 019/020、没有新数据库业务写入、不修改正式 main / 既有 v1.1.2 历史数据。

### B.22 2026-11-11 P2-3E 本地库存首次受控初始化协议与隔离回归

- 新增 `sync/inventory-bootstrap-coordinator.js`：显式触发、仅本地事务、绝不执行云端库存写入的初始化协调器。先核对实时身份/家庭/宝宝，再要求当前 **family+child+actor** 具备独立可信的历史迁移与备份验证证明；**当前没有真实迁移收据服务**，因此默认拒绝。
- 读取含已 ACK 的所有 IDB 队列、禁止已有快照/目标宝宝已有操作或队列损坏，连续两次核对服务器六尺码库存和 revision。正式模式不执行任何初始化写入，仍 `uploadAllowed:false`。
- **仅在完全合成的隔离测试**显式设置 `permitIsolatedLocalSeed:true` + `seedLocal:true` 后，模拟提交前重新核查身份/历史/队列，由既有 `idb-outbox.initializeInventory()` 同一事务完成本地快照写入，提交后第三次读取服务器；若服务器已变化，保留快照、标记人工复核，绝不自动放行上传。
- `tests/p2-inventory-bootstrap-coordinator.test.cjs` 的 **17 项**与 `tests/idb-atomic-inventory.test.cjs` 新增 **3 项**实际内存 IndexedDB 事务测试通过：刷新后恢复、重复初始化拒绝、已有与提交前插入的 pending 队列安全保留；完整 JS 回归 **304/304 PASS**，PG16 隔离合同 PASS。**不是**浏览器多标签并发或真实云端数据的完成证明。
- 审查文件 `docs/v1.2.0/P2_3E_ATOMIC_BOOTSTRAP_REVIEW.md` 说明真实历史凭证、底层 IDB 直接初始化可调用、服务器读取与本地提交时间差、专用测试宝宝单独路径都是正式放行前的**阻断项**。
- 未部署 SQL 019/020、未在腾讯云创建测试宝宝/采购/库存，未修改生产 `main`、v1.1.2 本地 `localStorage`、账号或家庭成员数据。本轮不要求用户再上传网页/执行 SQL；如后续需手动测试，文件和详细步骤直接在对话中给出。

### B.23 2026-11-11 P2-4A 旧版导出备份保护与恢复预览

- 已核对当前正式 `index.html` 的 `exportData` / `importData`：导出文件格式为 `{app:'xiaobao-diapers',version:1,exportedAt,data}`。**现有导入将替换本机数据，且合并默认值/钳制库存**，不允许用户用正在使用的手机直接进行覆盖式恢复验证。
- `sync/legacy-backup-vault.js` 纯本地库对原始导出 JSON **原文封存**，用 SHA-256 校验源文本及文件大小；未知旧版字段仍原样保留，并且显式声明 `migrationAuthorized:false` 与 `verifiedByServer:false`。对未知字段/不兼容格式不提前删除或补默认值。
- `cloudbase/smoke/legacy-backup-check.html` + `legacy-backup-check.js` 可在单独静态 `xb-test/` 目录提供**本地文件选择器**：选择原始备份 → 生成 SHA-256 保护副本 → 由用户本地下载 → 再次选择刚下载的保护副本 → 验证后可下载字节等价的原始 JSON。页面 CSP 禁止网络连接，也没有 CloudBase SDK、fetch、localStorage 或 IndexedDB。
- `tests/legacy-backup-vault.test.cjs` 8 项和 `tests/legacy-backup-check-browser.test.cjs` 4 项新增测试，完整 JavaScript **316/316 PASS**，PG16 隔离合同 PASS。正式业务数据从未被写入；用户浏览器/真实备份的校验仍待用户自行执行。
- 完整三文件链接、`xb-test/` 上传目录、原版导出步骤、保护副本二次验证、脱敏反馈与禁止真实恢复操作见 `docs/v1.2.0/P2_4A_LEGACY_BACKUP_RESTORE_RUNBOOK.md`；**本轮在对话正文也要发送相同的具体测试文件和步骤**。
- SHA-256 验证只能防意外破坏，**不是来源身份签名、正式恢复成功或历史迁移审批**。后续另做完全隔离的应用数据恢复及幂等迁移收据，不触碰现有 `main` 或用户手机原记录。

### B.24 2026-11-11 P2-4A 用户真实浏览器两步验证通过（已接收截图）

- 用户上传两个页面截图，第一张：已经选择从正式小宝管家 v1.1.2 导出的 JSON，页面显示“原始导出文件：格式正确”“保护副本：生成并自检 PASS”“可恢复原始文件：EXACT_ORIGINAL_EXPORT_AVAILABLE”。第二张：重新选择下载后的保护包，页面显示“保护副本核验 PASS”“原始文件字节长度：3265”“SHA-256 校验：一致”“原始备份完整恢复预览：PASS”以及“不会自动覆盖原有库存、采购或参考价”“真实云端迁移：仍然禁止”。
- 状态更新为 **P2-4A REAL_BROWSER_BACKUP_VAULT_PASS**；该结果是真实用户备份经过浏览器内完整性校验，并不证明正式旧版 `importData()` 回写后的数据逐字段一致，也不证明原始备份的服务器授权、CloudBase 收据、真实库存/采购同步。
- 页面网络连接禁用、文件只在本地处理。没有让用户分享 JSON/金额/家庭资料；正式 `main`、手机 `localStorage['xiaobao_diaper_planner_v1']` 和真实 CloudBase 业务数据保持不变。**不要求用户重复运行 P2-4A。**
- 下一项应进入 **P2-4B 隔离恢复差异审计**：在模拟状态/临时隔离容器对原始 v1.1.2 导入行为进行字段一致性对照，绝不建议用户直接在已使用的手机上点击「从备份恢复」。

### B.25 2026-11-11 P2-4B 旧版导入器的离线数据差异审计完成

- 复核正式 `index.html` 的 `importData` 与原生 `growth.js`：导入时会补默认值、钳制六尺码库存/目标/日用量、规范化宝宝资料和体重记录；简单的备份原字节取回 PASS **不等同于业务数据无损导入**。
- 新增 `sync/legacy-restore-projection.js`，只在内存模拟当前旧版导入行为，并在源导出对象与模拟还原对象间进行完整结构比较；未知扩展字段不会被输出，但其变化会计入差异；API 始终 `productionImportExecuted:false`、`canReplaceLocalState:false`、`canUpload:false`。
- `tests/legacy-restore-projection.test.cjs` 10 项涵盖合法状态原样投影、缺省值补入、库存舍入、体重异常过滤、嵌套未知字段损失、价格覆盖精度、源码合同漂移和零网络/零存储写入。CI 完整回归 **326/326 PASS**；隔离 PostgreSQL 合同保持 PASS。
- 用户 P2-4A 实测的 3265 字节备份文件**没有提供给开发分支，也不需要提供**。P2-4B 只使用合成样本，下一阶段需在独立/可回滚的测试上下文验证正式导入器实际效果；不允许用户在当前使用的小宝管家里点击恢复。
- 参见 `docs/v1.2.0/P2_4B_RESTORE_PROJECTION_REVIEW.md`。当前不需要用户执行额外文件测试，也没有授权云端历史迁移或正式版升级。

### B.26 2026-11-11 P2-4C 正式旧版导入器原样执行与模拟重载

- 完成 `tests/helpers/isolated-v1-import-harness.cjs`：在 GitHub Actions 的一次性 Node VM 提取正式 `index.html` 原样 `importData`、`save`、`load` 及辅助源码，用合成 `FileReader` 和**仅内存** `localStorage` Map 执行，不访问真实浏览器、用户历史或网络；实际 `growth.js` 参与字段规范化。
- `tests/legacy-real-import-isolation.test.cjs` 12 项安全合同已通过：标准数据导入/持久 Map/模拟重开、一致性对照，取消替换、错误 JSON、库存负值/四舍五入/上限、目标库存及日用量界限、购买/比价/参考价三位小数、体重异常过滤和未知嵌套扩展字段去除等。新增发现：**v1.1.2 原始导入器不会检查版本号**，未来迁移必须显式拒绝未知版本，不能套用旧逻辑。
- P2-4B 独立投影与 P2-4C 原始导入代码的多个合成样本结果一致。完整 JS CI **338/338 PASS**，隔离 PG16 合同 PASS。用户 P2-4A 浏览器封存核验已通过，无需重复上传备份。
- 范围严格区分：只在合成内存执行原样导入函数，不是完整正式网页、真实用户备份或手机 localStorage 的恢复测试。测试仅写 VM 局部 Map；**未改 main、GitHub Pages、正式 PWA、CloudBase 业务表、两个真实成员或任何历史数据**。
- 详见 `docs/v1.2.0/P2_4C_REAL_IMPORT_SANDBOX_REVIEW.md`。下一步设计无损/允许修正字段清单和严格版本预检、云端迁移的幂等收据，不用在正在使用的手机上做覆盖式恢复。

## C. 第一批：P1 已有家庭的两账号真实权限测试（已验收存档，不要求重复）

**状态：2026-11-11 用户反馈 A/B1/B2/B3/B4/C 六项通过。仅作为已执行步骤的记录。**

**测试对象**：已有家庭中的管理员账号 A 和普通成员账号 B。无需新建家庭、无需再次生成邀请码、无需重新邀请已有成员。真实 CloudBase 昵称可能被修改，故仅用“测试昵称→恢复原昵称”的短暂变更；任何异常立即停止。其他纸尿裤数据不会被测试页面读取。

### C0 准备

1. 使用此前已部署的 CloudBase「静态网站托管」HTTPS 诊断页 `xb-test/auth-test.html`。如诊断页不存在或非最新版，先报告，不从本机 `file://` 随意测试。
2. 打开正式小宝管家 v1.1.2（只查看），确认库存及记录能正常显示；建议通过「数据备份与恢复」在原设备导出 JSON 保存到本机。**不要在测试页导入任何真实备份**。
3. 诊断页若要求环境 ID 和凭证，只用 CloudBase 控制台提供的浏览器 Publishable Key；不得输入管理员 API Key / service_role SecretKey。真实验证码只在自己浏览器中填写。
4. 记录测试开始时间、设备浏览器、账号角色（A/B）；反馈时不要附明文邮箱、家庭 ID、密钥、邀请码。

### C1 管理员 A（真实账号）

1. 在诊断页「连接测试环境」；如会话未登录，主动点击发送验证码并完成验证。
2. 「检查登录与 RLS 读权限」应显示登录有效、读取成功。
3. 「查看我有权限的家庭」应是**已存在家庭 1 条**，自动填写家庭 ID。
4. 「查看家庭成员昵称」应有 **2 名成员**，角色为管理员/家庭成员，昵称约为「我」「老婆」，不应展示原始长 UID。
5. 不点击「创建家庭」「生成邀请码」「使用邀请码加入家庭」。该阶段不需要这些写操作。
6. 测试结束前，管理员可留在登录状态，以便最后复核昵称没有被非法修改。

### C2 普通成员 B（真实账号，优先）

1. 在配偶自己的手机/浏览器打开**同一 HTTPS 诊断页面**，按需邮箱验证码登录。不要把 A 的浏览器会话误当 B。
2. 「查看我有权限的家庭」应返回**相同家庭 1 条**；「查看家庭成员昵称」应有 2 名。
3. 在成员选择框中选中自己（原昵称「老婆」），将昵称临时改成「妈妈-测试」，点击「保存成员备注」；预期保存成功且重新读取时可见。
4. 再将本人昵称恢复原先的「老婆」；预期成功。若原始昵称不同，恢复**实际原值**。
5. 在成员选择框选中 A 管理员，填写「越权测试」并尝试保存；预期服务端拒绝，通常为 `42501` 或对应权限拒绝码，管理员原昵称不变。**若居然显示成功，请立刻停止后续测试并反馈；由 A 恢复原昵称，禁止再做任何云端业务部署。**
6. 在当前 B 会话尝试「生成一次性邀请码」；预期服务端拒绝（通常 `42501`），**不会创建有效邀请码**。不要点击「创建家庭」。
7. B 退出、重登后再读取家庭和昵称；预期仍是同一家庭，不需要再次接受邀请。

### C3 最后由 A 核对

1. A 重新点击「查看家庭成员昵称」，核对「我」和 B 的原昵称均正确。
2. A 查看正式 v1.1.2，确认历史库存、采购、报价、体重和参考价仍在。
3. 反馈 C1/C2/C3 各子项 PASS/FAIL/BLOCKED；如失败，仅提供按钮名称、错误码和脱敏截图（不要晒出验证码/家庭 ID/邮箱/令牌）。

### C4 陌生账号 C / 撤权（可后置）

- 若当前没有专门测试账号，不要求用户为了赶进度新建账户。
- 不得撤销现有 A/B 任一成员以测试权限。必须另设安全的虚拟成员测试方案并得到用户同意。
- 后续测试 C 应看不到家庭、不能创建邀请/编辑昵称/读取业务表；撤权后旧 token 不得继续云端读取或写入。

## D. 第二批：P3 Edge IndexedDB 离线持久化诊断（纯虚拟数据）

**测试文件**：必须同时部署 `cloudbase/smoke/idb-offline-test.html` 与 `cloudbase/smoke/idb-offline-sw.js` 至 CloudBase 静态网站托管的同一独立测试目录（如 `xb-test/`）。SW 仅作用于 `idb-offline-test.html`，不拦截 `auth-test.html` 或正式应用，不读取/清除任何正式数据。网页须通过 HTTPS 加载。如无法安装 SW，仍可按 D2a 测试已打开页面的离线录入；不要擅自清理网站数据。

1. 打开页面，确认标题「小宝管家 · P3 浏览器离线测试」，说明明确“独立的虚拟数据”。
2. 点击①「创建虚拟库存（只执行一次）」；预期成功。若提示已初始化，不要重复初始化，可直接下一步。
3. 点击②「离线记录采购 +60 片」；预期 S 码虚拟库存 +60，待同步数量 +1。
4. 点击③「重新读取并检查」；确认库存和待同步数量一致。
5. **D2a — 已打开页面断网录入（不依赖 SW）**：先打开网页，确认按钮正常，再关闭 Wi-Fi 和移动数据；**保持当前页面不刷新、不关闭**，点击②和③，预期 S 码增加 60、待同步 +1，且无网络也能在当前页面录入。
6. **D2b — 离线刷新/关闭重开（需要测试 SW）**：恢复网络，确保本 HTML 与 `idb-offline-sw.js` 同目录；等待页面显示「离线页面缓存已就绪」。若没有显示，停止这一子项并反馈具体状态文字，标记 BLOCKED，不将其误判为 IndexedDB 数据丢失。
7. 当缓存明确就绪后，再次关闭 Wi-Fi、移动数据；**刷新本测试页面，或关闭标签后用同一 URL 重新打开**。预期静态页面加载成功，点击③后看到断网前保存的库存/事件。若未打开，记录浏览器型号、错误提示和是否已显示缓存就绪，勿清除正式网站数据。
8. 恢复网络，再点击④「模拟云端收到全部操作」；预期待同步归零。仅是**本机模拟服务器回执**，绝非真正的 CloudBase 同步。
9. 测试完回到 v1.1.2 正式软件核对历史库存/采购/体重未改变；如需重测，复用现有虚拟库，不要清空同域网站数据。

## E. 后续测试闸门（必须逐项记录）

| 门槛 | 目标与最低通过条件 | 依赖 |
|---|---|---|
| E1 CloudBase 真实 SQL | 005、006、008、009、010 逐项审查，真机 SDK 访问、无越权/无重复消费/负库存拒绝 | P1 权限完成 + 用户明确授权部署 |
| E2 库存云同步 | A +60、B +80 后两个客户端一致为 140，两条购买记录准确 | E1 + 独立测试 UI |
| E3 断线/丢 ACK | 本地断网录入、关闭/重开、恢复后同 ID 补传，服务端不重复加库存 | E2 + 持久 IDB UI |
| E4 冲突/撤销 | 旧 revision 盘点拒绝、同时消耗不负库存、撤销保留流水 | E2 |
| E5 全业务 | 体重/宝宝档案/报价/参考价/设置 CRUD、历史删除标记和版本冲突 | E3 |
| E6 旧版迁移 | 原机 JSON 备份、字段对照、迁移 ID 幂等、两机数据对账，不累加历史库存 | E5 + 用户明确授权迁移 |
| E7 PWA/长期会话 | 同一安装源首次 OTP 后正常重启免登录，CloudBase 故障可本地记账恢复 | E6 |
| E8 发布 | 完成所有 E1～E7、审阅回退、用户批准后才合并发布 | 用户最终批准 |

## F. 用户测试结果反馈模板

仅反馈下面这些非敏感字段即可：

| 编号 | 操作 | 结果（PASS / FAIL / BLOCKED） | 错误码（如有） |
|---|---|---|---|
| C1 | A 已有家庭和两个昵称 |  |  |
| C2-1 | B 登录并看到同一家庭 |  |  |
| C2-2 | B 修改本人昵称并恢复 |  |  |
| C2-3 | B 修改管理员昵称被拒绝 |  |  |
| C2-4 | B 创建邀请被拒绝 |  |  |
| C3 | A 最终核对昵称和正式历史数据 |  |  |
| D1 | 独立 IDB 测试页面可打开 |  |  |
| D2 | 虚拟购买、刷新、断网、重开后保留 | PASS（2026-11-11） | 用户反馈全部正常 |
| D3 | 模拟回执后待同步归零 |  |  |

没有条件执行的项目填 BLOCKED 和原因，不需要为了填满通过数而勉强测试。
