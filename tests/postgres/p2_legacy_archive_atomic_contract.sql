-- XiaoBao P2-4E-B1. One-time PostgreSQL synthetic fixture ONLY.
-- Must run AFTER draft 022 DDL, NEVER in a real CloudBase SQL console.
\echo P2-4E-B1 atomic source archiving and no-stock-replay contract
INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
 'SYNTHETIC ARCHIVE FAMILY','archive-owner'),
 ('ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
 'SYNTHETIC ROLLBACK FAMILY','rollback-owner');
INSERT INTO public.family_members(family_id,user_uid,member_role) VALUES
 ('9b8d0e45-bf18-4c95-889c-6f19731a8ae5','archive-owner','owner'),
 ('9b8d0e45-bf18-4c95-889c-6f19731a8ae5','archive-member','member'),
 ('ba8d0e45-bf18-4c95-889c-6f19731a8ae5','rollback-owner','owner');
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by) VALUES
 ('9b8d0e45-bf18-4c95-889c-6f19731a8ae5','archive-owner','xb','archive-owner'),
 ('9b8d0e45-bf18-4c95-889c-6f19731a8ae5','archive-member','xb','archive-owner'),
 ('ba8d0e45-bf18-4c95-889c-6f19731a8ae5','rollback-owner','xb','rollback-owner');
INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by)
 VALUES('7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
 '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
 'primary','SYNTHETIC BABY','archive-owner'),
 ('ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
 'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
 'primary','SYNTHETIC ROLLBACK BABY','rollback-owner');

SELECT set_config('xb.test.legacy_export',$synthetic_source$
{"app":"xiaobao-diapers","version":1,"exportedAt":"2026-11-11T04:15:00.000Z","data":{"dueDate":"2027-01-08","birthDate":"","currentSize":"NB","babyWeight":"","babyProfile":{"name":"合成宝宝","sex":"","birthTime":"","birthWeight":"","birthLength":""},"weightRecords":[{"id":"w1","date":"2027-01-08","time":"09:20","weight":3.267,"note":"合成记录"}],"sizeMode":"manual","autoSize":"NB","replenishPolicy":{"mode":"days","days":7},"goalPrice":1.5,"plannedBudget":250,"target":{"NB":100,"S":60,"M":0,"L":0,"XL":0,"XXL":0},"daily":{"NB":10,"S":9,"M":7,"L":6,"XL":5,"XXL":5},"inventory":{"NB":7,"S":42,"M":0,"L":0,"XL":0,"XXL":0},"quotes":[{"id":"q1","date":"2026-11-10","brand":"合成品牌","series":"合成系列","size":"S","per":20,"packs":1,"pieces":20,"price":15.50,"unit":0.775}],"transactions":[{"id":"b1","type":"buy","date":"2026-11-10","brand":"合成品牌","series":"合成系列","size":"S","pieces":60,"price":29.99},{"id":"u1","type":"use","date":"2026-11-11","size":"NB","pieces":5,"price":0}],"referenceOverrides":{"合成品牌|合成系列|S":1.235},"preset":"balanced"}}
$synthetic_source$,false);

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
DO $member_denied$
BEGIN
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '3b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export'));
  RAISE EXCEPTION 'member_write_was_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$member_denied$;
SELECT set_config('xb.test.uid','archive-owner',false);
SELECT public.xb_test_assert(
 (SELECT v->>'status'='ARCHIVED_ONLY_NOT_MIGRATED'
  AND v->>'can_upload'='false'
  AND v->>'can_commit'='false'
  AND v->>'receipt_committed'='false'
  AND (v->>'archived_transaction_count')::integer=2
  AND (v->>'archived_quote_count')::integer=1
  AND (v->>'archived_weight_count')::integer=1
 FROM(SELECT public.xb_stage_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '3b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export')) AS v) s),
 'first complete source archive succeeds but NEVER finalizes migration');

-- Reply lost and phone retries with a DIFFERENT stage UUID.
SELECT public.xb_test_assert(
 (public.xb_stage_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '4b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export'))->>'status')
   ='ALREADY_STAGED_SAME_SOURCE',
 'exact source retry recognized despite changed stage UUID');
DO $changed_source$
BEGIN
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '5b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   replace(current_setting('xb.test.legacy_export'),
           '"NB":7','"NB":9'));
  RAISE EXCEPTION 'changed_stock_backup_was_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END
