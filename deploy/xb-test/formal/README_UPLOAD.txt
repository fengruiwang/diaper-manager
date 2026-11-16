小宝管家 V1.2.0｜P4-02B 五类共享文档只读页面状态最小修复包
业务源码 SHA：c5293a56c5ff4a9f59e82b53da15f84c0908a28b
版本参数：c5293a5
本包仅修复页面五文档读取状态，未修改任何数据库、RPC、登录或业务写入。

只上传本目录 3 个文件到原腾讯云 CloudBase 静态托管：
/xb-test/formal/index.html
/xb-test/formal/m1-controller.js
/xb-test/formal/formal-controller.js
三文件必须一次性覆盖；README_UPLOAD.txt 不需要上传。
不要改动 /xb-test/ 其他目录、GitHub main、正式 V1.1.2、S140。

部署包的页面脚本路径已调整为同级：
./m1-controller.js?v=c5293a5
./formal-controller.js?v=c5293a5
千万不要把原 preview/v1.2.0/formal/index.html (../ 路径) 单独上传。

访问原测试域名 /xb-test/formal/?p4=c5293a5
F12 -> Network -> Disable cache -> Ctrl+Shift+R，确认上面两个 JS 返回 HTTP 200。

登录账号 A、B 分别查看：
1. 等待页面出现「正在核验五类共享文档」；
2. 成功后出现「正式宝宝及五类共享文档已验证」；
3. 如果显示「读取失败或超时」，点击「刷新云端数据」重试；
4. 页面不得在尚未验证时宣称实时双端同步。
账号 A/B 已在上轮完成真实 RPC 20/20 和内容一致性验收；无需重做全部四轮 Console 测试或 SQL 结构核查。
建议 A 账号测试一次正常加载和一次刷新，B 账号测试一次正常加载即可。
仅把页面文字/下方只读 Console 结果发回，不要发送账号、UUID 或宝宝隐私资料。

Console 只读状态核对：
console.table({
 sourceSHA: document.querySelector('meta[name="xiaobao-p4-02b-source-sha"]')?.content,
 pageState: document.body.dataset.formalState,
 fiveDocumentsVerified: /五类共享文档已验证/.test(document.getElementById('formalSyncState')?.textContent || ''),
 documentWritesDisabled: window.XBFormalAppModule?.FORMAL_WRITE_ENABLED === false,
 purchaseWritesDisabled: window.XBFormalAppModule?.FORMAL_PURCHASE_ENABLED === false
});
必须确认 sourceSHA=c5293a56c5ff4a9f59e82b53da15f84c0908a28b，两个写入开关均 false，pageState=ready。
真实 A/B 页面成功才可给 UI PASS；本包 CI 成功不能替代真实浏览器结果。

本包仅源码和 CI 打包，不会自动上传腾讯云；
禁止写入 RPC、GRANT/REVOKE、SQL 026/027、采购/盘点、迁移及测试宝宝操作。
