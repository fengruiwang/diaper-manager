-- P2-3B isolated PG16 contract: SYNTHETIC family only.
-- Imported by p2_purchase_contract.sql AFTER all previous purchase tests.
-- NEVER EXECUTE ON REAL CLOUDBase; this file creates/retire test data.
\echo P2-3B owner-only virtual-child lifecycle (disposable PG only)

-- Never grant browser direct child writes or anon RPC execution.
SELECT public.xb_test_assert(
 NOT has_table_privilege('authenticated','public.xb_children','INSERT')
 AND NOT has_table_privilege('authenticated','public.xb_children','UPDATE')
 AND NOT has_function_privilege('anon','public.xb_create_smoke_child(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.xb_retire_smoke_child(uuid,uuid)','EXECUTE'),
 'P2-3B direct writes and anon SQL EXECUTE are denied');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-mom',false);

DO $test_member_create_denied$
BEGIN
 BEGIN
  PERFORM public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
  RAISE EXCEPTION 'member_create_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_member_create_denied$;

SELECT set_config('xb.test.uid','test-stranger',false);
DO $test_stranger_create_denied$
BEGIN
 BEGIN
  PERFORM public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
  RAISE EXCEPTION 'stranger_create_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_stranger_create_denied$;

-- Owner role alone is insufficient: removing the synthetic xb app grant
-- must block creation, even though the same user still owns this family.
RESET ROLE;
DELETE FROM public.family_app_access
 WHERE family_id='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5'
   AND user_uid='test-dad' AND app_code='xb';
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);
DO $test_owner_without_grant$
BEGIN
 BEGIN
  PERFORM public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
  RAISE EXCEPTION 'ungranted_owner_create_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_owner_without_grant$;
RESET ROLE;
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by)
 VALUES('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
        'test-dad','xb','test-dad');
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);

