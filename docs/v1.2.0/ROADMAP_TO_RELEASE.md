> **M1-02 最新执行状态（2026-11-12）**：现有 `xiaobao-family` 数据库阶段 A 已由用户真实验收：019A 18/18、019 完整安装、020 18/18。M1-02 阶段 B 独立测试界面已完成候选构建和定向测试，但**创建宝宝/真实采购尚未获授权，亦未部署**。请使用 [M1_02_STAGE_B_ACCEPTANCE.md](./M1_02_STAGE_B_ACCEPTANCE.md) 的一次性授权和 S60+S80→S140 验收流程。原下文的“019/020 未部署”是截至早期版本的历史记录，不能再作为当前状态。main/V1.1.2 不变。

# 小宝管家 v1.2.0 — 开发计划与验收路线图

更新时间：2026-11-11。开发分支 `feature/cloudbase-sync-v1.2.0`。本文件是规划，不构成部署真实数据、迁移历史或发布正式 PWA 的授权。

## 总体目标

把已经稳定使用的 v1.1.2 从单机浏览器本地数据模式，升级成家庭 A/B 两人长期使用的云端同步 PWA：保持登录、断网可继续记账、重复提交不重复计数、采购错误可编辑、价格参考配置可修改并保存、原历史自动兼容且不丢失。

## 基线

- **生产 v1.1.2**：手机正在使用，不能更改 `localStorage['xiaobao_diaper_planner_v1']`、历史 JSON 或现有 `main`。
- **云端 P2-1 已完成**：真实 CloudBase `xiaobao-family` 的 7 张业务表、RLS 和两个库存 RPC 已通过 006/014/015/016/018/012 验收。真实宝宝/库存/采购业务记录仍未由本项目迁入。
- **P2-3A**：管理员 A 和家庭成员 B 登录后的只读权限检查均为 10/10 PASS；匿名无登录状态、家庭与业务表共 6 项 PASS，匿名只读 RPC 返回 DENIED_UNCLASSIFIED，拒绝来源尚待独立核验。不能报告为匿名 7/7 PASS。
- **P2-3B**：019/020 owner-only 虚拟宝宝 SQL **仅草案**，PG16 18/18、Node 与独立网页的 12 步纯内存演练均已通过。未在 CloudBase 部署 019/020 或创建虚拟宝宝。
- **业务缺口**：未完成真实 A/B 采购/库存同步；采购后编辑、全部模块云端 CRUD、v1.1.2 历史迁移以及正式 PWA 集成都尚未验收。

## 建议实施顺序与目标

| 阶段 | 工作内容 | 验收/退出条件 | 风险/授权 |
|---|---|---|---|
| 1 P2-3B 受控测试环境 | 最终审查 019/020、测试标识隔离、owner 访问控制、创建/停用并发锁、只读宝宝列表过滤。准备独立测试页面 | PostgreSQL 合成测试、无敏感信息输出和测试宝宝显示隔离均过关，真实部署前审批 | 019/020 安装及创建真实测试宝宝需单独授权 |
| 2 P2-3C 真实库存与采购 | A 采购 S+60，B S+80，双方权威库存 140；同 ID 重试只记一次、错 payload 拒绝、撤销/盘点/负库存保护、断网补传和确认回执 | 两设备登录身份分离，写入审计和库存/账单数量一致，模拟网络故障恢复后不重复入库 | 创建/保留测试采购与软停用记录需单独授权 |
| 3 采购记录编辑 | 允许纠正品牌、系列、金额、日期、购买数量与尺码；采用后端原子差量变更、revision 和不可篡改审计 | 只修改元数据不变库存；60→80 只加20；尺码转换原子；冲突、负库存和重复提交全部拦截 | 数据库模型/RPC 变更需单独审批，不允许浏览器直写 |
| 4 全业务云端同步 | 宝宝资料、体重、采购记录、报价、参考价阈值、家庭设置；明确家庭共享字段与个人设备设置的归属。保留 IndexedDB 离线 outbox | A/B 数据一致；设置改动和备份可恢复；离线/在线转换不中断；支持原有手动参考价设置 | 仅 feature 开发，逐模块验收 |
| 5 历史数据迁移与恢复 | v1.1.2 schema 映射、完整本地导出/校验、云端幂等收据、冲突检测、先预览后上传、双端恢复；排除 `__xb_smoke_` 测试宝宝 | 原有库存、交易、报价、目标价、体重等逐项一致，重复迁移零副作用；可验证备份和恢复措施 | 在未具备恢复方案/明确用户授权之前，不能运行真实迁移 |
| 6 v1.2.0 UI/发布 | 正式手机页面集成稳定会话、可编辑采购、同步中/失败/冲突可见、跨设备检查、回归、灰度发布、升级后核对 | 全场景稳定、原 v1.1.2 历史数据完整、回退计划可用，用户明确批准才合并/发布 | 正式 `main`、GitHub Pages 不得提前更新 |