$changed_source$;
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT source_text=current_setting('xb.test.legacy_export')
    AND source_sha256=encode(sha256(
      convert_to(current_setting('xb.test.legacy_export'),'UTF8')),'hex')
    AND source_bytes=octet_length(current_setting('xb.test.legacy_export'))
    AND state_data->'inventory'->>'S'='42'
    AND counts->>'referenceOverrides'='1'
    AND stage_status='archive_only'
  FROM public.xb_legacy_staging
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'exact raw backup, SHA256, inventory and references retained');
SELECT public.xb_test_assert(
 (SELECT count(*)=4 FROM public.xb_legacy_stage_records
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=2 FROM public.xb_legacy_stage_records
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
 AND record_kind='transaction')
 AND (SELECT count(*)=0 FROM public.xb_inventory
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=0 FROM public.xb_inventory_operations
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=0 FROM public.xb_transactions
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=0 FROM public.xb_migrations
 WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'staged 2 historical transactions + quote + weight, no live stock or final receipt');

-- SQL/HTTP perms must not leak the full private user archive.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-owner',false);
DO $private_denied$
BEGIN
 BEGIN
  PERFORM count(*) FROM public.xb_legacy_staging;
  RAISE EXCEPTION 'private_archive_read_unexpectedly_allowed' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  PERFORM count(*) FROM public.xb_legacy_stage_records;
  RAISE EXCEPTION 'private_records_read_unexpectedly_allowed' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$private_denied$;
RESET ROLE;

-- Anonymous credential bypass test: EVEN IF the RPC gateway ignores GRANT.
GRANT EXECUTE ON FUNCTION public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text) TO anon;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $anon_denied$
BEGIN
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export'));
  RAISE EXCEPTION 'anonymous_stage_was_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$anon_denied$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text) FROM anon;

-- Injection: transaction insert succeeds, then a quote INSERT fails.
-- The partial stage, transactions, and source are all rolled back together.
CREATE FUNCTION public.xb_test_fail_archive_quote()
RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN
 IF NEW.record_kind='quote' THEN
  RAISE EXCEPTION 'synthetic_quote_archive_failure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END
$fail$;
CREATE TRIGGER xb_test_fail_archive_quote_trigger
 BEFORE INSERT ON public.xb_legacy_stage_records
 FOR EACH ROW EXECUTE FUNCTION public.xb_test_fail_archive_quote();

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
DO $stage_rollback$
BEGIN
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export'));
  RAISE EXCEPTION 'expected_quote_insert_failure_not_seen' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END
$stage_rollback$;
RESET ROLE;
SELECT public.xb_test_assert(
 NOT EXISTS(SELECT 1 FROM public.xb_legacy_staging
  WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_legacy_stage_records
  WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND NOT EXISTS(SELECT 1 FROM public.xb_migrations
  WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'injected mid-archive failure rolls back source and every history record');
DROP TRIGGER xb_test_fail_archive_quote_trigger ON public.xb_legacy_stage_records;
DROP FUNCTION public.xb_test_fail_archive_quote();

-- No synthetic corrupted submission should create stage records.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
DO $bad_archive$
BEGIN
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   replace(current_setting('xb.test.legacy_export'),'"version":1','"version":2'));
  RAISE EXCEPTION 'unknown_version_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   replace(current_setting('xb.test.legacy_export'),'"price":29.99','"price":29.995'));
  RAISE EXCEPTION 'third_decimal_purchase_total_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   replace(current_setting('xb.test.legacy_export'),'"S":42','"S":42.5'));
  RAISE EXCEPTION 'fractional_stock_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   replace(current_setting('xb.test.legacy_export'),'"id":"u1"','"id":"b1"'));
  RAISE EXCEPTION 'duplicate_history_id_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END
$bad_archive$;
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT count(*)=0 FROM public.xb_legacy_staging
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=0 FROM public.xb_legacy_stage_records
   WHERE family_id='ba8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'rejected malformed exports leave no staged PII or partial record');

-- After all rejected attempts, a valid stage still works for same child.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','rollback-owner',false);
SELECT public.xb_test_assert(
 (public.xb_stage_legacy_archive_draft(
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ca5f0e45-bf18-4c95-889c-6f19731a8ae5',
   '6b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   current_setting('xb.test.legacy_export'))->>'status')
    ='ARCHIVED_ONLY_NOT_MIGRATED',
 'valid retry after injected failure can archive without rebuilding inventory');
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_legacy_staging)
 AND (SELECT count(*)=8 FROM public.xb_legacy_stage_records)
 AND (SELECT count(*)=0 FROM public.xb_migrations
  WHERE family_id IN (
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   'ba8d0e45-bf18-4c95-889c-6f19731a8ae5')),
 'two complete synthetic archives and zero fake final migration receipts');
\echo P2-4E-B1 atomic archive-only contract PASSED