-- Legitimate owner may initialize precisely ONE dedicated test child.
SELECT set_config('xb.test.uid','test-dad',false);
SELECT public.xb_test_assert(
 (public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5')->>'created')::boolean,
 'owner first create returns created true');
SELECT public.xb_test_assert(
 NOT (public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5')->>'created')::boolean,
 'owner repeated create idempotent returns created false');
SELECT public.xb_test_assert(
 (SELECT count(*)=1 FROM public.xb_children WHERE legacy_slot='__xb_smoke_v1__')
 AND (SELECT count(*)=1 FROM public.xb_children WHERE legacy_slot='primary')
 AND (SELECT count(*)=2 FROM public.xb_children)
 AND (SELECT count(*)=0 FROM public.xb_children WHERE legacy_slot='__xb_smoke_v1__' AND deleted_at IS NOT NULL),
 'smoke singleton coexists with untouched primary');
SELECT public.xb_test_assert(
 (SELECT count(*)=0 FROM public.xb_inventory inv
    JOIN public.xb_children c ON c.id=inv.child_id WHERE c.legacy_slot='__xb_smoke_v1__')
 AND (SELECT count(*)=0 FROM public.xb_inventory_operations op
    JOIN public.xb_children c ON c.id=op.child_id WHERE c.legacy_slot='__xb_smoke_v1__')
 AND (SELECT count(*)=0 FROM public.xb_transactions tx
    JOIN public.xb_children c ON c.id=tx.child_id WHERE c.legacy_slot='__xb_smoke_v1__'),
 'creating smoke child does not create inventory or purchases');

-- Owner cannot accidentally retire the real/legacy primary baby.
DO $test_primary_retire_denied$
BEGIN
 BEGIN
  PERFORM public.xb_retire_smoke_child(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5');
  RAISE EXCEPTION 'primary_retire_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END
$test_primary_retire_denied$;
SELECT public.xb_test_assert(
 (SELECT deleted_at IS NULL AND revision=0
  FROM public.xb_children WHERE legacy_slot='primary'),
 'primary child remains untouched after wrong-target retirement');

-- Member cannot retire even if child ID is known.
SELECT set_config('xb.test.uid','test-mom',false);
DO $test_member_retire_denied$
DECLARE v_child_id uuid;
BEGIN
 SELECT id INTO v_child_id FROM public.xb_children
  WHERE legacy_slot='__xb_smoke_v1__';
 BEGIN
  PERFORM public.xb_retire_smoke_child(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',v_child_id);
  RAISE EXCEPTION 'member_retire_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_member_retire_denied$;

-- After owner retires, do not DELETE any inventory history or revive the child.
SELECT set_config('xb.test.uid','test-dad',false);
DO $test_owner_retire$
DECLARE v_child_id uuid; v_result jsonb;
BEGIN
 SELECT id INTO v_child_id FROM public.xb_children
  WHERE legacy_slot='__xb_smoke_v1__';
 v_result:=public.xb_retire_smoke_child(
  '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',v_child_id);
 PERFORM public.xb_test_assert((v_result->>'retired')::boolean,
  'owner retires smoke baby with tombstone');
 v_result:=public.xb_retire_smoke_child(
  '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',v_child_id);
 PERFORM public.xb_test_assert((v_result->>'already_retired')::boolean,
  'duplicate retire idempotent');
END
$test_owner_retire$;

SELECT public.xb_test_assert(
 (SELECT deleted_at IS NOT NULL AND revision=1
  FROM public.xb_children WHERE legacy_slot='__xb_smoke_v1__')
 AND (SELECT deleted_at IS NULL FROM public.xb_children WHERE legacy_slot='primary')
 AND (SELECT count(*)=2 FROM public.xb_children),
 'retirement is a tombstone, not destructive cleanup');

DO $test_no_revival$
BEGIN
 BEGIN
  PERFORM public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
  RAISE EXCEPTION 'retired_smoke_child_unexpectedly_revived' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END
$test_no_revival$;

-- Existing 009 business RPC must refuse a retired smoke child.
DO $test_retired_purchase_denied$
DECLARE v_child_id uuid;
BEGIN
 SELECT id INTO v_child_id FROM public.xb_children
  WHERE legacy_slot='__xb_smoke_v1__';
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',v_child_id,
   '841f2520-fbe5-4493-99b7-10b75aec13a9',
   'buy','S',10,NULL,NULL,'2026-11-11T04:00:00Z',
   '{"brand":"虚拟品牌","series":"开发系列","total_fen":1000,"purchase_date":"2026-11-11"}'::jsonb);
  RAISE EXCEPTION 'retired_smoke_purchase_unexpectedly_accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_retired_purchase_denied$;

RESET ROLE;
-- Internal migration receipts are intentionally private to authenticated.
-- Verify their absence only after RESET ROLE as the synthetic admin harness.
SELECT public.xb_test_assert(
 (SELECT count(*)=0 FROM public.xb_migrations m
  JOIN public.xb_children c ON c.id=m.child_id
  WHERE c.legacy_slot='__xb_smoke_v1__'),
 'smoke child never creates a private migration receipt');
SELECT public.xb_test_assert(
 (SELECT count(*)=0 FROM public.xb_inventory inv
    JOIN public.xb_children c ON c.id=inv.child_id WHERE c.legacy_slot='__xb_smoke_v1__')
 AND (SELECT count(*)=0 FROM public.xb_transactions tx
    JOIN public.xb_children c ON c.id=tx.child_id WHERE c.legacy_slot='__xb_smoke_v1__')
 AND (SELECT count(*)=0 FROM public.xb_inventory_operations op
    JOIN public.xb_children c ON c.id=op.child_id WHERE c.legacy_slot='__xb_smoke_v1__'),
 'failed retired child purchase left no data');

-- Simulate anon with SQL rights forcibly granted (gateway may ignore EXECUTE).
-- Internal checks must STILL reject anonymous callers.
GRANT EXECUTE ON FUNCTION public.xb_create_smoke_child(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.xb_retire_smoke_child(uuid,uuid) TO anon;
SET ROLE anon;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','',false);
DO $test_anon_create_denied$
BEGIN
 BEGIN
  PERFORM public.xb_create_smoke_child('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
  RAISE EXCEPTION 'anon_create_unexpectedly_succeeded' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END
$test_anon_create_denied$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.xb_create_smoke_child(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.xb_retire_smoke_child(uuid,uuid) FROM anon;
SELECT public.xb_test_assert(
 NOT has_function_privilege('anon','public.xb_create_smoke_child(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.xb_retire_smoke_child(uuid,uuid)','EXECUTE'),
 'anon permissions restored after gateway bypass simulation');
\echo P2-3B synthetic owner-only smoke child lifecycle passed