## 开发节奏建议

- 先保证 **正确性、安全性和数据保留**，再优化统计图表、外观主题与周边功能。
- 粗略按 **4–8 周的开发/联调工作量级**规划，非确定交付日期；CloudBase 实际权限行为、库存并发、迁移恢复可能导致阶段重复审核。
- 每个阶段分开记录 **纯模拟 PASS / PG16 隔离 PASS / CloudBase 真实 SDK/SQL PASS / 双真机业务 PASS**，不互相替代。
- 开发可连续推进纯逻辑、隔离 SQL、测试页和 Mock CI；任何生产共享 PostgreSQL 实际新增测试数据、迁移或正式发布，均需要**单独明确授权**。

## P2-3D 基线核验准备（2026-11-11）

- 新增 `sync/inventory-baseline-inspector.js`，组合已有 CloudBase 鉴权、非测试宝宝只读列表、IndexedDB 现存库存及全部待同步/已 ACK 记录和六尺码只读 reconciliation RPC。
- 对未信任的本地基线、待同步队列、已 ACK 但服务器回执缺失、六尺码/修订号不一致、陌生宝宝或错误家庭等情况拒绝自动同步；模块返回值**永远** `uploadAllowed:false`、`localUnchanged:true`。
- 隔离 Node 新增 15 组测试，开发分支 JavaScript **284/284 PASS**，PostgreSQL 原隔离合同仍通过。当前真实 CloudBase 尚无测试宝宝，因此本轮不要求用户再上传网页或反复做“空表”测试。
- 审查文档：`docs/v1.2.0/P2_3D_BASELINE_INSPECTION_REVIEW.md`。下一阶段不是直接把 `initialized` 设为 true，而是先设计与已保存 v1.1.2 历史兼容的**权威云端初始基线握手 + 原子 IDB 提交 + 检查后 revision 复核**。真实数据库写测试宝宝/采购及迁移仍须单独授权。

## P2-3E 受控首次本地基线写入（2026-11-11）

- 已新增 `sync/inventory-bootstrap-coordinator.js` 和 17 组直接合同测试，并将 3 组**真实 IndexedDB 合成事务**回归加入 `tests/idb-atomic-inventory.test.cjs`：经过源端双次库存+revision 核对，在模拟历史迁移收据已核验且明确开启隔离开关的条件下，IDB 原子保存初始库存；重复初始化、已有或临时插入队列阻止覆盖；第三次云端读取发现变化则等待复核。
- **正式开发环境默认不能本地初始化**：服务端真实历史迁移凭证/备份校验接口尚不存在，`permitIsolatedLocalSeed` 默认为 false；所有分支 `uploadAllowed:false`，不得把本轮测试模拟凭证、`source:'verified-server'` 字符串或布尔设置当生产权限。
- JS 自动化 **304/304 PASS**，PG16 隔离合同 PASS；未在真实 CloudBase 写入或修改正式 PWA。详细阻断项见 `docs/v1.2.0/P2_3E_ATOMIC_BOOTSTRAP_REVIEW.md`。
- **下一步**：独立审查旧版历史格式、备份可恢复性与权威迁移收据，限制底层 `initializeInventory` 直接调用路径；如果要先进行真实云端虚拟宝宝采购，则需要独立的仅测试身份路径以及用户对 019/020 安装和业务测试记录写入的**另行明确批准**。

