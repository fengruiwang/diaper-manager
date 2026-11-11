# 小宝管家 v1.2.0 — P2-4A 历史备份完整性与恢复预览

状态（2026-11-11）：**独立开发分支代码与 Mock/纯浏览器静态测试完成；尚未从用户真实浏览器读取备份或执行恢复。**

## 本轮已实际完成

通过审查 `index.html`，确认 v1.1.2 旧版 `localStorage['xiaobao_diaper_planner_v1']` 的完整业务模型，包括库存、购买/消耗、比价记录、参考价覆盖、目标库存、用量计划、宝宝资料和体重记录。正式版“导出 JSON 备份”格式为：

```json
{"app":"xiaobao-diapers","version":1,"exportedAt":"...","data":{"inventory":"...","transactions":"..."}}
```

**必须注意**：正式版 `importData(file)` 目前有 `confirm('确定用这个备份替换本机现有的库存和记录吗？')`，且会合并 defaults/校验库存数量、目标天数。**不能在保存真实历史记录的手机上用“导入”做恢复实验**，也不能把文件 roundtrip 通过误称正式应用已实现无损恢复。

新文件：

- `sync/legacy-backup-vault.js`：纯函数封存真实旧版导出 **原始 JSON 文本**，保留空白、数字精度、记录顺序和所有未知字段。使用 WebCrypto SHA-256 检测意外修改；可从验证过的保护包提取字节等价的原始导出文本。文件包含用户历史记录，不应上传给开发者或分享。
- `cloudbase/smoke/legacy-backup-check.html` + `legacy-backup-check.js`：独立网页，用户手动选择原始 JSON，生成保护副本，下载后重新选择进行独立校验，下载恢复出的原始 JSON。**没有 localStorage、IndexedDB、CloudBase SDK、fetch、XHR、WebSocket 或登录功能**；页面 CSP `connect-src 'none'`，仅同源加载两个 JS 文件，不允许网络发送文件内容。
- `tests/legacy-backup-vault.test.cjs` 和 `tests/legacy-backup-check-browser.test.cjs`：验证 SHA256、拷贝完整性、未知字段保留、价格精度、元数据伪造/修改拒绝和页面的无网络/无存储设计。合成数据测试通过。

## 手动浏览器测试 — 本次直接给用户的完整三文件交付

文件来自 `feature/cloudbase-sync-v1.2.0` GitHub 开发分支：

1. `cloudbase/smoke/legacy-backup-check.html`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/cloudbase/smoke/legacy-backup-check.html
2. `cloudbase/smoke/legacy-backup-check.js`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/cloudbase/smoke/legacy-backup-check.js
3. `sync/legacy-backup-vault.js`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/sync/legacy-backup-vault.js

三个文件都需**同名保存、放入原 CloudBase 静态网站的 `xb-test/` 独立测试目录**。只上传 HTML+JS 测试代码，**绝不上传任何导出的 JSON 备份文件**。不覆盖已有测试工具、正式 index、PWA 或 Service Worker。不运行 SQL。

操作顺序：

1. 在平常使用的正式 v1.1.2 中进入「数据备份与恢复」→「↓ 导出 JSON 备份」。**不要点击「↑ 从备份恢复」或者「清空所有记录」。** 确认已保存 `小宝纸尿裤备份_日期.json`。
2. 分别打开上面的 3 个 GitHub 文件链接，`Raw` → 下载/保存，文件名不能多出 `.txt`。在 CloudBase `xiaobao-family` 静态网站托管的既有 `xb-test/` 目录里只上传这 3 份静态代码。
3. 在自己浏览器访问 `https://<现有静态托管域名>/xb-test/legacy-backup-check.html`，无需登录。当前浏览器只从同一测试域名加载代码，`connect-src 'none'` 禁止后续网络请求。
4. 在步骤①选择刚从正式软件导出的 JSON 文件，点击「检查并生成保护副本」，预期显示“原始导出文件格式正确 / 保护副本生成并自检 PASS / 真实云端迁移仍未授权”。
5. 点击「下载保护副本」，在设备文件夹中找到 `小宝管家_历史保护副本_日期.json`。
6. 在步骤②**重新选择刚刚实际下载的保护副本文件**，点击「验证保护副本」，预期 `保护副本核验 PASS`、`SHA-256 校验一致`、`原始备份完整恢复预览 PASS`。
7. 可选：点击「下载验证后的原始备份」，会得到一份字节等价的 v1.1.2 导出 JSON；**不要在使用中的小宝管家导入它覆盖数据**。
8. 反馈时只告诉开发对话“原文件生成 PASS / 保护副本二次核验 PASS / 有无错误码”，不要发送 JSON、文件内容、SHA 值、宝宝资料、邮箱、Cookie 或价格明细。

## 当前能力与严格限制

- 本次 **仅**对原始备份 JSON 的完整性和提取字节进行独立校验，不触发生产软件导入，更不进行腾讯云迁移。
- SHA-256 仅检测文件是否被意外修改，**不是身份认证签名**；攻击者若同时篡改数据及散列值，仍可能伪造一份内部一致的文件。真正迁移需服务器收据/授权。
- “字节等价的原始导出文件”不等于“当前正式版导入后每一条记录、未知字段都无损恢复”。已有导入器进行 defaults 合并与数据钳制，必须在**完全隔离、可回滚的 PWA/浏览器上下文**进一步核验。
- 完整包包含用户购买和成长等隐私数据。不得上传至 GitHub 仓库、CloudBase 静态托管、开发对话或任何其他共享空间。测试页仅允许用户自己通过本地文件选择器读取。
- 没有用户明确许可不得创建真实测试宝宝、运行 019/020、上传历史、修改生产 `main` 或用户手机上的 `localStorage`。
- 本次通过后，再设计服务器幂等迁移收据、历史字段映射、异常恢复与两个设备导入去重；不能把“备份有效”直接当作 `verifyHistoryClearance` 的后端证明。

## 本轮测试验收证据

- 已有真实 v1.1.2 导出器源代码位置：`index.html` 第 720 行；导入替换逻辑第 721 行。测试工具源代码只在 Feature 分支。
- 8 组 vault 测试 + 4 组浏览器静态与语法合约测试；与原回归相加 **316/316 JS PASS**，PostgreSQL 隔离合同保持 PASS。
- 用户浏览器对自己原始 JSON 的手动校验 **尚待执行**，不能预先标为 `PASS_REAL`。
