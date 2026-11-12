-- M1-02 / stage A / read-only preflight for xiaobao-family.
-- DOES NOT INSTALL RPCS, INSERT A CHILD, CHANGE GRANTS, OR WRITE DATA.
-- Run ONLY before requesting separate approval for installing 019.
-- All result fields must be TRUE; an error or FALSE means STOP, not repair.
-- Expected from the previously accepted P2-1 schema: 1 family, 2 members,
-- 2 xb grants, 7 empty business tables, no smoke child, no smoke RPCs.
SELECT
  current_database() IS NOT NULL AS connected_database_present,
  to_regprocedure('auth.role()') IS NOT NULL
    AND to_regprocedure('auth.uid()') IS NOT NULL
    AS auth_role_and_uid_exist,
  to_regprocedure('xb_private.is_family_owner(uuid)') IS NOT NULL
    AND to_regprocedure('xb_private.can_use_app(uuid,text)') IS NOT NULL
    AS smoke_owner_and_app_helpers_exist,
  to_regclass('public.xb_children') IS NOT NULL
    AND to_regclass('public.xb_inventory') IS NOT NULL
    AND to_regclass('public.xb_inventory_operations') IS NOT NULL
    AND to_regclass('public.xb_transactions') IS NOT NULL
    AS smoke_purchase_tables_exist,
  (SELECT count(*) = 7
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('xb_children','xb_baby_profiles','xb_weight_records',
         'xb_inventory','xb_inventory_operations','xb_migrations','xb_transactions')
       AND c.relkind IN ('r','p') AND c.relrowsecurity)
    AS existing_seven_business_tables_rls_enabled,
  to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])'
    ) IS NOT NULL
    AS existing_purchase_and_reconciliation_rpcs_exist,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure(
      'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)')
      AND p.prosecdef
  ) AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])')
      AND p.prosecdef
  ) AS existing_inventory_rpcs_still_definer,
  to_regprocedure('public.xb_create_smoke_child(uuid)') IS NULL
    AND to_regprocedure('public.xb_retire_smoke_child(uuid,uuid)') IS NULL
    AS exact_smoke_rpc_signatures_absent,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('xb_create_smoke_child','xb_retire_smoke_child')
  ) AS no_overloaded_or_conflicting_smoke_rpc_names,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_index idx
    JOIN pg_catalog.pg_class c ON c.oid=idx.indexrelid
    WHERE idx.indrelid=to_regclass('public.xb_children')
      AND c.relname='xb_children_legacy_slot_unique'
      AND idx.indisunique AND idx.indisvalid AND idx.indisready
      AND pg_catalog.pg_get_indexdef(idx.indexrelid) LIKE '%(family_id, legacy_slot)%'
      AND pg_catalog.pg_get_indexdef(idx.indexrelid) LIKE '%legacy_slot IS NOT NULL%'
  ) AS required_smoke_slot_unique_index_valid,
  (SELECT count(*)=8 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid=to_regclass('public.xb_children')
       AND a.attnum>0 AND NOT a.attisdropped
       AND (a.attname,pg_catalog.format_type(a.atttypid,NULL)) IN (
         ('id','uuid'),('family_id','uuid'),('legacy_slot','text'),
         ('display_name','text'),('created_by','text'),
         ('deleted_at','timestamp with time zone'),
         ('updated_at','timestamp with time zone'),('revision','bigint')
       )) AS child_columns_required_by_019_unchanged,
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
    AS cloudbase_auth_roles_exist,
  NOT has_table_privilege('authenticated','public.xb_children','INSERT')
    AND NOT has_table_privilege('authenticated','public.xb_children','UPDATE')
    AS client_child_direct_write_still_denied,
  (SELECT count(*)=1 FROM public.families)
    AS one_original_family_present,
  (SELECT count(*)=2 FROM public.family_members)
    AS two_original_family_members_present,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb')
    AS two_original_xb_grants_present,
  (SELECT count(*)=0 FROM public.xb_children WHERE legacy_slot='__xb_smoke_v1__')
    AS reserved_smoke_slot_not_used,
  (SELECT count(*)=0 FROM public.xb_children)
    AND (SELECT count(*)=0 FROM public.xb_inventory)
    AND (SELECT count(*)=0 FROM public.xb_inventory_operations)
    AND (SELECT count(*)=0 FROM public.xb_transactions)
    AS no_existing_child_inventory_or_purchase_records;
