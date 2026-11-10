# P1 CloudBase 真实登录/权限验证计划（待浏览器联调）

2026-11-10：P0 postflight 所有 15 项 true，四张表已创建，全部 RLS 已开启，家庭表为空。此项仅表明**结构/静态权限**正确，尚未测试真实账号跨家庭权限。

## SDK 版本决定

使用 CloudBase JavaScript SDK v3，**构建时固定具体 npm 版本，打包进入 PWA shell**，离线启动不能依赖腾讯云或第三方 CDN 加载 SDK。v3 邮箱登录：
1. 明确点击“发送验证码” → auth.signInWithOtp({ email })。
2. 保存返回的 data.verifyOtp 回调（只在本页内存中），填入收到的验证码 → data.verifyOtp({ token })。
3. 用 auth.getSession() 核验确实得到用户会话；不可把“邮件发送成功”当作已登录。
4. app.rdb().rpc('xb_create_family', {p_name}) 创建家庭，之后创建邀请、核销邀请。
5. 退出登录不删除旧本机库存和备份；同步权限中断，须确认本机后续绑定家庭身份。

截至 2026-11-10 官方文档：
- https://docs.cloudbase.net/api-reference/webv3/initialization
- https://docs.cloudbase.net/api-reference/webv3/authentication
- https://docs.cloudbase.net/api-reference/webv3-pg/postgresql/rpc

## 当前代码

sync/cloudbase-family-client.js 是**隔离的 SDK 适配层**，不与 index.html 或生产 app 初始化相连；借助假的 SDK 响应测试登录分支与 RPC 请求参数。真实用户邮箱和验证码绝不保存在仓库或测试文件中。

## 下一步

在不影响主站正式应用的条件下，准备测试用登录入口。必须先确认 CloudBase SDK 版本/公开客户端配置、两人收到实际验证码、用户会话可用，再测试真实数据库 RPC。测试页面中不能内嵌 SecretKey/API Key/service_role；如 v3 初始化要求 accessKey，仅使用控制台确认可供浏览器的 Publishable Key（非管理 API Key）。

## P1 真实权限负面测试

- 未登录用户调用 xb_create_family → 权限拒绝；不能写数据。
- A 邮箱登录创建家庭成功 → family_id 和 xb 应用授权成立。
- B 使用第二邮箱登录，通过 A 的一次性邀请码加入同一家庭；再次核销必须拒绝。
- C 独立测试账号尝试查看 A/B 的 families/family_members/family_app_access → 空结果；调用 xb_create_invite(A 家庭) → 拒绝。
- B 尝试生成邀请 → 拒绝（仅 owner 允许）。
- A/B 两人继续使用原 v1.1.2 应用期间，不能有任何数据被自动迁移或覆盖。
- 一旦出现任何越权或认证报错，中止云端业务表部署，保留现有本地版。


## 2026-11-10 更新：真实 P1 首轮结果

用户在 CloudBase 静态网站托管 HTTPS 页面上使用 Publishable Key：SDK 初始化成功、邮箱验证码发送成功、验证码登录成功、PostgreSQL SELECT families 成功并返回 0 条。**这证明真实登录与数据库读连接畅通，但家庭成员隔离仍未验收。**
本地 file:// 页面可以初始化 SDK，但发生 unreachable 请求，属于来源或网络限制下的诊断现象；今后的真实云端验证使用托管网页。

## 家庭/邀请 P1 测试按钮（诊断版 3）

测试页路径仍为 cloudbase/smoke/auth-test.html，需覆盖 CloudBase 静态托管 xb-test/auth-test.html（不触碰正式 GitHub Pages）。新增：
- 已登录后「查看我有权限的家庭」：受 RLS 过滤的 SELECT；创建前返回 0。
- 明确点击「创建家庭」：实际写入 families / family_members / family_app_access，创建后会保留为正式家庭；不要随意创建测试家庭导致唯一约束冲突。
- 管理员明确点击「生成邀请码」：服务器返回 24 小时一次性邀请码；页面只显示在密码输入框，不存业务 localStorage。
- 第二邮箱登录后明确点击「接受邀请码」：实际写入该成员与 xb 应用访问许可。
- 所有 RPC 均要求已登录、按钮主动触发，不读写历史纸尿裤/体重记录。

重要：不要在聊天里发送实际邮箱、登录 token、Publishable Key 输入截图、邀请码。若出现 42501 或 PGRST 错误，反馈不含个人敏感内容的错误码即可。

**P1 最低成功标准**：A 账户看到自己的家庭 1 条，B 账户接受邀请后看到同一家庭 1 条；第三方 C 用户尝试读取家庭返回 0，无法创建邀请码。管理员、非管理员权限隔离必须单独验证，不能只凭 A/B 读成功宣布全部 RLS 测试通过。
\n\n## 家庭成员备注名及扩展性要求（待实现）\n\n当前 public.family_members 没有备注字段。下一步在安全审查后使用 ALTER TABLE 增量添加 member_alias（可空），不重建既有 owner/member 关系。管理员可编辑成员备注，成员可编辑本人备注；经服务端鉴权 RPC 写入，权限不能只靠前端按钮。界面主要显示「我」「老婆」等备注及管理员/成员角色，而非原始 user_uid；后台审计保留稳定 ID。实现设计及验收清单参见 docs/v1.2.0/EXTENSIBILITY_AND_MEMBER_LABELS.md。\n