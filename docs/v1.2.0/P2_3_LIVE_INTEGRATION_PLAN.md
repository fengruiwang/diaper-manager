# 小宝管家 v1.2.0 — P2-3 真实 CloudBase 业务联调方案（草案）

日期：2026-11-11。状态：**P2-3A 只读诊断代码、模拟回归和操作手册已完成；尚未上传静态测试站点或取得真实浏览器结果。P2-3B/C 真实数据写入仍未获授权**。

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
- **未发布、未上传 CloudBase 静态网站、没有真实 CloudBase HTTP/SDK 调用**。仅可将这两份前端文件手动放入原 `xb-test/` 独立目录；不得替换生产 PWA。
- 在用户反馈真实 A/B/anon 检查状态前，不能标记 P2-3A PASS_REAL，也不能启动任何虚拟宝宝或购买数据写入。

## P2-3 当前下一动作

**现阶段等待独立只读诊断页在 `xb-test/` 的真人浏览器验收**；随后继续在隔离测试环境设计虚拟宝宝专用 RPC 及可审计关闭流程，任何真实 CloudBase 测试数据写入都要单独申请。

**注意**：P2-1 的 018 与 012 全 true 是真实数据库静态验收证据，不是任何真实 HTTP/SDK 业务调用的结果。
