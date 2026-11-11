# 小宝管家 v1.2.0 — P2-3 真实 CloudBase 业务联调方案（草案）

日期：2026-11-11。状态：**P2-3A 已取得真实 A/B 双账号各 10/10 已登录只读 PASS；匿名只读 RPC 拒绝来源仍 INCONCLUSIVE。P2-3B 已完成受控测试宝宝 RPC 草案与 PG16 合同测试（020 18/18 true），但真实 CloudBase 部署及所有 P2-3B/C 业务写入仍未获授权。**

## 已完成的前置基础

- 现有 CloudBase `xiaobao-family`：共享 PostgreSQL 17.11，原有 1 家庭、2 成员、2 项 xb 授权完整。
- P2-1 数据库首次结构安装已通过全部真实环境只读验收：006 19/19、014 15/15、修复后的 015 21/21 与 016 角色 ACL、018 20/20、012 12/12。
- 七张 `xb_` 新业务表目前均为空；两个 RPC `xb_apply_inventory_operation` / `xb_read_inventory_reconciliation` 已安装。
- P3 离线 IndexedDB 模拟断网、离线重开及本地模拟 ACK 已经在独立测试页面通过，**并非真实云端补传**。
- 开发框架：`sync/cloudbase-inventory-client.js`、`sync/idb-outbox.js`、`sync/inventory-outbox-runner.js`、`sync/inventory-sync-reader.js` 等；尚未完整接入生产 PWA。

## 安全与授权红线

1. 所有研发代码、CI、文档留在 `feature/cloudbase-sync-v1.2.0`，不合并 `main` / `develop`、不更新正式站点。
2. **没有用户对 P2-3 的新授权前，不在真实 CloudBase 新建任何宝宝、模拟采购、调整库存或插入迁移记录，也不调用具有写入效应的生产 RPC。**
3. 已发布的 v1.1.2 的 `localStorage['xiaobao_diaper_planner_v1']`、历史 JSON、手机端 PWA、家庭管理员 A 和成员 B 均不改动；不得为了测试撤销任何现有账户或 xb 授权。
4. 真实用户邮箱、UID、Family ID、验证码、Publishable Key、邀请 token、会话密钥不提交 GitHub 或输出到测试日志。
5. 当前 CloudBase PG 共享实例**无可供用户验证的回档备份**。用户仅接受 P2-1 空结构安装的有限风险；对 P2-3 业务写入必须单独评估、取得明确同意。测试数据不能混入旧版迁移基线。

## 建议阶段与通过标准

### P2-3A：零业务写入的鉴权通道测试（先研发，授权后真实运行）

- 使用独立于正式 PWA 的诊断网页/模块；只允许现有 A 或 B 在本人设备登录。
- 明确区分测试页 `auth.getSession` 状态、家庭 xb 应用授权、CloudBase RDB HTTP RPC 可达性、DB RLS 能力。
- 无账号/无有效会话、伪造 familyId、错误 childId、错误参数的访问应被**拒绝**，不得将数据库异常显示为“空数据成功”。匿名端点行为不能仅从 SQL `GRANT EXECUTE` 认定。
- 可用 read-only 的 `xb_children` 等表空结果，确认目前无初始化宝宝；不能把“空表”误认为读取 RPC 对不存在 childId 调用成功。
- 若要调用写入 RPC 做“预期拒绝”测试，必须先证明请求没有任何数据落库（必要时将此项单独放到后续有明确授权的阶段）。
- 仅返回可公开的 PASS/FAIL、错误码；不返回凭证或任何长标识。

### P2-3B：虚拟宝宝的受控初始化入口（需另外审核和授权）

- 不能授予浏览器直接 `INSERT public.xb_children`，不能用管理员 SQL 偷写库。
- 设计**作用范围极窄**的 SECURITY DEFINER 创建测试宝宝接口，必须校验真实登录 `auth.uid()/auth.role()`、现有家庭 owner 身份、xb app grant、输入长度与唯一标识。
- 明确与 `legacy_slot='primary'` 隔离，使用专用测试标识和显式“测试”显示名称；最多一名处于启用状态的虚拟宝宝；禁止重复创建造成冗余记录。
- 不自动创建库存、采购、旧版迁移收据或改动现有家庭/成员。
- 事先设计可审计的关闭/停用或清理流程。由于库存操作和采购具有外键链路，**不得简单 DROP/TRUNCATE/DELETE 来清理已测试数据**；关闭测试宝宝应保留必要审计记录、不给正式 PWA 识别为真实宝宝。
- RPC SQL、只读 pre/postflight、纯合成测试 fixture 必须先在隔离 PG 通过；**正式 CloudBase 部署和任何宝宝创建均再次等待用户批准**。

