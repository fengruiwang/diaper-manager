# 小宝管家 v1.2.0 — P2-3B 虚拟宝宝隔离设计与验收记录

更新：2026-11-11。**仅设计/隔离测试，禁止真实腾讯云执行 019、020 或创建测试宝宝。**

## 目标与部署边界

在现有一个家庭、管理员 A 和家庭成员 B 的 CloudBase 业务模型中，建立**可审计、极小权限**的专用联调宝宝，随后用于两名成员通过已部署的 009/010 RPC 验证采购、库存、幂等与同步。

**当前没有批准在真实 CloudBase 写入任何测试数据**。已获授权完成的是 P2-1 的七张空表和两个 RPC。新 019/020 不是 P2-1 的一部分，不可由于 A/B 只读联调成功而自动部署。

## 已实现文件

- `cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql`：**设计草案**，安装两个 `SECURITY DEFINER` 函数。本 SQL 即便在未来部署，文件本身也只创建函数/授权，不自动创建宝宝；真正调用 `xb_create_smoke_child` **会写入一条宝宝记录**。
- `cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql`：**只读** 18 项结构、安全权限和原有家庭保持核验。首次初始化前应全部为 true。该文件名称仍包含 DO_NOT_DEPLOY，因为本阶段不允许真实执行。
- `tests/postgres/p2_smoke_child_contract.sql`：**仅一次性 PostgreSQL 16 测试容器**使用的合成家庭、成员和测试宝宝生命周期；包含故意的写入、撤销 app grant、模拟 anon 授权和归档。**绝对不得复制执行到真实腾讯云。**
- `tests/p2-smoke-child-draft.test.cjs`：静态 SQL 安全检查及测试顺序保障。

## SQL 设计细节

`public.xb_create_smoke_child(p_family_id uuid) RETURNS jsonb`

- 仅允许 `auth.role()=authenticated` 且 `auth.uid()` 非空。
- 必须同时通过 `xb_private.is_family_owner(family_id)` 和 `xb_private.can_use_app(family_id,'xb')`，不能单凭“已登录”或昵称创建。
- 不接受调用者自由指定宝宝名称、UID、测试标识、库存、金额等字段；服务端固定 `legacy_slot='__xb_smoke_v1__'` 和名称 `测试宝宝（仅云端联调）`。与正式迁移专用 `legacy_slot='primary'` 严格不同。
- 先加**与已部署 009 库存采购 RPC 完全一致**的家庭级事务咨询锁（`xb.inventory.family:` + family ID），再检查唯一索引 `xb_children_legacy_slot_unique`；这样创建/停用可与采购写入串行化，避免“购买已检查活跃，但同一时间停用提交”的窗口。重复调用返回同一个 `child_id` 与 `created=false`。
- 如果该测试宝宝已停用，则永久拒绝重新创建，**一户在当前 smoke v1 标识下只可创建一个宝宝（整个生命周期）**。这是有意的保守限制；以后若确实要重新开展全新实测，需要额外审核新 smoke 测试标识与迁移方案，不能靠删除历史绕过。
- 不写 `xb_inventory`、`xb_inventory_operations`、`xb_transactions`、`xb_migrations`、`xb_baby_profiles`、`xb_weight_records`。
- 不改动现有家庭、成员备注、邀请码、授权或 v1.1.2 本地存储。

`public.xb_retire_smoke_child(p_family_id uuid,p_child_id uuid) RETURNS jsonb`

- 同样须登录、拥有该家庭、且有 xb 授权。
- 必须同时匹配所给家庭、宝宝 ID 以及固定 `__xb_smoke_v1__` 标识，因此无法对正式 `primary` 宝宝执行停用。
- 只写 `xb_children.deleted_at`、`updated_at`、`revision+1`，不做 `DELETE` 或 `TRUNCATE`；重复停用返回 `already_retired=true`，不重复改 revision。
- 停用后，既有 009 采购 RPC 检查 `deleted_at IS NULL`，不能对该测试宝宝继续采购；所有历史库存事件和采购审计保留，不因测试“清理”被抹去。

**权限补充**：函数级 `REVOKE ... FROM PUBLIC,anon` + `GRANT EXECUTE TO authenticated` 属于 SQL ACL 加固。由于 CloudBase HTTP RPC 网关可能不会强制执行 EXECUTE ACL，函数内部的身份、家庭 owner 与 xb grant 检查才是根本保障。普通前端始终不得直接 INSERT/UPDATE 宝宝表。

## 潜在风险与后续强制闸门

