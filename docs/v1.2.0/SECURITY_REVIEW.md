# P0 基础 SQL 人工安全审查与验证矩阵

> 注意：\`cloudbase/sql/001_shared_foundation.sql\` 是**待实际联调的迁移草案**；目前只完成设计与静态校验，绝不声称已在用户 CloudBase 上成功执行。

## 审查确认

- [x] 不引用或重置 \`xiaobao_diaper_planner_v1\`。
- [x] 不创建/导入简记业务表；\`jj\` 仅保留应用代码枚举。
- [x] 私有辅助函数位于 \`xb_private\` schema。
- [x] 所有公众 RPC 的 \`SECURITY DEFINER\` 都显式检查 \`auth.role()='authenticated'\` 和有效 \`auth.uid()\`。
- [x] 家庭/成员/应用许可通过 GRANT + RLS 最小授权；邀请表不直接开放浏览器查询。
- [x] 邀请随机 UUID、24 小时有效、单次核销、\`SELECT ... FOR UPDATE\` 串行核销。
- [x] 用户在 \`xb\` 应用只允许一个家庭，避免设备错误绑定两个云端。
- [ ] CloudBase SQL 编辑器实际执行通过。
- [ ] 登录 A 创建家庭、登录 B 接受邀请。
- [ ] 未登录匿名 RPC 调用被拒绝（CloudBase 当前 RPC 网关可能不强制 GRANT EXECUTE）。
- [ ] 用户 C 无家庭授权时无法读取 A/B 家庭。
- [ ] 已加入 xb 家庭仍不能访问未来 jj 账本数据。
- [ ] 双设备远程调用与 RLS 权限经过实际 HTTP/SDK 联调验证。

## 后续业务表权限原则

业务表只给 \`authenticated\` 角色读取其已授权家庭数据；库存和事务性操作的写入只经服务端 RPC。体重与宝宝信息同样需要 per-record revision 或明确并发规则。**未创建业务表之前，不做真实历史数据迁移。**

## 已知限制

CloudBase 官方 RPC 文档明确提示当前 PostgREST 对 \`GRANT EXECUTE\` 不完全强制执行，不能单凭 REVOKE/GRANT 保护 SECURITY DEFINER。正式联调中需要专门负向测试匿名及第三方访问。

- https://docs.cloudbase.net/database/postgresql/rpc
- https://docs.cloudbase.net/database/postgresql/data-permission
- https://docs.cloudbase.net/authentication-v2/auth/auth-pg
