# M1-02｜2026-11-12 真实 CloudBase 双账号主链路验收（权威状态）

**结论：M1-02 核心双端同步主链路 REAL PASS；不是整个 V1.2.0 发布完成。**

信息来源：用户提供的真实 PostgreSQL / 浏览器手工验收报告。下表按实际报告记录，不把 JS 模拟测试替代真实证据；本轮未再次进入 CloudBase 数据库或浏览器。

| 核验点 | 真实结论 | 证据/保留说明 |
| --- | --- | --- |
| 019A 最小预检 / 019 安装 / 020 后检 | PASS | 019A 18/18、020 18/18；不得重复安装 |
| A 创建专用 `__xb_smoke_v1__` | PASS | 现有家庭 owner RPC；只创建一个 |
| A 云端真实购买 S60 | PASS | 用户确认权威库存 S60、revision=1、采购流水 1 |
| B 另一浏览器读取 S60 | PASS | 真实账号 B 跨浏览器读取 |
| B 云端真实购买 S80 | PASS | 用户确认购买成功 |
| 云端权威 S140，revision=2 | PASS | 用户实际核对，A/B 刷新库存一致 |
| 重新开启页面后完全一致 | **没有独立结果** | 不把刷新结果冒充关闭重开实测 |
| 最终 2 条 xb_transactions / 2 条 xb_inventory_operations 的直接 SQL 计数 | **待直接记录** | 用户没有提供两个表的最终实际行数；无需重新采购 |
| 真实离线排队和恢复 | **未验收** | 不得补造 PASS 或生成第三笔采购 |
| 原 operation ID、原 payload 的真实幂等重试 | **未验收** | 不得补造 PASS 或生成第三笔采购 |
| M2 历史迁移 / M3 正式 UI / M4 正式发布 | **未完成** | 须各自验收、单独批准数据库写入 |

## 现有真实测试数据永久保留规则（除非用户未来另行批准）
- 保留唯一 `__xb_smoke_v1__`、库存 S140、采购流水、库存操作事件、操作 ID 和审计。
- **不软停用、不 DELETE、不 TRUNCATE、不 DROP、不改唯一约束、不归零、不重新采购或导入旧版演练数据。**
- 测试宝宝仍可在后续 M2、M3、M4 使用作**只读隔离对照**，但本次授权不延伸到未来测试采购。
- 正式目标只能是**独立的活跃 `legacy_slot='primary'`**，所有业务查询以 family_id + child_id 严格隔离。
- 既有 V1.1.2、main、正式网址、PWA、图标及历史数据完全保持原样。没有用户已确认的完整数据库回档备份。

## 可选最小只读证据（有需要才手动执行；非验收阻断项）
```sql
SELECT
 c.legacy_slot,
 (SELECT count(*) FROM public.xb_transactions t
    WHERE t.family_id=c.family_id AND t.child_id=c.id) AS purchase_rows,
 (SELECT count(*) FROM public.xb_inventory_operations o
    WHERE o.family_id=c.family_id AND o.child_id=c.id) AS operation_rows,
 (SELECT quantity FROM public.xb_inventory i
    WHERE i.family_id=c.family_id AND i.child_id=c.id AND i.size='S') AS size_s_qty,
 (SELECT revision FROM public.xb_inventory i
    WHERE i.family_id=c.family_id AND i.child_id=c.id AND i.size='S') AS size_s_revision
FROM public.xb_children c
WHERE c.legacy_slot='__xb_smoke_v1__'
  AND c.deleted_at IS NULL;
```
此查询预期恰好 1 行，purchase_rows=2、operation_rows=2、size_s_qty=140、size_s_revision=2。若实际不符停止后续真实写入，保留现场，不清空/修复。

## 后续
- 当前直接转向 M2；暂不为遗留断网/幂等测试增加第三笔采购。
- M2：迁移范围内保存原始备份、现存库存、全部历史和偏好；正式 primary 与 smoke S140 隔离。
- M3：并行准备正式界面的只读 primary 数据适配，确认迁移收据后接入已有页面。
- M4：夫妻双端完整功能验收及正式 PWA 的独立发布审批。
