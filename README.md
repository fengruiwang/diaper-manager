# 小宝纸尿裤管家 · PWA 正式版 v1.0.0

## 简介
独立手机桌面网页应用。保留「参考价修复版」全部业务逻辑，新增 GitHub Pages 部署、安装到桌面、离线缓存和手动确认更新。

## 部署
将本目录所有文件原样放到 GitHub 仓库 `main` 根目录，然后在 Settings → Pages 将 `Build and deployment` 设为 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。公开仓库适用于 GitHub Pages 免费方案。

发布后的预期地址：`https://fengruiwang.github.io/diaper-manager/`（只有仓库实际创建、Pages 生效后此地址才可访问）。

手机：用 Chrome/Edge（Android）或 Safari（iOS）访问网址，点击页面“添加到手机桌面”或使用浏览器菜单安装。

## 历史数据迁移（重要）
1. 在旧的本地 HTML 的「个性设置 → 数据备份与恢复」导出 JSON。
2. 用手机浏览器访问新网址，再在新网站点击「导入旧版备份」导入 JSON。
3. 确认库存、采购流水、自定义参考价都正确；之后再添加到桌面。在 iOS 独立桌面应用中如无法看到 Safari 的数据，直接在桌面应用内重新导入该备份。
4. 保存旧版备份以备核对；不要先清理浏览器数据。

**本地文件 `file://` 与 GitHub Pages `https://` 的 localStorage 不相通，不能自动搬迁。**

## 数据安全与升级原则
- 数据存储键固定：`xiaobao_diaper_planner_v1`。
- JSON 备份格式固定：`{app: "xiaobao-diapers", version: 1, data: ...}`。
- 现有原始代码的 `defaults/load/save/import/export` 逻辑没有改变。
- Service Worker 只缓存静态页面和图标，不缓存用户数据库，更新不触碰 `localStorage`。
- 版本更新必须由用户点击“更新应用”确认，避免编辑表单时被强制刷新。
- 数据不进行跨设备实时共享：如需共享，需要另外开发云同步。

## 发布新版本
改动后同步更新 `sw.js` 的 `CACHE_NAME` 和 `version.json` 的版本。将所有静态文件提交并发布；旧版本检测到更新后会提示用户确认。不要修改 localStorage 键或直接清空历史数据。
