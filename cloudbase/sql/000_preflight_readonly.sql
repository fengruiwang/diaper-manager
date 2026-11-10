-- 小宝管家 v1.2.0 P0 只读预检，不修改 CloudBase 任何数据
-- 执行位置：PostgreSQL → SQL 编辑器。不要共享密钥或用户资料。
SELECT current_database() AS db_name, current_schema() AS schema_name, current_user AS sql_role, version() AS postgres_version;
SELECT nspname AS schema_name
FROM pg_namespace
WHERE nspname IN ('public','auth')
ORDER BY nspname;
SELECT rolname
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role')
ORDER BY rolname;
SELECT n.nspname AS function_schema, p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='auth' AND p.proname IN ('uid','role')
ORDER BY p.proname;
SELECT gen_random_uuid() AS generated_uuid_test;
SELECT to_regclass('public.families') AS families_table,
       to_regclass('public.family_members') AS family_members_table,
       to_regclass('public.family_app_access') AS app_access_table,
       to_regclass('public.family_invites') AS invites_table;
-- SQL 编辑器的管理员会话可能让 auth.uid() 为空，登录功能需要由浏览器 SDK 单独验证。