## P2-4A 历史备份保护与恢复预览（2026-11-11）

- 已按当前正式 v1.1.2 的 `exportData()` 实际文件格式开发 `sync/legacy-backup-vault.js`，封存原始 JSON **全文**而非删减或重新格式化后的状态；SHA-256 + 字节长度检测意外损坏；验证通过后可原样取回导出文件。测试中可保留未知未来字段和三位小数参考价，不会因迁移映射不全丢失原始内容。
- 新增独立 `legacy-backup-check.html` + `legacy-backup-check.js`，在原 `xb-test/` 目录可通过用户**本地文件选择器**进行封存/下载/二次验证。浏览器 CSP `connect-src 'none'`，没有 CloudBase、localStorage 或 IndexedDB 读取/写入路径。**用户只能上传测试代码，绝不能上传包含真实家庭历史的 JSON 文件到静态托管或 GitHub。**
- 新增 8+4 项隔离测试，完整 JS **316/316 PASS**，PG16 隔离合同不变；真实用户备份文件的手机/电脑浏览器校验尚待执行，不代表已完成数据迁移。
- 官方旧版 `importData()` 会替换当前本机数据并钳制部分字段；因此当前只提供“提取原始文件”而不执行覆盖式恢复。正式上线前必须在**单独隔离且可回退的测试浏览器/应用实例**比较导入后所有记录，再完成独立的服务器迁移收据、去重与补传协议。
- 详细交付及浏览器操作：`docs/v1.2.0/P2_4A_LEGACY_BACKUP_RESTORE_RUNBOOK.md`。保护包验证是备份可读性的前置条件，**不能单独满足 P2-3E 的真实 `verifyHistoryClearance`**。

## P2-4A 真实浏览器完成与 P2-4B 导入差异审计（2026-11-11）

- P2-4A 用户通过真实浏览器的两步备份文件检查：原始 v1.1.2 导出、保护副本自检 PASS，重新选择下载的保护包后 SHA-256 一致、可恢复原始备份 PASS（截图显示原始文件 3265 字节）。**此验收是文件完整性证明，不是原软件导入无损恢复的证明**。
- P2-4B 已新增纯函数 `sync/legacy-restore-projection.js`，对照正式 `index.html` 的导入合并/数值规范化和 `growth.js` 的宝宝资料/体重记录处理，模拟导入后的结构并报告差异。未知嵌套字段丢失、缺省字段新增、库存四舍五入、非法体重过滤等一律要求人工评审，报告不返回个人历史值。
- 新增 10 项隔离投影测试，总 JS **326/326 PASS**；PG16 隔离合同 PASS。真实用户 JSON 不需要上传给开发端，不能在已经使用的手机上点原生“从备份恢复”测试。
- 下一个关键里程碑是**隔离的真实导入器执行/差异核对**与服务器迁移凭证设计，而不是直接开放 P2-3E 的初始化开关。`docs/v1.2.0/P2_4B_RESTORE_PROJECTION_REVIEW.md` 中记录了主要差异风险。

## P2-4C 正式版导入器在隔离环境中实际执行（2026-11-11）

