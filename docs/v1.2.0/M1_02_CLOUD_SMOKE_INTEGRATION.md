# M1-02 隔离云端采购 UI 与原子库存队列｜开发交付（待真实写入审批）

开发基线：Feature \`f604ea90659dc1a41f1921c818fae07703d13746\`。本次只更新 Feature，不更改 main、正式 v1.1.2、正式 PWA 或腾讯云数据库。

## 已完成的开发代码（不等于真实云端验收）
- 直接复用 \`preview/v1.2.0/index.html\` 的原五页和既有“已购买 · 立即入库”、候选价入库入口；在“好价比对”添加**模式切换区域**，**不是新诊断页面**。
- 默认 **本机演练**。只有点击“进入隔离云端模式”，才检查当前会话的 RLS 家庭/xb 授权与固定测试标识 \`legacy_slot='__xb_smoke_v1__'\` 的未停用宝宝；\`primary\` 和其他宝宝不属于本模块。没有测试宝宝会拒绝云端模式，不会自动建记录。
- 模式切换时**两次读取 CloudBase 权威六尺码库存/revision**，并核验全部已确认购买流水与库存/revision 一一对应：仅允许不含消费、冲正、盘点的专用 smoke 采购账本初始化。家庭 B 首次加入时可根据 A 已经确认的 +60 合法建立 S=60 基线，不会把本机本地演练 +60 导入云端。
- 使用现有 \`XBInventoryClient\`、\`XBInventoryOutboxRunner\`、\`XBInventorySyncReader\`、\`XBDurableOutbox\`、\`XBInventoryProjection\`、\`XBInventoryReconciler\`、\`XBOutboxContract\`。客户端先 IndexedDB 原子提交带固定 UUID 的购买和本地库存，再尝试 CloudBase 原子 RPC；掉线/未知 ACK 保留原 ID，在线后从同一队列重试并读取服务端回执、reconciliation 及正式采购记录。
- 隔离测试 IDB 名为 \`xiaobao-v120-m102-smoke-idb-v1\`，按 \`familyId+actorUid+childId\` 区分设备/账号；不访问生产 \`localStorage['xiaobao_diaper_planner_v1']\`，不导入历史 JSON，不注册 PWA，不清理旧缓存。
- 云端模式下总览库存使用已核验云端/待同步 IDB 快照；“采购记录”改为服务端读取的两端共同列表。候选价、个人参考价和成长设置**仍为本机演练**，不可冒充全模块云同步。消费、盘点、撤销、清空功能在云端模式中明确禁止，防止沿用本机函数误改库存。
- 保留 Feature 最新的自动 Env ID + **客户端** Publishable Key 及 SDK-owned 会话；绝不把 SecretKey、服务端 API Key、验证码或用户数据入库提交。

## 当前硬闸门
\`preview/v1.2.0/m102-cloud.js\` 中 \`DEFAULT_WRITE_APPROVAL=false\`。即使上传新版静态页面、创建测试宝宝或者用户点击“已购买”，此版本的正常 UI 也不发送真实采购写 RPC。此常量是研发发布审批闸门，**不是数据库安全边界**；数据库端仍需原 RPC 鉴权、RLS、独立测试宝宝验证。审批后由开发分支新提交解锁测试 UI，并仅更新隔离托管文件。不得把 \`access-preflight.initialized=false\` 粗暴改为 true；M1-02 仅对双重源端核验且 IDB 持久初始化的专用 smoke 宝宝进行内部上传核验，正式宝宝始终禁止。

## 上传准备（无需更换静态服务）
本轮的修改文件：
1. \`preview/v1.2.0/index.html\` （内嵌 6 个现有同步模块以减少部署文件数）
2. \`preview/v1.2.0/m1-controller.js\` （保留自动公开 Key；只新增经真实家庭授权的上下文读取）
3. \`preview/v1.2.0/m102-cloud.js\` （受控 smoke 同步桥接）

上传时覆盖**腾讯云现有独立目录** \`xb-test/m1/\` 的前两份，新增第三份；**不要覆盖静态托管根目录**、GitHub Pages main 或旧版 PWA。此次静态上传本身不写业务数据库，但会有一般静态流量及只读 RPC 请求。仍需用户选择部署；没有自动替用户上传。尚无测试宝宝时显示 \`SMOKE_CHILD_NOT_READY\`，不要因为它而重部署已完成的 005–018 基础 SQL。

## 正式真实测试前必须另行获得的单独授权
### 阶段 A — owner-only 测试宝宝权限 RPC 的安装（DDL）
- 只考虑**现有** \`xiaobao-family\` PostgreSQL 共享集群；不新增腾讯云付费环境。先独立复核尚未部署的 \`019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql\`，明确是否批准执行。它会安装两个固定签名的 SECURITY DEFINER 函数 \`xb_create_smoke_child\` 和 \`xb_retire_smoke_child\`、函数执行 ACL；**安装时不创建宝宝/采购**。
- 再执行仅只读的 \`020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql\`，预期 18/18 true；异常立即暂停。不能为了加速跳过风险评估或静态权限验收。
- DDL 会短暂占用数据库元数据锁。现有云环境没有用户可验证的完整数据库回档备份，此风险必须再次明确接受，不适用先前 P2-1 的风险授权。

### 阶段 B — 创建及购买测试业务数据（DML）
- 家庭 owner A **单独确认**后由安全 RPC 创建一条 \`legacy_slot='__xb_smoke_v1__'\` 的测试宝宝；只允许同家庭 xb owner，服务端生成 child_id；不得由浏览器 INSERT。
- 核对 \`xb_children\` RLS 和专用标识过滤，确认未与 \`primary\`/迁移记录混淆。A/B 各登录不同身份，禁止重复创建家庭与成员。
- 需再次明确批准**两笔可审计的模拟采购**。升级 M1-02 测试页为显式许可写入版后：A +60、B +80，两个账号分别刷新权威 S=140、2 条购买流水；再验证同一操作 ID 幂等、不同 payload 拒绝、掉线待同步、恢复与冲突/权限拒绝。
- 预计正常主流程新增 **1 条专用宝宝、2 条采购流水、2 条库存操作事件，及按现有 RPC 规则产生的库存行/revision**。额外负面测试可能增加有审计的记录，应另行约定测试上限。少量读写通常资源量很小，但具体平台计费、免费额度及备份费用不在本仓库内，不能保证零费用。
- 测试结束只使用已审查 owner-only \`xb_retire_smoke_child\` 软停用：留下测试宝宝、购买、操作等审计记录，**不执行** \`DELETE\`、\`DROP\`、\`TRUNCATE\`、清库、重建家庭或删除账号。烟测宝宝软停用后不可用同一标识重新创建，若要重测必须新审批。停用是隐藏/禁止继续采购，**不是数据库完全回退**。

## 数据隔离与正式版兼容
- 本轮 GitHub 变更仅 Feature；正式 main 不修改。
- \`index.html\` 使用独立 \`xiaobao_v120_m1_local_sandbox\`，M1-02 使用独立命名的 IndexedDB，CloudBase SDK 维护会话，完全不读写 v1.1.2 的 \`xiaobao_diaper_planner_v1\`。
- 本轮不实现正式历史迁移；专用烟测标识从正常宝宝列表过滤；历史迁移目标仅明确的 \`primary\`。数据隔离的最终证明仍需在未来正式 PWA 集成时再做迁移验收。
- 静态 UI 无法代替服务端安全保障：未经另行授权不得在云端执行 019/020、创建宝宝或真实采购。云端真实验收未完成前，所有结果严格标注为“合成/模拟测试”。

## M1-02 最小真实验收矩阵（待获授权）
1. A/B 不同邮箱账号，已知授权家庭不变；客户端无需手输 Env/公开 Key。
2. 一条仅测试宝宝，S 初始=0，其他尺码=0；非测试宝宝绝不能被 M1-02 选择。
3. A 已购买 S60，服务端库存 S60、1 条购买；B 已购买 S80，服务端库存 S140、2 条购买；双方刷新/重进展示一致。
4. 同 ID 同内容重试不重复；同 ID 修改价格或数量拒绝；客户端重复点击不能双提交。
5. 离线购买先本机 IDB 原子入队，不显示“云端已同步”；联网后原 ID 补传、ACK 和清队列；网络超时不会发新 ID。
6. 授权撤销/非法身份拒绝；盘点、撤销的并发 revision 与负库存保护继续依赖已通过的 SQL/IDB 合同，未接入正式测试 UI 时不得声称真实验收通过。
7. 软停用后拒绝采购，审计保留，原始正式版数据/已有家庭/帐号不变。

## 验收级别
- 代码完成：Feature 文件与定向测试可查。
- 隔离/合成测试：以实际 CI 结果为准；不替代真实 SDK。
- 实际 CloudBase：尚未执行 M1-02 写入，未授权。
- 正式发布：未执行，main 不变。
