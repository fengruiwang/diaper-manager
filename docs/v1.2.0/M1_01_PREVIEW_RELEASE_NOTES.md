# M1-01 独立联网测试版（复用现有 V1.1.2 界面）

基线 `84aac8d1a4689f9a4d7ddb31f6fd3fffb5052ec8`。此文件为验收说明，不构成真实云端写入或正式发布授权。

- `preview/v1.2.0/index.html` 是从 `index.html` 原样复用的五个功能页，保留采购、库存、候选价、参考价、成长和设置 UI；内部的 `growth.js` 与现有 CloudBase 适配器直接嵌入，避免上传一大批依赖文件。**不注册 PWA**，避免测试页改变正式 SW。
- 该预览页使用独立的 `xiaobao_v120_m1_local_sandbox` 及 `xiaobao_v120_m1_active_tab`，严格不读写生产 `xiaobao_diaper_planner_v1`；按钮执行原版功能仅在测试存储里演练。导入真实备份和导出演练备份按钮被禁用。原版软件及 main 没有修改。
- `preview/v1.2.0/m1-controller.js` 复用现有 family-client、session-recovery、access-preflight、child-reader 和 inventory-client。已验证 CloudBase 环境 ID 预填 `f495637659-d2gnuzz2jf5657da8`。尚缺公开仓库中的**客户端 Publishable Key**，不能凭空生成：临时版可在浏览器首次填入**公开客户端 Key**，只存入独立测试 key `xiaobao_v120_m1_preview_public_key`；相同域名下后续自动初始化。发布前应将经确认的 Publishable Key 置入专用前端公开配置并去掉一次性输入。不允许提交服务端 SecretKey、API key 或 token。
- 联网部分只读：已有会话自动恢复；未登录显示 OTP 表单（只有主动点击才发邮件）；通过真实 RLS 核对家庭和 xb 授权；存在且仅存在一个正式宝宝时读取六尺码 reconciliation；若没有正式宝宝则状态为 FAMILY_READY_NO_BUSINESS_CHILD。即使成功也绝不称采购已同步。
- `tests/m1-preview-shell.test.cjs` 定向检查 UI 复用、独立存储、禁止真实备份导入、SDK/session/family 检测及零云端写路径。
- **当前没有可直接访问的线上测试网址**：Feature 不属于正式 GitHub Pages 发布分支。需将上面两个文件发布在**单独测试静态目录**，例如 `xb-test/m1/`，并在手机/电脑通过相同 URL 打开；此静态网页部署不是 CloudBase 数据库写入部署。实际上传前确认当前测试托管的脚本路径、费用/权限和域名。不应复制成正式 main。
- 使用时：首次输入客户端公开 Key（不能是服务端私钥）→ 登录一次→ 之后同域重新打开自动恢复 → 点击刷新检查家庭/云端库存；下方所有采购和库存修改仍是每设备独立演练，不会真实双设备同步。
- M1-02 下一步：优先独立隔离 CloudBase 测试环境/测试家庭的成本与安全授权，受控测试宝宝、A/B 真实 RPC 采购与 refresh 读取；未经另行批准不安装 019/020、不创建测试记录或触发真实写入。
