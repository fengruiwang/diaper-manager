-- XiaoBao v1.2.0 P2-1 / STAGE 008 purchase-table postflight (READ ONLY).
-- Run only AFTER successful execution of 008 and BEFORE executing 009.
-- Expected for first empty installation: ALL 15 booleans true.
-- Never creates test purchases, babies or permissions; does not reveal user data.
SELECT
  to_regclass('public.xb_transactions') IS NOT NULL
    AS purchase_table_exists,
  (SELECT COUNT(*)=0 FROM public.xb_transactions)
    AS purchase_history_empty,
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid=to_regclass('public.xb_transactions') AND c.relrowsecurity)
    AS purchase_rls_enabled,
  has_table_privilege('authenticated','public.xb_transactions','SELECT')
    AS authenticated_can_select_purchases,
  NOT has_table_privilege('anon','public.xb_transactions','SELECT')
    AS anonymous_cannot_select_purchases,
  NOT has_table_privilege('authenticated','public.xb_transactions','INSERT')
    AS authenticated_cannot_insert_purchases,
  NOT has_table_privilege('authenticated','public.xb_transactions','UPDATE')
    AS authenticated_cannot_update_purchases,
  NOT has_table_privilege('authenticated','public.xb_transactions','DELETE')
    AS authenticated_cannot_delete_purchases,
  EXISTS(SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname='public' AND p.tablename='xb_transactions'
      AND p.policyname='xb_transactions_family_read'
      AND p.cmd='SELECT'
      AND p.qual LIKE '%xb_private.can_use_app%')
    AS purchase_family_read_policy_exists,
  EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass('public.xb_transactions')
      AND c.contype='f'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE
        '%FOREIGN KEY (family_id, operation_id, child_id, size) REFERENCES xb_inventory_operations%')
    AS purchase_operation_scope_fk_exists,
  EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass('public.xb_inventory_operations')
      AND c.conname='xb_inventory_operation_scope_unique' AND c.contype='u')
    AS operation_scope_unique_constraint_exists,
  to_regclass('public.xb_transactions_history') IS NOT NULL
    AS purchase_history_index_exists,
  (SELECT COUNT(*)=1 FROM public.families)
    AS original_family_preserved,
  (SELECT COUNT(*)=2 FROM public.family_members)
    AS original_members_preserved,
  (SELECT COUNT(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS original_xb_grants_preserved;
