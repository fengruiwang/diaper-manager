-- XiaoBao v1.2.0 / 016 P2 STAGE-009 permission diagnostic (READ ONLY).
-- Run ONLY if 015 shows authenticated_can_execute_purchase_rpc=false.
-- This does not call the business RPC, mutate GRANT, or disclose family IDs.
-- One row; do not expect every column true: some describe environment.
WITH funcs AS (
 SELECT
  to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)') AS purchase_oid,
  to_regprocedure('public.xb_set_member_alias(uuid,text,text,bigint)') AS alias_oid
), acl AS (
 SELECT p.oid,p.proowner,p.proacl FROM pg_catalog.pg_proc p
 JOIN funcs f ON p.oid=f.purchase_oid
)
SELECT
 f.purchase_oid IS NOT NULL AS purchase_function_found,
 EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
   AS authenticated_role_exists,
 has_schema_privilege('authenticated','public','USAGE')
   AS authenticated_public_schema_usage,
 CASE WHEN f.purchase_oid IS NOT NULL
   THEN has_function_privilege('authenticated',f.purchase_oid,'EXECUTE')
   ELSE false END AS effective_authenticated_execute,
 CASE WHEN f.purchase_oid IS NOT NULL
   THEN has_function_privilege('anon',f.purchase_oid,'EXECUTE')
   ELSE false END AS effective_anon_execute,
 EXISTS (
  SELECT 1 FROM acl a
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.proacl) item
  JOIN pg_catalog.pg_roles r ON r.oid=item.grantee
  WHERE r.rolname='authenticated' AND item.privilege_type='EXECUTE'
 ) AS explicit_authenticated_execute_grant,
 EXISTS (
  SELECT 1 FROM acl a
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.proacl) item
  WHERE item.grantee=0 AND item.privilege_type='EXECUTE'
 ) AS public_execute_grant_present,
 EXISTS (
  SELECT 1 FROM acl a
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.proacl) item
  JOIN pg_catalog.pg_roles r ON r.oid=item.grantee
  WHERE r.rolname='anon' AND item.privilege_type='EXECUTE'
 ) AS explicit_anon_execute_grant,
 COALESCE((SELECT a.proacl IS NULL FROM acl a),false)
   AS purchase_function_has_default_acl,
 CASE WHEN f.alias_oid IS NOT NULL
   THEN has_function_privilege('authenticated',f.alias_oid,'EXECUTE')
   ELSE false END AS comparison_alias_authenticated_execute,
 EXISTS (
  SELECT 1 FROM acl a
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=a.proowner
  WHERE owner_role.rolname='cloudbase_postgres'
 ) AS purchase_function_owned_by_cloudbase_postgres
FROM funcs f;
