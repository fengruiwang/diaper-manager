# 小宝管家 V1.2.0 | GitHub Pages 正式候选包 P4-04A

**仅构建与审核候选文件，未发布。** 本批未修改原 GitHub Pages 根目录 V1.1.2、腾讯云或真实数据库权限。

## 候选目录与构建

生成目录：release-candidate/pages-v1.2.0/（14 个静态文件，含全部图标及 .nojekyll）。

源文件继续使用已验收的 V1.2.0 五页面、CloudBase 登录和正式 primary 五文档读回：
- preview/v1.2.0/formal/index.html
- preview/v1.2.0/m1-controller.js
- preview/v1.2.0/formal-controller.js
- scripts/pages-v120-pwa.js
- 原根 Manifest、SW 外壳、growth.js 与全部 icons

构建及定向测试：
    node scripts/build-pages-v120-candidate.cjs --check
    node --test tests/p4-04a-pages-candidate.test.cjs

未来源码变动后使用不带 --check 的构建命令重生成整个包，并重跑 CI；不同版本的 HTML、控制器和资源不得混用。

## GitHub Pages 正式路径

候选包 index.html 的外部资源均相对当前目录：./m1-controller.js、./formal-controller.js、./pwa.js、./manifest.webmanifest 和 ./icons/*。发布时应仅把候选目录的**内容**作为完整静态包安装在 GitHub Pages /diaper-manager/ 根目录；不能合并 Feature 后直接称为 V1.2.0。

## 兼容性

- Manifest 原样复制，id、scope、start_url 均为 ./；在原 GitHub Pages 同源根路径中保持既有 PWA 身份。
- 原所有 PNG、maskable、Apple touch 与 SVG 图标保留。
- SW 使用独立缓存 xiaobao-shell-v1.2.0-rc1，保留用户确认后才切换的新旧缓存更新逻辑；不清空 localStorage/IndexedDB。
- PWA shell 只处理安装和更新，不调用旧版数据导入、清空或模拟同步。旧 V1.1.2 的本机历史记录仍保存在原同源存储中，正式升级前后必须核对，且需保留原备份。
- 已隐藏并禁用候选页面中实际未接通的云端备份/导入/清空入口；不暗示这些操作已支持。
- 本候选包两个业务写入开关均为 false；SQL 权限仍关闭。
- Tencent CloudBase 测试域与 GitHub Pages 的本地存储及登录态互不自动共享。

## 后续操作（尚未批准，不执行）

1. 独立审核候选包和升级迁移方案，明确发布版写入授权矩阵。
2. 经单独批准后才将候选包 14 个文件完整放到 main 的 /diaper-manager/ 根位置；不合并全部 Feature 工作树。
3. 以 GitHub Pages 同源验证原 PWA 安装身份及 SW 更新、CloudBase 登录与会话、既有 localStorage 数据保留、正式 primary 与 A/B 五文档数据一致。
4. 再单独批准真实写入测试，完成后宣布正式发布。失败则恢复原 V1.1.2 根文件及 SW，不清理用户浏览器存储。

## CI 边界

静态本地 HTTP 200、Manifest、图标、脚本、SW、版本与开关检查通过，不等于真实浏览器登录、CloudBase 可访问、PWA 原地升级或手机数据已迁移。
