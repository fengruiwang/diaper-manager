# 小宝管家 v1.2.0 — P2-3A 真实 CloudBase 只读诊断验收手册

更新：2026-11-11。状态：**A 管理员 10/10 PASS；B 老婆独立账号全部 PASS（按本测试10项记账）；手机新浏览器匿名检查 6 PASS + 1 项拒绝来源未分类，严格整体仍 INCONCLUSIVE。**

## 首次真实测试反馈与正确解读

- A 管理员已经登录时执行④：**10/10 PASS_REAL**，家庭、成员、xb 授权、四张空业务表和两次非法读取 RPC 拒绝均正确。
- 用户自认为未登录时执行④也得到 **10/10 PASS**，但 `authenticated_session=SESSION_PRESENT`。这代表此浏览器其实存在有效 CloudBase 会话；不能算匿名测试，也不能证明是配偶 B 账号。
- 执行②匿名检查仅返回 `anonymous_session=BLOCKED(LOGIN_SESSION_PRESENT_USE_PRIVATE_WINDOW)`。工具发现已有会话后主动阻断，**没有执行匿名数据访问或 RPC**；既不是匿名验收成功，也不意味着发生越权。
- **测试余项：匿名账户 7 项与 B 成员独立 10 项。管理员 A 不必再次登录或重测。**
- CloudBase Web SDK v3 的登录状态由 `auth.getSession()` 返回的 `data.session` 判断，不能以当前页面是否刚刚输入过 OTP 为准。

## 手机新浏览器复测（最新真实反馈）

- 未登录状态点击④：`BLOCKED(LOGIN_REQUIRED)`，是正确拦截。用户手动抄录可能将字段 `authenticated_session` 写为 `anonymous_session`，不影响诊断。
- ② 匿名检查中 6 项 `PASS`：`NO_SESSION`、家庭及四张业务表拒绝访问。既有登录会话污染问题已经解决。
- 剩余 `anonymous_reconciliation_rpc=INCONCLUSIVE(DENIED_UNCLASSIFIED)`：这不是 RPC 成功，而是服务端返回拒绝信号，但 CloudBase SDK 没有保留或暴露函数体预期的 `authentication_required` 文本。测试工具在无法确认拒绝来源时故意不把它当作函数内部拒绝已证实。**不应反复重试、不需要重跑任何数据库 SQL。**
- 记录实际情况为“匿名访问结果没有泄露数据，拒绝来源仍需后续专项验证”。A 管理员与 B 家庭成员的 10 项检查均已由用户反馈通过，**不必再测**。
- 切勿为取得 7/7 PASS 而把 `INCONCLUSIVE` 强行改为通过，或跳过真正的 RPC 函数体权限验证。P2-3B/C 真实业务写入仍未授权。

## B 账号真实结果（最新）

用户反馈老婆在本人设备/账号运行了这组检查，结果**全部 PASS**。承接既定的 10 项已登录成员只读检查，记为 B 10/10 PASS_REAL（用户提供的是汇总反馈而非逐项截图），无需重新获取验证码或重复测试。A 管理员 10/10 PASS_REAL 也保持。

**当前仍未关闭的 P2-3A 安全点**是匿名只读 RPC 返回 `DENIED_UNCLASSIFIED`（请求拒绝但不能区分网关 ACL 与函数体鉴权）；这不是成功读取或已证实的漏洞。不要为追求“全部 PASS”反复测试或放松拒绝判断。P2-3B/C 的真实数据库业务写入仍需另行授权。

## 目的## 目的

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

1. **推荐 Chrome 浏览器 → 右上角头像 → 添加/打开访客（Guest）窗口**，这样与原账号浏览器存储完全隔离；或先关闭**全部**现存的无痕窗口，再新开无痕窗口。同一批无痕窗口共享会话，单独新开一个无痕标签未必匿名。连接相同测试页，只输入环境 ID 与客户端 Publishable Key；**不要登录，也不要退出原账号或清除原浏览器数据**。
2. 点击②“检查匿名权限”；预期 **7 个检查状态全部 PASS**：无会话、匿名对家庭与 4 张业务表均不可见/被拒绝，以及匿名只读 RPC 返回 `authentication_required`。
3. 如果仍显示 `BLOCKED: LOGIN_SESSION_PRESENT_USE_PRIVATE_WINDOW`，说明当前浏览器上下文仍有登录会话；**不要为了通过测试而登出原账号或清除浏览器数据**。更换独立 Guest 窗口；如仍 BLOCKED，把状态反馈开发对话，不要尝试关闭安全检测。
4. 如果错误在 SDK 层被包装导致无法辨识确切拒绝原因，页面会报 INCONCLUSIVE，而不会自动当作 PASS；仅反馈字段名及安全错误码。

### 反馈给开发对话

只需反馈 `A: PASS/FAIL/INCONCLUSIVE；B: ...；anon: ...`。若有非 PASS 项，复制页面的**检查名称、状态及短码**；不复制 Token、验证码、完整请求、真实 UUID、邮箱或 Key。

## 测试通过后仍未完成的事情

- 没有真正执行 `xb_apply_inventory_operation` 写入 RPC，尚未测试采购流水/库存原子性与幂等。
- 没有创建专用虚拟宝宝/库存；P2-3B 需要先设计与审核，不允许直接写入原有家庭主宝宝。
- 夫妻真机双端增量补传、断网和 ACK 重传、全业务同步、v1.1.2 历史迁移、正式发布仍未完成且未授权。
- 不要把“静态 SQL PASS”和“只读诊断 PASS”写成正式产品已经联网同步。
