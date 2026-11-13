小宝管家 V1.2.0｜P1-01 五页面正式数据只读审查｜腾讯云静态托管包
正式功能代码源提交：92c7923676b5fd1dd6b8cd2b4de111c21af14d2a
版本号：92c7923

本次变化：
- 对齐 HTML 内嵌投影与源模块，保留云端采购 operationId/reversed 字段。
- 共享文档覆盖层绑定已验证的 primary 家庭和宝宝 ID；不匹配不覆盖。
- 首页提示区明确区分历史迁移快照、内置参考价和未验证共享文档。

部署目标：沿用原腾讯云 CloudBase 静态托管域名，目录 /xb-test/formal/
必须同时上传并覆盖三个同目录文件：
  index.html
  m1-controller.js
  formal-controller.js
README_UPLOAD.txt 仅供本地阅读，无需上传网站。

访问原测试域名（不要更换到 Cloudflare）：
https://<原腾讯云静态托管域名>/xb-test/formal/?p1=92c7923

Console 核验：
console.table({
  sourceSHA: document.querySelector('meta[name="xiaobao-p1-source-sha"]')?.content,
  appMode: window.XBFormalApp?.mode,
  writesDisabled: window.XBFormalAppModule?.FORMAL_WRITE_ENABLED===false
});
预期 sourceSHA=92c7923676b5fd1dd6b8cd2b4de111c21af14d2a
已登录时 appMode=ready，正式业务写入应保持 false。
Network 勾选 Disable cache，Ctrl+Shift+R，两个 JS 必须返回 HTTP 200。

浏览器验收：
1. 同一正式家庭/宝宝，无 S140 混入。
2. 历史采购 10 笔与库存六尺码一致，采购历史不重算库存。
3. 总览、历史统计和已支出金额来源正确。
4. 参考价、历史候选价、成长、宝宝资料、个性设置与原迁移数据一致；共享文档未验证时明确标注。
5. F5/标签切换后无未核验家庭信息闪现，正式写入仍关闭。

本包不包含数据库修改、不执行 SQL 或历史迁移、不合并 main，
不修改 V1.1.2、不推进 P1-02/P2。真实验收只能由用户在原腾讯云域名完成。