- `tests/helpers/isolated-v1-import-harness.cjs` 从**当前正式 `index.html`** 提取 `importData`、`save`、`load` 和辅助函数的原始源码，并调用正式 `growth.js`；只在一次性 Node VM 中运行，提供合成 FileReader、用户确认及独立内存 Map 作为 localStorage，不使用真实浏览器或历史备份。
- `tests/legacy-real-import-isolation.test.cjs` 新增 12 项合同测试：完整历史导入/模拟重启后重载、取消不写、非法文件拒绝、库存/目标/日用量修正、采购/比价/参考价精度、未知成长字段被旧导入器删去、异常体重记录过滤、缺省值填补、版本号接受漏洞，以及与 P2-4B 独立投影一致性。
- 最新 JS 完整回归 **338/338 PASS**，临时 PostgreSQL 合同 PASS。发现现有 v1.1.2 **并不核验备份 `version`**；未来迁移必须对版本进行严格校验并对可能过滤/修正的数据作差异预览，不能直接复用旧 `importData()` 做云端迁移。
- P2-4A 用户真实浏览器备份核验已 PASS，但这轮只用**合成数据**执行正式函数，不对用户旧版 PWA 执行真实覆盖恢复，也不迁移腾讯云。发布前仍需隔离浏览器完整 UI 级回放、差异分类清单和真正幂等的云端迁移凭证。
- 审查文件：`docs/v1.2.0/P2_4C_REAL_IMPORT_SANDBOX_REVIEW.md`。

## P2-4D 严格迁移预检与差异处理分类（2026-11-11）

- `sync/strict-migration-gate.js` 已对真实 v1.1.2 导出格式建立严格的**只读**准入：`app/version/exportedAt/data` 必须合规，禁止使用旧 `importData` 缺少版本验证的宽松规则。
- 合并已有历史字段映射、采购价格精度校验和内存恢复差异对比，严格拒绝丢失真实采购、比价、六尺码库存/目标/日用量、三位小数参考价、成长记录或未知嵌套字段；缺少 `preset` 单独列为需人工审核的 UI 默认值补充，不能暗中认为无损。
- 保持历史六尺码库存为**唯一初始化库存基线**，旧采购/消耗记录作为历史账本保存而不是再累加一次。
- 新增 18 项独立合成回归，完整 JavaScript **356/356 PASS**，隔离 PG16 合同 PASS。任何结果均 `canUpload:false` / `serverReceiptPresent:false`，不解锁 P2-3E 的首次本地库存初始化；用户旧版 v1.1.2 和真实 CloudBase 完全未修改。
- 明确下一阶段 **P2-4E**：先设计服务端幂等迁移收据、跨设备并发/重试语义与逐条数据核验，然后隔离环境验收，再按用户**单独明确授权**进行真实数据库部署和写入。参考 `docs/v1.2.0/P2_4D_STRICT_MIGRATION_GATE_REVIEW.md`。

## P2-4E-A 私有迁移收据去重与并发防护（2026-11-11）

- **已完成隔离验证，真实部署仍被禁止**：`cloudbase/sql/021_xb_migration_receipt_preflight_DRAFT_DO_NOT_DEPLOY.sql` 仅为数据库迁移收据的唯一索引和 owner-only 只读预检函数草案；脚本包含 `CREATE UNIQUE INDEX` / `CREATE FUNCTION` DDL，**没有用户授予在真实 xiaobao-family 执行的权限**。
- 为一个宝宝的一次旧版导入限制 `(family_id,child_id,source_format)` 唯一；同一份备份摘要不可被同一家庭重复分配给不同宝宝。所有只读预检响应 `receipt_committed:false,can_upload:false,can_commit:false`，不预留迁移、不开通上传。
- `tests/postgres/p2_migration_receipt_preflight_contract.sql` 测试了模拟重试、不同摘要/ID、误选宝宝、匿名/普通成员/陌生人拒绝及数据库局部失败回滚；`tests/postgres/p2_migration_receipt_concurrency.sh` **真正在临时 PostgreSQL 服务中启动两个独立连接**，竞争同一宝宝，结果仅一个提交，另一个唯一索引拒绝。
- `sync/cloudbase-migration-receipt-preview.js` 只读 SDK 适配器（未接入正式 PWA）新增 8 个合成场景，完整 Node **364/364 PASS**，隔离 PostgreSQL 单会话/双连接测试 PASS。
- **当前不是完整云端历史迁移完成**：后续 P2-4E-B 要设计完整的权威原子写入，包括旧版六尺码库存基线和历史采购不可重复累加、全部报价/参考价/成长/设置不丢失、服务器真实源内容校验、库存与历史同事务提交、最后写收据、可验证恢复和跨设备对账；才可能在单独授权后实际部署。详情 `docs/v1.2.0/P2_4E_A_RECEIPT_IDEMPOTENCY_REVIEW.md`。

