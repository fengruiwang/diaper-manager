小宝管家 V1.2.0｜P4-03D 参考价保存即时反馈测试包（仅供审核，禁止直接上传）
源码基线 SHA：788f1e8bbfb3cdc6a54c8448e722987a800f5c6e
最新 Feature 打包提交见 GitHub Actions。脚本版本：788f1e8

本轮仅准备代码/测试包，未执行 CloudBase GRANT、REVOKE、PUT，也未上传腾讯云。
真实 P4-03C 参考价已恢复默认，revision 已为 3；数据库 document_put_allowed=false。
该包内 FORMAL_WRITE_ENABLED=true 仅供将来单独批准时上传；
FORMAL_PURCHASE_ENABLED=false、referenceOnly=true，其他四类文档和采购/盘点 UI 仍关闭。
正式 Feature 源控制器依旧双开关 false，main/V1.1.2 未改动。
SQL 026 文档 PUT 共用五类，不会因前端 referenceOnly 限制而自动只授权 reference。

打包文件（必须整套使用，批准前禁止上传）：
  index.html
  m1-controller.js
  formal-controller.js
README 不需要上传。只有用户和独立审核明确批准后才可三文件覆盖原
腾讯云 /xb-test/formal/。不要把不同版本的 index.html/JS 混用。

获批部署后访问 /xb-test/formal/?p4=788f1e8，
浏览器 F12 / Network 勾选 Disable cache，Ctrl+Shift+R 强制刷新。
确认两个 JS 均 HTTP 200。meta[name="xiaobao-p4-03d-source-sha"]
应为 788f1e8bbfb3cdc6a54c8448e722987a800f5c6e。
此次关注：点保存后立即显示「正在检查价格与版本」，按钮被禁用；
保存中可看见「本地持久队列」「回执/云端提交」「云端读回」阶段提示；
只有保存结果 REFERENCE_CLOUD_READBACK_VERIFIED 才显示成功；
ACK 不明确则保留原 UUID、按钮显示「待确认，请勿重复保存」并禁用，
可通过已有「重新核验待确认操作」检查，不得重新点击生成另一笔；
表单 Enter 与保存按钮 click 不可触发两次；冲突/失败保留原输入。
Console 仅会在成功后记录阶段耗时（ms），不包含邮箱、家庭 ID、价格或 UUID。

本阶段未安排真实重写，P4-03C 已有真实 A/B 结果不必重复。
后续获准最小浏览器测试：一次正常保存、一次快速连点/Enter 模拟、
一次刷新确认 B 同步；如需修改真实参考价必须再次单独批准具体值。

回退：独立 GitHub Actions Artifact「XiaoBao-P4-02B-READONLY-ROLLBACK」，
或仓库 deploy/xb-test/p4-02b-readonly-rollback/。
三文件完整覆盖原测试目录，核对两个开关 false。
注意上传回退页面不撤销数据库 GRANT；数据库权限须单独审核执行撤销。
不要清浏览器 IndexedDB 或丢弃待确认原 UUID。
