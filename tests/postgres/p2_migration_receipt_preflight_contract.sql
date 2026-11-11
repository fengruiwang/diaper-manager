-- P2-4E synthetic-only contract. Runs AFTER the existing P2 tests.
-- Never run against the live xiaobao-family. Only disposable PostgreSQL CI.
\echo P2-4E receipt preview, uniqueness and transaction-rollback contracts
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)') IS NOT NULL,
 'draft migration preview exists only in isolated PG');
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM pg_indexes WHERE schemaname='public'
  AND indexname IN ('xb_migration_once_per_child_source_format',
   'xb_migration_source_digest_once_per_family')
  AND indexdef LIKE 'CREATE UNIQUE INDEX%'),
 'both server-enforced receipt uniqueness indexes present');
SELECT public.xb_test_assert(
 NOT has_function_privilege('anon',
 'public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)','EXECUTE')
 AND has_function_privilege('authenticated',
 'public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)','EXECUTE'),
 'authenticated grant and anon exclusion for preview');

-- Isolated alternate household: no production IDs, no historical data.
-- The primary child is clean, the second child only tests mis-targeted imports.
INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5','P2-4E SYNTHETIC FAMILY','synthetic-migration-owner');
INSERT INTO public.family_members(family_id,user_uid,member_role) VALUES
 ('a28d0e45-bf18-4c95-889c-6f19731a8ae5','synthetic-migration-owner','owner'),
 ('a28d0e45-bf18-4c95-889c-6f19731a8ae5','synthetic-migration-member','member');
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by) VALUES
 ('a28d0e45-bf18-4c95-889c-6f19731a8ae5','synthetic-migration-owner','xb','synthetic-migration-owner'),
 ('a28d0e45-bf18-4c95-889c-6f19731a8ae5','synthetic-migration-member','xb','synthetic-migration-owner');
INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by) VALUES
 ('b35f0e45-bf18-4c95-889c-6f19731a8ae5',
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5','primary','CLEAN SYNTHETIC BABY','synthetic-migration-owner'),
 ('c35f0e45-bf18-4c95-889c-6f19731a8ae5',
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5',NULL,'WRONG SYNTHETIC BABY','synthetic-migration-owner'),
 ('d35f0e45-bf18-4c95-889c-6f19731a8ae5',
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5','__xb_smoke_other__',
  'ISOLATED TEST BABY','synthetic-migration-owner');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','synthetic-migration-owner',false);
SELECT public.xb_test_assert(
 (SELECT result->>'status'='PLAN_ONLY_EMPTY_TARGET'
  AND result->>'can_commit'='false'
  AND result->>'can_upload'='false'
  AND result->>'receipt_committed'='false'
  AND result->>'requires_separate_approval'='true'
 FROM (SELECT public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1') AS result) q),
 'clean child provides PLAN ONLY, never permission to upload or commit');

-- Source/format validation must fail independently from client-side checks.
DO $p2_4e_invalid$
BEGIN
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   'FAKE-MD5','xiaobao-diapers:v1');
  RAISE EXCEPTION 'invalid_hash_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v2');
  RAISE EXCEPTION 'wrong_format_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END
$p2_4e_invalid$;

-- Only the active primary may be used, not an arbitrary or smoke child.
DO $p2_4e_wrong_target$
BEGIN
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'c35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1');
  RAISE EXCEPTION 'wrong_child_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'd35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1');
  RAISE EXCEPTION 'smoke_child_not_denied' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$p2_4e_wrong_target$;

-- Even under the known P2 production-like purchase state, preflight cannot
-- propose an empty source target.
SELECT set_config('xb.test.uid','test-dad',false);
SELECT public.xb_test_assert(
 (public.xb_preview_legacy_migration_receipt(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('b',64),'xiaobao-diapers:v1')->>'status')
   ='TARGET_ALREADY_HAS_BUSINESS_DATA',
 'existing business inventory rejects clean-target preview');

SELECT set_config('xb.test.uid','synthetic-migration-member',false);
DO $p2_4e_member$
BEGIN
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1');
  RAISE EXCEPTION 'member_must_not_preview_migration' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$p2_4e_member$;

SELECT set_config('xb.test.uid','synthetic-migration-stranger',false);
DO $p2_4e_stranger$
BEGIN
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1');
  RAISE EXCEPTION 'stranger_must_not_preview_migration' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$p2_4e_stranger$;
RESET ROLE;

-- Simulate the CloudBase REST RPC gateway ignoring anon EXECUTE permissions.
-- Function body must still refuse anonymous callers at SQL layer.
GRANT EXECUTE ON FUNCTION public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text) TO anon;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $p2_4e_anon$
BEGIN
 BEGIN
  PERFORM public.xb_preview_legacy_migration_receipt(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1');
  RAISE EXCEPTION 'anon_rpc_gateway_bypass' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$p2_4e_anon$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text) FROM anon;

