-- P2-4F-A: read-only history and settings RPC contract.
-- Synthetic PG16, never execute on real family database.
\echo P2-4F-A committed history/setting read and pagination contract
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)') IS NOT NULL
 AND to_regprocedure('public.xb_read_legacy_settings_draft(uuid,uuid)') IS NOT NULL
 AND NOT has_function_privilege('anon',
  'public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)','EXECUTE')
 AND NOT has_function_privilege('anon',
  'public.xb_read_legacy_settings_draft(uuid,uuid)','EXECUTE'),
 'read-only function definitions exist with no anon execute grants');
SELECT public.xb_test_assert(
 (SELECT provolatile='s' AND prosecdef
  FROM pg_proc WHERE oid=
    'public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)'::regprocedure)
 AND (SELECT provolatile='s' AND prosecdef
  FROM pg_proc WHERE oid=
    'public.xb_read_legacy_settings_draft(uuid,uuid)'::regprocedure),
 'both read functions stable and security definer');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=4 AND (r->>'offset')::integer=0
  AND (r->>'limit')::integer=2
  AND r->>'record_kind'='all' AND r->>'has_more'='true'
  AND r->>'complete'='true' AND r->>'can_edit'='false'
  AND r->>'can_upload'='false'
  AND jsonb_array_length(r->'rows')=2
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'all',0,2) r) p),
 'family member may read first bounded page of COMMITTED history');
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=4 AND r->>'has_more'='false'
  AND jsonb_array_length(r->'rows')=2
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'all',2,2) r) p),
 'second immutable history page is complete with no more results');
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=2
  AND jsonb_array_length(r->'rows')=2
  AND r->'rows'->0->>'kind'='transaction'
  AND r->'rows'->0->'payload'->>'type'='buy'
  AND r->'rows'->1->'payload'->>'type'='use'
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'transaction',0,20) r) p),
 'old buy/use history is readable but isolated from new inventory deltas');
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=1
  AND r->'rows'->0->'payload'->>'id'='q1'
  AND (r->'rows'->0->'payload'->>'unit')::numeric=0.775
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'quote',0,20) r) p),
 'legacy unit-price and original quote payload retained');
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=1
  AND (r->'rows'->0->'payload'->>'weight')::numeric=3.267
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'weight',0,20) r) p),
 'legacy weight history retained with original precision');
SELECT public.xb_test_assert(
 (SELECT r->>'complete'='true' AND r->>'can_edit'='false'
   AND r->>'can_upload'='false'
   AND (r->>'revision')::bigint=0
   AND r->'settings'->'referenceOverrides'->>'合成品牌|合成系列|S'='1.235'
   AND r->'settings'->'daily'->>'NB'='10'
 FROM (SELECT public.xb_read_legacy_settings_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5') r) p),
 'reference price overrides and daily target available read-only');
SELECT public.xb_test_assert(
 (SELECT (r->>'total')::integer=4 AND jsonb_array_length(r->'rows')=0
  AND r->>'has_more'='false'
 FROM (SELECT public.xb_read_legacy_history_page_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'all',100,2) r) p),
 'out-of-range offset returns empty safe page rather than all history');

DO $invalid_scope$
BEGIN
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'all',0,51);
  RAISE EXCEPTION 'unbounded_page_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'all',-1,2);
  RAISE EXCEPTION 'negative_offset_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'hacked_type',0,2);
  RAISE EXCEPTION 'invalid_kind_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END
$invalid_scope$;

DO $uncommitted_stage$
BEGIN
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   'a28d0e45-bf18-4c95-889c-6f19731a8ae5',
   'b35f0e45-bf18-4c95-889c-6f19731a8ae5',
   'all',0,5);
  RAISE EXCEPTION 'unverified_receipt_data_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$uncommitted_stage$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);
DO $cross_family$
BEGIN
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'all',0,2);
  RAISE EXCEPTION 'other_family_history_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_read_legacy_settings_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5');
  RAISE EXCEPTION 'other_family_settings_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$cross_family$;
RESET ROLE;

-- Simulate CloudBase RPC gateway ignoring SQL EXECUTE ACL for anonymous role.
GRANT EXECUTE ON FUNCTION public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.xb_read_legacy_settings_draft(uuid,uuid) TO anon;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $anonymous_denial$
BEGIN
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'all',0,2);
  RAISE EXCEPTION 'anonymous_history_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_read_legacy_settings_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5');
  RAISE EXCEPTION 'anonymous_settings_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$anonymous_denial$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.xb_read_legacy_settings_draft(uuid,uuid) FROM anon;

SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_migrations WHERE family_id IN(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  'ba8d0e45-bf18-4c95-889c-6f19731a8ae5'))
 AND (SELECT count(*)=8 FROM public.xb_legacy_history_entries WHERE family_id IN(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  'ba8d0e45-bf18-4c95-889c-6f19731a8ae5')),
 'read-only calls left receipts and history counts unchanged');
\echo P2-4F-A bounded legacy history/settings read SQL contract PASSED
