\set ON_ERROR_STOP on
\echo P2 isolated PostgreSQL contract: no CloudBase or user data is accessed

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('xb.test.uid',true),'');
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('xb.test.role',true),'');
$$;
CREATE FUNCTION public.xb_test_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'test_assertion_failed: %',label; END IF;
END;
$$;

\i cloudbase/sql/001_shared_foundation.sql
\i cloudbase/sql/003_member_alias_migration.sql

-- All UUIDs, emails and amounts below are synthetic; never production data.
INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','TEST FAMILY','test-dad');
INSERT INTO public.family_members(family_id,user_uid,member_role) VALUES
 ('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-dad','owner'),
 ('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','member');
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by) VALUES
 ('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-dad','xb','test-dad'),
 ('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','xb','test-dad');
\i cloudbase/sql/011_xb_p2_predeploy_readonly.sql
\i cloudbase/sql/013_xb_p2_capabilities_readonly.sql

\i cloudbase/sql/005_xb_core_schema_draft.sql
\i cloudbase/sql/006_xb_core_schema_postflight.sql
\i cloudbase/sql/008_xb_transactions_schema_draft.sql
\i cloudbase/sql/014_xb_p2_purchase_postflight_readonly.sql
\i cloudbase/sql/009_xb_purchase_atomic_rpc_draft.sql
\i cloudbase/sql/015_xb_p2_atomic_purchase_postflight_readonly.sql
\i cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql

-- Simulate the real CloudBase explicit anonymous EXECUTE grant observed in
-- 016, only in this disposable PG16 fixture (never in live family DB).
GRANT EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb) TO anon;
SELECT public.xb_test_assert(
 has_function_privilege('anon',
 'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)',
 'EXECUTE'),'simulated unexpectedly granted anon EXECUTE');
\i cloudbase/sql/017_xb_p2_purchase_rpc_acl_repair.sql
SELECT public.xb_test_assert(
 NOT has_function_privilege('anon',
  'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)',
  'EXECUTE')
 AND has_function_privilege('authenticated',
  'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)',
  'EXECUTE'),
 '017 only the logged-in role retains execute permission');
\i cloudbase/sql/015_xb_p2_atomic_purchase_postflight_readonly.sql
\i cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql
\i cloudbase/sql/010_xb_inventory_reconcile_rpc_draft.sql
\i cloudbase/sql/018_xb_p2_reconciliation_postflight_readonly.sql
\i cloudbase/sql/012_xb_p2_postdeploy_readonly.sql

-- P2-3B DRAFT only: install safe test-child RPCs in this disposable
-- PostgreSQL fixture; real CloudBase deployment is NOT AUTHORIZED.
\i cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql
\i cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql

SELECT public.xb_test_assert(
 to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz)') IS NULL,
 'stock-only 9-arg purchase bypass removed');
SELECT public.xb_test_assert(
 to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)') IS NOT NULL,
 '10-arg audited purchase RPC exists');

INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by)
 VALUES('6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
  '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','primary','TEST BABY','test-dad');