-- No SELECT grant or RLS policy permits a client to read private receipts.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','synthetic-migration-owner',false);
DO $p2_4e_private$
BEGIN
 BEGIN
  PERFORM count(*) FROM public.xb_migrations;
  RAISE EXCEPTION 'client_read_private_receipts' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$p2_4e_private$;
RESET ROLE;

-- All insertions below are synthetic admin-only contract fixtures.
-- They are NOT examples that should be run in the real CloudBase SQL editor.
INSERT INTO public.xb_migrations(
 family_id,migration_id,child_id,source_sha256,source_format,counts,initiated_by)
VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5',
 'e35f0e45-bf18-4c95-889c-6f19731a8ae5',
 'c35f0e45-bf18-4c95-889c-6f19731a8ae5',
 repeat('f',64),'xiaobao-diapers:v1','{"synthetic":true}'::jsonb,'synthetic-migration-owner');
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','synthetic-migration-owner',false);
SELECT public.xb_test_assert(
 (public.xb_preview_legacy_migration_receipt(
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
  'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
  repeat('f',64),'xiaobao-diapers:v1')->>'status')
  ='SOURCE_RECEIPTED_FOR_OTHER_CHILD',
 'same source fingerprint cannot be targeted to another child');
RESET ROLE;

INSERT INTO public.xb_migrations(
 family_id,migration_id,child_id,source_sha256,source_format,counts,initiated_by)
VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5',
 'f35f0e45-bf18-4c95-889c-6f19731a8ae5',
 'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
 repeat('a',64),'xiaobao-diapers:v1','{"synthetic":true}'::jsonb,'synthetic-migration-owner');
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','synthetic-migration-owner',false);
SELECT public.xb_test_assert(
 (public.xb_preview_legacy_migration_receipt(
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
  'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
  repeat('a',64),'xiaobao-diapers:v1')->>'status')
  ='ALREADY_RECEIPTED_SAME_SOURCE',
 'lost response replay identifies the same already receipted source');
SELECT public.xb_test_assert(
 (public.xb_preview_legacy_migration_receipt(
  'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
  'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
  repeat('b',64),'xiaobao-diapers:v1')->>'status')
  ='CHILD_HAS_DIFFERENT_RECEIPT',
 'different source backup cannot silently replace existing migration');
RESET ROLE;

-- Database constraints are the FINAL idempotency guard.  Changing request
-- UUID, source hash or target child does not bypass the unique receipt keys.
DO $p2_4e_conflict$
BEGIN
 BEGIN
  INSERT INTO public.xb_migrations(
   family_id,migration_id,child_id,source_sha256,source_format,counts,initiated_by)
  VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'a45f0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('b',64),'xiaobao-diapers:v1','{}'::jsonb,'synthetic-migration-owner');
  RAISE EXCEPTION 'changing_backup_and_id_bypassed_child_unique' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
 BEGIN
  INSERT INTO public.xb_migrations(
   family_id,migration_id,child_id,source_sha256,source_format,counts,initiated_by)
  VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'a55f0e45-bf18-4c95-889c-6f19731a8ae5',
   'd35f0e45-bf18-4c95-889c-6f19731a8ae5',
   repeat('a',64),'xiaobao-diapers:v1','{}'::jsonb,'synthetic-migration-owner');
  RAISE EXCEPTION 'changing_child_bypassed_source_unique' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END
$p2_4e_conflict$;

-- A real future import RPC must insert the receipt within the SAME
-- transaction as all business rows. Verify PG subtransaction rollback for
-- a synthetic failure that occurs AFTER a simulated inventory insert.
DO $p2_4e_rollback$
BEGIN
 BEGIN
  INSERT INTO public.xb_inventory(
   family_id,child_id,size,quantity,revision,updated_by)
  VALUES('a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'c35f0e45-bf18-4c95-889c-6f19731a8ae5','NB',12,0,
   'synthetic-migration-owner');
  RAISE EXCEPTION 'simulated_business_write_failed' USING ERRCODE='23514';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END
$p2_4e_rollback$;
SELECT public.xb_test_assert(
 NOT EXISTS(SELECT 1 FROM public.xb_inventory
  WHERE family_id='a28d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND child_id='c35f0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=2 FROM public.xb_migrations
  WHERE family_id='a28d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'simulated failed business subtransaction leaves no stock or extra receipt');
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_migrations
  WHERE family_id='a28d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'duplicate/conflicting receipt inserts created no extra private rows');
\echo P2-4E receipt idempotency/ACL/read-only-preview synthetic contract PASSED
