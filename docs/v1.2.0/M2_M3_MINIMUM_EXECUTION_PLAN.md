# 小宝管家 V1.2.0｜M2 最小可实施迁移与 M3 并行路线

**当前基线**：M1-02 真实双端 S60+S80=S140 主链路 PASS。独立测试宝宝及全部审计保留不动。详见 [M1-02 真实验收记录](./M1_02_REAL_CLOUDBASE_ACCEPTANCE.md)。正式 main/V1.1.2 完全不变。

## M2：最短五段迁移链（以现有模块为主）

| 顺序 | 实施步骤 | 已有资产 / 唯一必要补缺 | 写入边界 |
| --- | --- | --- | --- |
| 1 | **冻结原始 V1.1.2 数据**：本地原样导出并校验 SHA256、字节长度、完整 JSON、字段清单、未知字段/数值精度 | `legacy-backup-vault.js`、`strict-migration-gate.js`、`legacy-migration-manifest.js`、`legacy-restore-projection.js`。旧版备份本地文件已有真实校验成果 | 仅离线操作、不得把真实备份上传 GitHub/托管/云库；不调用旧版导入覆盖 |
| 2 | **创建独立 primary 目标**：使用 existing family A owner，创建唯一 `legacy_slot='primary'`，记录服务器生成的 child_id，确保与 smoke ID 不同 | 新增仅 Feature 草案 `025_xb_create_primary_child_owner_only_DRAFT_DO_NOT_DEPLOY.sql`；复用 019 的 owner+xb 权限模式、009 家庭锁、现成按家庭/slot 唯一索引 | 025 是 **未部署、未授权的函数 DDL**；安装与调用创建均需新的明确授权；绝不自动创建 |
| 3 | **安装迁移防重/暂存/提升/读取 SQL**：按相互依赖顺序 021→022→023→024，先审查、确认现有对象签名及变更集 | 021 receipts/唯一约束；022 原样私有归档与后台 SHA；023 单事务原子提升；024 完成收据后的只读历史/设置 | 021–024 均仍为未部署草案；表/函数安装需要单独 DDL 授权，不能以阶段 B 授权代替 |
| 4 | **授权后暂存 + 原子提升一次**：owner 从受控 SDK 将原始 JSON 上传 022 仅归档，确认源哈希/明细/冲突；023 在一个事务内迁移业务快照、验收清单，最后写 `xb_migrations` 收据 | 022 原文+完整 records；023 六尺码库存直接来源于 `state.inventory`，6 条 `migration_baseline` 非增量事件；历史 `transactions` 转 `xb_legacy_history_entries` 不转换成新增实时采购；宝宝信息、体重、候选价、referenceOverrides、目标/日用量与设置全部保留 | **任何真实备份上传、022/023 业务写入都须额外明确授权**；无授权只允许本地审查。没有可信回档备份，不可承诺完整可逆 |
| 5 | **A/B 只读核对并确定可恢复性**：核对源 SHA、收据、6 库存基线、历史条目/金额/片数、价格/3 位小数参考价、成长与所有设置，再验证 A/B 在同一 primary 下读到相同结果 | 024 + `cloudbase-legacy-history-reader.js`；`cloudbase-child-reader.js`；M3 新 `primary-cloud-read-model.js` | 初始仅只读，不改 M1-02 smoke，也不修改 V1.1.2。本地备份始终可独立保留，旧版仍可继续使用直到正式切换 |

### 数据映射的不可妥协边界
1. 旧版 `inventory` 是**唯一库存初始化基线**；旧版 `transactions` 的 buy/use 是历史事实，禁止再次执行 `buy/use` 或累加库存。023 采用 6 行直接库存 + 6 条 `migration_baseline` 事件，不是 6 条额外实时买入。
2. `transactions`、`quotes`、`weightRecords` 保留原 ID、顺序、源 SHA 和原字段；`referenceOverrides` 支持最多 0.001 元单片价精度，不可四舍五入为分。
3. `babyProfile`、`babyWeight`、`dueDate`、`birthDate`、`target`、`daily`、`preset`、`replenishPolicy`、`currentSize`、`sizeMode`、`autoSize`、`goalPrice`、`plannedBudget` 同步纳入归档/设置映射。未知字段必须保留原文并暂停审查，不得静默丢弃。
4. **既有 smoke 不是全局空表阻断项**：所有空目标检查限定 `family_id+child_id(primary)`。含 smoke 的 A/B 家庭允许为 primary 进行首次迁移，但 smoke 自己绝不接受迁移。
5. 021 的目标宝宝+源 SHA 去重与 023 的最终收据是重复迁移保护；两个设备竞争、ACK 丢失时先核对收据与源摘要，不盲目用新 ID 重新导入。
6. 022 归档完成但 023 未提升：不得显示“云端正式历史可用”，保留归档等待受控处理。023 数据事务回滚时不得抹掉原备份或已成功的暂存。023 提升成功但浏览器 ACK 丢失，先读取收据验证结果，不再次生成采购操作。
7. 无完整可验证云端数据库回档；“回退”主要是停止发布、保留原版 PWA 和本地保护包，不是把已经落库的迁移数据自动删除。

### 需要验收、但不必重新设计的缺口
- **真正的 primary 创建**：025 目前仅为设计草案；先在隔离环境校验与 019 测试宝宝并存、不碰 S140。
- **021–024 的真实部署与执行入口**：目前只有隔离 PG16/Node 成果；需一次汇总 DDL 变更清单和明确授权，不提前部署。
- **端到端恢复证据**：历史完整字段清单、源 SHA 和实际服务端读回对照、缺回执/失败恢复；在 M2 正式写入前准备好只读核对路径。

## M3：现在并行的最小工作（不等 M2 写入）
- 新增 `sync/primary-cloud-read-model.js`：复用现有 账号/家庭授权预检、`child-scope-guard.js`、`cloudbase-child-reader.js`、010 权威库存、CloudBase 采购查询、024 旧历史/设置读取；**仅 active primary 可用**。
- 在没有 primary 或尚无 024 已完成迁移收据时返回不可用状态，不能把 smoke S140 当作正式库存；仍未将任何模块装载到正式 V1.1.2 PWA。
- 正式页面集成优先级：① 保留原有五个页面/图标/路由与登录会话恢复，替换原总览和历史读取源；② 把历史购买和迁移后新采购按来源分别呈现，不能二次计库存；③ 参考价/候选报价/成长/设置逐步接已有界面；④ 各类正式编辑/写入另行审查、授权；⑤ 最后 M4 双端 PWA/正式网址发布审批。
- M3 接入前既有的 `primary-cloud-read-model` **仅为只读适配准备，尚非正式 UI 已接入**，不宣称具备正式编辑同步。

## 现在执行范围
仅在 Feature 编写草案、更新状态/合同测试；不执行任何真实腾讯云 DDL/DML、不上传实际历史 JSON、不更改 main/旧 PWA、不停用/清理测试宝宝。下次需要真实 SQL 和正式备份时**先提供一次性精准变更清单及授权范围**。
