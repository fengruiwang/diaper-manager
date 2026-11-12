-- XiaoBao V1.2.0 M3: atomic multi-size stocktake DRAFT. DO NOT DEPLOY.
-- No live CloudBase DDL/DML is authorized. Disposable PG16 only.
-- Uses same family advisory lock and xb_inventory_operations audit as 009.
-- This is a batch-specific complement, NOT a new inventory source of truth.
-- A single RPC transaction applies ALL selected sizes or none.
BEGIN;
DO $requirements$
BEGIN
 IF to_regclass('public.xb_inventory') IS NULL
  OR to_regclass('public.xb_inventory_operations') IS NULL
  OR to_regclass('public.xb_migrations') IS NULL
  OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
  OR to_regprocedure('auth.role()') IS NULL
  OR to_regprocedure('auth.uid()') IS NULL
  OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
  RAISE EXCEPTION 'stocktake_batch_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END $requirements$;
CREATE TABLE public.xb_stocktake_batch_receipts(
 family_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 child_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
 actor_uid text NOT NULL CHECK(char_length(actor_uid) BETWEEN 1 AND 128),
 result jsonb NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,batch_id),
 FOREIGN KEY(family_id,child_id)
  REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON public.xb_stocktake_batch_receipts
 FROM PUBLIC,anon,authenticated;
ALTER TABLE public.xb_stocktake_batch_receipts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.xb_primary_stocktake_batch_draft(
 p_family_id uuid,p_child_id uuid,p_batch_id uuid,p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $batch$
DECLARE
 v_actor text;v_sha text;
 v_receipt public.xb_stocktake_batch_receipts%ROWTYPE;
 v_row public.xb_inventory%ROWTYPE;
 v_item jsonb;v_size text;v_new integer;v_expected bigint;
 v_op uuid;v_changes jsonb:='[]'::jsonb;v_result jsonb;
 v_count integer;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated' OR NULLIF(auth.uid(),'') IS NULL
  THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_batch_id IS NULL
  OR jsonb_typeof(p_items)<>'array'
  OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 6 THEN
  RAISE EXCEPTION 'invalid_stocktake_batch' USING ERRCODE='22023';END IF;
 v_count:=jsonb_array_length(p_items);
 IF (SELECT count(DISTINCT item->>'size') FROM jsonb_array_elements(p_items) item)
    <>v_count
  OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_items) item
   WHERE jsonb_typeof(item)<>'object'
    OR item->>'size' NOT IN ('NB','S','M','L','XL','XXL')
    OR jsonb_typeof(item->'count')<>'number'
    OR (item->>'count') !~ '^(0|[1-9][0-9]{0,5})$'
    OR (item->>'count')::numeric>100000
    OR jsonb_typeof(item->'expectedRevision')<>'number'
    OR (item->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,14})$'
  ) THEN
  RAISE EXCEPTION 'invalid_stocktake_items' USING ERRCODE='22023';END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(
  hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 PERFORM 1 FROM public.xb_children WHERE family_id=p_family_id
  AND id=p_child_id AND legacy_slot='primary' AND deleted_at IS NULL
  FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'active_primary_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.xb_migrations
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_format='xiaobao-diapers:v1') THEN
  RAISE EXCEPTION 'completed_migration_receipt_required'
   USING ERRCODE='42501';END IF;
 v_sha:=encode(sha256(convert_to(p_items::text,'UTF8')),'hex');
 SELECT * INTO v_receipt FROM public.xb_stocktake_batch_receipts
  WHERE family_id=p_family_id AND batch_id=p_batch_id;
 IF FOUND THEN
  IF v_receipt.child_id<>p_child_id OR v_receipt.request_sha256<>v_sha THEN
   RAISE EXCEPTION 'batch_id_reused_different_payload' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('saved',true,'duplicate',true,
   'batch_id',p_batch_id,'family_id',p_family_id,'child_id',p_child_id,
   'result',v_receipt.result);
 END IF;
 FOR v_item IN
  SELECT item FROM jsonb_array_elements(p_items) item ORDER BY item->>'size'
 LOOP
  v_size:=v_item->>'size';
  v_new:=(v_item->>'count')::integer;
  v_expected:=(v_item->>'expectedRevision')::bigint;
  SELECT * INTO v_row FROM public.xb_inventory
   WHERE family_id=p_family_id AND child_id=p_child_id
     AND size=v_size FOR UPDATE;
  IF NOT FOUND OR v_row.revision<>v_expected THEN
   RAISE EXCEPTION 'stocktake_revision_conflict' USING ERRCODE='40001';
  END IF;
  IF v_row.quantity<>v_new THEN
   UPDATE public.xb_inventory SET quantity=v_new,
    revision=v_row.revision+1,updated_at=now(),updated_by=v_actor
    WHERE family_id=p_family_id AND child_id=p_child_id AND size=v_size;
   v_op:=gen_random_uuid();
   INSERT INTO public.xb_inventory_operations(
    family_id,operation_id,child_id,size,kind,delta,
    old_quantity,new_quantity,expected_revision,resulting_revision,
    payload_sha256,actor_uid,occurred_at
   ) VALUES(
    p_family_id,v_op,p_child_id,v_size,'stocktake',NULL,
    v_row.quantity,v_new,v_expected,v_expected+1,
    encode(sha256(convert_to(jsonb_build_array(
     'xb.stocktake.batch.v1',p_batch_id,v_size,v_new,v_expected)::text,
     'UTF8')),'hex'),
    v_actor,now()
   );
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object(
    'size',v_size,'previous_quantity',v_row.quantity,'new_quantity',v_new,
    'revision',v_expected+1,'operation_id',v_op
   ));
  END IF;
 END LOOP;
 v_result:=jsonb_build_object('status','APPLIED',
  'changed_sizes',jsonb_array_length(v_changes),'changes',v_changes);
 INSERT INTO public.xb_stocktake_batch_receipts(
  family_id,batch_id,child_id,request_sha256,actor_uid,result
 ) VALUES(p_family_id,p_batch_id,p_child_id,v_sha,v_actor,v_result);
 RETURN jsonb_build_object('saved',true,'duplicate',false,
  'batch_id',p_batch_id,'family_id',p_family_id,'child_id',p_child_id,
  'result',v_result);
