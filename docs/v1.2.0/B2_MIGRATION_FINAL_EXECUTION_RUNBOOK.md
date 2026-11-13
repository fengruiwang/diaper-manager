# 小宝管家 V1.2.0｜B2 迁移前技术收尾、022 异常恢复与执行手册

> 阶段 A（025/021/022/023/024/026/027）已在真实 CloudBase PG17.11 验收 PASS，禁止重复安装。B1 已对唯一 V1.1.2 JSON 完成严格预检、SQL 022 本地兼容和 SHA-256 保护副本复验 PASS。本文件仅是计划/只读工具，不是迁移授权；main、正式 V1.1.2、原测试宝宝 S140/revision 2、两笔采购及审计均不可动。初始审查基线 `61ef8f05836a8ae0c8de73bfbcf5b57accbcbda7`。

## 1. 022 暂存 ACK 不明（B2 最小补缺）

在**未来独立授权的** 022 RPC 发生超时、断网、无响应或返回结构异常后，立即 STOP。保留原始 `familyId`、`childId`、`stageId`、`migrationId`、`sourceSha256`，不要创建新 ID、自动重传 022、删除暂存、尝试 023 或重新导出覆盖当前暂存源。

授权操作人员确认仍处于原 CloudBase 环境、PG17.11 SQL 控制台及角色 `cloudbase_postgres_postgres_j17zp5ey` 后，执行**只读模板** `cloudbase/sql/B2_STAGE_ACK_READONLY_OPERATOR_CHECK.sql`。仅把四个占位符替换为**原记录的** family UUID、child UUID、stage UUID、SHA；绝不粘贴 JSON 正文。SQL 会在单一快照里检查原 stageId 与源摘要、服务端重算 SHA、原文字节数、source_text 与 state_data、事务/候选价/成长数量以及每条 record_kind+ordinal+原 ID+payload 一致，另检查收据、active primary 和正式业务表空目标；**只输出状态、布尔值、计数**。

| operator_status | 处理方式 |
|---|---|
| `STAGED_SAME_SOURCE_VERIFIED` | 可判定同源归档**已提交**；再核对最终门禁、授权 owner 和 021 `PLAN_ONLY_EMPTY_TARGET`，并取得**独立 B-3 授权**后，显式调用已有执行器新方法 `resumeVerifiedStage`，只调用 023，不再发 022，继续使用原 migrationId。 |
| `STAGE_NOT_FOUND_STOP` | 没有可确认的同源归档，不能据此推断一定未提交，更不能盲目重传；保持停止状态、核实环境和查询。 |
| `STAGE_SCOPE_CONFLICT_STOP`、`STAGE_SOURCE_OR_RECORD_MISMATCH_STOP`、`TARGET_NOT_EMPTY_STOP` | 异常/冲突，立即停止，不换 ID，不清理任何行。 |
| `RECEIPT_PRESENT_STOP_READBACK_ONLY` | 先运行 021 同源收据只读预检；若已提交，只做 024/010 与完整业务对账，不再调用 023。 |
| `QUERY_CONTEXT_UNVERIFIED_STOP`、`PRIMARY_SCOPE_UNVERIFIED_STOP`、SQL 报错/超时/无结果 | 视作 `QUERY_UNVERIFIED_STOP`，不得继续。 |

人工确认对象 `stageReview` 的字段是固定的原 familyId/childId/stageId/sourceSha256、`status:'STAGED_SAME_SOURCE_VERIFIED'` 与 `operatorConfirmed:true`。**它不是数据库签名、不是权限**，仅是人为操作防错闸门；`cloudWritesEnabled` 默认 false、`operatorApproved` 必须 true，且服务端 023 依然独立检查 owner、sourceSha256、目标与记录后才会提交。没有独立 B-3 授权，绝不能设置这些写入开关。

## 2. SQL 010 独立六尺码读回验收

023 成功并获得 021 同源正式迁移收据后，由已登录、具备家庭 xb 权限的真实 SDK 账号调用现有 `XBInventoryClient.readReconciliation({familyId,childId,operationIds:[]})`。010 必须返回 `complete=true`，`checked_operation_ids=[]`、`seen_operation_ids=[]`；六个尺码 NB/S/M/L/XL/XXL 各恰好出现一次，其 `quantity` 等于**停写后最终 JSON** 的 `data.inventory[size]`，`revision=1`。这个结果与既有执行器的 `readInventory`（RLS 直接 SELECT）六行交叉核对。SQL 控制台中没有真实用户 auth.uid，**不要假冒 SDK 角色调用 010**。

另通过现有 `XBLegacyMigrationReadback.readBaselineOperations` 读取 `xb_inventory_operations`：必须恰好六条、尺码不重复、`kind='migration_baseline'`、`delta=null`、`old_quantity=0`、`new_quantity=源 inventory[size]`、`expected_revision=null`、`resulting_revision=1`、`legacy_transaction_id=null`、`reverses_operation_id=null`。010 的空操作 ID 只证明快照，**不证明**这六条审计。`xb_transactions` 对 primary 必须为零，旧采购只保留在 024 的 original history，不重放累加库存。

