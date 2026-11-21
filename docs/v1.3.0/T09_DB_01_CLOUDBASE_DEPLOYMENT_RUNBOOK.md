# T09-DB-01A｜SQL 028 腾讯云部署操作手册

部署对象为妈妈健康的家庭级文档表、请求回执表和三个 RPC。经独立审核的 SQL 028 基线为 `a1002d6b5077e85b2e9dfaf7a90315305f1823db`。本手册用于后续获单独授权的部署，只准备文件，不构成部署授权。

## 1. 部署前检查

在获授权的 CloudBase 项目中打开 PostgreSQL SQL 控制台，确认当前环境是授权指定的环境。完整执行 [028A 部署前只读检查](../../cloudbase/sql/028A_xb_maternal_health_preflight_READONLY.sql)，保存 PostgreSQL 版本、控制台角色与全部结果。

只有所有行均为 `PASS` 才可进入下一步。任一项报错或 `FAIL` 都应停止。如果任何目标表、RPC 或同名重载已存在，先核实当前安装状态。即使只发现一个对象，也不要执行 SQL 028。

## 2. 执行一次完整 SQL 028

在同一控制台执行 [SQL 028](../../cloudbase/sql/028_xb_maternal_health_DRAFT_DO_NOT_DEPLOY.sql) 的完整内容，从 `BEGIN` 到 `COMMIT` 一次提交。脚本已经包含三项 `authenticated` RPC 执行授权。使用这份脚本即可，无需单独调整 `authenticated`、`anon` 或既有认证和家庭授权的其他权限。

如果执行报错，立即停止，记录出错语句位置、SQLSTATE（如控制台提供）和脱敏错误信息，交由负责人核对事务和实际对象状态。不要拆段补跑、盲目重试或重复执行 SQL 028。此步骤只创建新对象，不修改宝宝业务表及数据，也不执行数据迁移。

## 3. 部署后立即验证

1. 执行 [028B 部署后只读验证](../../cloudbase/sql/028B_xb_maternal_health_postflight_READONLY.sql) 的 **A 段**。所有行均应为 `PASS`。这一步检查两张表的存在、RLS、策略和直接权限，以及三个 RPC 的执行权限、`SECURITY DEFINER` 和固定 `search_path`。
2. A 段全部通过后，在首次业务写入前执行 **B 段**。两张表都应为 `PASS`。B 段只输出是否为空的判定，须使用可查看全表的控制台角色。控制台角色自身仍受这两张表的 RLS 过滤时，B 段返回 `FAIL`，避免把被过滤的结果判为空。
3. 保存 028A 和 028B 的结果并提交审核。任一检查失败或 SQL 报错时停止，提供检查名及脱敏错误信息，由负责人决定后续处理。已存在数据时不得为了得到空表结果而清理记录。

## 4. 执行边界

**禁止在真实 CloudBase 执行 PostgreSQL 合同测试。** [`tests/postgres/t09_maternal_health_contract.sql`](../../tests/postgres/t09_maternal_health_contract.sql) 仅用于隔离测试数据库，包含合成家庭和宝宝数据写入。

审核材料只需检查结果、环境标识和脱敏错误。不要提供家庭 UUID、邮箱、凭据或健康记录。真实环境联调及应用发布由负责人另行安排。
