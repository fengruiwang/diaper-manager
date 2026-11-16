小宝管家 V1.2.0｜P4-03B 参考价单项写入测试包（待审核，禁止直接发布）

业务源码基线：18813363df77cde76a83929cc2ef55df7f97dda7
测试包版本：1881336
本 GitHub 产物尚未上传腾讯云。本轮没有修改真实数据库、授权或业务数据。
WARNING：本包内测试控制器 FORMAL_WRITE_ENABLED=true，仅供独立审核批准后的测试部署。
Feature 源正式控制器 FORMAL_WRITE_ENABLED=false / FORMAL_PURCHASE_ENABLED=false；
本包 FORMAL_PURCHASE_ENABLED=false，且仅有 reference UI + referenceOnly 文档队列开放。
特别注意：SQL 026 文档 PUT 是五类共用 RPC；数据库层的 GRANT 并不限制 kind=reference。

=== 首次真实写入前：必须单独审核批准 ===
1. 用户明确批准：测试包上传、数据库最小 GRANT、一个真实参考价变更及恢复。
2. 在原正式 primary 中明确：品牌、系列、尺码、该键原有无自定义覆盖、
   原覆盖值或默认值、拟修改的实际价格、还原方式。
3. 保持 SQL 027 和 009 权限不变；不创建 S140 / 不迁移历史 / 不启动其他写入。
4. 仅在获批后，由操作者在 CloudBase PostgreSQL 控制台手动执行：
   GRANT EXECUTE ON FUNCTION public.xb_put_primary_document_draft(
     uuid,uuid,text,bigint,uuid,jsonb) TO authenticated;
   如需撤销（需单独执行）：
   REVOKE EXECUTE ON FUNCTION public.xb_put_primary_document_draft(
     uuid,uuid,text,bigint,uuid,jsonb) FROM authenticated;
   注意 REVOKE 不回滚已保存值、修订号或操作流水；两个前端标记也不是数据库 ACL。

=== 上传方法：获批前不要操作 ===
腾讯云 CloudBase 原静态托管：/xb-test/formal/
从本 ZIP 一次性覆盖 3 个同级程序文件：
  index.html
  m1-controller.js
  formal-controller.js
README_UPLOAD.txt 仅供阅读，不上传；不得混用旧版本页面和 JS。
访问原测试域名 /xb-test/formal/?p4=1881336
F12 > Network > Disable cache > Ctrl+Shift+R，确认页面和两个 JS 都 HTTP 200。
页面源标记 xiaobao-p4-03b-source-sha = 18813363df77cde76a83929cc2ef55df7f97dda7
Console 安全检查（只查看状态，不修改数据）：
console.table({
 sha:document.querySelector('meta[name="xiaobao-p4-03b-source-sha"]')?.content,
 state:document.body.dataset.formalState,
 documentsVerified:/五类共享文档已验证/.test(document.getElementById('formalSyncState')?.textContent||''),
 referenceTestEnabled:window.XBFormalAppModule?.FORMAL_WRITE_ENABLED===true,
 purchaseWriteDisabled:window.XBFormalAppModule?.FORMAL_PURCHASE_ENABLED===false
});
真实写入前 documentsVerified 应为 true；不发采购/消耗/盘点/其他四类文档操作。

=== 单条参考价的真实验收（仅下一轮批准后）===
A 登录，确认五文档已验证和无文档未确认队列。
记录指定品牌/系列/尺码的原价、是否已有 referenceOverrides 键、reference revision。
A 只更改 1 个真实价格，保存 1 次（不要连点）。
检查保存 ACK、同一 request UUID 的回执 COMMITTED、reference revision +1。
B 刷新读取同一个覆盖价和 revision；A 再刷新，双方内容和 revision 相同。
查询原 request UUID 回执，确保没有第二次写入；出现网络不确定时禁止重新
生成 UUID，使用「重新核验待确认操作」复用既有队列。
恢复：
  - 原来已有自定义覆盖：在同键重新设置为原自定义数值。
  - 原来没有自定义覆盖：仅对当前键使用「恢复默认价」(reference.reset)。
  - 不得重置整个目录、品牌/系列、其他尺码。
恢复是新的写入，会再产生一个 UUID 和 revision +1，不能还原为旧 revision 0。
最后 A/B 各刷新一次，确认值和修订号一致。

=== P4-02B 只读版回退（本轮提交保留完整 3 文件）===
仓库路径：deploy/xb-test/p4-02b-readonly-rollback/
本次 GitHub Actions 提供单独 ZIP Artifact「XiaoBao-P4-02B-READONLY-ROLLBACK」。
也可从 Feature 历史提交 eb2658bfe41e1b2ea3355552671af7c411863222
中获取 deploy/xb-test/formal/ 原三文件。
需恢复时三文件一次性覆盖回原 /xb-test/formal/，强刷并核对：
FORMAL_WRITE_ENABLED=false 与 FORMAL_PURCHASE_ENABLED=false。
如有 pending/ambiguous request，先保留原浏览器 IndexedDB 和 UUID，
核实回执再回退；不要清理缓存或重新生成请求。
数据库写入 GRANT 不会随静态文件回退自动撤销，必须按单独授权流程处理。

不触碰 main、GitHub Pages 正式 V1.1.2 或腾讯云其他目录。
