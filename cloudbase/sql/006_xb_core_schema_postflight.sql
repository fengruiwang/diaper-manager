-- P2 core schema design postflight. READ-ONLY. Run only after actual migration approval.
SELECT
  to_regclass('public.xb_children') IS NOT NULL AS children_table_exists,
  to_regclass('public.xb_baby_profiles') IS NOT NULL AS profile_table_exists,
  to_regclass('public.xb_weight_records') IS NOT NULL AS weight_table_exists,
  to_regclass('public.xb_inventory') IS NOT NULL AS inventory_table_exists,
  to_regclass('public.xb_inventory_operations') IS NOT NULL AS operation_table_exists,
  to_regclass('public.xb_migrations') IS NOT NULL AS migration_receipt_exists,
  (SELECT count(*)=1 FROM public.families) AS original_family_preserved,
  (SELECT count(*)=2 FROM public.family_members) AS original_members_preserved,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb') AS xb_grants_preserved,
  (SELECT count(*)=0 FROM public.xb_children) AS no_children_uploaded,
  (SELECT count(*)=0 FROM public.xb_baby_profiles) AS no_profiles_uploaded,
  (SELECT count(*)=0 FROM public.xb_weight_records) AS no_weight_uploaded,
  (SELECT count(*)=0 FROM public.xb_inventory) AS no_inventory_uploaded,
  (SELECT count(*)=0 FROM public.xb_inventory_operations) AS no_ops_uploaded,
  (SELECT count(*)=0 FROM public.xb_migrations) AS no_migration_performed,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    WHERE c.oid IN ('public.xb_children'::regclass,
     'public.xb_baby_profiles'::regclass,'public.xb_weight_records'::regclass,
     'public.xb_inventory'::regclass,'public.xb_inventory_operations'::regclass,
     'public.xb_migrations'::regclass)) AS all_business_rls_enabled,
  NOT has_table_privilege('authenticated','public.xb_inventory','UPDATE') AS client_inventory_update_denied,
  NOT has_table_privilege('authenticated','public.xb_inventory_operations','INSERT') AS client_ops_insert_denied,
  NOT has_table_privilege('authenticated','public.xb_migrations','SELECT') AS client_migration_receipts_private;
-- No clinical or business data is inserted by the schema proposal.
