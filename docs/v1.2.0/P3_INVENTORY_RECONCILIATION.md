# P3 服务端库存一致性读取：010 增量 SQL 草案

状态：只在 v1.2.0 开发分支，**尚未执行到腾讯云**。等待正式审查和 CloudBase 真实权限验证。

## 作用

\`xb_read_inventory_reconciliation(family_id,child_id,operation_ids[])\` 是只读、内部鉴权的 \`SECURITY DEFINER\` RPC。

- 一次 PostgreSQL MVCC 读取同一宝宝六个尺码的权威库存、各尺码 \`revision\` 和**当前登录成员自己**提交的已完成 \`operation_id\`。
- 即使客户端因断线丢失 ACK，只要服务端已写该操作，它就会出现在 \`seen_operation_ids\`，避免再把其库存数量覆盖叠加到服务器库存。
- 必须返回 \`checked_operation_ids\` 全量回显，客户端和本地 IDB 事务内再核对，防止云端读取后出现新的本地操作而不知情。
- 仅允许最多 50 个互异 UUID，且必须有效认证、有 \`xb\` 应用授权、属于该家庭和宝宝。
- 服务端的 \`complete\` 只是此次查询覆盖六个库存尺码和给定 ID 的结果，不代表云端所有历史流水已拉取，更不代表永久实时同步。

## 重要边界

- 请求者可以看见自己的操作被服务端确认，但不能通过篡改 actor_uid 查询别人是否提交了某 ID。
- 普通客户端只有此 RPC EXECUTE 和已有受 RLS 的只读权限，禁止直接更新任何业务表。
- SQL 的 read-side consistency 不能代替 write-side idempotency（由 009 写 RPC 保证）。
- 50 个操作 ID 是当前独立模块安全边界；超过上限时前端**必须停止自动合并**。未来需要批量游标分页或改为服务端维护持久 reconciliation watermark。不能丢掉早期的 \`acked\` 事件来凑数量。
- 盘点（绝对值）和撤销操作尚不能按云端基线直接自动重算：必须先经过完整操作历史和 revision 验证；冲突时保留本地记录，不强行上报“已同步”。
- 当前还需要真正的浏览器/CloudBase 联调与跨设备购买历史拉取。**禁止自动上传手机历史数据**。
