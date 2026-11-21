-- SQL 028 postflight. Run section A first. Run section B only if all A checks pass.
-- SELECT only. Section B returns emptiness flags, never business rows.

-- A. Object, RLS, policy and effective privilege checks.
WITH roles AS (
 SELECT
  (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
  (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS auth_oid
), tables AS (
 SELECT expected.name, c.oid, c.relkind, c.relrowsecurity
 FROM (VALUES ('xb_maternal_health_documents'), ('xb_maternal_health_requests')) AS expected(name)
 LEFT JOIN pg_catalog.pg_class c ON c.oid = pg_catalog.to_regclass('public.' || expected.name)
), rpcs AS (
 SELECT expected.signature, p.oid, p.prokind, p.prosecdef, p.proconfig
 FROM (VALUES ('public.xb_read_maternal_health(uuid)'),
  ('public.xb_put_maternal_health(uuid,bigint,uuid,jsonb)'),
  ('public.xb_check_maternal_health_request(uuid,uuid)')) AS expected(signature)
 LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(expected.signature)
), checks(object_name, check_name, ok) AS (
 SELECT 'console', 'anon and authenticated roles exist', anon_oid IS NOT NULL AND auth_oid IS NOT NULL
 FROM roles
 UNION ALL
 SELECT 'public.' || name, 'ordinary table exists', relkind = 'r' FROM tables
 UNION ALL
 SELECT 'public.' || name, 'row level security enabled', relrowsecurity FROM tables
 UNION ALL
 SELECT 'public.' || t.name, 'no RLS policies', t.oid IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = t.oid)
 FROM tables t
 UNION ALL
 SELECT 'public.' || t.name, checked.name || ' has no direct table or column access',
  NOT pg_catalog.has_table_privilege(checked.oid, t.oid,
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT pg_catalog.has_any_column_privilege(checked.oid, t.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
 FROM tables t CROSS JOIN roles
 CROSS JOIN LATERAL (VALUES ('anon', anon_oid), ('authenticated', auth_oid)) AS checked(name, oid)
 UNION ALL
 SELECT signature, 'function exists', prokind = 'f' FROM rpcs
 UNION ALL
 SELECT signature, 'SECURITY DEFINER', prosecdef FROM rpcs
 UNION ALL
 SELECT signature, 'search_path = pg_catalog, public, pg_temp',
  'search_path=pg_catalog, public, pg_temp' = ANY(proconfig)
 FROM rpcs
 UNION ALL
 SELECT signature, 'anon cannot execute', NOT pg_catalog.has_function_privilege(anon_oid, oid, 'EXECUTE')
 FROM rpcs CROSS JOIN roles
 UNION ALL
 SELECT signature, 'authenticated can execute', pg_catalog.has_function_privilege(auth_oid, oid, 'EXECUTE')
 FROM rpcs CROSS JOIN roles
)
SELECT object_name, check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY object_name, check_name;

-- B. Initial emptiness. The console must be able to see all rows.
-- If this section reports a permissions error or RLS is active for the console role, stop.
SELECT 'public.xb_maternal_health_documents' AS object_name, 'initial table is empty' AS check_name,
 CASE WHEN pg_catalog.row_security_active('public.xb_maternal_health_documents') THEN 'FAIL'
  WHEN EXISTS (SELECT 1 FROM public.xb_maternal_health_documents) THEN 'FAIL'
  ELSE 'PASS' END AS result
UNION ALL
SELECT 'public.xb_maternal_health_requests', 'initial table is empty',
 CASE WHEN pg_catalog.row_security_active('public.xb_maternal_health_requests') THEN 'FAIL'
  WHEN EXISTS (SELECT 1 FROM public.xb_maternal_health_requests) THEN 'FAIL'
  ELSE 'PASS' END;
