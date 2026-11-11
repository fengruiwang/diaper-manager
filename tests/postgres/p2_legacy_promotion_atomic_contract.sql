-- P2-4E-B2 synthetic PG16 ONLY, after 021 + 022 + B1 test fixtures.
-- Exact legacy JSON source and UUIDs come from B1 fixture, never user history.
\echo P2-4E-B2 atomic archive promotion and final receipt contract
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)') IS NOT NULL
 AND NOT has_function_privilege('anon',
  'public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)','EXECUTE')
 AND has_function_privilege('authenticated',
  'public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)','EXECUTE'),
 'B2 RPC exists only in disposable PG, role grants do not include anon');
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN
   ('xb_legacy_history_entries','xb_legacy_settings'))
 AND (SELECT count(*)=2 FROM pg_class
  WHERE oid IN ('public.xb_legacy_history_entries'::regclass,
                'public.xb_legacy_settings'::regclass)
   AND relrowsecurity),
 'new history/settings tables both enable RLS');

-- Test signed-in family member cannot trigger an owner-only promotion.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
DO $deny_member$
BEGIN
 BEGIN
  PERFORM public.xb_promote_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '1c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   (SELECT source_sha256 FROM public.xb_legacy_staging
    WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'));
  RAISE EXCEPTION 'nonowner_promoted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$deny_member$;
SELECT set_config('xb.test.uid','archive-owner',false);
DO $wrong_digest$
BEGIN
 BEGIN
  PERFORM public.xb_promote_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '1c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64));
  RAISE EXCEPTION 'unmatched_archive_promoted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END
$wrong_digest$;

