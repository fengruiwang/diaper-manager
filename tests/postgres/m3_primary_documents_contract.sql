-- Dedicated disposable PG16 ONLY. SQL 026 is draft; NO LIVE DB CHANGES.
-- Existing synthetic archived family was promoted by B2 prior to this test.
\echo M3 five business document kinds CAS + two-account + primary-only contract
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_read_primary_document_draft(uuid,uuid,text)') IS NOT NULL
 AND to_regprocedure('public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)') IS NOT NULL
 AND NOT has_table_privilege('authenticated','public.xb_primary_documents','SELECT')
 AND NOT has_table_privilege('authenticated','public.xb_primary_documents','UPDATE')
 AND NOT has_table_privilege('authenticated','public.xb_primary_document_commands','SELECT')
 AND NOT has_function_privilege('anon',
  'public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)','EXECUTE'),
 '026 only exposes family/primary receipt-gated definer RPC, no direct DML');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
SELECT public.xb_test_assert(
 (public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','quotes')->>'revision')='0'
 AND jsonb_array_length(public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','quotes')->'body'->'items')=1
 AND jsonb_array_length(public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','growth')->'body'->'items')=1
 AND jsonb_typeof(public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','profile')->'body'->'babyProfile')='object'
 AND jsonb_typeof(public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','settings')->'body'->'target')='object'
 AND jsonb_typeof(public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','reference')->'body'->'referenceOverrides')='object',
 'all five read kinds derive exact untouched legacy baseline with revision 0');

-- Member may safely publish the first CAS update.
SELECT public.xb_test_assert(
 (public.xb_put_primary_document_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'reference',0,'ca41f403-1111-4111-8111-000000000001',
  '{"referenceOverrides":{"好奇|小森林|S":1.123}}'::jsonb
 )->>'revision')='1',
 'family member writes precision-preserved reference with rev0→1');
SELECT public.xb_test_assert(
 (public.xb_put_primary_document_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'reference',0,'ca41f403-1111-4111-8111-000000000001',
  '{"referenceOverrides":{"好奇|小森林|S":1.123}}'::jsonb
 )->>'duplicate')='true',
 'ACK lost: exact same request UUID is receipt-only, not an extra write');
RESET ROLE;

-- Owner B observes the member A revision and cannot overwrite on old revision.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-owner',false);
SELECT public.xb_test_assert(
 (public.xb_read_primary_document_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','reference')->>'revision')='1',
 'B account reads A account latest shared document');
DO $conflict$
BEGIN
 BEGIN
  PERFORM public.xb_put_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'reference',0,'ca41f403-1111-4111-8111-000000000002',
   '{"referenceOverrides":{"好奇|小森林|S":1.124}}'::jsonb);
  RAISE EXCEPTION 'stale_B_overwrote_A' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
END $conflict$;
SELECT public.xb_test_assert(
 (public.xb_put_primary_document_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'reference',1,'ca41f403-1111-4111-8111-000000000003',
  '{"referenceOverrides":{"好奇|小森林|S":1.124}}'::jsonb
 )->>'revision')='2',
 'B account fresh CAS succeeds rev1→2');
DO $precision$
BEGIN
 BEGIN
  PERFORM public.xb_put_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'reference',2,'ca41f403-1111-4111-8111-000000000004',
   '{"referenceOverrides":{"好奇|小森林|S":1.1234}}'::jsonb);
  RAISE EXCEPTION 'submill_precision_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END $precision$;
DO $reuse$
BEGIN
 BEGIN
  PERFORM public.xb_put_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'reference',0,'ca41f403-1111-4111-8111-000000000001',
   '{"referenceOverrides":{"好奇|小森林|S":1.888}}'::jsonb);
  RAISE EXCEPTION 'reused_UUID_changed_payload_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END $reuse$;
RESET ROLE;

-- No new edits may silently overwrite the original receipt-backed data.
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_primary_document_commands)
 AND (SELECT revision=2 AND payload->'referenceOverrides'->>'好奇|小森林|S'='1.124'
      FROM public.xb_primary_documents
      WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
        AND child_id='7b5f0e45-bf18-4c95-889c-6f19731a8ae5'
        AND document_kind='reference')
 AND (SELECT count(*)=4 FROM public.xb_legacy_history_entries
      WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=6 FROM public.xb_inventory
      WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'),
 'A/B CAS writes preserve original migration history and all six stock baselines');

-- A smoke child in a family with an xb grant is still not a primary.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-owner',false);
DO $smoke$
DECLARE v_smoke uuid;
BEGIN
 SELECT id INTO v_smoke FROM public.xb_children
  WHERE family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5'
   AND legacy_slot='__xb_smoke_v1__';
 BEGIN
  PERFORM public.xb_read_primary_document_draft(
   'ac0b0e45-bf18-4c95-889c-6f19731a8ae5',v_smoke,'reference');
  RAISE EXCEPTION 'smoke_document_read_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $smoke$;
RESET ROLE;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $anon$
BEGIN
 BEGIN
  PERFORM public.xb_read_primary_document_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5','reference');
  RAISE EXCEPTION 'anon_document_read_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $anon$;
RESET ROLE;
\echo M3 primary documents CAS contract PASSED
