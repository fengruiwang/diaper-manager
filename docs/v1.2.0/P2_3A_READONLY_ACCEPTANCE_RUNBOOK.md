# 小宝管家 v1.2.0 — P2-3A 真实 CloudBase 只读诊断验收手册

更新：2026-11-11。状态：**开发分支代码和模拟回归已准备；尚未上传到 CloudBase 静态托管，尚未执行真实浏览器联调。**

## 目的

对已完成 P2-1 的现有 `xiaobao-family` PostgreSQL 17.11 共享环境，只进行**读表、查看现有登录会话、只读一致性 RPC 的拒绝测试**。不调用 `xb_apply_inventory_operation` 采购写入 RPC。

核验四项：

1. 无登录时不能读取家庭、宝宝、库存及采购数据。
2. 家庭已有成员 A/B 各自能够使用已有登录会话读取自己家庭的成员数和 xb 授权数，且首次部署的业务表仍为空。
3. `xb_read_inventory_reconciliation` 在“当前家庭 + 合成的不存在宝宝 ID”时拒绝；在“合成的其他家庭 ID”时拒绝，且不会写库存。
4. SDK、HTTP 网关、RLS、函数体鉴权中出现不确定或失败时显式报告，不误记为通过。

CloudBase 官方安全提示：PostgREST 网关可能不强制执行 SQL `GRANT EXECUTE`；本轮必须看真正的 RPC 服务端拒绝，而不能只看 018/012 的静态检查。<https://docs.cloudbase.net/database/postgresql/rpc>

## 代码与部署隔离

- `cloudbase/smoke/p2-readonly-test.html`：独立用户操作界面。
- `cloudbase/smoke/p2-readonly-diag.js`：仅包含 `SELECT` 和 `xb_read_inventory_reconciliation` 调用的独立诊断模块。
- `tests/p2-readonly-browser-diagnostics.test.cjs`：假 CloudBase SDK 事务隔离测试，保证无直写、无写 RPC、无会话主动退出、无用户标识输出。
- 所有文件只在 `feature/cloudbase-sync-v1.2.0`。**没有修改生产 index.html、PWA SW、正式页面、localStorage 旧版键。**
- 新诊断页初始不做任何网络/业务请求；点击“连接”才加载 CloudBase JS SDK，点击某个检查按钮才查询。
- SDK 会负责其自己的登录会话存储；诊断页本身不使用 localStorage 存储 Key/邮箱或输出 Token。
- 不自动发送 OTP、不自动登录、也不提供“退出当前账号”按钮。已有会话应尽量复用，符合用户免反复登录的长期目标。
- 仅允许使用**客户端 Publishable Key**，严禁服务端密钥、生产数据库管理凭据。
- 不为测试新增任何家庭、宝宝、采购或库存；不重跑已完成的 005-018 DDL；不迁移 v1.1.2 数据。

## 手动部署到隔离测试目录（需要用户主动上传，不是正式发布）

1. 在 GitHub `feature/cloudbase-sync-v1.2.0` 分支下载**上面的两份** `p2-readonly-test.html`、`p2-readonly-diag.js`，文件名保持不变。
2. 打开腾讯云 CloudBase 环境 `xiaobao-family` → 静态网站托管，找到原来的专用测试目录 `xb-test/`。确认不是生产站点根目录；**仅在 `xb-test/` 上传这两份文件**，不要覆盖 `auth-test.html`、`idb-offline-test.html`、`idb-offline-sw.js`、正式 PWA 文件。
3. 通过独立 HTTPS 测试地址打开 `.../xb-test/p2-readonly-test.html`。确认标题为“小宝管家 · P2-3A 云端只读诊断”。若上传失败，反馈状态，不重建测试目录或清理其他文件。
4. 按页面提示填写现有 CloudBase 环境 ID 和 Publishable Key；Key 只在当前输入时使用，页面完成初始化会清空输入。

## 实测顺序（用户每阶段反馈后再推进）

### A. A 管理员 / B 已有成员（分别在自己设备）

1. 同一独立测试 HTTPS 页面打开；按下“连接”。如果 SDK 找到有效登录会话，直接运行④。
2. 若没有登录，使用**已有家庭成员邮箱**在③主动请求并填写验证码，完成后运行④。OTP/邮箱/Session 不传给开发对话。
3. 预期 **10 个检查状态全部 PASS**：有效 session、1 家庭、2 家庭成员、2 项 xb 授权、4 张业务表为零记录，以及“合成不存在宝宝”和“合成其他家庭”两次只读 RPC 都被正确拒绝。
4. 任何 FAIL 立即停止；INCONCLUSIVE 记录对应字段和精简代码，等待排查。不清空缓存、不退出正式 PWA、不动旧版数据。

### B. 无登录 / anon（全新的无痕窗口）

1. 新开真正的无痕窗口（不能复用已登录的普通页面），连接同一测试目录，只输入环境 ID 与客户端 Publishable Key；**不要登录**。
2. 点击②“检查匿名权限”；预期 **7 个检查状态全部 PASS**：无会话、匿名对家庭与 4 张业务表均不可见/被拒绝，以及匿名只读 RPC 返回 `authentication_required`。
3. 如果显示 `BLOCKED: LOGIN_SESSION_PRESENT_USE_PRIVATE_WINDOW`，说明当前测试容器有登录状态；不要直接退出原账号，换新无痕窗口再试。
4. 如果错误在 SDK 层被包装导致无法辨识确切拒绝原因，页面会报 INCONCLUSIVE，而不会自动当作 PASS；仅反馈字段名及安全错误码。

### 反馈给开发对话

只需反馈 `A: PASS/FAIL/INCONCLUSIVE；B: ...；anon: ...`。若有非 PASS 项，复制页面的**检查名称、状态及短码**；不复制 Token、验证码、完整请求、真实 UUID、邮箱或 Key。

## 测试通过后仍未完成的事情

- 没有真正执行 `xb_apply_inventory_operation` 写入 RPC，尚未测试采购流水/库存原子性与幂等。
- 没有创建专用虚拟宝宝/库存；P2-3B 需要先设计与审核，不允许直接写入原有家庭主宝宝。
- 夫妻真机双端增量补传、断网和 ACK 重传、全业务同步、v1.1.2 历史迁移、正式发布仍未完成且未授权。
- 不要把“静态 SQL PASS”和“只读诊断 PASS”写成正式产品已经联网同步。
