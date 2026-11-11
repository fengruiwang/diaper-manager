# P3 受控库存补传执行器（尚未接入正式版）

\`sync/inventory-outbox-runner.js\` 只有显式调用 \`flush(scope,{uploadEnabled:true})\` 才考虑发送网络请求。代码导入时无行为；传入的 \`verifyAccess\` 必须由 **实时服务端认证、家庭 xb 授权和迁移初始化状态检查** 驱动，不能来自用户填的昵称或本机旧缓存。

### 规则

- 默认 \`uploadEnabled=false\`，不查队列、不上传。
- 每次补传前核对服务器返回的 familyId/actorUid/appCode/member/initialized；不满足任一项停止。
- 当前仅支持 \`inventory.delta\`（buy/use）、\`inventory.count\`（stocktake）和 \`transaction.reverse\`。其他模块待独立 RPC 实现，不能误 ACK。
- 固定 \`operation_id\`、\`createdAt\` 与所有参数从 IndexedDB 重放，绝不临时生成新的 ID。
- 收到可信 RPC 同 ID 回执并成功持久化 ACK 后算一条已确认；相同 ID 的重复返回同样可以确认。
- 发生 revision 冲突、库存不足、权限撤销、登录失效或服务器异常时，单批次立即停止并保持全部尚未确认操作；不得继续自动覆盖。
- 全部操作 ACK 后只显示 \`awaiting-reconciliation\`，还必须拉取服务器最新库存、流水与游标并核对，才可以显示完整“已同步”。
- 浏览器多个标签页争用、网络退避、完整状态投影、真正的家庭初始化证明和真实 CloudBase 联调仍在后续开发。

**这是开发框架，不代表已经建立可以安全上传的 \`verifyAccess\` 生产实现。P2-1 数据库静态部署已于 2026-11-11 通过真实 CloudBase 的 018（20/20）及 012（12/12），不应重复执行任何已完成的部署 SQL；但 P2-3 真实业务联调、测试宝宝写入、正式版历史数据上传仍未授权。**
