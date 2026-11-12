# 小宝管家 V1.2.0｜M1-02 阶段 A 最终受控执行方案（尚未授权）

基线：`feature/cloudbase-sync-v1.2.0`，正式 main / V1.1.2 禁止改动。以下是**准备好的操作顺序**，本文件不批准执行真实数据库 SQL。

## 已经确定，不要重做的事
- P2-1 既有 005–018 安装与 012（12/12）、018（20/20）等验收已经记录为真实 PASS，不重新运行。
- A/B 登录及家庭 xb 授权此前已真实通过；M1-01 浏览器部署、登录、刷新会话恢复也已通过。
- 019/020 之前只在临时 PG16 验收，**从未获批准在共享 CloudBase 运行**。
- 本轮预备 UI 内置三种互相独立的发布开关：创建、采购、停用全部为 false。只新增 Feature 代码，不能自动开启。

## 阶段 A 严格顺序（先只读，后明确用户批准，再 DDL）
**第 1 项：仅执行 019A 的一条只读 SELECT。**
- 控制台选择现有 `xiaobao-family` PostgreSQL SQL 编辑器，绝不选择正式 PWA 的静态根目录或其他数据库。
- 打开 `cloudbase/sql/019A_xb_smoke_stage_a_preflight_READONLY.sql`，复制完整单条 SELECT，运行一次即可。
- 预期输出**一行 18 个布尔字段均为 true**。其中含 019 依赖的 auth.* 与 xb_private.* 函数、旧购买/对账 RPC、七张业务表 RLS、唯一索引定义、必要字段类型、实名/匿名角色、家庭/成员/xb 授权数、无任何测试宝宝、无现成测试 RPC/重载及未有业务采购库存。
- 任何 false、SQL 错误、现有 RPC 同名/同签名、业务表不空或数量变化：**停止，不安装 019，不调整家庭、权限、索引或历史以追求 PASS**。仅返回字段名、布尔结果和错误码（不返回 UUID、Token、邮箱或密钥）。
- 019A 只读取当前结构和汇总计数，不会写任何数据。开发人员没有直接访问当前腾讯云 SQL 控制台；以前的 012/018 PASS 不替代本轮真实 019A 返回值。

**第 2 项：取得单独、精确的“阶段 A 019 安装授权”。**
授权仅涵盖在现有 CloudBase PostgreSQL 共享实例一次性运行经审查的原文件 `cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql`，安装以下对象：
1. `public.xb_create_smoke_child(uuid)`；
2. `public.xb_retire_smoke_child(uuid,uuid)`；
3. 仅对上述两个新函数执行 `REVOKE ... FROM PUBLIC,anon` 与 `GRANT EXECUTE TO authenticated`。

019 使用 `BEGIN/COMMIT`，`CREATE FUNCTION`（而非 OR REPLACE），函数体均有显式身份 + 家庭 owner + xb 授权检查。安装不调用它们，不创建宝宝，不插入库存/采购，不操作既有用户、家庭或原业务记录，不改变正式 main 和本机历史。

**第 3 项：若 019 完整成功提交，仅执行 020 的只读验收。**
- 执行 `cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql` 完整原 SQL 一次。
- 预期 **18/18 true**；包括签名存在、函数为 `SECURITY DEFINER VOLATILE`、JSONB 返回、固定 `search_path`、owner/app 身份校验、anon 无 EXECUTE、authenticated 能调用、保留既有唯一索引、无测试宝宝写入、浏览器无直接写表权限、原家庭 1 / 成员 2 / xb 授权 2。
- 任一 false 或查询报错就停止阶段 A，**不创建测试宝宝、不开启前端真实采购、不执行任何临时 GRANT 或 DROP**。只上报字段名与短错误码。

## 失败时的处理和回退边界
- 预检查不通过：仅查询，无写入，无需回退；先调查而不是改变原数据。
- 019 事务报错：按 PostgreSQL `BEGIN/COMMIT` 语义，事务通常回滚；但控制台执行方式/超时可能令结果不明。**不要盲目重试、运行修复 SQL 或推定对象不存在**；先只读核验是否出现目标函数、ACL 和原家庭记录。
- 019 成功而 020 不通过：停止任何 DML。保留现场元数据，审查 020 原因、函数所有者和 ACL；不能用清空表/修改 RLS/补 GRANT 来“调成 PASS”。
- 如果安装成功但决定撤回，理论上在未调用过这两个函数、没有其他对象依赖时可以**单独审批**后精确移除这两个新增函数；这仍是新一轮 DDL，不是自动回档，不能保证恢复数据库的所有状态。共享数据库无完整可验证的回档备份，仍有未完全可逆的风险。
- 阶段 B 的任何测试宝宝创建、库存/采购 DML、双端联调均不属于阶段 A；另行明确授权。即使阶段 A 成功，也不能默许调用 `xb_create_smoke_child`。

## 资源和正式数据影响
- 不创建新云环境、新表或新增付费实例，只在现有数据库增加两个函数的定义与 ACL。元数据量很小，但 SQL DDL/查询可能短暂占用数据库连接、锁、请求额度。
- 020 和 019A 为轻量只读 SELECT；一次性安装 019 不产生采购记录。CloudBase 静态托管和 PostgreSQL 的配额/调用费用依赖现有套餐，不能承诺零费用或远程恢复能力。
- V1.1.2 数据在浏览器 localStorage `xiaobao_diaper_planner_v1`，本轮既不加载该存储键、也不导入 JSON；正式 main、现有 PWA 地址、图标和 Service Worker 均不变。
- 独立 M1-02 测试宝宝使用固定的 `__xb_smoke_v1__`，排除 `primary` 和正式迁移目标。**不要在完成全部实测之前停用测试宝宝**；软停用后不能在同一家庭以该标识重新创建，历史审计也不会删除。

## 阶段 B 的准备（不包含在授权内）
- 现有 `preview/v1.2.0/index.html` 已准备一体化创建 / 选择 / 停用区，`m102-cloud.js` 有 owner 复核、云端作用域固定、分开的创建、采购、停用发布开关。
- 阶段 A 通过后，再单独批准创建测试宝宝（1 条）和两笔真实采购（S+60、S+80）；仅为批准的功能变更发布新的独立测试版，启用所需开关，**停用开关继续保持 false**。
- A/B 刷新六尺码权威库存 S=140 并对账两笔服务端采购，检查重复 ID、防重放、断网/ACK 恢复及异常时 fail closed。
- 所有真实业务写操作执行前仍须显式用户批准，不能因测试代码已完成自动触发。

## 建议的精确授权语句（仅在 019A 18/18 真实通过后）
“我批准在现有 `xiaobao-family` PostgreSQL 环境中，一次性完整执行已审查的 `019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql`，仅新增两个专用测试宝宝 RPC 及其函数级权限；随后执行只读的 `020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql` 验收。我理解共享数据库缺少可验证的完整回档备份，并接受这一轮仅函数安装的剩余风险。本授权不包括创建/停用测试宝宝、真实采购/库存写入、正式主站发布或任何额外数据库修复。”