## P2-4E-B1 原子归档暂存（2026-11-11）

- 新增 `cloudbase/sql/022_xb_legacy_archive_atomic_STAGE_DRAFT_DO_NOT_DEPLOY.sql`（**SQL DDL 草案，仅隔离 PG16，禁止真实 CloudBase 执行**）。安全保留完整 v1 原始 JSON 文本、后端 SHA-256、逐笔购买/消耗、报价、体重记录及其原位置。六尺码库存、参考价、设置及宝宝资料从原始快照完整保留，但尚未写入新云端正式业务表。
- 仅当前 owner + xb grant、未停用 primary 宝宝、空目标可暂存。服务器独立校验版本、备份结构、价格/库存精度及 null/重复 JSON 键，使用与 009 相同的家庭咨询锁，禁止不同备份重新归档。**所有回复 can_upload=false / can_commit=false / receipt_committed=false**；不调用实时购买，不改变业务库存。
- PostgreSQL 原子合同用合成数据验收：四条历史记录完整暂存、原文/哈希一致、错误版本或精度拒绝、注入中途 INSERT 失败自动全回滚。独立双连接并发同一备份：**一个首次归档，一个识别重复**，零正式业务库存及迁移收据。JS 回归保持 **364/364 PASS**；PG16 测试通过。
- 下一阶段 **P2-4E-B2**：必须把保留的完整历史映射为真正可查询/可编辑的云端业务记录，在单一数据库事务中初始化旧版现存库存六尺码（不重放历史购买）、核对价格/记录/修订号，最后落正式私有迁移收据。之后才能真正进行 P2-3E 安全初始化、A/B 双设备同步和正式 PWA 升级。
- B1 的完整源文件包含私人家庭历史，未来真实上传须经过单独的数据库安装、备份保护/隐私和写入授权。现在不要求用户上传 JSON、执行 SQL、重新测试或修改正式手机。详见 `docs/v1.2.0/P2_4E_B1_ATOMIC_ARCHIVE_STAGE_REVIEW.md`。

## P2-4E-B2 原子推广：库存基线 + 历史账本 + 完成收据（2026-11-11）

- **已完成合成 PG16 事务原型，尚未真实部署。** `cloudbase/sql/023_xb_legacy_promotion_atomic_DRAFT_DO_NOT_DEPLOY.sql` 将 022 完整暂存归档通过同一数据库事务迁入业务记录：六尺码原样库存、六条 `migration_baseline` 非增量事件、宝宝资料、原生体重、独立历史交易/比价/成长与设置/参考价格。
- 由于既有 `xb_transactions` 与当前实时库存操作存在强外键关系，旧版历史购买被严格放到新的 `xb_legacy_history_entries`（家人 xb RLS 可读）中，不调用普通 buy RPC；避免“现存库存 + 旧购买历史”重复计数。新 `xb_legacy_settings` 保留参考价 0.001 元精度、目标/日用量、补货和其它设置；旧完整原文本由私有 B1 归档保存。
- 最后写入 `xb_migrations` 之前，重新核验源 SHA256、历史明细逐条匹配、六尺码总量、记录数、历史购买总价分及买入/使用件数。**模拟在最后收据 INSERT 失败时，完整库存、历史、设置和成长全部回滚**，保存 B1 归档等待重试。
- `tests/postgres/p2_legacy_promotion_atomic_contract.sql` 及 `tests/postgres/p2_legacy_promotion_concurrency.sh` 在临时 PG16 通过：两个独立数据库会话竞争同一归档，最终仅一份完成收据、6 库存/6 baseline、4 历史、0 旧购买实时重放。Node 回归 **364/364 PASS**，PG16 完整测试 PASS。用户真实 xiaobao-family **未安装 021、022、023**。
- **下阶段重点**：为新历史表接入正式 SDK 安全分页读取及双账号浏览，然后设计经过审计的采购记录修改/撤销与库存冲正，完善 P2-3E 服务器证明和本地 IndexedDB 原子初始化、离线重试、两设备一致性及正式发布。原 B2 完成收据不等于立即允许旧手机 outbox 上传。
- 不运行任何真实 SQL、不上传真实备份、不触碰生产 main、v1.1.2 本地数据或现有 CloudBase 业务表。详情：`docs/v1.2.0/P2_4E_B2_ATOMIC_PROMOTION_REVIEW.md`。

