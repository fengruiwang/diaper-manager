# 小宝管家 v1.2.0 — P2-3C 登录身份与上传闸门只读测试

日期：2026-11-11。状态：**用户真实电脑截图与手机实测均返回 AUTH_PASS_UPLOAD_BLOCKED，四项只读权限 PASS，上传闸门 BLOCKED（预期）；未启用上传。**

## 已取得的真实测试结果（无需重复）

用户在电脑截图中提供的结果：

| 检查项 | 实际结果 |
|---|---|
| 总体 | `AUTH_PASS_UPLOAD_BLOCKED` |
| session | `PASS (SESSION_PRESENT)` |
| family | `PASS (ONE_VISIBLE_FAMILY)` |
| member | `PASS (MEMBERSHIP_VERIFIED)` |
| grant | `PASS (XB_GRANT_VERIFIED)` |
| upload_gate | `BLOCKED (DURABLE_BASELINE_NOT_VERIFIED)` |

用户反馈在手机上得到相同结果。以上是**正确的安全闸门验收**；不要求再次上传文件、再次登录或重测。测试页本身没有登录表单，仅通过 CloudBase SDK `getSession()` 检查该设备浏览器里**已有**的有效会话；电脑/手机都存在会话，因此未弹出 OTP 是合理的。正式 PWA 的多日会话保活、token 自动刷新仍未验收。

本次页面隐藏账号 UID、家庭 ID 和角色，故不能仅凭结果完全相同确定两个设备登录了不同账号；此点不会推翻既有 P2-3A A/B 双账号分别验证的结果。未来诊断可以安全显示 `管理员/家庭成员`，不显示可识别标识。

**本次成功不证明库存初始基线完成。** `initialized:false` 依然是手动关闭的安全开关；实际库存与离线队列对齐是下一独立工程环节。尚无 CloudBase 测试宝宝及购买记录写入授权，继续保持 `019/020` 不在真实库执行。

## 测试意义

过去 P2-3A A/B 用户已完成各 10/10 只读权限检查，但库存 Outbox 的 `verifyAccess` 尚无真实 SDK 实现，更没有独立确认客户端是否已完成持久库存初始化。本轮先建立一个**不能开启上传的安全前置检查器**。

- `sync/cloudbase-access-preflight.js` 只通过 `auth.getSession()` 读取登录身份，必须与 `actorUid` 相等，并使用 RLS 对 `families`、`family_members`、`family_app_access` 发起当前成员范围的只读 SELECT。它的 `initialized` **永久返回 false**，代表“尚未证明持久库存基线”，不是声称服务器上没有数据。
- `cloudbase/smoke/p2-upload-readiness-bridge.js` 只在手动点击时组合上述只读核验；不显示任何 UID、家庭 ID、Token 或客户端 Key。
- `cloudbase/smoke/p2-upload-readiness.html` 是独立测试页，所有真实创建、上传、迁移按钮均禁用。不加载到正式 v1.1.2。
- `tests/p2-cloudbase-access-preflight.test.cjs` 和 `tests/p2-upload-readiness.test.cjs` 通过合成 SDK 确认：身份不符、成员缺失、app grant 撤销、网络错误均不能通过；即使手动传 `uploadEnabled:true` 给现有 outbox runner，也会因 `initialized:false` 停止且不会调用真实库存写入。

## 本轮测试文件（共 3 个，保持原文件名）

1. `cloudbase/smoke/p2-upload-readiness.html`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/cloudbase/smoke/p2-upload-readiness.html
2. `cloudbase/smoke/p2-upload-readiness-bridge.js`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/cloudbase/smoke/p2-upload-readiness-bridge.js
3. `sync/cloudbase-access-preflight.js`
   https://github.com/fengruiwang/diaper-manager/blob/feature/cloudbase-sync-v1.2.0/sync/cloudbase-access-preflight.js

三份文件全部上传到 CloudBase **现有专用静态测试目录 `xb-test/`**，不可上传至正式站点根目录、不可覆盖 `auth-test.html`、`p2-readonly-test.html`、`p2-smoke-preview.html`、Service Worker 或正式 PWA。

## 用户逐步测试与预期

1. 在 GitHub 开发分支各自打开上面 3 个文件 → `Raw` → 保存，保留原名，保证不会被系统自动保存成 `.txt`。
2. 打开腾讯云 `xiaobao-family` → 静态网站托管 → 原有独立测试文件夹 `xb-test/`，只上传这 3 个文件。**无 SQL 操作，也不进行任何新业务数据库 DDL。**
3. 用 A 账号已有会话的浏览器打开 `https://<原静态站点域名>/xb-test/p2-upload-readiness.html`，输入环境 ID 和客户端 Publishable Key，点击“连接”；Key 会在初始化后从输入框清空。绝不输入服务端 API Key、管理员密码。
4. 点击“执行安全前置检查”。预期：
   - 总体 `AUTH_PASS_UPLOAD_BLOCKED`；
   - `session=PASS(SESSION_PRESENT)`；
   - `family=PASS(ONE_VISIBLE_FAMILY)`；
   - `member=PASS(MEMBERSHIP_VERIFIED)`；
   - `grant=PASS(XB_GRANT_VERIFIED)`；
   - `upload_gate=BLOCKED(DURABLE_BASELINE_NOT_VERIFIED)`。
   最后一项 **BLOCKED 是预期的安全结果**，不是程序失败。程序没有真正检查或创建库存初始基线。
5. B 用户在自己已登录的浏览器执行相同第 3、4 步；如没有会话，此页应只返回 `LOGIN_REQUIRED`，不会自动登录或发验证码，可沿用已经验收的 P2-3A 登录页，不需要重新创建家庭或邀请码。预期 B 也得到 `AUTH_PASS_UPLOAD_BLOCKED`。
6. 将两台手机的整体状态以及 5 个检查名称/状态发回开发对话即可；若 `INCONCLUSIVE` 只复制安全短码。不要分享真实 UID、家庭 UUID、Token、Key、邮箱、验证码或完整 Network 日志。

## 不能做的事

- 不执行 SQL 019/020、不创建虚拟宝宝、不调用 `xb_apply_inventory_operation`、不做采购 +60/+80 真实上传。
- 不启用 Outbox 写入、不修改正式 `main`、不清除旧手机 localStorage、不合并/发布正式站点。
- 不因为四项授权检查 PASS 就把 `initialized` 改成 true；下一阶段需要设计真正的 IDB + 服务端库存**按宝宝/六尺码的可验证基线握手**。
- 未获得用户对真实云端测试数据写入的单独授权前，所有实际库存和购买测试仍只能使用 PG16 独立数据库或纯合成模拟。

## 通过后剩余工程

- 经服务器授权的 owner-only 虚拟测试宝宝创建接口仍为 SQL 草案，未部署。
- 真实库存基线初始化前必须明确孩子归属、初始六尺码数量、服务器 revision 和当前设备空 outbox 的一致性；不得强制清空既有 pending 队列。
- 现有 `inventory-outbox-runner` / `inventory-sync-reader` 需要把 preflight `initialized:false` 扩展为真正经过审查的 baseline proof，才考虑开启任何上传；该证明不能来自按钮选择或可随意改写的 localStorage 状态。
- 真正两设备购买、断网补传、采购编辑和旧版历史迁移都属于后续独立阶段。
