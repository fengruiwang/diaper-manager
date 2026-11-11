# 小宝管家 v1.2.0 — P2-4F-A 已迁移历史与设置的安全分页读取

记录：2026-11-11。**仅 Feature 开发与一次性 PostgreSQL 16 / Mock CloudBase SDK 测试通过。真实腾讯云没有安装 021/022/023/024，正式 v1.1.2 继续使用原本本地记录。**

## 本轮真实开发

- `cloudbase/sql/024_xb_legacy_history_read_DRAFT_DO_NOT_DEPLOY.sql`：新增两个只读业务 RPC（脚本本身包含 `CREATE FUNCTION` DDL，**不是可以直接在真实腾讯云运行的只读 SELECT**）。
  - `xb_read_legacy_history_page_draft(family,child,kind,offset,limit)`：支持 `all/transaction/quote/weight` 四类，单页 1–50 条，起点 0–10000；返回 `total/has_more/rows`，每条保留原始 `id/ordinal/payload`。按类型、旧版位置、ID 稳定排序。
  - `xb_read_legacy_settings_draft(family,child)`：读取已经迁移且与正式完成收据来源哈希一致的设置 JSON，包括参考价覆盖、目标、用量等，返回设置修订号。
- 两个函数在 SQL 内检查**有效的登录身份、家庭 xb 应用访问授权、未停用宝宝、存在真正完成的 `xb_migrations` 收据**；要求收据具有 `archiveVerified=true` 以及正确的 `migration_schema=legacy-history-v1`，任意字段缺失或为 `NULL` 都失败关闭。
- 历史读取还核对全量记录总数、每类条数及每条历史记录来源 SHA-256 必须与收据一致；不允许数据被删除或改错摘要后仅显示“部分可用”。设置读取核对来源摘要、`revision=0` 以及参考价条目数量。
- 接口不会返回私有 `xb_legacy_staging.source_text`、完整原始备份文件、私有迁移表或额外的账号 UID/哈希字段。**每条历史 payload 原文包含个人历史信息，只能在用户自己获得家庭授权的会话中展示**。
- 函数体独立拒绝匿名用户，不能单独信任 SQL 的 `EXECUTE` 权限；家庭外账号不准读取。新表原有 RLS 继续存在。本次所有新功能都不会更改或回放 `xb_inventory`。
- `sync/cloudbase-legacy-history-reader.js`：独立、未接入正式 PWA 的 CloudBase Web SDK 适配器，用户主动调用才检查既有会话并发出只读 RPC。SDK 侧复核 UUID、分页限额、服务器 `total/has_more`、字段顺序/类型、原始 ID、设置结构，并固定 `canEdit:false,canUpload:false`；禁止从伪造服务器响应中开启写入。

## 隔离验收

- `tests/postgres/p2_legacy_history_read_contract.sql`：在此前 P2-4E-B2 已完成迁移的**合成家庭**检查两页历史、按交易/报价/成长分类、1.235 元/片参考价、家庭成员访问、其它家庭拒绝、匿名即使被额外 GRANT EXECUTE 也拒绝，以及非法分页参数拒绝。
- 独立验证**不完整的假迁移收据不能开放历史读取**。使用 PostgreSQL 临时事务模拟有人将已完成历史的一条来源 SHA 改错，或者清空参考价覆盖；读取接口必须拒绝，最终测试事务 `ROLLBACK`，没有残留真实数据。
- `tests/cloudbase-legacy-history-reader.test.cjs`：新增 **15 项** Mock SDK 场景，覆盖正确分页与价格精度、登录取消、会话身份不一致、跨页、类型筛选、服务器伪造“可编辑/可上传”、重复/错位/越界记录、越界分页、恶意错误信息脱敏，以及不写 CloudBase/本机存储。
- 完整 JavaScript 自动化 **379/379 PASS**，合成 PostgreSQL 16 合同与此前双连接原子迁移竞争测试 **PASS**。

## 用户想要的“录错后修改购买信息”如何接入

**P2-4F-A 只实现安全读取，不是采购编辑。** 同时明确两套绝不能混淆的操作：

1. **旧版迁移历史**：原始 `xb_legacy_history_entries` 保持不可修改的依据。未来修改品牌、系列、日期或支付金额，需要通过修订记录叠加“当前有效视图”，每次有 actor、操作 ID、前后版本、原因、时间、乐观 revision、幂等 ACK；不能覆盖原 JSON 或私自调整现存库存。旧版购买数量、尺码修正也**不能直接重放买入**：现存库存已经独立盘点，需要用户单独确认库存调整，并使用受 revision 保护的 stocktake。
2. **迁移后的新采购**：使用现有 `xb_transactions` 和 `009` 的当前库存事务模型。仅修改品牌/系列/金额/日期原则上不改库存；修改数量/尺码必须在同一数据库事务计算**差额**、拒绝负库存/并发冲突、写审计，不能先 reverse 再 buy 导致错误。这个修改 RPC 和 UI 尚未实现。

两人是否都可编辑历史，仍需在正式上线前明确权限产品政策；不能因为家庭成员可以**读取**，就默认任何成员自动获得写入权。

## 本阶段边界与后续

- 024 是**未授权真实部署的 SQL DDL 草案**，不能让用户复制到正在使用的 `xiaobao-family` SQL 控制台；它依赖真实云端还未安装的 021/022/023。
- 没有将任何 SDK 模块挂载到正式 `index.html`、没有创建 CloudBase 测试宝宝或真实库存、没有读取用户 3265 字节个人备份，也没有修改 `main`。
- **下一阶段 P2-4F-B**：分离旧版历史修订与新购买原子编辑，先实现不可篡改的纠错审计表/权限、revision/操作幂等与只读有效视图，再分别测试品牌价格元数据修改、数量/尺码冲突和真实设备同步。
- 当前用户无需再测试。需要真机验收时，将在对话中直接提供测试文件链接、上传位置、逐步操作、预期状态与脱敏反馈，不要求分享真实备份 JSON。