## P2-4F-A 已迁移历史与设置的安全分页读取（2026-11-11）

- 新增未部署 SQL `cloudbase/sql/024_xb_legacy_history_read_DRAFT_DO_NOT_DEPLOY.sql`，通过 STABLE SECURITY DEFINER RPC 对**已具备真实完成收据**的旧版历史按交易/报价/成长提供 1–50 条分页，以及只读参考价/计划/用量设置。函数体检查现有登录/家庭 xb 授权、孩子有效、迁移收据两项证明字段和各类历史数量及 SHA 来源，一旦缺失或篡改即拒绝；SQL 本身仍包含 CREATE FUNCTION DDL，**未获许可不可真实执行**。
- `sync/cloudbase-legacy-history-reader.js` 是未接入正式 PWA 的安全只读 SDK 适配器，客户端验证会话身份、分页完整性/顺序、服务器返回的编辑/上传权限始终为 false；新增 **15 个** SDK Mock 用例，完整 JS **379/379 PASS**，隔离 PostgreSQL 读取/隐私/缺收据/数据篡改阻断合同 PASS。此前 B2 原子迁移及双连接一致性仍 PASS。
- 旧版历史保持不可修改的迁移依据，新应用查询可以看到原采购/消耗/比价与参考价。**正式采购编辑、历史修订版合成、两台手机实时读取/离线同步仍待实现**；详情 `docs/v1.2.0/P2_4F_A_HISTORY_READ_REVIEW.md`。
- 下一阶段 P2-4F-B：append-only 历史纠错账本、乐观 revision、幂等操作 ID、修改前后审计；对原有旧购买**只修有效历史视图**、数量/尺码修正后需用户明确确认是否另作当前库存盘点；对迁移后的**实时新购买**才使用原子差额/库存版本校验。不得把旧购买重新加进现存库存。
- 真实 CloudBase 021–024 全部未安装，`main`、v1.1.2 手机本地记录和真实家庭数据库未更改。本轮无需用户手动测试、上传 JSON 或执行 SQL。

## 采购编辑（正式版必备）

详细需求见 `PURCHASE_EDIT_CORRECTION_REQUIREMENTS.md`。当前 009 RPC 仅支持 `buy/use/stocktake/reverse`，未实现编辑。页面应提供普通「编辑购买记录」，服务端按字段类型选择不变库存的元数据变更或原子差量库存更新，必须记录修改历史、修改人和时间。

## 每轮测试的交付格式（固定约束）

未来每次需要用户测试，**直接在对话中**一并发送：测试文件链接、是否需要上传及目标 `xb-test/` 路径、按顺序操作的步骤、每一步预期结果、失败时应提供的安全错误码、明确禁止操作。不得只贴 GitHub 说明文件；不得要求用户分享邮箱、验证码、真实家庭 UID、API Key、token 或完整网络日志。

## 本轮具体执行

- 已建立纯只读 `sync/cloudbase-child-reader.js`，复用 `sync/child-scope-guard.js`，实现既有家庭成员合法访问、过滤 smoke/已停用宝宝、严格的迁移目标预检；`readyForMigration=false`，绝不自动上传历史数据。
- 配套 `tests/p2-cloudbase-child-reader.test.cjs` 模拟了无会话、无 xb 授权、未知分类字段、重复宝宝、历史 primary 停用和将来家庭超过两人的兼容性。
- 本轮没有真实 CloudBase 操作，未执行 SQL、未改 main、未发布，用户暂不需要额外测试。
