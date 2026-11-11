-- XiaoBao v1.2.0 / P2 predeployment inspection, read-only.
-- Run BEFORE 005/008/009/010 on the existing CloudBase PostgreSQL database.
-- Returns only boolean flags. NO DDL, UPDATE, INSERT, DELETE or private IDs.
-- Expected before first P2 deployment: ALL flags true; a false flag means STOP.
-- Checking readiness DOES NOT authorize running any migration.
SELECT
  to_regclass('public.families') IS NOT NULL
    AND to_regclass('public.family_members') IS NOT NULL
    AND to_regclass('public.family_app_access') IS NOT NULL
    AND to_regclass('public.family_invites') IS NOT NULL
    AS shared_family_tables_present,
  (SELECT count(*)=1 FROM public.families)
    AS existing_one_family_preserved,
  (SELECT count(*)=2 FROM public.family_members)
    AS existing_two_members_preserved,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS existing_two_xb_grants_preserved,
  to_regprocedure('public.xb_set_member_alias(uuid,text,text,bigint)') IS NOT NULL
    AS existing_alias_rpc_present,
  to_regprocedure('xb_private.can_use_app(uuid,text)') IS NOT NULL
    AS xb_permission_helper_present,
  to_regclass('public.xb_children') IS NULL
    AND to_regclass('public.xb_baby_profiles') IS NULL
    AND to_regclass('public.xb_weight_records') IS NULL
    AND to_regclass('public.xb_inventory') IS NULL
    AND to_regclass('public.xb_inventory_operations') IS NULL
    AND to_regclass('public.xb_migrations') IS NULL
    AS first_deploy_business_tables_absent,
  to_regclass('public.xb_transactions') IS NULL
    AS first_deploy_purchase_table_absent,
  to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz)'
  ) IS NULL AS legacy_stock_only_rpc_absent,
  to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)'
  ) IS NULL AS full_purchase_rpc_not_yet_deployed,
  to_regprocedure(
    'public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])'
  ) IS NULL AS reconciliation_rpc_not_yet_deployed;
