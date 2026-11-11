# 小宝管家 v1.2.0 — P2-4D 历史迁移严格预检与差异处理策略

记录：2026-11-11。范围：`feature/cloudbase-sync-v1.2.0`，仅合成数据、只读分析。**不是云端迁移授权，不生成服务器迁移收据，不会读取或写入当前用户手机的数据。**

## 目标与证据边界

- P2-4A：用户的真实 3265 字节导出文件已在独立浏览器完成 SHA-256 保护副本核验并取回预览，属于文件完整性验证。
- P2-4B：对照正式导入逻辑的独立内存差异模拟测试通过。
- P2-4C：从正式 `index.html` **原样提取** `importData/save/load` 并以合成状态运行的隔离 VM 测试通过，发现旧版没有检查 JSON `version`，以及潜在的数字钳制/成长记录扩展字段丢失。
- **本阶段 P2-4D**：新增 `sync/strict-migration-gate.js` 与 `tests/strict-migration-gate.test.cjs`，将上述风险收敛成自动化的、失败即阻断的迁移预检。18 个新测试，完整 JS 回归 **356/356 PASS**；PostgreSQL 隔离合同独立 PASS。以上仍非用户真实历史的云端迁移测试。

## 严格数据策略

| 原数据类别 | 迁移前处理 | 允许自动改写吗 |
|---|---|---|
| 外层格式 `app/version/exportedAt/data` | 要求 `xiaobao-diapers`、数字版 `version=1`、有效精确 UTC 时间戳、无未知信封键 | **不允许**。不认识版本就拒绝 |
| 现存六尺码库存 `inventory` | 必须有 NB/S/M/L/XL/XXL；每项 0–100000 的整数，无新尺码键 | **不允许**舍入、归零或重新计算 |
| `target/daily` | 同样六尺码完整、整数上下限，禁止未知码 | **不允许**静默补缺或钳制 |
| `transactions` | 每条 ID 唯一，类型/日期/尺码/数量/品牌/系列合法；采购总额精确到人民币分 | **不允许**金额四舍五入、漏单或去重合并 |
| `quotes` | 记录 ID、品牌系列、尺码、包装件数、总额及单价计算一致 | **不允许**修改单片价、金额或静默删除 |
| `referenceOverrides` | 自定义每片参考价可精确至 0.001 元；键需是品牌、系列、旧版支持的 NB/S/M/L/XL；价格数值需合法 | **不允许**丢失覆盖或把 0.001 元当成采购总额分 |
| `babyProfile/weightRecords` | 资料字段、体重测量合法，未知嵌套字段需要分类审查 | **不允许**过滤原有测量、抹除扩展字段 |
| `sizeMode/autoSize/replenishPolicy` | 正式版本必要设置，不允许将未知模式自动改成 `manual` | **不允许**暗中改变 |
| `preset` | 唯一允许单独分级的缺失字段：旧导入器会补 `balanced` | **仅允许预览并人工审核**；不代表自动接受 |
| 其他未知顶层/嵌套字段 | 保留源 JSON 完整备份，先定义明确映射或审计留存 | **不允许**静默舍弃 |

### 为什么不将历史采购重新累加到库存

旧版的“实际库存”可能由手动盘点直接调整，不一定能从全部采购和消耗历史精确重放得到。因此新系统初始化时，旧版六尺码 `inventory` 是**独立库存基线**；`transactions` 是**独立历史账本**。不能一边把旧库存写入新系统，一边再次重放旧采购数量来加库存。

## 对用户可见的有限状态码

- `SOURCE_REJECTED`：JSON 解析/来源版本/导出时间/文件大小或外层字段不合要求。
- `SOURCE_STRUCTURE_REJECTED`：必需业务字段不符合底层合同，或无法生成合法只读审计。
- `SCHEMA_OR_RECORD_REVIEW_REQUIRED`：未知字段、不合法的订单/体重/参考价或缺少必要字段。
- `SILENT_DATA_CHANGE_REVIEW_REQUIRED`：模拟旧版导入后与原数据不一致；禁止假定“无损”。
- `DEFAULT_PRESET_REVIEW_REQUIRED`：仅 `preset` 缺失、旧版会补 `balanced`，仍需人工审核。
- `MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED`：仅表明**源结构和当前已知映射预检干净**，不是数据库上传许可，也不能证明云端已准备好幂等迁移。
- `DEPENDENCIES_UNAVAILABLE`、`PROJECTION_UNVERIFIED`：依赖不满足或导入投影无法核验，全部拒绝。

所有输出都固定 `canUpload:false`、`canReplaceLocalState:false`、`serverReceiptPresent:false`，并且不会返回原始品牌、系列、购买金额、宝宝姓名、记录 ID、UID、字段私密扩展键或 JSON 原文；仅返回固定类别与问题数量。

## 新增代码与测试

- `sync/strict-migration-gate.js`：完全内存的只读迁移预检协调器。复用 `migration-contract.js`、`legacy-migration-manifest.js`、`legacy-purchase-audit.js`、`legacy-restore-projection.js` 和 `growth.js`；不执行数据库/本地存储操作，也不会调用正式 `importData`。
- `tests/strict-migration-gate.test.cjs`：18 项测试覆盖正确格式、旧版版本号缺陷、非法或过大的文件、无效时间戳、缺字段、未知顶层/嵌套字段、未知尺码、采购金额精度、唯一 ID、异常成长记录、预设默认值、危险数据修正，以及品牌参考键错误时的隐私脱敏。
- 新结果是**合成数据上的代码级 PASS**。既有真实备份由用户自己保存，无需上传给开发对话或 GitHub。

## 发布前仍未解决的阻断点

1. **还没有服务端签发并持久化的幂等迁移收据**，不能凭客户端预检 PASS 开启真实上传，不能用假的 `verified-server-migration-receipt` 给 `inventory-bootstrap-coordinator` 解锁。
2. 还没完成历史各类记录映射到 CloudBase 的最终 schema/RPC 和**按家庭/宝宝/备份版本的重复迁移保护**，跨设备对账仍未验收。
3. 严格预检不是可提交迁移的完整安全证明：需要生产环境、独立历史备份核验、逐记录对账、事务隔离、回滚/恢复能力，并最终由用户明确批准。
4. P2-3B 019/020 真实安装与虚拟宝宝真实写入仍无授权，不应为了 P2-4D 顺便执行 SQL 或打开库存上传。
5. **正式手机 v1.1.2 本地历史及 main 分支保持不变。** 不要求用户重新登录、重新下载文件、上传 JSON 或执行覆盖式恢复。

## 下一阶段

建议先设计 **P2-4E 历史迁移计划与幂等收据** 的只读 schema / 权限合同草案，再模拟两设备同时发起迁移的竞争和重复提交。代码与隔离 PG 测试通过后，单独明确真实云端部署和写入授权，最后才考虑正式发布。
