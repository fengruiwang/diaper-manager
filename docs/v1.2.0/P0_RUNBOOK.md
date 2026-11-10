# P0 验证清单（用户协作，先只读后建表）

## 当前已确认（依据用户控制台截图）

- CloudBase 环境 \`xiaobao-family\` 已创建、已升级个人版，PostgreSQL \`public\` 空数据库。
- 邮箱验证码登录显示「已启用 · 代发」，匿名登录关闭。
- 在「HTTP 网关 → 跨域设置」中存在 \`fengruiwang.github.io\` 自定义安全来源。
- **尚未验证**：实际验证码登录是否成功、SDK/HTTP 能否携带认证访问 PG、RLS 用户分离是否成立。
- 正式小宝管家仍是 v1.1.2（本地记录未迁移）。

## P0-1：只读 SQL 预检

在 CloudBase 控制台 → PostgreSQL → SQL 编辑器，复制 \`cloudbase/sql/000_preflight_readonly.sql\` 中内容，执行后仅反馈 **检查项是否通过**；不要提供真实用户列表、验证码或敏感凭证。该脚本不创建表、不修改任何数据。

预期检查：
- \`public\`、\`auth\` schema 存在；
- \`anon\`、\`authenticated\`、\`service_role\` 角色存在；
- \`auth.uid()\`、\`auth.role()\` 函数存在；
- \`gen_random_uuid()\` 可以生成 UUID；
- P0 基础表尚不存在。

注意：SQL 编辑器通常以管理员角色运行，\`auth.uid()\` 可能为空，这**不代表邮箱登录失败**。用户态鉴权需要之后通过正式 SDK 验证。

## P0-2：真实邮箱登录

登录面板由 Feature 代码提供测试入口（禁止接入 main）。发送测试验证码，使用本人邮箱完成登录；验证用户 ID 非空、退出后不可再访问私有数据。**不要把验证码或 Token 发到聊天**。

## P0-3：建表脚本（需先审阅）

只有 P0-1 成功且再次确认空数据库后，才建议执行 \`cloudbase/sql/001_shared_foundation.sql\`。脚本在单事务内建立 4 张共享基础表、鉴权函数和 RLS。不导入真实记录。

如果执行出错，截图错误摘要（隐藏 token/邮箱），不要反复执行不明 SQL。开发侧先修复脚本并验证原因。

## P0-4：安全验收

- 匿名访问创建家庭 RPC → 拒绝；
- 登录用户创建家庭 → 成功；
- 家庭管理员生成 1 次、24 小时有效的邀请链接；
- 被邀请用户注册并核销 → 拿到 **xb** 应用访问权限；
- 第三方登录用户访问家庭和库存 → 拒绝；
- **简记权限仍未授予任何成员**。

所有测试先用虚拟用户和虚拟数据。真实历史记录只在 P3 并由用户确认后迁移。


## P0-5：基础建表后只读核对

待 P0-1 检查全 true 且 SQL 脚本经审阅后，使用 cloudbase/sql/001_shared_foundation.sql 在 PostgreSQL SQL 编辑器执行基础建表。执行方式必须保证每条 DDL 正确执行：CloudBase ExecutePGSql 接口可能限制一次一条语句；控制台若拒绝多语句，停止并反馈原始错误，不要盲目拆分重试。基础表尚无用户数据，SQL 不涉及现有 Edge 本机记录。

完成后运行 cloudbase/sql/002_foundation_postflight_readonly.sql，只反馈检查项 true/false 和错误文本。此脚本不写数据，核对 4 表、4 表 RLS、3 RPC 和匿名不可查看邀请表。**SQL 编辑器管理员身份不能证明真实网页登录的 RLS 隔离**；后续必须使用真实用户 token 做负向测试。

## 本地不依赖云服务要求

已将 docs/v1.2.0/OFFLINE_RECOVERY.md 纳入发布闸门：离线仍能录入、关闭 App 重启不丢、同 ID 补传不双加、绝对盘点需 revision 冲突检查、跨家庭队列隔离。当前仅有纯函数合同及回归测试；尚未开发 IndexedDB 原子事务和云端 RPC。
