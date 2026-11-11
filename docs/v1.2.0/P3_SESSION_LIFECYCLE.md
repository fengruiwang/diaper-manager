# P3 登录一次、日常自动恢复：会话设计与验收

状态：开发分支已实现独立恢复模块及单元测试，尚未连接正式 PWA UI。

- 新增 \`sync/cloudbase-session-recovery.js\`：PWA 启动、恢复前台和网络恢复时调用 SDK \`auth.getSession()\`；会话有效时直接显示主页，不弹邮箱或验证码。
- 如 SDK 返回 \`expires_in\` 且不足 5 分钟，调用 SDK 官方 \`auth.refreshSession()\`；如果 SDK 不提供此值，依赖 SDK 内部管理，不擅自构造刷新令牌。
- \`token_expired\` 可先尝试官方刷新；\`invalid_refresh_token\` 或 \`refresh_token_expired\` 才显示重新登录要求。网络不可用时本地数据可继续使用，但不能假装已经联网验证家庭权限。
- 不在业务 localStorage、IndexedDB outbox、错误日志或 URL 中复制令牌；SDK 自己维护会话。手机号/邮箱 OTP 仅在用户主动点击登录时发送。
- 在手机 Edge 已安装的 GitHub Pages PWA 与腾讯云静态托管的诊断页面之间，浏览器 **origin 不同**，会话不能自动共享。真正发布后在固定的 GitHub Pages 域中首次登录，后续同域打开恢复。
- 即使保持登录，用户被移出家庭时仍须通过每次上传前的服务端家庭和 xb app 授权检查；会话存在 != 有权修改家庭数据。
- 真实测试：首次登录一次→关闭 PWA→重启手机→再次打开免邮箱；短期断网仍可访问本地；长时间不使用、令牌失效或清除网站数据时需要重新登录；从测试托管域切到 GitHub Pages 域首次登录可能需要重新验证。
- 用户在本机主动退出时调用 SDK \`auth.signOut()\`，但 **不自动清空未同步的本地家庭事件**，待重新登录时严格按原 familyId + actorUid 恢复。
- 不承诺永久免登录：刷新凭证的有效期、账号状态及浏览器清理缓存等行为由 CloudBase 和浏览器实际决定。

资料参考：CloudBase Web v3 官方身份认证 API 的 getSession / refreshSession / signInWithOtp（https://docs.cloudbase.net/api-reference/webv3/authentication）。
