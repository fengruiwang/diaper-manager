-- SQL 028 deployment preflight. SELECT only. Run in the SQL console.
-- The result contains metadata only. Any FAIL means STOP before SQL 028.
WITH public_relations AS (
 SELECT c.oid, c.relname, c.relkind
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
), required_functions(schema_name, function_name, signature, argument_oids, needs_execute) AS (
 VALUES
  ('xb_private', 'can_use_app', 'xb_private.can_use_app(uuid,text)',
   ARRAY['pg_catalog.uuid'::regtype::oid, 'pg_catalog.text'::regtype::oid], true),
  ('auth', 'uid', 'auth.uid()', ARRAY[]::oid[], true),
  ('auth', 'role', 'auth.role()', ARRAY[]::oid[], false),
  ('pg_catalog', 'sha256', 'pg_catalog.sha256(bytea)', ARRAY['pg_catalog.bytea'::regtype::oid], false),
  ('pg_catalog', 'pg_input_is_valid', 'pg_catalog.pg_input_is_valid(text,text)',
   ARRAY['pg_catalog.text'::regtype::oid, 'pg_catalog.text'::regtype::oid], false)
), functions AS (
 -- Name-based resolution can throw before reporting a missing schema USAGE grant.
 SELECT expected.signature, expected.needs_execute, p.oid
 FROM required_functions expected
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = expected.schema_name
 LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid AND p.proname = expected.function_name
  AND p.prokind = 'f' AND p.proargtypes::text = pg_catalog.array_to_string(expected.argument_oids, ' ')
), checks(check_name, ok, on_failure) AS (
 VALUES
  ('PostgreSQL >= 16', pg_catalog.current_setting('server_version_num')::integer >= 160000,
   'STOP: SQL 028 requires pg_input_is_valid'),
  ('role anon', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon'),
   'STOP: missing role'),
  ('role authenticated', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'),
   'STOP: missing role')
 UNION ALL
 -- OID-based checks return NULL for missing objects. Report those as FAIL.
 SELECT 'schema ' || expected.name || ' permits ' || expected.privilege,
  COALESCE(pg_catalog.has_schema_privilege(current_user, n.oid, expected.privilege), false),
  'STOP: current_user lacks schema access or the schema is missing'
 FROM (VALUES ('public', 'CREATE'), ('public', 'USAGE'), ('xb_private', 'USAGE'),
  ('auth', 'USAGE')) AS expected(name, privilege)
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = expected.name
 UNION ALL
 SELECT 'table public.families permits REFERENCES',
  COALESCE(pg_catalog.has_table_privilege(
   current_user, (SELECT oid FROM public_relations WHERE relname = 'families' AND relkind IN ('r', 'p')),
   'REFERENCES'), false),
  'STOP: current_user lacks REFERENCES or public.families is missing'
 UNION ALL
 SELECT signature || ' permits EXECUTE',
  COALESCE(pg_catalog.has_function_privilege(current_user, oid, 'EXECUTE'), false),
  'STOP: current_user lacks EXECUTE or the function is missing'
 FROM functions WHERE needs_execute
 UNION ALL
 SELECT 'table public.' || expected.name,
  EXISTS (SELECT 1 FROM public_relations r WHERE r.relname = expected.name AND r.relkind IN ('r', 'p')),
  'STOP: missing required table'
 FROM (VALUES ('families'), ('family_members'), ('family_app_access')) AS expected(name)
 UNION ALL
 SELECT signature, oid IS NOT NULL, 'STOP: missing required function' FROM functions
 UNION ALL
 SELECT 'unused relation name public.' || expected.name,
  NOT EXISTS (SELECT 1 FROM public_relations r WHERE r.relname = expected.name),
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
