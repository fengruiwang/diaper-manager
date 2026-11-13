小宝管家 V1.2.0｜P1-01 Chrome 兼容性修复｜腾讯云静态托管部署包

功能源代码 SHA：0f7e50b365ab6f7b23e699f5ee78c00981d627f3
版本参数：0f7e50b

本次修复仅将正式五页面调用链中的 Object.hasOwn(obj, key)
替换为 Object.prototype.hasOwnProperty.call(obj, key)。
没有新增全局 Polyfill，没有修改任何数据、权限、认证或正式写入配置。

在原腾讯云 CloudBase 静态托管网站的 /xb-test/formal/ 目录中，
一次性覆盖上传以下 3 个文件（与 index.html 位于同级）：
- index.html
- m1-controller.js
- formal-controller.js
README_UPLOAD.txt 仅供查看，不需要上传。

访问原腾讯云域名：
https://<原腾讯云测试域名>/xb-test/formal/?p1=0f7e50b

浏览器使用 F12 → Network → 勾选 Disable cache，Ctrl+Shift+R 刷新。
核对 2 个脚本：
/xb-test/formal/m1-controller.js?v=0f7e50b
/xb-test/formal/formal-controller.js?v=0f7e50b
状态均须为 HTTP 200。

在 Console 输入：
console.table({
 sourceSHA: document.querySelector('meta[name="xiaobao-p1-source-sha"]')?.content,
 pageState: document.body.dataset.formalState,
 writesDisabled: window.XBFormalAppModule?.FORMAL_WRITE_ENABLED === false
});
sourceSHA 预期：0f7e50b365ab6f7b23e699f5ee78c00981d627f3
成功登录后的 pageState 应为 ready，writesDisabled 应为 true。

请分别使用 Chrome 与 Edge 验证：
1. 已登录账户刷新后进入正式五页面；
2. 10 条历史记录与六尺码库存一致，无重复累计；
3. 设置、参考价、成长数据一致；
4. 未混入 S140，正式业务写入仍关闭。

本包只打包 GitHub 已提交代码，未自动发布腾讯云；
不要清除浏览器本地数据，不执行迁移 SQL。
P1-01 真实 Chrome/Edge 验收须由用户完成。
