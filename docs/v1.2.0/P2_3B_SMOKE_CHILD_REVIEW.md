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
- 先加家庭范围事务咨询锁 `pg_advisory_xact_lock`，再检查唯一索引 `xb_children_legacy_slot_unique`；重复调用返回原本的 `child_id` 与 `created=false`，不新增记录。
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
4. 如果测试产生库存或采购流水，停用只是归档，不会自动删除或归零；应明确审计保留期限、展示过滤、后续迁移排除等策略。禁止 `DROP TABLE`、`TRUNCATE`、修改历史家庭或重置旧版数据。
5. 真机网关级匿名、陌生用户、非 owner 拒绝测试，需要专门的独立测试页面。不得为了制造拒绝用真实业务写入接口尝试非法操作而没有审计和状态核对。
6. `019` 草案不能由用户自行从 GitHub 复制执行；需完成代码安全审查、回退/归档设计、CI、备份风险复核，用户**另行明确授权**后制定分阶段部署步骤。P2-1 已验收 SQL 无需再跑。

## 本轮隔离 CI 验收项目

- 新 RPC 定义与 ACL、固定 search_path、owner/app 检查、宝宝唯一索引：020 **18/18 true**。
- 普通成员、陌生人、没有 xb grant 的 owner、模拟匿名有 EXECUTE 权限但无有效会话：均被函数体拒绝。
- 管理员首次创建、重复创建不重复新增、只有一条独立测试记录、真实 `primary` 行保持不变。
- 成员不能停用；管理员不能通过错误 ID 停用正式宝宝；停用后 revision 仅增加一次、不可复活；停用后 009 采购拒绝且库存/流水保持不变。
- 019 部署脚本自身不插入宝宝或数据，020 检查在业务模拟之前运行。所有合成操作仅发生在 PostgreSQL 16 一次性容器，绝未使用真实家庭 UID/Token/密钥。

## 下一阶段建议

先把 019/020 草案做最终安全审查，再准备独立的、显式手动操作的 P2-3B 测试客户端原型（默认所有业务写入按钮禁用）。待用户对数据库“创建测试宝宝、模拟采购、审计保留和不能简单删除”的风险范围明确批准后，才能在真实 CloudBase 执行相关新脚本及后续 A +60、B +80 的联调。