1. **共享实例缺少用户可验证的回档备份**。本次测试代码不会改变真实云库；未来若用户同意开展 P2-3B 真机部署，须另行确认新增数据及不可逆归档记录的可接受范围、真实会话、失败/停机处理。
2. 通过 `legacy_slot='__xb_smoke_v1__'` 标识测试宝宝，是利用现有表结构及唯一索引，避免新增第八张业务表。但 `xb_children` 的家庭成员 RLS SELECT **会显示该测试宝宝记录**；后续正式 PWA/迁移/跨业务查询必须在逻辑层明确排除此专用标识，且不能把它映射成正式宝宝或参与历史数据迁移。
3. 创建和停用不是普通用户 CRUD；只允许家庭 owner 主动触发。模拟购买阶段，成员 B 可以在属于同一家庭且获得 xb 授权时对未停用测试宝宝使用已部署的 009，测试结束后由 owner 停用。
4. 如果测试产生库存或采购流水，停用只是归档，不会自动删除或归零；应明确审计保留期限、展示过滤、后续迁移排除等策略。已新增纯函数 `sync/child-scope-guard.js`：未来读取宝宝列表必须同时取得 `legacy_slot` 和 `deleted_at`，缺少字段即拒绝分类；排除所有 `__xb_smoke_` 前缀及已停用宝宝，旧版历史迁移只允许明确的、活跃的 `primary` 目标。当前尚未接入正式 UI，不可作为已解决全部显示隔离的证明。禁止 `DROP TABLE`、`TRUNCATE`、修改历史家庭或重置旧版数据。
5. 真机网关级匿名、陌生用户、非 owner 拒绝测试，需要专门的独立测试页面。不得为了制造拒绝用真实业务写入接口尝试非法操作而没有审计和状态核对。
6. `019` 草案不能由用户自行从 GitHub 复制执行；需完成代码安全审查、回退/归档设计、CI、备份风险复核，用户**另行明确授权**后制定分阶段部署步骤。P2-1 已验收 SQL 无需再跑。

## 2026-11-11 安全复核与原草案修正

- **发现并修复未部署草案的并发锁域不一致**：019 原来使用 `xb:smoke-v1:`，与 009 已部署库存写入锁键不同，极端并发下不能保证停用与采购同步。019 已更改为与 009 相同的 `xb.inventory.family:` 事务锁域。静态回归锁定相同前缀，PG16 生命周期合同继续通过；生产环境没有执行此修复，因为 019 本来就未部署。
- **避免静默覆盖现有函数**：019 新函数改为首次安装用 `CREATE FUNCTION`，如名称签名已存在则事务失败，不能无提示覆盖现有 RPC。
- **非真实验证边界**：Node 的 12 步模拟购买并不调用服务器、不是幂等性的真实验证；PG16 单进程业务测试和锁前缀检查仍不能替代未来真实两设备并发负载测试。
- **清理风险**：软停用只设置 `deleted_at`，保留测试 child / purchase / operation 审计；如果未来产品查询没有排除专用测试 `legacy_slot`，测试行可能被同家庭成员的正式宝宝列表看到。此为正式部署前必须核验的发布阻断点。

## 本轮隔离 CI 验收项目

- 新 RPC 定义与 ACL、固定 search_path、owner/app 检查、宝宝唯一索引：020 **18/18 true**。
- 普通成员、陌生人、没有 xb grant 的 owner、模拟匿名有 EXECUTE 权限但无有效会话：均被函数体拒绝。
- 管理员首次创建、重复创建不重复新增、只有一条独立测试记录、真实 `primary` 行保持不变。
- 成员不能停用；管理员不能通过错误 ID 停用正式宝宝；停用后 revision 仅增加一次、不可复活；停用后 009 采购拒绝且库存/流水保持不变。
- 019 部署脚本自身不插入宝宝或数据，020 检查在业务模拟之前运行。所有合成操作仅发生在 PostgreSQL 16 一次性容器，绝未使用真实家庭 UID/Token/密钥。

## 模拟页面和业务投影保护（最新）

- `cloudbase/smoke/p2-smoke-preview.html` + `p2-smoke-preview.js` 已实现手机端 12 步模拟，所有数据仅在 JS 内存中，不使用 CloudBase SDK、RPC、fetch、WebSocket、localStorage、IndexedDB 等，也不调用任何 SQL。真正写入的按钮被禁用，刷新页面归零。手册：`P2_3B_PREVIEW_RUNBOOK.md`。
- 纯业务投影防护模块：`sync/child-scope-guard.js` + `tests/p2-child-scope-guard.test.cjs`。未来正式读取必须 `SELECT id,family_id,legacy_slot,deleted_at,...` 并调用 `activeBusinessChildren()`，不能直接用不含测试标识/停用字段的查询。缺失关键字段应抛错，不应默认展示。
- `requireLegacyMigrationTarget()` 仅接受 `legacy_slot='primary'` 且未停用的目标，避免把 v1.1.2 历史数据导入 smoke 宝宝或任意尚未核准的 child。
- 以上防护**只在开发分支**，还未集成正式产品及真实迁移。下一次真实测试宝宝创建前仍需逐项核验客户端筛选、RPC owner 权限、可审计软停用和共享实例风险。

## 下一阶段建议

独立的手机端**纯内存演练页面已实现**：`cloudbase/smoke/p2-smoke-preview.html` + `p2-smoke-preview.js`，含 12 项手动场景，所有真实云端操作按钮永久禁用，不调用 SDK、RPC 或任何网络/持久化 API。验收和部署说明见 `docs/v1.2.0/P2_3B_PREVIEW_RUNBOOK.md`。仍需完成最终独立安全审查与真实并发验证设计。待用户对数据库“创建测试宝宝、模拟采购、审计保留和不能简单删除”的风险范围明确批准后，才能在真实 CloudBase 执行相关新脚本及后续 A +60、B +80 的联调。
