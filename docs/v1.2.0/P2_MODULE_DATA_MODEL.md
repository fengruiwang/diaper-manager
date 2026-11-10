# v1.2.0 P2 多宝宝 / 模块扩展数据模型（设计合同）

状态：设计准备，可用于接下来正式业务表 SQL 编写；**尚未创建业务表，不执行真实数据迁移**。

## 目标

家长在一个 CloudBase 家庭内管理一名或多名宝宝，所有模块共享家庭成员权限、同步协议、离线队列、审计和备份基础设施。当前版本只交付纸尿裤 + 体重 + 宝宝基本资料的同步；奶粉喂养、疫苗和提醒作为后续独立版本加入。

### 固定身份层

- \`family_id\`：家庭唯一 UUID，所有业务记录必须带上，不允许通过前端任意改家庭归属。
- \`child_id\`：每个宝宝一个稳定 UUID，建议建 \`xb_children\` 表，\`UNIQUE(family_id,legacy_slot)\` 仅用于首个宝宝的迁移幂等。
- \`actor_uid\`：CloudBase 稳定认证 UID，记录谁创建/修改操作；**不能用昵称替代**。
- \`member_alias\`：来自已授权的 \`family_members\`，界面展示“老婆”等；更名不修改历史事件 actor_uid。
- \`app_code\`：小宝管家使用 \`xb\`，未来简记使用 \`jj\`，两者服务共用、数据权限独立。
- 如未来引入多个宝宝，界面在选择 child_id 后才显示对应的喂养、疫苗和成长记录，防止记到另一个宝宝名下。

### 业务数据拆分

| 模块标识 | 表（规划） | 当前优先级 | 独立同步粒度 |
|---|---|---|---|
| children | xb_children / xb_baby_profiles | v1.2.0 | 单宝宝档案、revision |
| diaper | xb_inventory / xb_inventory_operations / xb_transactions | v1.2.0 | 购买、消耗、撤销、盘点；库存事务 |
| growth | xb_weight_records | v1.2.0 | 单条体重，record_id + revision + tombstone |
| price | xb_quotes / xb_reference_overrides | v1.2.0 | 单条候选价或覆盖价 |
| preferences | xb_settings | v1.2.0 | 按家庭或宝宝设置不同的 revision |
| feeding | xb_feeding_records | **后续** | 单次喂奶/母乳/辅食记录 |
| vaccination | xb_vaccination_records / xb_vaccine_catalog | **后续** | 单次实际接种记录；规范目录单独版本化 |
| reminders | xb_reminders / xb_reminder_ack | **后续** | 待办/确认/提醒状态（不代表已接种） |
| sleep | xb_sleep_sessions | **后续** | 一次睡眠的开始、结束、记录者 |

现阶段**不要**提前创建所有未来的空表；先定义命名、身份、修订号、时间字段和同步接口规范，等每个模块需求落实后增量建表。

### 通用业务实体约定

每条记录至少：
- id（UUID），family_id（UUID），child_id（UUID；仅宝宝相关记录），actor_uid（稳定认证 ID）
- revision（非负整数），created_at/updated_at（服务器 timestamptz），deleted_at（软删除标记；按模块审计需求）
- 数据模块明确区分「事件时间」与「服务器接收时间」。喂养、体重、疫苗实际接种时间按用户输入的本地时区正确保存，不能直接使用服务器写入时间替代。
- 修改时需 \`expected_revision\` 或稳定、幂等的追加事件；撤销和删除必须同步 tombstone，不允许旧设备使已删记录复活。
- 特殊业务操作按 \`family_id + operation_id\` 去重并校验 payload hash；不能使用整份 JSON 直接覆盖。
- 所有业务表开启 RLS 且按家庭 + app_code 严格授权；必要的高权限写入通过函数内明确鉴权的 RPC。

### v1.1.2 历史兼容

现有 \`localStorage['xiaobao_diaper_planner_v1']\` 是一个单宝宝 \`state\`。首次迁移时：
1. 提前导出完整 JSON、生成 SHA-256 校验摘要；严禁无提示清空本机。
2. 云端新建一个 \`xb_children\` 行并固化 \`child_id\`，\`legacy_slot='primary'\` 仅用于首宝宝。后续重试必须得到同一 child_id。
3. babyProfile、birthDate、weightRecords 映射到该 child_id；纸尿裤库存业务从原始购买与库存快照初始化，但不能重复按购买流水增加一次库存。
4. 列出原始字段到新列的迁移映射，对尚未定义的扩展字段用受控兼容区保留，不能因为「字段未识别」就丢弃。
5. 云端初始化须以一个迁移 ID 在事务中完成；第二设备只下载，禁止上传空白默认值。
6. 即使加入新模块，旧备份仍可作为隔离导入候选；**禁止直接把旧备份覆盖家庭云端**。

### 喂养（后续功能）设计要点

- 支持配方奶 ml、母乳亲喂左右侧时长、瓶喂母乳 ml、辅食等；每条必须说明类型和计量单位，严禁混算体积与时长。
- 可以记录开始时间、结束时间、宝宝、操作者和备注；时间跨午夜按完整时间戳处理。
- 爸妈同时记录要显示是否重复、允许审核撤销，不能直接合并有歧义的两次喂养。
- 不将喂养数据直接作为医学诊断结论。

### 疫苗（后续功能）设计要点

- 「官方推荐接种计划」「已接种记录」「自行设置提醒」是三类不同的实体。
- 计划依地区和官方发布日期版本化；提醒是建议，不等于实际接种。补种方案由接种门诊/医师确认。
- 支持上传凭证的设计需单独评估隐私、权限、云存储费用，初版可只记录文本信息。
- 推送仅在具备浏览器通知权限或后端调度后启用；PWA 关闭时不能依赖前台定时器保证提醒。

### 可执行验收门槛

- 各模块可独立创建/读取/删除，新增 feeding/vaccination 模块后，历史 diaper/weight 库存与体重记录指纹不变。
- user_uid 改显示备注后，旧操作仍能正确归属原创建者；不向未授权用户泄漏 UID/家庭资料。
- 同家庭不同 child_id 之间不能串记体重、喂养或疫苗，跨家庭访问均拒绝。
- 每个模块有自己的 migrationVersion 和离线恢复测试，CloudBase 停用期间可继续在本机操作，恢复后按模块补传。
- 业务 SQL 经静态审查和真实两账户 RLS 负面测试后才能进入生产初始化。
