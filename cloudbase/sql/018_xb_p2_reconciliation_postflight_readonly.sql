-- XiaoBao v1.2.0 / P2-1 stage 010 reconciliation RPC postflight.
-- READ ONLY. Run immediately AFTER 010, BEFORE final 012.
-- Expected on first installation: one row with ALL 20 flags TRUE.
-- Does not call RPC, create users/babies, write inventory, or migrate data.
SELECT
  to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
    IS NOT NULL AS reconciliation_rpc_exists,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=
    to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
    AND p.prosecdef) AS reconciliation_security_definer,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=
    to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
    AND p.provolatile='s') AS reconciliation_is_stable,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=
    to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
    AND p.prorettype='pg_catalog.jsonb'::regtype)
    AS reconciliation_returns_jsonb,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL unnest(p.proconfig) AS setting(config)
    WHERE p.oid=to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
      AND regexp_replace(setting.config,'[[:space:]]','','g')=
        'search_path=pg_catalog,public,pg_temp')
    AS reconciliation_search_path_fixed,
  has_function_privilege('authenticated',
    'public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])','EXECUTE')
    AS authenticated_can_execute_reconciliation,
  NOT has_function_privilege('anon',
    'public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])','EXECUTE')
    AS anonymous_cannot_execute_reconciliation,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    JOIN LATERAL pg_catalog.aclexplode(p.proacl) perm ON true
    JOIN pg_catalog.pg_roles r ON r.oid=perm.grantee
    WHERE p.oid=to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
      AND r.rolname='authenticated' AND perm.privilege_type='EXECUTE')
    AS authenticated_explicit_reconciliation_grant,
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    JOIN LATERAL pg_catalog.aclexplode(p.proacl) perm ON true
    WHERE p.oid=to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
      AND perm.privilege_type='EXECUTE'
      AND (perm.grantee=0 OR perm.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon')))
    AS public_and_anon_reconciliation_grants_absent,
  has_schema_privilege('authenticated','public','USAGE')
    AS authenticated_can_use_public_schema,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%authentication_required%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%xb_private.can_use_app%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%op.actor_uid=v_actor%')
    AS reconciliation_auth_and_actor_filter_present,
  (SELECT count(*)=0 FROM public.xb_children)
    AS no_babies_created,
  (SELECT count(*)=0 FROM public.xb_inventory)
    AS no_inventory_created,
  (SELECT count(*)=0 FROM public.xb_inventory_operations)
    AS no_inventory_operations_created,
  (SELECT count(*)=0 FROM public.xb_transactions)
    AS no_purchases_created,
  has_function_privilege('authenticated',
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)','EXECUTE')
    AND NOT has_function_privilege('anon',
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)','EXECUTE')
    AS purchase_rpc_acl_still_secure,
  to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz)')
    IS NULL AS stock_only_rpc_still_absent,
  (SELECT count(*)=1 FROM public.families) AS original_family_preserved,
  (SELECT count(*)=2 FROM public.family_members) AS original_members_preserved,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS original_xb_grants_preserved;