### P2-3C：真实库存采购联调（需明确测试数据授权）

使用同一专用测试宝宝、夫妻两个真实账号 A/B，各自只在自己的设备登录：

1. A 采购 S +60，品牌/系列/金额/日期完整；B 采购 S +80，预计权威库存 140，两条购买流水准确且以整数分记录。
2. A 重复提交相同 `operation_id` 和相同 payload，必须只记一次；相同 ID 改金额/品牌需拒绝并不改变数量。
3. A/B 各自可读相同六尺码权威库存；读取自己提交的操作 ACK，只能看到自己的 ID 匹配结果，不能伪造 actorUid 读取另一方的 ACK。
4. use、stocktake/revision 冲突、reverse 和不得负库存的边界测试。
5. 模拟客户端断网/丢失服务端 ACK：IDB 保持原操作 ID、恢复后补传不得重复加库存，且必须完成云端 reconciliation 才能显示“已同步”。
6. 对每条步骤采集无敏感信息的审计结果，失败时停止并保留待同步操作，不清库、不强制覆盖。

### P2-3C 补充阻断：已保存购买记录的纠错/编辑

- 用户要求**购买成功后仍可编辑错误的品牌、系列、金额、购买日期、数量、尺码**。编辑不是直接给前端 `UPDATE xb_transactions` 权限，也不宜完全依赖“整笔 reverse + 重新 buy”，否则部分用掉的库存不足时将无法简单撤回。
- 新增 `docs/v1.2.0/PURCHASE_EDIT_CORRECTION_REQUIREMENTS.md`：区分只改元数据（库存不动）与数量/尺码差量调整（库存及有效支出原子更新），要求审计历史、修订冲突、同编辑操作 ID 重放幂等、两账号同步和负库存保护。
- 当前已安装的 `009` 只支持 `buy/use/stocktake/reverse`，**没有 edit API**；本项是未来正式产品必备需求，不允许用现有 12 项纯内存演练“全 PASS”替代验收。
- 未来测试必须在聊天正文直接提供文件链接、上传位置、逐步步骤、预期结果和安全注意事项，不能仅交付 GitHub 文档链接。

### P2-3D：产品端集成（独立开发和发布门槛）

- 只在独立测试站点/开发版集成现有 CloudBase adapter + IDB outbox + sync runner + reader；生产 PWA 不加载新的自动同步代码。
- 登录会话刷新/长期保活、断网、过期 token、家庭 app grant 改变、跨端数据一致性均须验收。
- 全业务模块（宝宝档案/体重/采购参考价/设置等）还有各自的 CRUD 和迁移契约，不能以库存成功冒充全业务成功。
- 真实旧版迁移最后单独审查 schema mapping、备份可恢复性、idempotency、旧版数据校验；用户再决定是否授权。正式发布必须另行批准。

## P2-3A 实际开发交付（2026-11-11）

- 独立浏览器入口：`cloudbase/smoke/p2-readonly-test.html`。
- 只读检查模块：`cloudbase/smoke/p2-readonly-diag.js`，仅 `SELECT` 与只读 `xb_read_inventory_reconciliation` 受控探针，不包含写库存 RPC 或数据表 DML。
- 自动化合成 CloudBase SDK 用例：`tests/p2-readonly-browser-diagnostics.test.cjs`，覆盖 anon / 已登录 A/B、错误权限、RPC 意外成功、网络错误不可误报 PASS、不可输出真实家庭 ID。
- 专用部署及手动验收步骤：`docs/v1.2.0/P2_3A_READONLY_ACCEPTANCE_RUNBOOK.md`。
- **用户已手动上传诊断文件至 CloudBase 静态测试目录并运行真实 SDK/HTTP 只读检查**；正式生产 PWA 没有更新，未写入宝宝或库存。
- A/B 两名真实家庭成员的已登录只读路径已通过，anon 6 项通过但 RPC 拒绝来源仍未分类。不得把该项计为 7/7 完全通过，更不能因此启动未经授权的虚拟宝宝或购买数据写入。

## P2-3B 实际开发交付（仅离线设计和模拟数据库）

