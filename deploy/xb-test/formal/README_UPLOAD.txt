小宝管家 V1.2.0｜P4-02B 真实 CloudBase 五类文档只读集成验收
代码来源 Feature SHA：79d39a4dc718ebae0f561914afb50f139a473153
本文件夹内容生成自 Feature 最新源文件；此部署包本身不会上传腾讯云。

仅上传本文件夹中的 3 个文件到原腾讯云 CloudBase 静态托管 /xb-test/formal/：
  index.html
  m1-controller.js
  formal-controller.js
请一次性覆盖这 3 个文件。README_UPLOAD.txt 无需上传。
不要修改 /xb-test/ 其他目录；不要触碰现行 GitHub Pages/main/V1.1.2。

注意：仓库原始 preview/v1.2.0/formal/index.html 使用上级路径 ../ 脚本。
此部署包已经将脚本改成同级 ./m1-controller.js、./formal-controller.js，
并添加版本参数 ?v=79d39a4，适配原有 CloudBase 同级三文件上传目录。
切勿将未加工的原始 HTML 与此部署包的 JS 混用。

上线后先在原域名访问：/xb-test/formal/?p4=79d39a4
按 F12 → Network → Disable cache → Ctrl+Shift+R，
核对页面 200、m1-controller.js?v=79d39a4 200、
formal-controller.js?v=79d39a4 200。

然后在 Console 输入以下只读状态核对（不包含私密信息）：
console.table({
  sourceSHA: document.querySelector('meta[name="xiaobao-p4-02b-source-sha"]')?.content,
  gate: document.body.dataset.formalState,
  documentWritesDisabled: window.XBFormalAppModule?.FORMAL_WRITE_ENABLED === false,
  purchaseWritesDisabled: window.XBFormalAppModule?.FORMAL_PURCHASE_ENABLED === false,
  documentsVerifiedInUI: /五类共享文档已验证/.test(document.getElementById('formalSyncState')?.textContent || '')
});
预期 sourceSHA=79d39a4dc718ebae0f561914afb50f139a473153，两个 WritesDisabled 均为 true。
成功登录并完成读取后，gate=ready 且 documentsVerifiedInUI=true。

依次使用账号 A、账号 B 在各自浏览器登录并运行额外提供的
P4-02B 五文档只读核验脚本（独立控制台脚本，无须上传腾讯云）。
只将每个文档的 status/revision/迁移基线标志/脱敏摘要传回，
不要上传账号、邮箱、UUID、宝宝资料、候选价、库存具体数值。
分别核验：首次登录、刷新、退出后重登/会话恢复。
同一家庭的 scopeTag、各文档 revision 与 bodyTag 应一致。
readAll 若失败，不能算五类文档真实读取 PASS。

严禁测试中调用写入 RPC、GRANT/REVOKE/SQL DDL、批量盘点、
采购/消耗/撤销、创建宝宝或迁移历史记录。
真实 A/B PASS 需实际结果，CI 成功不能替代。