-- P1: verify nickname RBAC, revision, non-destructive audit in disposable PG.
-- Existing real CloudBase membership is NEVER accessed by this contract.
\echo P1 isolated alias permissions contract
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);
SELECT public.xb_test_assert(
 (public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-dad','我',0)->>'alias_revision')::bigint=1,
 'owner can update own alias');
SELECT public.xb_test_assert(
 (public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','老婆',0)->>'alias_revision')::bigint=1,
 'owner can update another xb member alias');

SELECT set_config('xb.test.uid','test-mom',false);
SELECT public.xb_test_assert(
 (SELECT COUNT(*)=2 FROM public.family_members),
 'member sees both people in authorized family');
SELECT public.xb_test_assert(
 (public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','妈妈',1)->>'alias_revision')::bigint=2,
 'member can update self alias with current revision');
DO $xb_p1_test$
BEGIN
 BEGIN
  PERFORM public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-dad','越权修改',1);
  RAISE EXCEPTION 'expected owner alias change to be denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $xb_p1_test$;
SELECT public.xb_test_assert(
 (SELECT member_alias='我' AND alias_revision=1 FROM public.family_members
 WHERE user_uid='test-dad'), 'member cannot alter owner alias');
DO $xb_p1_test$
BEGIN
 BEGIN
  PERFORM public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','过期版本',1);
  RAISE EXCEPTION 'expected stale alias revision to be denied';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
END $xb_p1_test$;
DO $xb_p1_test$
BEGIN
 BEGIN
  UPDATE public.family_members SET member_alias='绕过RPC' WHERE user_uid='test-mom';
  RAISE EXCEPTION 'expected direct member table update to be denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $xb_p1_test$;

SELECT set_config('xb.test.uid','test-stranger',false);
SELECT public.xb_test_assert(
 (SELECT COUNT(*)=0 FROM public.family_members),
 'stranger cannot read household membership');
DO $xb_p1_test$
BEGIN
 BEGIN
  PERFORM public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-mom','陌生账号',2);
  RAISE EXCEPTION 'expected stranger alias change to be denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $xb_p1_test$;
SELECT set_config('xb.test.role','anon',false);
SELECT set_config('xb.test.uid','test-dad',false);
DO $xb_p1_test$
BEGIN
 BEGIN
  PERFORM public.xb_set_member_alias('29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5','test-dad','匿名伪造',1);
  RAISE EXCEPTION 'expected anonymous alias change to be denied';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $xb_p1_test$;
SELECT set_config('xb.test.role','authenticated',false);
RESET ROLE;
SELECT public.xb_test_assert(
 (SELECT COUNT(*)=3 FROM public.family_member_alias_audit),
 'exactly three valid edits created immutable audit records');
SET ROLE authenticated;
SELECT public.xb_test_assert(
 (SELECT member_alias='妈妈' AND alias_revision=2 FROM public.family_members
 WHERE user_uid='test-mom'),
 'rejected requests never changed member nickname');
\echo P1 isolated alias permissions contract passed

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);

-- Dad buys 60 diapers at 29.99, mom independently buys 80 at 39.99.
SELECT public.xb_apply_inventory_operation(
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 '397b1791-b8d0-4d63-82d6-c5b829240f42',
 'buy','S',60,NULL,NULL,'2026-11-10T08:30:00Z',
 '{"brand":"好奇","series":"小森林","total_fen":2999,"purchase_date":"2026-11-10"}'::jsonb
);
SELECT set_config('xb.test.uid','test-mom',false);
SELECT public.xb_apply_inventory_operation(
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 'e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64',
 'buy','S',80,NULL,NULL,'2026-11-10T08:40:00Z',
 '{"brand":"Babycare","series":"皇室Pro","total_fen":3999,"purchase_date":"2026-11-10"}'::jsonb
);
SELECT public.xb_test_assert(
 (SELECT quantity=140 AND revision=2 FROM public.xb_inventory
  WHERE family_id='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5' AND size='S'),
 'two purchases accumulate 140 and revision 2');
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_transactions), 'purchase history has both orders');
SELECT public.xb_test_assert(
 (SELECT sum(total_fen)=6998 FROM public.xb_transactions), 'exact money preserved');

-- Reply lost: replay dad's exact same request after mom's purchase.
SELECT set_config('xb.test.uid','test-dad',false);
SELECT public.xb_test_assert(
 (public.xb_apply_inventory_operation(
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 '397b1791-b8d0-4d63-82d6-c5b829240f42',
 'buy','S',60,NULL,NULL,'2026-11-10T08:30:00Z',
 '{"brand":"好奇","series":"小森林","total_fen":2999,"purchase_date":"2026-11-10"}'::jsonb
 )->>'duplicate')::boolean, 'exact retry is duplicate');
SELECT public.xb_test_assert(
 (SELECT quantity=140 FROM public.xb_inventory WHERE size='S'), 'duplicate does not affect stock');

-- Same ID but changed price is forbidden, and cannot create an extra purchase.
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   '397b1791-b8d0-4d63-82d6-c5b829240f42',
   'buy','S',60,NULL,NULL,'2026-11-10T08:30:00Z',
   '{"brand":"好奇","series":"小森林","total_fen":3001,"purchase_date":"2026-11-10"}'::jsonb);
  RAISE EXCEPTION 'expected price tampering to fail';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END $$;

-- Buy without purchase detail must be denied.
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   '780d45fe-dd5b-48c8-9660-ec14d4c0bb96',
   'buy','S',20,NULL,NULL,'2026-11-10T09:00:00Z',NULL);
  RAISE EXCEPTION 'expected missing purchase details to fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
END $$;
SELECT public.xb_test_assert((SELECT count(*)=2 FROM public.xb_transactions),
 'rejected purchase does not add financial row');

-- Stale absolute stocktake cannot overwrite the 140 shared stock.
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   'dddb23ca-895a-4b1b-b5e0-672e0e4f4d23',
   'stocktake','S',10,0,NULL,'2026-11-10T09:05:00Z',NULL);
  RAISE EXCEPTION 'expected version conflict';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
END $$;

-- Consuming 20 and reversing a prior 60 purchase must both update the stock.
SELECT public.xb_apply_inventory_operation(
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 'b2c032c0-e04a-43a3-ae26-d457235daec8',
 'use','S',20,NULL,NULL,'2026-11-10T09:10:00Z',NULL);
SELECT public.xb_apply_inventory_operation(
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 '729a0dd7-0ea3-4a70-a2b8-e0cc50461ed8',
 'reverse','S',NULL,NULL,'397b1791-b8d0-4d63-82d6-c5b829240f42',
 '2026-11-10T09:15:00Z',NULL);
SELECT public.xb_test_assert((SELECT quantity=60 FROM public.xb_inventory WHERE size='S'),
 'reverse changes quantity to 60');
