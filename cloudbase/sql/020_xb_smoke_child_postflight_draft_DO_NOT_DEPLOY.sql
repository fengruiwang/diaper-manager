-- XiaoBao P2-3B / 020 owner-only virtual-child RPC postflight.
-- DESIGN DRAFT ONLY: DO NOT RUN IN REAL CLOUDBase absent separate approval.
-- READ ONLY, does not create any test babies or inventory operations.
-- Expected in fresh disposable PG16 immediately after 019: 18 TRUE.
SELECT
 to_regprocedure('public.xb_create_smoke_child(uuid)') IS NOT NULL
   AS smoke_create_rpc_exists,
 to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)') IS NOT NULL
   AS smoke_retire_rpc_exists,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_create_smoke_child(uuid)')
     AND p.prosecdef AND p.provolatile='v')
   AS create_rpc_is_volatile_definer,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)')
     AND p.prosecdef AND p.provolatile='v')
   AS retire_rpc_is_volatile_definer,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_create_smoke_child(uuid)')
     AND p.prorettype='pg_catalog.jsonb'::regtype)
   AS create_rpc_returns_jsonb,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)')
     AND p.prorettype='pg_catalog.jsonb'::regtype)
   AS retire_rpc_returns_jsonb,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL unnest(p.proconfig) AS setting(config)
   WHERE p.oid IN (
     to_regprocedure('public.xb_create_smoke_child(uuid)'),
     to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)')
   ) AND regexp_replace(setting.config,'[[:space:]]','','g')=
       'search_path=pg_catalog,public,pg_temp'
   HAVING count(*)=2)
   AS both_smoke_rpcs_have_fixed_search_path,
 has_function_privilege('authenticated',
    'public.xb_create_smoke_child(uuid)','EXECUTE')
   AND has_function_privilege('authenticated',
    'public.xb_retire_smoke_child(uuid,uuid)','EXECUTE')
   AS authenticated_can_execute_smoke_rpcs,
 NOT has_function_privilege('anon',
    'public.xb_create_smoke_child(uuid)','EXECUTE')
   AND NOT has_function_privilege('anon',
    'public.xb_retire_smoke_child(uuid,uuid)','EXECUTE')
   AS anonymous_cannot_execute_smoke_rpcs,
 NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
   WHERE p.oid IN (
     to_regprocedure('public.xb_create_smoke_child(uuid)'),
     to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)')
   ) AND acl.privilege_type='EXECUTE'
     AND (acl.grantee=0 OR acl.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon'))
 ) AS no_smoke_rpc_public_or_anon_grants,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_create_smoke_child(uuid)')
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%xb_private.is_family_owner%'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%xb_private.can_use_app%'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%authentication_required%')
   AS create_owner_and_app_check_present,
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)')
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%xb_private.is_family_owner%'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%xb_private.can_use_app%'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%authentication_required%')
   AS retire_owner_and_app_check_present,
 EXISTS(SELECT 1 FROM pg_catalog.pg_index idx
   JOIN pg_catalog.pg_class c ON c.oid=idx.indexrelid
   WHERE idx.indrelid=to_regclass('public.xb_children')
     AND c.relname='xb_children_legacy_slot_unique' AND idx.indisunique)
   AS test_slot_unique_index_preserved,
 (SELECT count(*)=0 FROM public.xb_children
   WHERE legacy_slot='__xb_smoke_v1__') AS no_smoke_baby_created_by_migration,
 NOT has_table_privilege('authenticated','public.xb_children','INSERT')
   AND NOT has_table_privilege('authenticated','public.xb_children','UPDATE')
   AS client_still_cannot_write_children,
 (SELECT count(*)=1 FROM public.families)
   AS original_family_preserved,
 (SELECT count(*)=2 FROM public.family_members)
   AS original_members_preserved,
 (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb')
   AS original_xb_grants_preserved;
