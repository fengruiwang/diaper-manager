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
