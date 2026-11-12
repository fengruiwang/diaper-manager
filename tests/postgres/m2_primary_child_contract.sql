-- M2 owner-only primary RPC contract against disposable PG16 ONLY.
-- Loaded after synthetic P2 migration tests. Never execute on CloudBase.
\echo M2 SQL025 primary + retained smoke isolated SQL contract
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_create_primary_child(uuid)') IS NOT NULL
 AND has_function_privilege('authenticated','public.xb_create_primary_child(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.xb_create_primary_child(uuid)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.xb_children','INSERT'),
 '025 installed as authenticated RPC, not direct table insert');
INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('ac0b0e45-bf18-4c95-889c-6f19731a8ae5',
 'M2 SYNTHETIC PRIMARY FAMILY','m2-owner'),
 ('bc0b0e45-bf18-4c95-889c-6f19731a8ae5',
 'M2 SYNTHETIC RETIRE FAMILY','m2-retire-owner');
INSERT INTO public.family_members(family_id,user_uid,member_role) VALUES
 ('ac0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-owner','owner'),
 ('ac0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-member','member'),
 ('bc0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-retire-owner','owner');
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by) VALUES
 ('ac0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-owner','xb','m2-owner'),
 ('ac0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-member','xb','m2-owner'),
 ('bc0b0e45-bf18-4c95-889c-6f19731a8ae5','m2-retire-owner','xb','m2-retire-owner');

-- The smoke child is a real retained child inside the synthetic family.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-owner',false);
SELECT public.xb_test_assert(
 (public.xb_create_smoke_child('ac0b0e45-bf18-4c95-889c-6f19731a8ae5')->>'created')::boolean,
 'synthetic smoke child created exactly once');
RESET ROLE;

-- Simulated existing S140 is admin-only synthetic fixture, not a UI purchase.
INSERT INTO public.xb_inventory(family_id,child_id,size,quantity,revision,updated_by)
SELECT family_id,id,'S',140,2,'m2-synthetic-setup'
FROM public.xb_children
WHERE family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5'
 AND legacy_slot='__xb_smoke_v1__';
SELECT public.xb_test_assert(
 (SELECT count(*)=1 FROM public.xb_inventory i JOIN public.xb_children c
   ON c.family_id=i.family_id AND c.id=i.child_id
   WHERE c.family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5'
    AND c.legacy_slot='__xb_smoke_v1__' AND i.size='S'
    AND i.quantity=140 AND i.revision=2),
 'synthetic retained S140 is seeded only for primary isolation test');

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-member',false);
DO $member_denied$
BEGIN
 BEGIN
  PERFORM public.xb_create_primary_child('ac0b0e45-bf18-4c95-889c-6f19731a8ae5');
  RAISE EXCEPTION 'member_created_primary' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $member_denied$;
SELECT set_config('xb.test.uid','m2-owner',false);
SELECT public.xb_test_assert(
 (public.xb_create_primary_child('ac0b0e45-bf18-4c95-889c-6f19731a8ae5')->>'created')::boolean,
 'owner creates first and only primary while retained smoke has S140');
SELECT public.xb_test_assert(
 NOT (public.xb_create_primary_child('ac0b0e45-bf18-4c95-889c-6f19731a8ae5')->>'created')::boolean,
 'same owner primary RPC is idempotent and does not create second baby');
RESET ROLE;

SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_children
   WHERE family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5' AND deleted_at IS NULL)
 AND (SELECT count(*)=1 FROM public.xb_children
   WHERE family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5' AND legacy_slot='primary')
 AND (SELECT count(*)=0 FROM public.xb_inventory i JOIN public.xb_children c
   ON c.family_id=i.family_id AND c.id=i.child_id
   WHERE c.family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5' AND c.legacy_slot='primary')
 AND (SELECT i.quantity=140 AND i.revision=2
   FROM public.xb_inventory i JOIN public.xb_children c
    ON c.family_id=i.family_id AND c.id=i.child_id
   WHERE c.family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5'
    AND c.legacy_slot='__xb_smoke_v1__' AND i.size='S'),
 'primary target is separately scoped; existing smoke S140 is unchanged');

-- The new primary has no completed migration receipt: read-only RPCs MUST reject.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-member',false);
DO $receipt_required$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM public.xb_children
  WHERE family_id='ac0b0e45-bf18-4c95-889c-6f19731a8ae5'
    AND legacy_slot='primary';
 BEGIN
  PERFORM public.xb_read_legacy_history_page_draft(
   'ac0b0e45-bf18-4c95-889c-6f19731a8ae5',v_id,'all',0,50);
  RAISE EXCEPTION 'unmigrated_primary_history_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_read_legacy_settings_draft(
   'ac0b0e45-bf18-4c95-889c-6f19731a8ae5',v_id);
  RAISE EXCEPTION 'unmigrated_primary_settings_visible' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $receipt_required$;
RESET ROLE;

-- An already retired primary is never recreated or silently reactivated.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-retire-owner',false);
SELECT public.xb_test_assert(
 (public.xb_create_primary_child('bc0b0e45-bf18-4c95-889c-6f19731a8ae5')->>'created')::boolean,
 'synthetic second family primary initially created');
RESET ROLE;
UPDATE public.xb_children SET deleted_at=now()
WHERE family_id='bc0b0e45-bf18-4c95-889c-6f19731a8ae5' AND legacy_slot='primary';
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','m2-retire-owner',false);
DO $retired_blocked$
BEGIN
 BEGIN
  PERFORM public.xb_create_primary_child('bc0b0e45-bf18-4c95-889c-6f19731a8ae5');
  RAISE EXCEPTION 'retired_primary_recreated' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END $retired_blocked$;
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT count(*)=1 AND bool_and(deleted_at IS NOT NULL)
  FROM public.xb_children
  WHERE family_id='bc0b0e45-bf18-4c95-889c-6f19731a8ae5' AND legacy_slot='primary'),
 'retired primary remains one retired record, never silently recreated');
\echo M2 primary RPC scoped isolation contract passed
