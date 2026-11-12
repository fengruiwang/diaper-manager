-- Synthetic only: user has NOT authorized real CloudBase changes.
\echo M3 atomic multi-size stocktake and ACK recovery PG16 contract
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)') IS NOT NULL
 AND NOT has_table_privilege('authenticated',
  'public.xb_stocktake_batch_receipts','SELECT')
 AND NOT has_table_privilege('authenticated',
  'public.xb_stocktake_batch_receipts','INSERT')
 AND NOT has_function_privilege('anon',
  'public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)','EXECUTE'),
 'batch stocktake is definer RPC only, cannot directly edit receipts');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
SELECT public.xb_test_assert(
 (public.xb_primary_stocktake_batch_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'aa41f403-1111-4111-8111-000000000001',
  '[{"size":"NB","count":8,"expectedRevision":1},
    {"size":"S","count":43,"expectedRevision":1}]'::jsonb
 )->'result'->>'changed_sizes')='2',
 'one family member can atomically change NB and S with server CAS');
SELECT public.xb_test_assert(
 (public.xb_primary_stocktake_batch_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'aa41f403-1111-4111-8111-000000000001',
  '[{"size":"NB","count":8,"expectedRevision":1},
    {"size":"S","count":43,"expectedRevision":1}]'::jsonb
 )->>'duplicate')='true',
 'lost response replays same batch UUID without second stock increment');
DO $conflict$
BEGIN
 BEGIN
  PERFORM public.xb_primary_stocktake_batch_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'aa41f403-1111-4111-8111-000000000002',
   '[{"size":"NB","count":9,"expectedRevision":2},
     {"size":"S","count":44,"expectedRevision":1}]'::jsonb);
  RAISE EXCEPTION 'stale_S_revision_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
END $conflict$;
DO $reuse$
BEGIN
 BEGIN
  PERFORM public.xb_primary_stocktake_batch_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'aa41f403-1111-4111-8111-000000000001',
   '[{"size":"NB","count":9,"expectedRevision":2}]'::jsonb);
  RAISE EXCEPTION 'batch_UUID_reuse_different_payload_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END $reuse$;
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_inventory
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND child_id='7b5f0e45-bf18-4c95-889c-6f19731a8ae5'
   AND ((size='NB' AND quantity=8 AND revision=2)
     OR (size='S' AND quantity=43 AND revision=2)))
 AND (SELECT count(*)=1 FROM public.xb_stocktake_batch_receipts
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5')
 AND (SELECT count(*)=2 FROM public.xb_inventory_operations
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND kind='stocktake'),
 'accepted two-size batch leaves one receipt and exactly two auditable stocktake events');

-- Inject failure after first size update; the WHOLE RPC transaction rolls back.
CREATE FUNCTION public.xb_test_fail_batch_stocktake()
 RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN
 IF NEW.family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
  AND NEW.size='S' AND NEW.kind='stocktake' THEN
  RAISE EXCEPTION 'synthetic_batch_second_size_failed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fail$;
CREATE TRIGGER xb_test_fail_stocktake
 BEFORE INSERT ON public.xb_inventory_operations
 FOR EACH ROW EXECUTE FUNCTION public.xb_test_fail_batch_stocktake();
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-owner',false);
DO $rollback$
BEGIN
 BEGIN
  PERFORM public.xb_primary_stocktake_batch_draft(
   '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
   '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
   'aa41f403-1111-4111-8111-000000000003',
   '[{"size":"NB","count":10,"expectedRevision":2},
     {"size":"S","count":45,"expectedRevision":2}]'::jsonb);
  RAISE EXCEPTION 'partial_batch_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END $rollback$;
RESET ROLE;
DROP TRIGGER xb_test_fail_stocktake ON public.xb_inventory_operations;
DROP FUNCTION public.xb_test_fail_batch_stocktake();
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_inventory
  WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
   AND ((size='NB' AND quantity=8 AND revision=2)
     OR (size='S' AND quantity=43 AND revision=2)))
 AND NOT EXISTS(SELECT 1 FROM public.xb_stocktake_batch_receipts
   WHERE family_id='9b8d0e45-bf18-4c95-889c-6f19731a8ae5'
     AND batch_id='aa41f403-1111-4111-8111-000000000003'),
 'second size injected error rolls back first size and receipt (ALL OR NOTHING)');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','archive-member',false);
SELECT public.xb_test_assert(
 (public.xb_read_primary_stocktake_batch_receipt_draft(
  '9b8d0e45-bf18-4c95-889c-6f19731a8ae5',
  '7b5f0e45-bf18-4c95-889c-6f19731a8ae5',
  'aa41f403-1111-4111-8111-000000000001'
 )->>'status')='COMMITTED',
 'A/B family member can read original batch UUID receipt after ACK loss');
RESET ROLE;
\echo M3 atomic multi-size batch stocktake contract PASSED
