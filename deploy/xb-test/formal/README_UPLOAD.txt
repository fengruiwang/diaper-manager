小宝管家 V1.2.0｜P0 启动耗时定向优化（只读腾讯云测试部署包）
功能源代码 SHA: da93ab12bce17f735a16d5dbc5ef32b24ef3c070
版本号: da93ab1

仅在原有 CloudBase 静态托管环境的 /xb-test/formal/ 上传：
  index.html
  m1-controller.js
  formal-controller.js
三个文件必须在 /xb-test/formal/ 同一个目录内，全部覆盖原文件。
README_UPLOAD.txt 不上传到网站；文件管理操作不涉及 SQL 或数据库。

保留原有腾讯云环境 ID、公开匿名前端密钥与邮箱登录体系。
不使用 Cloudflare 测试，不修改 GitHub Pages 正式版本。
FORMAL_WRITE_ENABLED=false，不执行任何真实云端业务写入。

打开原有腾讯云静态托管域名：
  https://<原腾讯云域名>/xb-test/formal/?p0=da93ab1
在 DevTools > Network 勾选 Disable cache，使用 Ctrl+Shift+R。
两个脚本应 HTTP 200：
  /xb-test/formal/m1-controller.js?v=da93ab1
  /xb-test/formal/formal-controller.js?v=da93ab1
浏览器 Console 校验：
  console.log(document.querySelector('meta[name="xiaobao-p0-source-sha"]')?.content)
预期结果：da93ab12bce17f735a16d5dbc5ef32b24ef3c070
  console.log(window.XBFormalApp?.mode, window.XBFormalAppModule?.FORMAL_WRITE_ENABLED)
已登录应该是 ready, false；无登录时应该是 login, false。

真实验收（由用户手动执行）：
1) 未登录打开，用浏览器现有 Performance/Network 工具记录至 login 的耗时；
2) 已登录 F5 刷新，记录至 ready 的耗时，建议连续 3 次；
3) 正确 OTP 登录、退出重新打开、切换标签页、两个账号分别验证；
4) 核对正式宝宝、10 笔历史采购、6 尺码库存；不展示 S140；
5) 失败时保留验证码；网络/数据库权限不要修改。

说明：历史用户实测（优化前）未登录约 4–5 秒，已登录刷新约 7–8 秒。
这些是对照基线，不是本包实际测速；绝不能仅凭 CI 宣告真实 P0 性能通过。
后续 CloudBase 故障时的离线可用性是必要待办，不在本包实现。
