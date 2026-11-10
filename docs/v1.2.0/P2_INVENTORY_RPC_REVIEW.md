# P2 库存事务 RPC 设计与测试闸门

状态：设计分支功能实现草案。**007 未部署 CloudBase，任何真人库存还未上传。**

## 入参和回执

\`xb_apply_inventory_operation(p_family_id uuid,p_child_id uuid,p_operation_id uuid,p_kind text,p_size text,p_amount integer,p_expected_revision bigint,p_reverses_operation_id uuid,p_occurred_at timestamptz)\`

- buy / use: \`p_amount\` 是 1–100000 的正整数；buy 加库存，use 减库存；不允许传 revision/reverse id。
- stocktake: \`p_amount\` 是目标库存 0–100000；**必须**提供读取到的 \`p_expected_revision\`，旧版本返回 SQLSTATE 40001，不改任何库存。
- reverse: 不接受客户端自选正负库存，必须提供原始 buy/use 的 \`p_reverses_operation_id\`；服务器取原操作 delta 的相反数；同一原操作最多逆向撤销一次。
- \`p_operation_id\` 为在本地创建、持久化后永不变更的 UUID；请求超时重试必须复用原 ID、所有原参数和原 actor 身份，不得用新 ID 再重试。
- \`p_occurred_at\` 是客户端记录的事件时刻，服务器另外记录 \`committed_at\`；摘要按 UTC 归一化。
- 回执 \`result_quantity\`、\`result_revision\` 是**该操作提交时的库存结果**，不保证是随后其他操作已发生时的当前库存；需增量同步读取当前值。

## 并发 / 原子性

- 先验登录身份和 xb 家庭授权，再使用家庭粒度 PostgreSQL advisory transaction lock 串行化同家庭操作。随后查询已存在的 operation_id + payload_sha256 并验证 actor_uid；相同请求返回旧回执，改变内容则报 23505。
- 新操作在受控 RPC 内锁定对应库存行，在一个事务中更改库存和写入操作流水。任何 SQL 错误自动回滚行插入、库存更改和操作流水。
- 用 SQL 检查 0–100000 边界，不允许库存不足时减到负数。多家庭隔离靠 SQL WHERE family_id 和 xb 授权，跨宝宝靠 composite foreign keys 与 child_id 检查。
- \`pg_advisory_xact_lock(hashtextextended(...))\` 只用于并发串行化，不作为权限授权；潜在 hash 碰撞只可能影响性能。
- 原始操作 buy/use 才可被 reverse；已完成的 stocktake 与 reverse 自己不可再通过此接口反向撤销。
- 同一账户多次提交不同 request ID 是两个独立业务操作，即使数值完全相同；客户端需在持久化后重用同一个 ID。

## 当前不包含的部分

- 005 业务表仍是未部署的草案；007 依赖它，不能单独在真实家庭运行。
- \`xb_transactions\` 采购金额、单价、品牌、系列及财务审计尚未添加；本 RPC 仅保证库存物理变化，采购业务的综合事务需要之后把采购信息和库存事件放同一 RPC。
- 未实现前端 IndexedDB outbox、真实网络重试、登录验证的 CloudBase RPC 浏览器调用、两个账号真实并发验收。
- 目前仅使用 Node 模拟账本 + 静态 SQL 合同回归，**不能声称通过真实 PostgreSQL 并发或 RLS 测试**。
- 无法再进行 stocktake/restore 之前的「全量旧版初始化」自动运行。迁移必须另行设计专门一次性事务，并由用户主动确认备份与所有统计量。

## 真实环境部署前的阻断事项

1. 审核 005/007 在 CloudBase 实际 PostgreSQL 版本上运行（pg_catalog.sha256(bytea) 需要支持）。
2. 根据采购详情要求补 \`xb_transactions\` 后评估是否要将其并入同一库存 RPC（不能先发布一个只动库存的正式购买入口）。
3. 用完全虚拟宝宝和虚拟库存测试两个账号：+60/+80、重试、负库存拒绝、旧 revision、重复反向操作、撤销库存不足、陌生家庭拒绝、撤销成员后拒绝。
4. 确保正式旧版本地存储 \`xiaobao_diaper_planner_v1\` 不被访问、不丢失，备份与恢复仍能用。
5. 所有测试通过后才确定业务初始化与发布时机。
