\echo T09-DB-01 synthetic family health RPC contract
SELECT public.xb_test_assert(
 (SELECT count(*) = 2 AND bool_and(relrowsecurity) FROM pg_class
  WHERE oid IN ('public.xb_maternal_health_documents'::regclass,
                'public.xb_maternal_health_requests'::regclass))
 AND NOT has_table_privilege('authenticated','public.xb_maternal_health_documents','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.xb_maternal_health_requests','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_function_privilege('anon','public.xb_read_maternal_health(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.xb_check_maternal_health_request(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.xb_put_maternal_health(uuid,bigint,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.xb_put_maternal_health(uuid,bigint,uuid,jsonb)','EXECUTE'),
 'health tables are private and app writes start closed');

-- Enable writes exclusively in this disposable database.
GRANT EXECUTE ON FUNCTION public.xb_put_maternal_health(uuid,bigint,uuid,jsonb) TO authenticated;

INSERT INTO public.families(id,display_name,owner_uid) VALUES
 ('f1300000-0000-4000-8000-000000000001','SYNTHETIC HEALTH FAMILY','t09-health-a'),
 ('f1300000-0000-4000-8000-000000000002','SYNTHETIC OTHER FAMILY','t09-health-c'),
 ('f1300000-0000-4000-8000-000000000003','SYNTHETIC CAS FAMILY','t09-cas-a');
INSERT INTO public.family_members(family_id,user_uid,member_role) VALUES
 ('f1300000-0000-4000-8000-000000000001','t09-health-a','owner'),
 ('f1300000-0000-4000-8000-000000000001','t09-health-b','member'),
 ('f1300000-0000-4000-8000-000000000001','t09-health-no-app','member'),
 ('f1300000-0000-4000-8000-000000000002','t09-health-c','owner'),
 ('f1300000-0000-4000-8000-000000000003','t09-cas-a','owner'),
 ('f1300000-0000-4000-8000-000000000003','t09-cas-b','member');
INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by) VALUES
 ('f1300000-0000-4000-8000-000000000001','t09-health-a','xb','t09-health-a'),
 ('f1300000-0000-4000-8000-000000000001','t09-health-b','xb','t09-health-a'),
 ('f1300000-0000-4000-8000-000000000002','t09-health-c','xb','t09-health-c'),
 ('f1300000-0000-4000-8000-000000000003','t09-cas-a','xb','t09-cas-a'),
 ('f1300000-0000-4000-8000-000000000003','t09-cas-b','xb','t09-cas-a');

SET ROLE authenticated;
DO $$
DECLARE
 f constant uuid := 'f1300000-0000-4000-8000-000000000001';
 first_request constant uuid := 'a1300000-0000-4000-8000-000000000001';
 second_request constant uuid := 'a1300000-0000-4000-8000-000000000002';
 rejected_request constant uuid := 'a1300000-0000-4000-8000-000000000003';
 empty_body constant jsonb := '{"schemaVersion":1,"items":[]}';
 first_body constant jsonb := '{"schemaVersion":1,"items":[{"id":"mock-w","kind":"weight","date":"2026-01-02","weightKg":62}]}';
 second_body constant jsonb := '{"schemaVersion":1,"items":[{"id":"mock-w","kind":"weight","date":"2026-01-02","weightKg":63},{"id":"mock-c","kind":"constipation","date":"2026-01-03"},{"id":"mock-r","kind":"postpartum_recovery","date":"2026-01-04"}]}';
 invalid_body jsonb;
 denied_actor text;
BEGIN
 PERFORM set_config('xb.test.role','authenticated',true);
 PERFORM set_config('xb.test.uid','t09-health-a',true);
 PERFORM public.xb_test_assert(public.xb_read_maternal_health(f) =
  jsonb_build_object('family_id',f,'revision',0,'body',empty_body), 'childless family starts empty');
 PERFORM public.xb_test_assert(public.xb_check_maternal_health_request(f,first_request)->>'status' = 'NO_RECEIPT',
  'new request has no receipt');

 FOREACH invalid_body IN ARRAY ARRAY[
  NULL::jsonb, '{}'::jsonb, '{"schemaVersion":1,"items":null}'::jsonb,
  '{"schemaVersion":1,"items":[{"id":"bad","kind":"weight","date":"2026-01-02","weightKg":"62"}]}'::jsonb,
  '{"schemaVersion":1,"items":[{"id":"bad","kind":"constipation","date":"2026-02-30"}]}'::jsonb,
  '{"schemaVersion":1,"items":[{"id":"bad","kind":"other","date":"2026-01-02"}]}'::jsonb,
  first_body || jsonb_build_object('items',(first_body->'items') || (first_body->'items'))
 ] LOOP
  BEGIN
   PERFORM public.xb_put_maternal_health(f,0,rejected_request,invalid_body);
   RAISE EXCEPTION 'expected invalid document rejection';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
 END LOOP;

 PERFORM public.xb_test_assert(public.xb_put_maternal_health(f,0,first_request,first_body) =
  jsonb_build_object('saved',true,'duplicate',false,'family_id',f,'request_id',first_request,'revision',1),
  'A first save is revision 1');
 PERFORM set_config('xb.test.uid','t09-health-b',true);
 PERFORM public.xb_test_assert(public.xb_read_maternal_health(f)->'body' = first_body, 'B sees A records');
 PERFORM public.xb_test_assert(public.xb_check_maternal_health_request(f,first_request)->>'status' = 'NO_RECEIPT',
  'B cannot see A receipt');
 BEGIN
  PERFORM public.xb_put_maternal_health(f,0,first_request,first_body);
  RAISE EXCEPTION 'expected another actor UUID reuse rejection';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 PERFORM public.xb_test_assert(public.xb_put_maternal_health(f,1,second_request,second_body)->>'revision' = '2',
  'B updates the same family document to revision 2');

 PERFORM set_config('xb.test.uid','t09-health-a',true);
 PERFORM public.xb_test_assert(public.xb_read_maternal_health(f) =
  jsonb_build_object('family_id',f,'revision',2,'body',second_body), 'A sees B edits and additions');
 PERFORM public.xb_test_assert(public.xb_check_maternal_health_request(f,first_request) =
  jsonb_build_object('status','COMMITTED','family_id',f,'request_id',first_request,'revision',1),
  'lost ACK can be recovered after the family revision advances');
 PERFORM public.xb_test_assert(public.xb_put_maternal_health(f,0,first_request,first_body) =
  jsonb_build_object('saved',true,'duplicate',true,'family_id',f,'request_id',first_request,'revision',1),
  'exact replay returns original revision');
 BEGIN
  PERFORM public.xb_put_maternal_health(f,0,first_request,second_body);
  RAISE EXCEPTION 'expected UUID reuse with changed body rejection';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_put_maternal_health(f,2,first_request,first_body);
  RAISE EXCEPTION 'expected UUID reuse with changed revision rejection';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  PERFORM public.xb_put_maternal_health(f,1,rejected_request,first_body);
  RAISE EXCEPTION 'expected stale revision conflict';
 EXCEPTION WHEN serialization_failure THEN NULL;
 END;
 PERFORM public.xb_test_assert(public.xb_check_maternal_health_request(f,rejected_request)->>'status' = 'NO_RECEIPT'
  AND public.xb_read_maternal_health(f)->>'revision' = '2', 'failed requests and retries leave the document intact');

 FOREACH denied_actor IN ARRAY ARRAY['t09-health-c','t09-health-no-app',''] LOOP
  PERFORM set_config('xb.test.uid',denied_actor,true);
  BEGIN
   PERFORM public.xb_read_maternal_health(f);
   RAISE EXCEPTION 'expected read denial for %',denied_actor;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   PERFORM public.xb_put_maternal_health(f,2,rejected_request,empty_body);
   RAISE EXCEPTION 'expected write denial for %',denied_actor;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   PERFORM public.xb_check_maternal_health_request(f,first_request);
   RAISE EXCEPTION 'expected receipt denial for %',denied_actor;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $$;
RESET ROLE;

SELECT public.xb_test_assert(
 NOT EXISTS (SELECT 1 FROM public.xb_children WHERE family_id = 'f1300000-0000-4000-8000-000000000001')
 AND NOT EXISTS (SELECT 1 FROM public.xb_migrations WHERE family_id = 'f1300000-0000-4000-8000-000000000001')
 AND (SELECT count(*) = 2 FROM public.xb_maternal_health_requests
      WHERE family_id = 'f1300000-0000-4000-8000-000000000001'),
 'shared writes require neither a child nor a migration receipt');

INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by) VALUES
 ('c1300000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',
  'primary','SYNTHETIC FIRST BABY','t09-health-a');
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false),set_config('xb.test.uid','t09-health-b',false);
SELECT public.xb_test_assert(public.xb_put_maternal_health('f1300000-0000-4000-8000-000000000001',2,
 'a1300000-0000-4000-8000-000000000004',
 public.xb_read_maternal_health('f1300000-0000-4000-8000-000000000001')->'body')->>'revision' = '3',
 'family with a primary but no migration receipt can still read and write');
RESET ROLE;
DELETE FROM public.xb_children WHERE id = 'c1300000-0000-4000-8000-000000000001';
INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by) VALUES
 ('c1300000-0000-4000-8000-000000000002','f1300000-0000-4000-8000-000000000001',
  'primary','SYNTHETIC REPLACEMENT BABY','t09-health-a');
SET ROLE authenticated;
SELECT set_config('xb.test.uid','t09-health-a',false);
SELECT public.xb_test_assert(public.xb_read_maternal_health('f1300000-0000-4000-8000-000000000001')
 @> '{"revision":3,"body":{"items":[{"id":"mock-w","weightKg":63}]}}',
 'primary replacement preserves the existing health document');
RESET ROLE;
\echo PASS T09-DB-01 family health authorization, CAS, idempotency and child independence