- `cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql`：准备 `xb_create_smoke_child` 与 `xb_retire_smoke_child`，仅当前家庭 owner 有权运行。使用固定 `__xb_smoke_v1__` 测试标识，幂等创建、每户一个、软停用且不可复活。文件只是 SQL 草案，尚未运行真实 CloudBase。
- `cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql`：18 项只读核验，**隔离 PG16 18/18 true**。不代表真实 CloudBase 已安装任何新 RPC。
- `tests/postgres/p2_smoke_child_contract.sql`：仅合成 PG16，验证 owner/成员/陌生用户/无授权 owner/anon 的服务器授权和生命周期；不操作真实家庭或历史数据。
- `tests/p2-smoke-child-draft.test.cjs`：静态防误发布、固定标识、权限限制和检查脚本的代码级断言。
- `cloudbase/smoke/p2-smoke-preview.html` + `p2-smoke-preview.js`：独立手机浏览器可操作的 12 步**仅内存**演练，覆盖 A/B 60+80、丢 ACK 重发、冲突、读本人回执和停用后拒绝；真实云端按钮禁用，绝无 SDK 或存储调用。
- `tests/p2-smoke-preview.test.cjs` 与 `docs/v1.2.0/P2_3B_PREVIEW_RUNBOOK.md`：演练模块自动化断言及手机查看说明。
- `sync/child-scope-guard.js` + `tests/p2-child-scope-guard.test.cjs`：未来正式云端宝宝显示和 v1.1.2 历史迁移的**默认拒绝**分类守卫，缺失 `legacy_slot/deleted_at` 即阻断，排除测试和停用宝宝，迁移必须指定未停用的 `primary`。尚未集成正式 PWA。
- 设计审查和未来正式测试前提：`docs/v1.2.0/P2_3B_SMOKE_CHILD_REVIEW.md`。必须先明确风险、测试记录保留和 UI / 迁移排除后，**单独取得用户对真实数据库新增函数与一条虚拟宝宝记录的授权**。

### 2026-11-11 P2-3B 深度复核

- 发现 `019` 创建/停用原先咨询锁键与已部署 `009` 库存写入不同步，存在极端并发窗口。仅修改未部署的 019 为相同的 `xb.inventory.family:` 家庭事务锁键，保证二者序列化；增加静态合同测试，不触碰 CloudBase 真实 009。
- 019 新函数使用 `CREATE FUNCTION` 而非 `CREATE OR REPLACE FUNCTION`，避免误安装时覆盖同签名函数。
- 纯内存手机演练页面已交付，且设计了 fail-closed 的测试宝宝筛选守卫，但**不是真实 CloudBase 双端同步，也未接入正式 UI**。未来必须在单独授权后进行真实创建/采购/幂等/并发、并核实正式宝宝列表与历史迁移排除测试标识。

### 2026-11-11 P2-3C 上传前置安全检查（仅 RLS 只读，真机待验收）

- 新增 `sync/cloudbase-access-preflight.js`：用实际 CloudBase `getSession()` 的 UID 对齐 actorUid，并通过 RLS 的家庭、成员、本人的 xb grant 的只读 SELECT 验证。不会自动登录、不会读取或修改旧版本地数据。
- 与现有 Outbox runner 和 InventorySyncReader 的合成联调保证：`initialized:false`（**未证明持久库存基线**）时即使请求开启同步也**零业务写入**，返回 `family-not-initialized`。不允许仅凭登录/授权判断数据已初始化。
- 独立真实 CloudBase 只读测试工具：`cloudbase/smoke/p2-upload-readiness.html` + `p2-upload-readiness-bridge.js` + `sync/cloudbase-access-preflight.js`（三个文件上传至同一 `xb-test/`）。预期 A 和 B 各返回 `AUTH_PASS_UPLOAD_BLOCKED`，四项身份/家庭授权 PASS、上传闸门 BLOCKED。**这不是上传失败，是尚未授权真实写入的正确状态。**
- 测试方法、完整三文件链接、预期安全状态和脱敏反馈见 `docs/v1.2.0/P2_3C_UPLOAD_READINESS_RUNBOOK.md`；用户要求同样步骤必须在对话中发出。
- **P2-3C 只读浏览器检查已取得真实电脑截图及手机相同结果**：两端总体均为 `AUTH_PASS_UPLOAD_BLOCKED`，session/family/member/grant 四项 PASS，upload_gate BLOCKED（安全预期）。两设备能恢复已存在的 SDK 会话，不需要此测试页重新登录；新页面未显示 owner/member 角色，不能仅凭两端结果相同判断两个不同 UID。仍没有部署虚拟宝宝 SQL 019/020、修改生产 PWA 或上传真实库存。真实初始库存基线、A/B 采购、购买记录编辑和安全迁移仍是后续独立任务。

## P2-3 当前下一动作

**P2-3B 的 SQL 草案、PG16 隔离合同测试以及手机可操作的纯内存演练页面均已完成**。下一个发布前门槛是独立安全审查、真实测试宝宝与正式迁移的过滤设计，以及单独授权真实 CloudBase 测试数据写入；在获得许可前不运行 019/020、不创建宝宝或真实模拟采购。匿名读取 RPC 拒绝来源仍待独立核验。

**注意**：P2-1 的 018 与 012 全 true 是真实数据库静态验收证据，不是任何真实 HTTP/SDK 业务调用的结果。
