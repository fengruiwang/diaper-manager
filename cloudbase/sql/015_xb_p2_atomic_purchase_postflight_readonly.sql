-- XiaoBao v1.2.0 P2-1 / STAGE 009 atomic purchase RPC postflight.
-- READ ONLY. Run AFTER 009 and BEFORE 010. Expect one row, 21 TRUE flags.
-- It checks function ACLs/definition, revocation of old stock-only overload,
-- reversal uniqueness, empty business data and original family preservation.
-- This does not invoke the RPC or create stock, babies, purchases or users.
SELECT
  to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
    IS NOT NULL AS atomic_purchase_rpc_exists,
  to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz)')
    IS NULL AS legacy_stock_only_rpc_absent,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND p.prosecdef) AS purchase_rpc_is_security_definer,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND p.provolatile='v') AS purchase_rpc_is_volatile,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND p.prorettype='pg_catalog.jsonb'::regtype) AS purchase_rpc_returns_jsonb,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL unnest(p.proconfig) AS setting(config)
    WHERE p.oid=to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND regexp_replace(setting.config,'[[:space:]]','','g')=
        'search_path=pg_catalog,public,pg_temp')
    AS purchase_rpc_search_path_fixed,
  NOT has_schema_privilege('authenticated','public','CREATE')
    AND NOT has_schema_privilege('anon','public','CREATE')
    AS untrusted_roles_cannot_create_public,
  has_function_privilege('authenticated',
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)',
    'EXECUTE') AS authenticated_can_execute_purchase_rpc,
  NOT has_function_privilege('anon',
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)',
    'EXECUTE') AS anonymous_cannot_execute_purchase_rpc,
  to_regclass('public.xb_inventory_one_reverse_per_source') IS NOT NULL
    AS one_reverse_per_source_index_exists,
  EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass('public.xb_inventory_operations')
      AND c.conname='xb_inventory_reverse_reference_consistent'
      AND c.contype='c') AS reverse_operation_consistency_check_exists,
  to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])') IS NULL
    AS read_reconciliation_rpc_not_installed_yet,
  (SELECT COUNT(*)=0 FROM public.xb_transactions) AS purchase_history_still_empty,
  (SELECT COUNT(*)=0 FROM public.xb_inventory_operations) AS inventory_ops_still_empty,
  (SELECT COUNT(*)=0 FROM public.xb_inventory) AS inventory_still_empty,
  (SELECT COUNT(*)=0 FROM public.xb_children) AS babies_still_empty,
  NOT has_table_privilege('authenticated','public.xb_inventory','INSERT')
    AND NOT has_table_privilege('authenticated','public.xb_inventory','UPDATE')
    AND NOT has_table_privilege('authenticated','public.xb_transactions','INSERT')
    AS direct_business_writes_still_denied,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%purchase_details_required%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%inventory_operation_id_reused_with_different_payload%')
    AS rpc_contains_purchase_and_retry_validation,
  (SELECT COUNT(*)=1 FROM public.families) AS original_family_preserved,
  (SELECT COUNT(*)=2 FROM public.family_members) AS original_members_preserved,
  (SELECT COUNT(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS original_xb_grants_preserved;
