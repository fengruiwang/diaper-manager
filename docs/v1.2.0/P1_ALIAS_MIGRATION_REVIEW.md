# P1 增量迁移 003：成员友好备注名审查

状态：编写、GitHub CI 测试中。尚未在 CloudBase 环境中执行。

## 数据兼容

目前 1 个家庭、2 个成员、2 个 xb 授权。003 只对 family_members 增加 member_alias、alias_revision、alias_updated_at、alias_updated_by，不删除也不重建成员，不更改 user_uid/family_id/role 等主键和角色数据。未设置备注时，界面显示“管理员”或“家庭成员”，不把技术 UID 作为标题。

## 权限规则

- 当前 CloudBase 身份认证角色必须是 authenticated，auth.uid() 非空。
- 请求方必须已经具有所请求家庭的 xb 应用许可。
- 管理员可修改家庭内任何 xb 成员备注；普通成员仅能修改本人。
- SQL 函数在服务端重新检查目标成员和权限，调用方不能通过传参伪造身份。
- 所有备注修改使用当前 alias_revision 乐观并发版本；冲突错误码 SQLSTATE 40001。P3 后续对离线操作提供可持久恢复和 ID 去重的统一操作入口。
- 备注变化保留审计；audit 表不开客户端 SELECT、INSERT、UPDATE 或 DELETE。
- 改备注不改变 CloudBase 账号邮箱、user_uid、member_role、family_app_access 或现有采购等业务数据。
- RPC 采用 SECURITY DEFINER，在函数体显式校验 auth.role()、auth.uid()、家庭许可和角色。当前 RPC 网关可能不会强制检查 GRANT EXECUTE，因此数据库内部身份检查不可省略。

## 实际 CloudBase 验收闸门

1. 经用户确认后，在 xiaobao-family 的 PostgreSQL SQL 编辑器执行 003_member_alias_migration.sql。
2. 再执行 004_member_alias_postflight.sql，只提供布尔结果，不提供邮箱、UID 或邀请 token。
3. Admin 将家庭成员备注改成“老婆”；B 登录看见更新后名称；user_uid/family_id/role 不变。
4. B 更新自己备注成功，但修改管理员备注失败（42501）；非成员 C 调用 RPC 失败。
5. 两个账号同时改同一备注，在旧 revision 下只能一个成功；冲突返回 40001。
6. 修改后仍能查看家庭、生成/核销邀请、双方读取自家数据；不影响未来 jj 权限。
7. 模拟 CloudBase 断网时本地应用仍能读取已有缓存；此次成员备注本身不构成离线同步端到端验收。

## 取消/回滚

不要用 DROP TABLE 或删除账号恢复旧界面。将前端退回不显示备注的版本即可；保留新增的空/非空备注列，避免历史丢失。若 RPC 出现安全异常，先撤销函数的访问并暂停相关功能，调查后修复。