SELECT public.xb_test_assert(
 (SELECT r->>'status'='PROMOTED_HISTORY_AND_BASELINE'
    AND r->>'can_upload'='false'
    AND r->>'outbox_enabled'='false'
    AND r->>'history_edit_enabled'='false'
    AND r->>'receipt_committed'='true'
    AND (r->>'stock_units')::integer=49
    AND (r->>'history_count')::integer=4
    AND (r->>'weight_count')::integer=1
  FROM (SELECT public.xb_promote_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '1c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   (SELECT source_sha256 FROM public.xb_legacy_staging
    WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')) AS r) x),
 'one complete owner promotion writes receipt LAST, never enables outbox');

-- Lost HTTP response and request UUID changed: no double stock/ledger.
SELECT public.xb_test_assert(
 (public.xb_promote_legacy_archive_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  '2c5f0e45-bf18-4c95-889c-6f19731a8ae5',
  (SELECT source_sha256 FROM public.xb_legacy_staging
   WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 )->>'status')='ALREADY_PROMOTED_SAME_SOURCE',
 'changing migration UUID on retry cannot double-promote');
DO $different_digest$
BEGIN
 BEGIN
  PERFORM public.xb_promote_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '2c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('b',64));
  RAISE EXCEPTION 'modified_source_bypassed_receipt' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END
$different_digest$;
RESET ROLE;

-- Check native tables and source count/size semantics as administrator.
SELECT public.xb_test_assert(
 (SELECT count(*)=6 FROM public.xb_inventory
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
    AND revision=1)
 AND (SELECT sum(quantity)=49 FROM public.xb_inventory
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT quantity=42 FROM public.xb_inventory
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5' AND size='S')
 AND (SELECT count(*)=6 FROM public.xb_inventory_operations
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND kind='migration_baseline'
   AND delta IS NULL AND old_quantity=0 AND resulting_revision=1)
 AND (SELECT count(*)=0 FROM public.xb_transactions
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'six absolute stock baselines; history buys did NOT replay into live buys');
SELECT public.xb_test_assert(
 (SELECT count(*)=4 FROM public.xb_legacy_history_entries
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=2 FROM public.xb_legacy_history_entries
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND record_kind='transaction')
 AND (SELECT count(*)=1 FROM public.xb_weight_records
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND legacy_record_id='w1' AND weight_kg=3.267)
 AND (SELECT count(*)=1 FROM public.xb_baby_profiles
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND profile_data->'babyProfile'->>'name'='合成宝宝')
 AND (SELECT settings_data->'referenceOverrides'->>'合成品牌|合成系列|S'='1.235'
  FROM public.xb_legacy_settings
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=1 FROM public.xb_migrations
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND counts->>'archiveVerified'='true'
   AND counts->>'purchaseHistoryReplayed'='false'),
 'history/price/profile/native-weight and final digest receipt all present');

-- Readability is family-grant scoped and NOT migration-writable by client.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
SELECT public.xb_test_assert(
 (SELECT count(*)=4 FROM public.xb_legacy_history_entries)
 AND (SELECT count(*)=1 FROM public.xb_legacy_settings),
 'existing family member can read migrated history and settings via RLS');
DO $no_direct_write$
BEGIN
 BEGIN
  DELETE FROM public.xb_legacy_history_entries
   WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5';
  RAISE EXCEPTION 'client_deleted_immutable_migration' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$no_direct_write$;
RESET ROLE;

-- Deliberately grant anon EXECUTE to simulate CloudBase gateway ignoring ACL.
GRANT EXECUTE ON FUNCTION public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)
 TO anon;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $deny_anon$
BEGIN
 BEGIN
  PERFORM public.xb_promote_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '3c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64));
  RAISE EXCEPTION 'anon_promoted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$deny_anon$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)
 FROM anon;

-- Tampered archive count must not promote or create any business rows.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
DO $tamper_count$
BEGIN
 BEGIN
  UPDATE public.xb_legacy_staging
   SET counts=jsonb_set(counts,'{transactions}','999'::jsonb)
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5';
  PERFORM public.xb_promote_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '3c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   (SELECT source_sha256 FROM public.xb_legacy_staging
    WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5'));
  RAISE EXCEPTION 'tampered_archive_count_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END
$tamper_count$;
-- NOTE: preceding UPDATE under authenticated should be denied! Run
-- tamper as privileged test with separate admin block below instead.
RESET ROLE;

-- Inject failure AT THE LAST RECEIPT INSERT, after all business rows exist
-- inside the in-flight transaction. The whole migration must vanish.
CREATE FUNCTION public.xb_test_fail_last_migration_receipt()
 RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN
 IF NEW.family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5' THEN
  RAISE EXCEPTION 'simulated_last_receipt_failure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fail$;
CREATE TRIGGER xb_test_fail_last_receipt
 BEFORE INSERT ON public.xb_migrations
 FOR EACH ROW EXECUTE FUNCTION public.xb_test_fail_last_migration_receipt();
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
DO $receipt_failure$
BEGIN
 BEGIN
  PERFORM public.xb_promote_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '3c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   (SELECT source_sha256 FROM public.xb_legacy_staging
    WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5'));
  RAISE EXCEPTION 'migration_receipt_failure_was_not_seen' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END
$receipt_failure$;
RESET ROLE;
SELECT public.xb_test_assert(
 NOT EXISTS(SELECT 1 FROM public.xb_inventory
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_inventory_operations
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_legacy_history_entries
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_legacy_settings
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_weight_records
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_baby_profiles
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_migrations
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND EXISTS(SELECT 1 FROM public.xb_legacy_staging
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'failure at final receipt rolls back ALL live business writes, preserves archive');
DROP TRIGGER xb_test_fail_last_receipt ON public.xb_migrations;
DROP FUNCTION public.xb_test_fail_last_migration_receipt();

-- Retry after rollback must succeed once, then be immutable/idempotent.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
SELECT public.xb_test_assert(
 (public.xb_promote_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '4c5f0e45-bf18-4c95-889c-6f19731a8ae5',
   (SELECT source_sha256 FROM public.xb_legacy_staging
     WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 )->>'status')='PROMOTED_HISTORY_AND_BASELINE',
 'after last-receipt fault rolled back, a clean retry can promote');
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_migrations
  WHERE family_id IN(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5'))
 AND (SELECT count(*)=12 FROM public.xb_inventory
  WHERE family_id IN(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5'))
 AND (SELECT count(*)=8 FROM public.xb_legacy_history_entries
  WHERE family_id IN(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5')),
 'two synthetic families each have exactly one complete promotion');
\echo P2-4E-B2 isolated promotion full atomicity contract PASSED
