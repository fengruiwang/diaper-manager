-- SQL 028 deployment preflight. SELECT only. Run in the SQL console.
-- The result contains metadata only. Any FAIL means STOP before SQL 028.
WITH checks(check_name, ok, on_failure) AS (
 VALUES
  ('PostgreSQL >= 16', pg_catalog.current_setting('server_version_num')::integer >= 160000,
   'STOP: SQL 028 requires pg_input_is_valid'),
  ('role anon', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'),
   'STOP: missing role'),
  ('role authenticated', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'),
   'STOP: missing role'),
  ('schema public permits CREATE', COALESCE(pg_catalog.has_schema_privilege(
    current_user, (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public'), 'CREATE'), false),
   'STOP: confirm SQL console role before installation')
 UNION ALL
 SELECT 'table public.' || expected.name,
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = expected.name AND c.relkind IN ('r', 'p')),
  'STOP: missing required table'
 FROM (VALUES ('families'), ('family_members'), ('family_app_access')) AS expected(name)
 UNION ALL
 SELECT signature, pg_catalog.to_regprocedure(signature) IS NOT NULL, 'STOP: missing required function'
 FROM (VALUES ('xb_private.can_use_app(uuid,text)'), ('auth.uid()'), ('auth.role()'),
  ('pg_catalog.sha256(bytea)'), ('pg_catalog.pg_input_is_valid(text,text)')) AS expected(signature)
 UNION ALL
 SELECT 'unused relation name public.' || expected.name,
  pg_catalog.to_regclass('public.' || expected.name) IS NULL,
  'STOP: a target relation already exists; inspect before proceeding'
 FROM (VALUES ('xb_maternal_health_documents'), ('xb_maternal_health_requests')) AS expected(name)
 UNION ALL
 -- Check names as well as signatures. An unexpected overload is also a conflict.
 SELECT 'unused RPC name public.' || expected.name,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = expected.name),
  'STOP: a target RPC or overload already exists; inspect before proceeding'
 FROM (VALUES ('xb_read_maternal_health'), ('xb_put_maternal_health'),
  ('xb_check_maternal_health_request')) AS expected(name)
)
SELECT pg_catalog.current_setting('server_version') AS pg_version, current_user AS sql_console_role,
 check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result,
 CASE WHEN NOT ok THEN on_failure END AS action
FROM checks
ORDER BY check_name;
