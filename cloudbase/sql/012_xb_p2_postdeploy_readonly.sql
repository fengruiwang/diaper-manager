-- XiaoBao v1.2.0 / P2 FIRST-deployment acceptance check.
-- READ ONLY. Run after the explicitly approved sequence 005 -> 006 -> 008 -> 009 -> 010.
-- Initial install expects all columns true. Run before creating ANY virtual baby or stock.
-- This is NOT a data migration and MUST NOT be used as proof of live RPC behavior.
SELECT
  to_regclass('public.xb_children') IS NOT NULL
    AND to_regclass('public.xb_baby_profiles') IS NOT NULL
    AND to_regclass('public.xb_weight_records') IS NOT NULL
    AND to_regclass('public.xb_inventory') IS NOT NULL
    AND to_regclass('public.xb_inventory_operations') IS NOT NULL
    AND to_regclass('public.xb_migrations') IS NOT NULL
    AND to_regclass('public.xb_transactions') IS NOT NULL
    AS all_seven_business_tables_exist,
  (SELECT count(*)=7
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relname IN ('xb_children','xb_baby_profiles','xb_weight_records',
         'xb_inventory','xb_inventory_operations','xb_migrations','xb_transactions')
       AND c.relrowsecurity)
    AS all_seven_tables_rls_enabled,
  (SELECT count(*)=1 FROM public.families) AS one_existing_family_preserved,
  (SELECT count(*)=2 FROM public.family_members) AS two_existing_members_preserved,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS two_existing_xb_grants_preserved,
  (SELECT count(*)=0 FROM public.xb_children)
    AND (SELECT count(*)=0 FROM public.xb_baby_profiles)
    AND (SELECT count(*)=0 FROM public.xb_weight_records)
    AND (SELECT count(*)=0 FROM public.xb_inventory)
    AND (SELECT count(*)=0 FROM public.xb_inventory_operations)
    AND (SELECT count(*)=0 FROM public.xb_migrations)
    AND (SELECT count(*)=0 FROM public.xb_transactions)
    AS first_deploy_created_no_business_data,
  NOT has_table_privilege('authenticated','public.xb_inventory','INSERT')
    AND NOT has_table_privilege('authenticated','public.xb_inventory','UPDATE')
    AND NOT has_table_privilege('authenticated','public.xb_inventory','DELETE')
    AND NOT has_table_privilege('authenticated','public.xb_inventory_operations','INSERT')
    AND NOT has_table_privilege('authenticated','public.xb_transactions','INSERT')
    AND NOT has_table_privilege('authenticated','public.xb_transactions','UPDATE')
    AND NOT has_table_privilege('authenticated','public.xb_transactions','DELETE')
    AS authenticated_browser_cannot_write_business_rows,
  has_table_privilege('authenticated','public.xb_inventory','SELECT')
    AND has_table_privilege('authenticated','public.xb_transactions','SELECT')
    AND NOT has_table_privilege('anon','public.xb_inventory','SELECT')
    AND NOT has_table_privilege('anon','public.xb_transactions','SELECT')
    AND NOT has_table_privilege('authenticated','public.xb_migrations','SELECT')
    AS expected_read_and_migration_privileges,
  to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz)'
  ) IS NULL AS legacy_stock_only_rpc_removed,
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)'
  ) AND p.prosecdef) AS audited_purchase_rpc_installed_as_definer,
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(
    'public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])'
  ) AND p.prosecdef) AS inventory_read_rpc_installed_as_definer,
  to_regprocedure('public.xb_set_member_alias(uuid,text,text,bigint)') IS NOT NULL
    AS member_alias_rpc_preserved;
