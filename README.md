# 小宝纸尿裤管家 · V1.2.0-rc.6 GitHub Pages 正式入口

前端使用 GitHub Pages（main 根目录）：https://fengruiwang.github.io/diaper-manager/ 。后台使用腾讯云 CloudBase 提供账号、家庭授权、库存及共享文档服务。

此版按照已审核的 V1.2.0-rc.6 候选包原样发布；业务源码基线 `16a6a15d0d158b288e331c4b9d1d6abea72d42c3`。候选资源的 14 个文件与已验收的 GitHub Actions Artifact 完全一致；版本仍标记为 rc.6 以准确反映来源。

## 重要：保留 V1.1.2 数据和回退能力

原 V1.1.2 最终 Commit：`a7c6a138f8aa7858b6b72b8f843625a5a4232bd9`，已独立备份到 `backup/v1.1.2-pre-v120-20261119` 分支。**不要删除该分支。**

V1.1.2 本地数据在同源浏览器 `localStorage` 键 `xiaobao_diaper_planner_v1` 下；V1.2.0-rc.6 不读取、不覆盖该键，而是使用已授权的 CloudBase 和独立 IndexedDB 库存队列。升级前，建议先在旧版「数据备份与恢复」导出 JSON 并妥善保存，升级后不要清除站点数据。

如需回退：以备份分支为来源，将 V1.1.2 的完整 Git 根目录树恢复为 main 的**新提交**（不要修改 CloudBase 真实数据，也不要强制重写 main 历史），核对 GitHub Pages 部署及旧版 PWA 更新提示。用户设备可能需接受版本更新、重新打开或刷新页面，方能切换 Service Worker 缓存。

**程序回退不等于云端记录迁移**：回退后的 V1.1.2 只读其原有本地记录，不会自动导入 V1.2.0 期间新增的云端采购、消耗、成长等数据。回退时避免误删 CloudBase 数据及浏览器站点数据。

## 构建与回归

发布资源直接复制自 `release-candidate/pages-v1.2.0-rc6/`，保留相对路径及图标。Feature 分支的 1012 项 JavaScript 测试、PostgreSQL 合约与 rc.6 隔离 HTTP 校验已通过。main 的回归运行 `node --test tests/*.test.cjs`，其中 `tests/integration.test.cjs` 现在验证正式根目录 V1.2.0-rc.6；旧版集成测试仍可在备份分支获取。

此仓库的 GitHub Pages 采用 Settings → Pages → Deploy from a branch → `main` → `/ (root)`。