024 需全分页核对 legacy transactions、quotes、weightRecords 原 ID、顺序、内容、总数；设置与参考价、profile（出生日期和时间可空）、原生成长记录需同源逐字段一致。两位家庭成员使用不同真实账号纯只读核对相同结果，任何分页/数字格式或数据不同均 STOP。

## 3. CloudBase PG 恢复风险（不冒称已验证）

- **本地**：原始 JSON、完整文本封存、SHA-256 和重新提取已通过 B1；这不是原版覆盖式导入恢复试验。
- **022/023**：各 RPC 是独立 PostgreSQL 事务。022 成功归档不会因之后 023 失败而自动撤销；023 中途失败会回滚其自身的所有业务提升/收据。
- **023 已成功提交**：官方说明 PG 模式没有 DocumentDB 回档，使用底层 PostgreSQL 备份机制；CloudBase PG 产品资料宣称自动备份和 PITR，**但无法从公开文档推出当前 `xiaobao-family` 的特定实例对用户开放了可验证的备份/恢复入口**。必须在控制台确认实例归属、恢复权限、可选时间点/备份、恢复目标与不破坏正式实例的验证途径，或在 B-2/B-3 授权前由用户**明确单独接受 `CLOUD_PITR_UNVERIFIED` 剩余风险**。

若无验证的 PITR，023 成功后的异常无法承诺整库回到迁移前状态。留下旧版可读本地记录、原备份、私有 022 原文、023 收据和差异审计可以帮助人工重建/追踪，但不是完整云端恢复；若未来出现错误修改、已提交数据丢失、服务端无法读回或有后续新写，原状态未必能自动无损恢复。

## 4. PG17.11 SDK 合约剩余验收项

| 项目 | 现在的证据 | 未来验收 |
|---|---|---|
| RPC 返回 | Mock 支持对象及单行数组包装 | PG17.11 网关返回形态、错误码、身份和响应 ACK |
| DATE/TIME/NUMERIC | Mock 用字符串日期/时间、数值/可 Number 化值 | 原生体重 measured_on/measured_at/weight_kg 是否可按预期严格对账；不一致不自动放行 |
| 022 大小限制 | SQL 022 上限为 10MiB | CloudBase HTTP 请求体/超时可能更低；不得用真实上传试探 |
| 024 分页 | 每页最多 50；客户端拒绝超过 10050 条的全量假成功 | 真实 SDK 多页、跨页顺序与 total 稳定性 |
| 010 | 已部署及 Stage A 授权权限通过 | 两个真实账号签名只读调用并确认同源六尺码 |

不能以隔离 PG16 PASS 等同于实际家庭 PG17.11 写入验收。上述不确定项仅在未来单独授权窗口内处理。

## 5. 三个独立的正式执行授权窗口

**B-1：唯一 primary** — 固定 Feature SHA 和环境，在读验证家庭 owner、xb grant、当前 primary=0/receipt=0、S140 保持正常后，单独批准一次调用 `public.xb_create_primary_child(uuid)` 与对应短时授权，确定唯一 childId。ACK 不明时只读查 primary，不再次创建；新 primary 正式业务表必须为空；撤销 025 临时 EXECUTE。**不自动批准 B-2。**

**B-2：唯一最终备份暂存** — 真实停止所有旧版写入并记录准确停写时间；**停写后**重新导出最终唯一 JSON，重新做严格预检、保护副本 SHA 复验，单源 `final-cutover-gate` PASS；确认当前文件较 B1 备份是否变化，不按导出日期猜最完整；保存原文本、摘要与固定 stageId/migrationId，021 owner 预检 `PLAN_ONLY_EMPTY_TARGET`，确认空 primary、恢复风险已处理；**另行授权**短时开放 022、只调用一次。ACK 不明按第 1 节查证。**不自动批准 B-3。**

**B-3：023 提升与完整读回** — 使用原 migrationId、原 SHA，仅在 022 ACK 或只读核验已证明同源成功、021 无冲突时**另行批准**短时开放 023。核验 021 同源收据、024 全记录/设置、010 六尺码、六条 baseline 审计、原生体重/宝宝资料及两账号只读一致。ACK 不明先 021，不能重新生成 ID 或再提升。出现异常就停、保留原始资料。收尾撤销 025/022/023 的临时 EXECUTE，复核 S140/revision 2、两笔采购及两笔审计不变。026/027 写入保持锁定，**阶段 C 和正式发布不属于 B3**。

每个窗口需要一条**独立、精确的用户授权**：环境、固定 Feature SHA、唯一调用函数、允许参数、一次性操作、预期和失败停止条件。B1 当前 JSON 只是旧快照，不是最终停写后可迁移的文件。

## 6. B2 结论边界

B2 源码/隔离测试/执行手册可验收，不表示已有 PG PITR 或 PG17.11 真实历史导入验收。本轮不需要用户再上传 JSON、不执行 CloudBase DDL/DML、不改变正式 V1.1.2 或 main。