END;
$batch$;
REVOKE ALL ON FUNCTION public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)
 TO authenticated;

CREATE FUNCTION public.xb_read_primary_stocktake_batch_receipt_draft(
 p_family_id uuid,p_child_id uuid,p_batch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $receipt_read$
DECLARE v_receipt public.xb_stocktake_batch_receipts%ROWTYPE;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated' OR NULLIF(auth.uid(),'') IS NULL
  THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_batch_id IS NULL THEN
  RAISE EXCEPTION 'invalid_batch_scope' USING ERRCODE='22023';END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb')
   OR NOT EXISTS(SELECT 1 FROM public.xb_children
     WHERE family_id=p_family_id AND id=p_child_id
      AND legacy_slot='primary' AND deleted_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.xb_migrations
     WHERE family_id=p_family_id AND child_id=p_child_id
       AND source_format='xiaobao-diapers:v1') THEN
  RAISE EXCEPTION 'primary_batch_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO v_receipt FROM public.xb_stocktake_batch_receipts
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND batch_id=p_batch_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','NO_RECEIPT',
  'batch_id',p_batch_id,'family_id',p_family_id,'child_id',p_child_id);END IF;
 RETURN jsonb_build_object('status','COMMITTED',
  'batch_id',p_batch_id,'family_id',p_family_id,'child_id',p_child_id,
  'result',v_receipt.result,'request_sha256',v_receipt.request_sha256);
END;
$receipt_read$;
REVOKE ALL ON FUNCTION public.xb_read_primary_stocktake_batch_receipt_draft(uuid,uuid,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_read_primary_stocktake_batch_receipt_draft(uuid,uuid,uuid)
 TO authenticated;
COMMIT;
