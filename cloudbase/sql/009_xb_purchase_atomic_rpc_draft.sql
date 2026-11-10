-- XiaoBao P2 v1.2.0: full-purchase inventory RPC DRAFT; not deployed.
-- Requires 005_xb_core_schema_draft.sql; do not execute on CloudBase before review.
-- This migration creates functions/indexes only: NO child, inventory, or historical rows inserted.
BEGIN;

DO $$
BEGIN
 IF to_regclass('public.xb_transactions') IS NULL THEN
  RAISE EXCEPTION 'xb_purchase_schema_missing';
 END IF;
END $$;

-- Atomic transition from 9-argument stock-only RPC to required purchase payload.
DROP FUNCTION IF EXISTS public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz);

DO $$
BEGIN
 IF to_regclass('public.xb_inventory') IS NULL
    OR to_regclass('public.xb_inventory_operations') IS NULL
    OR to_regclass('public.xb_children') IS NULL
    OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'xb_p2_inventory_schema_missing';
 END IF;
 IF to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
   RAISE EXCEPTION 'xb_p2_sha256_function_required';
 END IF;
END $$;

-- Prevent two independent reverse operation IDs from undoing the same purchase.
CREATE UNIQUE INDEX IF NOT EXISTS xb_inventory_one_reverse_per_source
 ON public.xb_inventory_operations(family_id,reverses_operation_id)
 WHERE reverses_operation_id IS NOT NULL;

DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM pg_constraint
   WHERE conrelid='public.xb_inventory_operations'::regclass
     AND conname='xb_inventory_reverse_reference_consistent'
 ) THEN
  ALTER TABLE public.xb_inventory_operations
   ADD CONSTRAINT xb_inventory_reverse_reference_consistent
    CHECK ((kind='reverse') = (reverses_operation_id IS NOT NULL));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.xb_apply_inventory_operation(
 p_family_id uuid, p_child_id uuid, p_operation_id uuid,
 p_kind text, p_size text, p_amount integer,
 p_expected_revision bigint, p_reverses_operation_id uuid,
 p_occurred_at timestamptz, p_purchase jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
 v_actor text;
 v_hash text;
 v_prior public.xb_inventory_operations%ROWTYPE;
 v_reversed public.xb_inventory_operations%ROWTYPE;
 v_stock public.xb_inventory%ROWTYPE;
 v_delta integer;
 v_after integer;
 v_revision bigint;
 v_brand text;
 v_series text;
 v_total_fen bigint;
 v_purchase_date date;
 v_purchase_json jsonb;
BEGIN
 -- Grant EXECUTE is not the security boundary in CloudBase RPC: validate here.
 IF COALESCE(auth.role(),'')<>'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_operation_id IS NULL
    OR p_occurred_at IS NULL
    OR p_kind IS NULL OR p_kind NOT IN ('buy','use','stocktake','reverse')
    OR p_size IS NULL OR p_size NOT IN ('NB','S','M','L','XL','XXL') THEN
  RAISE EXCEPTION 'invalid_inventory_operation' USING ERRCODE='22023';
 END IF;

 IF p_kind IN ('buy','use') THEN
  IF p_amount IS NULL OR p_amount<1 OR p_amount>100000
     OR p_expected_revision IS NOT NULL OR p_reverses_operation_id IS NOT NULL THEN
   RAISE EXCEPTION 'invalid_inventory_delta' USING ERRCODE='22023';
  END IF;
 ELSIF p_kind='stocktake' THEN
  IF p_amount IS NULL OR p_amount<0 OR p_amount>100000
     OR p_expected_revision IS NULL OR p_expected_revision<0
     OR p_reverses_operation_id IS NOT NULL THEN
   RAISE EXCEPTION 'invalid_stocktake_request' USING ERRCODE='22023';
  END IF;
 ELSE
  IF p_amount IS NOT NULL OR p_expected_revision IS NOT NULL
     OR p_reverses_operation_id IS NULL
     OR p_reverses_operation_id=p_operation_id THEN
   RAISE EXCEPTION 'invalid_reverse_request' USING ERRCODE='22023';
  END IF;
 END IF;

 -- A buy without full purchase details would cause an orphan stock increase.
 IF p_kind='buy' THEN
  IF p_purchase IS NULL OR jsonb_typeof(p_purchase)<>'object'
   OR (SELECT count(*) FROM jsonb_object_keys(p_purchase))<>4
   OR NOT(p_purchase ?& ARRAY['brand','series','total_fen','purchase_date']) THEN
   RAISE EXCEPTION 'purchase_details_required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_purchase->'brand')<>'string'
   OR jsonb_typeof(p_purchase->'series')<>'string'
   OR jsonb_typeof(p_purchase->'total_fen')<>'number'
   OR jsonb_typeof(p_purchase->'purchase_date')<>'string' THEN
   RAISE EXCEPTION 'invalid_purchase_details' USING ERRCODE='22023';
  END IF;
  v_brand:=btrim(p_purchase->>'brand');
  v_series:=btrim(p_purchase->>'series');
  IF char_length(v_brand) NOT BETWEEN 1 AND 120
   OR char_length(v_series) NOT BETWEEN 1 AND 120
   OR v_brand ~ '[[:cntrl:]]' OR v_series ~ '[[:cntrl:]]'
   OR (p_purchase->>'total_fen') !~ '^[1-9][0-9]{0,7}$'
   OR (p_purchase->>'purchase_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'invalid_purchase_details' USING ERRCODE='22023';
  END IF;
  v_total_fen:=(p_purchase->>'total_fen')::bigint;
  IF v_total_fen>10000000 THEN
   RAISE EXCEPTION 'invalid_purchase_amount' USING ERRCODE='22023';
  END IF;
  v_purchase_date:=(p_purchase->>'purchase_date')::date;
  IF to_char(v_purchase_date,'YYYY-MM-DD')<>(p_purchase->>'purchase_date') THEN
   RAISE EXCEPTION 'invalid_purchase_date' USING ERRCODE='22023';
  END IF;
  v_purchase_json:=jsonb_build_object('brand',v_brand,'series',v_series,
    'total_fen',v_total_fen,'purchase_date',to_char(v_purchase_date,'YYYY-MM-DD'));
 ELSE
  IF p_purchase IS NOT NULL THEN
   RAISE EXCEPTION 'unexpected_purchase_details' USING ERRCODE='22023';
  END IF;
  v_purchase_json:=NULL;
 END IF;

 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;

 -- Normalizing typed arguments and UTC timestamp makes retry fingerprints stable
 -- across JSON field order and client timezone string formatting.
 -- A digest computed by the server prevents clients from forging payload_sha256.
 v_hash:=encode(sha256(convert_to(
   jsonb_build_array('xb.inventory.v2.purchase',p_family_id,p_child_id,p_kind,
    p_size,p_amount,p_expected_revision,p_reverses_operation_id,
    to_char(p_occurred_at AT TIME ZONE 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.US'),v_actor,v_purchase_json)::text,'UTF8')),'hex');

 -- Serialize operation receipts and stock writes within one small household.
 -- A 64-bit advisory-key hash collision would only cause extra serialization,
 -- never expose or mix data because every query also filters by family_id.
 PERFORM pg_advisory_xact_lock(
   hashtextextended('xb.inventory.family:'||p_family_id::text,0)
 );

 -- Look up the receipt BEFORE checking current stock revision. Retrying an ACK
 -- lost in transit returns its previous result; it cannot apply a second time.
 SELECT * INTO v_prior FROM public.xb_inventory_operations
  WHERE family_id=p_family_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF v_prior.payload_sha256<>v_hash OR v_prior.actor_uid<>v_actor THEN
   RAISE EXCEPTION 'inventory_operation_id_reused_with_different_payload'
    USING ERRCODE='23505';
  END IF;
  IF v_prior.kind='buy' AND NOT EXISTS(
   SELECT 1 FROM public.xb_transactions
    WHERE family_id=p_family_id AND operation_id=p_operation_id
  ) THEN
   RAISE EXCEPTION 'purchase_receipt_missing' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
   'accepted',true,'duplicate',true,
   'operation_id',v_prior.operation_id,'child_id',v_prior.child_id,
   'size',v_prior.size,'result_quantity',v_prior.new_quantity,
   'result_revision',v_prior.resulting_revision,
   'committed_at',v_prior.committed_at);
 END IF;

 -- New work is allowed only on an active child owned by this family.
 IF NOT EXISTS(
   SELECT 1 FROM public.xb_children
    WHERE family_id=p_family_id AND id=p_child_id AND deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'child_unavailable' USING ERRCODE='42501';
 END IF;

 IF p_kind='reverse' THEN
  SELECT * INTO v_reversed FROM public.xb_inventory_operations
   WHERE family_id=p_family_id
     AND operation_id=p_reverses_operation_id
     AND child_id=p_child_id AND size=p_size
     AND kind IN ('buy','use');
  IF NOT FOUND THEN
   RAISE EXCEPTION 'reverse_target_unavailable' USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.xb_inventory_operations
     WHERE family_id=p_family_id AND reverses_operation_id=p_reverses_operation_id
  ) THEN
   RAISE EXCEPTION 'inventory_already_reversed' USING ERRCODE='23505';
  END IF;
  v_delta:=-v_reversed.delta;
 ELSIF p_kind='buy' THEN
  v_delta:=p_amount;
 ELSIF p_kind='use' THEN
  v_delta:=-p_amount;
 ELSE
  v_delta:=NULL;
 END IF;

 -- For a newly created baby, first 0-stock row may not exist yet.
 INSERT INTO public.xb_inventory(
  family_id,child_id,size,quantity,revision,updated_by
 ) VALUES(p_family_id,p_child_id,p_size,0,0,v_actor)
 ON CONFLICT(family_id,child_id,size) DO NOTHING;

 SELECT * INTO STRICT v_stock FROM public.xb_inventory
  WHERE family_id=p_family_id AND child_id=p_child_id AND size=p_size
  FOR UPDATE;

 IF p_kind='stocktake' THEN
  IF v_stock.revision<>p_expected_revision THEN
   RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001';
  END IF;
  v_after:=p_amount;
 ELSE
  v_after:=v_stock.quantity+v_delta;
 END IF;

 -- Never silently clamp negative stock or exceed the existing 100000 limit.
 IF v_after<0 OR v_after>100000 THEN
  RAISE EXCEPTION 'inventory_out_of_bounds' USING ERRCODE='23514';
 END IF;

 v_revision:=v_stock.revision+1;
 UPDATE public.xb_inventory
    SET quantity=v_after,revision=v_revision,
        updated_by=v_actor,updated_at=now()
  WHERE family_id=p_family_id AND child_id=p_child_id AND size=p_size;

 INSERT INTO public.xb_inventory_operations(
  family_id,operation_id,child_id,size,kind,delta,
  old_quantity,new_quantity,expected_revision,resulting_revision,
  payload_sha256,actor_uid,reverses_operation_id,occurred_at
 ) VALUES(
  p_family_id,p_operation_id,p_child_id,p_size,p_kind,v_delta,
  v_stock.quantity,v_after,p_expected_revision,v_revision,
  v_hash,v_actor,p_reverses_operation_id,p_occurred_at
 );

 -- Same transaction: stock update, operation receipt and purchase record.
 IF p_kind='buy' THEN
  INSERT INTO public.xb_transactions(
   family_id,operation_id,child_id,size,brand,series,pieces,
   total_fen,purchase_date,created_by
  ) VALUES(
   p_family_id,p_operation_id,p_child_id,p_size,v_brand,v_series,
   p_amount,v_total_fen,v_purchase_date,v_actor
  );
 ELSIF p_kind='reverse' AND v_reversed.kind='buy' THEN
  UPDATE public.xb_transactions
   SET reversed_by_operation_id=p_operation_id
   WHERE family_id=p_family_id AND operation_id=p_reverses_operation_id
    AND child_id=p_child_id AND size=p_size AND reversed_by_operation_id IS NULL;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'purchase_reverse_inconsistent' USING ERRCODE='23514';
  END IF;
 END IF;

 RETURN jsonb_build_object(
  'accepted',true,'duplicate',false,
  'operation_id',p_operation_id,'child_id',p_child_id,
  'size',p_size,'result_quantity',v_after,
  'result_revision',v_revision,'committed_at',now());
END;
$$;

REVOKE ALL ON FUNCTION public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb) TO authenticated;

COMMIT;
