# T09-ARCH-02 小宝管家 V1.3.0 家庭级妈妈健康存储设计

**推荐方案 B。** 新增一张家庭健康文档表、一张请求回执表和三个专用 RPC。每个家庭只有一份妈妈健康文档，体重、便秘和产后恢复共用一个文档修订号。夫妻账号复用现有家庭授权，浏览器复用 IndexedDB 队列实现。此方案调整的前端文件更少，也无需重建原五类文档的主外键或迁移其数据。

调查基线为 `feature/v1.3.0` 的 `6dfeeae02aa54de9e30f23663974f741431d19c1`。以下名称和文件清单用于后续实现，测试矩阵是验收计划。本轮只读仓库，未执行 SQL、测试或 CloudBase 操作。生产对象定义和授权状态未在本轮核验。

## 1. 现状与共同接入点

- 云端 SQL 026 的文档主键是 `(family_id, child_id, document_kind)`，文档表通过 `(family_id, child_id)` 引用宝宝表。命令表以 `(family_id, request_id)` 为主键，并通过文档三列键引用文档。读、写、回执 RPC 都要求有效的 `primary` 宝宝与历史迁移收据。基线函数从宝宝历史取默认文档，写入使用修订号比对、请求 UUID 与载荷摘要。见 [SQL 026](../../cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql#L28)。
- `primary-documents-client.js` 的 `scope()` 使用已验证主宝宝或 `inspectLegacyTarget()`，读写及回执都核对 `childId`。`primary-documents-business-commands.js` 用完整已显示文档生成新载荷。`primary-documents-operations.js` 在入队、发送、回执和冲突恢复时采用宝宝范围，不能直接接收家庭操作。底层 `idb-outbox.js` 的普通 `enqueue`、`get`、`list`、`ready`、`recordResult` 已按 `(familyId, actorUid)` 工作。`outbox-contract.js` 只需登记新的带修订号操作类型。见 [客户端](../../sync/primary-documents-client.js#L39)、[业务命令](../../sync/primary-documents-business-commands.js#L85)、[文档队列](../../sync/primary-documents-operations.js#L56)、[IndexedDB](../../sync/idb-outbox.js#L119)、[队列合同](../../sync/outbox-contract.js#L5)。
- 已验证登录和家庭成员资格是两个方案共同的页面入口。`m1-controller.js` 已在查宝宝前发出 `FORMAL_FAMILY_VERIFIED`。但 `formal-controller.js` 在主读模型不是 `PRIMARY_READ_ONLY_READY` 时会关闭现有业务界面，HTML 也只在 `ready` 时显示 `.wrap`。因此即使数据库已脱钩，直接在原五页旁加第六个按钮仍无法通过无宝宝验收。见 [家庭验证交接](../../preview/v1.2.0/m1-controller.js#L123)、[入口门控](../../preview/v1.2.0/formal-controller.js#L738)、[显示规则](../../preview/v1.2.0/formal/index.html#L120)。
- 两种方案都应在 `restore()` 获得本次有效的 `verifiedContext()` 后启用妈妈健康。现有 `ready` 路径继续显示六个页签。家庭已验证、宝宝尚未就绪时，沿用同一个导航和妈妈健康面板，只开放健康页并保留原五页不可用的原因。健康状态按应用会话、当前账号和家庭维护，切换宝宝只重置宝宝业务状态。登出、账号或家庭变更、家庭授权失效时清除健康视图，丢弃旧会话的迟到响应。健康页的手动刷新、移动端下拉和前台恢复复用现有入口，由活动页及已验证范围决定读哪份数据。成功提示对应实际完成的读取。见 [会话恢复](../../preview/v1.2.0/formal-controller.js#L594)、[手动刷新](../../preview/v1.2.0/formal-controller.js#L1945)、[前台恢复](../../preview/v1.2.0/formal-controller.js#L2633)。

## 2. 方案 A · 扩展现有共享文档表

```text
families(id) ───────────────────────┐
xb_children(family_id, id) ─────┐   │
                               ▼   ▼
xb_primary_documents(document_id PK, family_id, child_id, document_kind)
  宝宝文档  UNIQUE(family_id, child_id, document_kind)  WHERE child_id IS NOT NULL
  健康文档  UNIQUE(family_id, document_kind)            WHERE child_id IS NULL
                               ▲
xb_primary_document_commands(PK family_id + request_id, FK family_id + document_id)
```

### SQL 变更位置

1. 另写增量 SQL，为现有文档回填代理键 `document_id`，增加 `(family_id, document_id)` 唯一约束并替换现有主键。原三列键采用宝宝范围的部分唯一索引。为家庭文档增加只覆盖 `child_id IS NULL` 的部分唯一索引。现有主键隐含 `child_id` 非空，因此只改列的可空性无法成立。
2. 文档增加到 `families(id)` 的外键，保留宝宝行的复合外键，并用类型约束明确规定 `maternal_health` 必须 `child_id IS NULL`，原五类必须 `child_id IS NOT NULL`。回执表增加 `document_id` 并按原三列键回填，改用 `(family_id, document_id)` 外键。在保留旧 RPC 签名与返回字段的前提下，通过关联文档取得宝宝及类型。回执主键 `(family_id, request_id)` 保持。迁移须用既有文档和回执测试回填完整性及原 UUID 恢复。
3. 替换原 PUT 的文档和回执定位，更新原回执 RPC 的查询。原读 RPC 签名、五类白名单、主宝宝与迁移收据校验保持。为健康单独公开读、CAS 写和查回执入口，三个入口仅按家庭授权，缺行返回空文档与修订号 0。家庭写入可用各自文档行的事务行锁，原宝宝事务路径沿用当前锁与顺序。完成后重跑原合同，核验原 RPC 签名、授权、数据、旧回执及错误语义。变更对应 [SQL 026 表结构与外键](../../cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql#L28)、[原写入口](../../cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql#L146)、[原回执入口](../../cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql#L271)。

### 源码和取舍

若通过当前三个 `primary-documents-*` 模块直接复用，可在客户端的 `read/put/checkRequest` 增加显式家庭分派，在业务命令增加独立载荷变换，在队列入队、发送和回执验证处分辨两种作用域，并保持 `readAll()` 仅处理原五类。再修改 `outbox-contract.js`、正式 HTML 及控制器，共约 **6 个前端源码文件**，另有 SQL 和测试。复用原队列数据库时还必须明确按类型挑选待发送和冲突请求，避免旧队列消费者因遇见家庭类型而阻塞。另开本地队列可以减少交叉影响，但也降低直接复用现有宝宝队列的收益。

优点是统一管理两种范围的文档和回执。代价是迁移已存在的文档及回执键、重建约束、修改原写入和回执函数。宝宝侧前后端都需增加作用域分派或兼容验证，后续维护要一直区分家庭行和宝宝行。

## 3. 方案 B · 新建家庭健康文档与回执表（推荐）

```text
families(id)
  └── xb_maternal_health_documents
        PK/FK family_id | payload JSONB | revision | updated_by | updated_at
          └── xb_maternal_health_requests
                PK(family_id, request_id) | FK family_id → 健康文档
                expected_revision | resulting_revision | body_sha256 | actor_uid | committed_at

A 账号 ─┐
        ├── 当前家庭 xb 授权 ── 读 / CAS 写 / 查回执 ── 同一家庭文档
B 账号 ─┘
```

### SQL 与 RPC

新增一份 V1.3.0 增量 SQL，创建上图两张空表和以下三个 RPC。复用现有 `xb_private.can_use_app(family_id, 'xb')`，每次服务端调用都验证登录身份及授权，实际操作者使用 `auth.uid()`。两表仅通过受控 RPC 访问，采用现有的直接权限撤销、RLS 和固定 `search_path` 做法。文档的家庭外键绑定 `families(id)`，健康表及回执路径均无 `child_id`，也无需查询宝宝、宝宝迁移收据或宝宝历史。结构安装、实际环境权限核验及开放正式写入须按仓库规则获得单独授权。见 [家庭授权函数](../../cloudbase/sql/001_shared_foundation.sql#L70)、[既有 RPC 权限做法](../../cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql#L56)。

| 建议 RPC | 行为 |
| --- | --- |
| `xb_read_maternal_health(p_family_id)` | 返回已验证的 `family_id`、`revision` 和 `body`。无文档时返回 `{schemaVersion: 1, items: []}` 与修订号 0，读取不创建记录。 |
| `xb_put_maternal_health(p_family_id, p_expected_revision, p_request_id, p_next_body)` | 校验健康文档结构、唯一记录 ID、类别与最小字段。按家庭串行化写入，先查原请求回执，再进行 CAS。匹配的原请求直接返回原结果。复用同一 UUID 但账号、基线版本或载荷不同则拒绝。文档升级与回执插入在同一事务中完成。 |
| `xb_check_maternal_health_request(p_family_id, p_request_id)` | 返回原提交者在当前已授权家庭内对应 UUID 的提交状态和结果修订号。夫妻共享文档，两人各自恢复本人的请求。 |

首次并发写入可在事务内按 `family_id` 尝试插入修订号 0 的空行，遇主键冲突后复用现有行，再 `SELECT ... FOR UPDATE`。获得行锁后先查回执，再比较 `expected_revision`。成功写入才提交，首次成功的可见版本为 1。失败会回滚本事务创建的空行。已有文档走同一行锁路径，无需新增全局应用锁。两个不同请求使用同一旧修订号时，仅一方能提交，另一方保留草稿并核对最新版后重新提交。同一原请求在后续版本已经推进时仍返回原回执。

### 客户端与 IndexedDB

| 建议位置 | 最小改动 |
| --- | --- |
| 新增 `sync/maternal-health-client.js` | 薄 RPC 客户端，复用登录会话和家庭授权核验。对照当前家庭、请求 UUID 和修订号验证回复。绑定当前会话，发起写入前核对原排队账号。 |
| 新增 `sync/maternal-health-operations.js` | 以已显示的健康文档和修订号生成新增或编辑请求，按记录 ID 修改载荷。用 `idb-outbox.create()` 创建独立的健康队列数据库，复用普通入队、查询和结果更新 API。恢复时先查原 UUID 回执，已确认则读回最新文档，明确无回执时仅可重发完全相同的排队请求，结果不明时保留请求。 |
| `sync/outbox-contract.js` | 在类型及必需修订号集合中登记一个 `maternal-health.upsert`。沿用现有 `familyId`、`actorUid`、操作签名和成功、冲突、待恢复状态。`idb-outbox.js` 本身无需修改或升级存储结构。 |
| `preview/v1.2.0/formal/index.html` 和 `preview/v1.2.0/formal-controller.js` | 新增第六页签及家庭就绪入口，更新 HTML 内嵌队列合同，接入新模块、保存状态、冲突反馈及共用刷新。后续 V1.3.0 发布准备需验证新模块被纳入其自身静态包。 |

按上表共约 **5 个前端源码文件**，其中 2 个新增。SQL 为一份增量脚本，另有测试文件和隔离 PG 测试入口调整。原 `primary-documents-client.js`、`primary-documents-business-commands.js`、`primary-documents-operations.js` 和原五类 overlay 无需更改。云端按家庭共享，本地请求仍按账号和家庭隔离。首次保存可在获确认后读回，恢复必须读取最新文档，避免用旧排队载荷覆盖后来已提交的更新。首版沿用现有文档的联网保存流程，IndexedDB 用于恢复已发起请求。三个类别共用修订号意味着跨类别同时编辑也可能触发一次刷新重试。

## 4. 比较与决定

| 项目 | A · 扩展现有表 | B · 独立健康表 |
| --- | --- | --- |
| 前端源码数量 | 约 6 个文件。改动涉及三个现有宝宝文档模块 | 约 5 个文件，含 2 个新模块。共用入口和队列合同改动集中 |
| SQL 复杂度 | 重建文档键、回填已有回执外键、兼容旧 RPC，另加健康入口 | 新建 2 张空表与 3 个 RPC，无历史数据回填 |
| 原五类共享文档 | 需要验证原读写、基线、授权、历史回执和旧客户端合同 | 保持数据库及 RPC 原路径，重点验证页面入口和共用合同回归 |
| 客户端和 IndexedDB | 直接复用上一层模块时要明确区分宝宝与家庭路径，并防止队列互相阻塞 | 复用 SDK、家庭权限、队列合同及 IndexedDB 实现，健康队列独立 |
| 双账号共享 | 同一家庭读取同一空 `child_id` 健康行 | 同一家庭读取同一 `family_id` 健康行 |
| 并发与请求恢复 | 复用统一回执表及 CAS 规则，需兼容两种作用域 | 独立修订号和回执，按家庭行锁处理首次并发与后续更新 |
| V1.4.0 宝宝喂养 | 共享表和宝宝文档合同已经改动，未来宝宝模块要遵循新的作用域约束 | 宝宝作用域设计保持独立，V1.4.0 可按自身需求再选表与同步方式 |
| 维护 | 统一表，但作用域判断跨 SQL、客户端和队列 | 多两张小表，依赖和规则集中在健康模块 |

选择 **B**。V1.3.0 只有一种家庭级文档。新增专用表和三个窄 RPC 即可实现整个业务闭环，数据库改动为新增空对象，现有宝宝文档及回执无需转换。

## 5. 验收矩阵

用新建合成家庭 F1 的 A（owner）和 B（member），二者均有 `xb` 授权。F2 的 C 是另一家庭的合成账号。沿用临时 PG 角色及 `auth.uid()` 测试桩，并在 JS 使用独立账号会话、模拟 SDK、DOM 和 IndexedDB。现有测试入口参考 [隔离 PG 套件](../../tests/postgres/p2_purchase_contract.sql#L432)、[SQL 026 合同](../../tests/postgres/m3_primary_documents_contract.sql)、[文档队列测试](../../tests/m3-primary-documents-operations.test.cjs) 和 [刷新集成测试](../../tests/t05-p2-01-mobile-pull-refresh.test.cjs)。

| 场景 | 操作与断言 | 层级 |
| --- | --- | --- |
| 1. 无主宝宝 | F1 无宝宝行。A 进入健康页，读取空文档，新增后 revision 变 1，重开可读。原宝宝功能仍处于未就绪状态。 | PG + 页面集成 |
| 2. 无宝宝迁移收据 | 为 F1 创建合成主宝宝，保持无 `xiaobao-diapers:v1` 迁移收据。健康页仍可进入、查看、编辑并保存。 | PG + 页面集成 |
| 3. A 写 B 读 | A 新增固定 ID 的体重记录。B 独立会话刷新，读取相同 ID、字段及 revision。 | PG + JS 集成 |
| 4. B 写 A 读 | B 编辑 A 的记录并新增便秘记录。A 下拉或手动刷新，可读取两笔结果且历史无重复。 | PG + JS 集成 |
| 5. 家庭隔离 | C 使用 F1 标识调用读、写、查回执均被拒绝。未登录者、缺少 `xb` 权限的成员和直接表访问同样被拒绝。账号切换后旧页面与迟到响应不再显示。 | PG + JS 集成 |
| 6. 相同 revision 并发 | 用两个独立 PG 会话，从 revision 0 同时首次保存，再对已有 revision 重做一轮。各轮只提交一次，失败请求无已提交回执，旧版本不覆盖，界面保留失败方草稿。 | PG 双连接 + JS 集成 |
| 7. 原 UUID 恢复 | 模拟已提交但网络响应丢失，重开后原账号用原 UUID 查回执，修订号不再递增。明确无回执时原样重发，回执状态不明时保留队列。相同 UUID 变更载荷或版本应拒绝。 | PG + JS/IndexedDB |
| 8. 更换主宝宝 | 先用 A 保存，切换 F1 的主宝宝并重开页面。B 仍读到同一份健康历史和修订号，可继续保存。 | PG + 页面集成 |
| 9. 原五类回归 | 原 `quotes`、`reference`、`growth`、`profile`、`settings` 基线、CAS、回执和刷新合同继续通过。健康请求不进入原宝宝队列，健康读取失败不会阻塞原五页。 | 原 PG 合同 + JS 回归 |

## 6. 后续小任务

1. **家庭文档和回执合同。** 编写新增表与 RPC 的增量 SQL，只在隔离 PG 使用合成家庭验证矩阵 1–8 的服务端部分。原 SQL 026 合同继续执行。
2. **客户端与持久化队列。** 接入健康读取、CAS 与请求恢复。用模拟 SDK 和 IndexedDB 验证跨账号读取、同版本冲突、响应丢失后重开、原 UUID 重发，以及队列隔离。
3. **第六页签与妈妈体重。** 打通家庭已验证但宝宝未就绪的入口，实现体重新增、编辑和历史。验证两账号刷新、主宝宝切换、旧会话清理及原五页回归。
4. **便秘记录。** 增加该类别的最小字段、表单和校验，验证新增、编辑、历史及跨类别记录保留。
5. **产后恢复记录。** 增加该类别的录入、编辑与历史，验证三类记录在两个合成账号下的交叉读写并运行完整 JS 回归。

正式数据库安装、开放正式写入及发布属于后续独立授权事项。