SELECT public.xb_test_assert((SELECT count(*)=1 FROM public.xb_transactions
  WHERE reversed_by_operation_id IS NOT NULL),'purchase reversal marked');
SELECT public.xb_test_assert((SELECT sum(total_fen)=3999 FROM public.xb_transactions
  WHERE reversed_by_operation_id IS NULL),'active spend excludes canceled order');

-- A revoked or stranger identity must fail at the server, not just in UI.
SELECT set_config('xb.test.uid','test-stranger',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   '8e1cc2f7-2bbc-4b09-a5a7-57d14f693403',
   'buy','S',50,NULL,NULL,'2026-11-10T09:30:00Z',
   '{"brand":"好奇","series":"小森林","total_fen":5000,"purchase_date":"2026-11-10"}'::jsonb);
  RAISE EXCEPTION 'expected stranger denial';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;
SELECT public.xb_test_assert((SELECT count(*)=0 FROM public.xb_transactions),
 'RLS hides family purchase history from stranger');

RESET ROLE;
SELECT public.xb_test_assert((SELECT quantity=60 FROM public.xb_inventory WHERE size='S'),
 'stock unchanged after rejected stranger');
SELECT public.xb_test_assert((SELECT count(*)=4 FROM public.xb_inventory_operations),
 'exact count of successful inventory events');
-- Inject a failure AFTER stock has been updated, at the financial INSERT.
-- PostgreSQL transaction atomicity must undo stock + op receipt + purchase.
RESET ROLE;
CREATE FUNCTION public.xb_test_reject_purchase() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'injected_purchase_insert_failure' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER xb_test_reject_purchase_trigger
 BEFORE INSERT ON public.xb_transactions
 FOR EACH ROW EXECUTE FUNCTION public.xb_test_reject_purchase();

SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   'fa6536c7-4f68-4471-89e2-11cc4e50b483',
   'buy','S',5,NULL,NULL,'2026-11-10T09:45:00Z',
   '{"brand":"测试品牌","series":"模拟系列","total_fen":500,"purchase_date":"2026-11-10"}'::jsonb);
  RAISE EXCEPTION 'expected deliberately injected transaction failure';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
END $$;
SELECT public.xb_test_assert(
 (SELECT quantity=60 FROM public.xb_inventory WHERE size='S'),
 'purchase insert failure rolls back stock');
SELECT public.xb_test_assert(
 (SELECT count(*)=4 FROM public.xb_inventory_operations),
 'purchase insert failure rolls back event receipt');
SELECT public.xb_test_assert(
 (SELECT count(*)=2 FROM public.xb_transactions),
 'purchase insert failure leaves financial rows unchanged');

-- Second independent reversal of an already reversed purchase is forbidden.
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_apply_inventory_operation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   'bfa6d76f-dd16-4e83-ae8d-848bfa28fb16',
   'reverse','S',NULL,NULL,'397b1791-b8d0-4d63-82d6-c5b829240f42',
   '2026-11-10T09:50:00Z',NULL);
  RAISE EXCEPTION 'expected double reversal failure';
 EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
 END;
END $$;
SELECT public.xb_test_assert(
 (SELECT quantity=60 FROM public.xb_inventory WHERE size='S'),
 'double reversal failure leaves inventory unchanged');
RESET ROLE;
DROP TRIGGER xb_test_reject_purchase_trigger ON public.xb_transactions;
DROP FUNCTION public.xb_test_reject_purchase();

-- Validate the dedicated consistent read is authorized and cannot
-- attribute another member's operations to the logged-in actor.
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','test-dad',false);
SELECT public.xb_test_assert(
  (SELECT (r->'rows'->1->>'quantity')::integer=60
      AND jsonb_array_length(r->'rows')=6
      AND jsonb_array_length(r->'seen_operation_ids')=1
      AND r->'seen_operation_ids' ? '397b1791-b8d0-4d63-82d6-c5b829240f42'
   FROM (SELECT public.xb_read_inventory_reconciliation(
    '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
    '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
    ARRAY['397b1791-b8d0-4d63-82d6-c5b829240f42',
          'e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64']::uuid[]
   ) AS r) AS checked),
  'receipt check matches logged-in actor only and includes six sizes');
SELECT set_config('xb.test.uid','test-mom',false);
SELECT public.xb_test_assert(
  (SELECT jsonb_array_length(r->'seen_operation_ids')=1
      AND r->'seen_operation_ids' ? 'e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64'
   FROM (SELECT public.xb_read_inventory_reconciliation(
    '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
    '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
    ARRAY['397b1791-b8d0-4d63-82d6-c5b829240f42',
          'e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64']::uuid[]
   ) AS r) AS checked),
  'member receipt check cannot see owner receipt');
SELECT set_config('xb.test.uid','test-stranger',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.xb_read_inventory_reconciliation(
   '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
   ARRAY[]::uuid[]);
  RAISE EXCEPTION 'expected stranger inventory read denial';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;
RESET ROLE;
\echo P2 PostgreSQL contract passed
