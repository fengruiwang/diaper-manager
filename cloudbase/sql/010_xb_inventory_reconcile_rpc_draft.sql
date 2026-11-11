-- XiaoBao v1.2.0 P2-1 STAGE 010: secure inventory reconciliation READ RPC.
-- Requires 005/008/009 schema and real 015/016 ACL acceptance after 017.
-- Scoped P2-1 deployment authorized by user. Creates a function/ACL only;
-- does not call RPC, create babies, insert inventory or migrate history.
-- Execute as one BEGIN/COMMIT script ONCE, then run read-only 018 and 012.
-- Logic unchanged from isolated-PG-tested implementation.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.xb_inventory') IS NULL OR
    to_regclass('public.xb_inventory_operations') IS NULL OR
    to_regclass('public.xb_children') IS NULL OR
    to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'xb_inventory_read_missing_schema';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.xb_read_inventory_reconciliation(
 p_family_id uuid,p_child_id uuid,p_operation_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
 v_actor text;
 v_inventory jsonb;
 v_seen jsonb;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_operation_ids IS NULL
    OR cardinality(p_operation_ids)>50
    OR array_position(p_operation_ids,NULL) IS NOT NULL
    OR (SELECT COUNT(DISTINCT op_id) FROM unnest(p_operation_ids) AS checked(op_id))
       <>cardinality(p_operation_ids) THEN
  RAISE EXCEPTION 'invalid_inventory_read_request' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.xb_children
   WHERE family_id=p_family_id AND id=p_child_id AND deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'child_unavailable' USING ERRCODE='42501';
 END IF;

 -- One PostgreSQL statement sees a consistent MVCC snapshot of all six sizes
 -- and receipts. Absent rows mean untouched zero-stock / revision zero.
 SELECT jsonb_agg(
   jsonb_build_object('size',sizes.size,'quantity',COALESCE(inv.quantity,0),
    'revision',COALESCE(inv.revision,0)) ORDER BY sizes.seq)
 INTO v_inventory
 FROM (VALUES(1,'NB'),(2,'S'),(3,'M'),(4,'L'),(5,'XL'),(6,'XXL')) AS sizes(seq,size)
 LEFT JOIN public.xb_inventory inv
  ON inv.family_id=p_family_id AND inv.child_id=p_child_id
   AND inv.size=sizes.size;

 -- Check exactly the supplied operation IDs for THIS signed-in member,
 -- THIS family and THIS child. Never infer an accepted operation from
 -- quantity or from somebody else's receipt.
 SELECT COALESCE(jsonb_agg(op.operation_id ORDER BY op.operation_id),'[]'::jsonb)
 INTO v_seen
 FROM public.xb_inventory_operations op
 WHERE op.family_id=p_family_id AND op.child_id=p_child_id
   AND op.actor_uid=v_actor AND op.operation_id=ANY(p_operation_ids);

 RETURN jsonb_build_object(
  'complete',true,'family_id',p_family_id,'child_id',p_child_id,
  'actor_uid',v_actor,
  'checked_operation_ids',to_jsonb(p_operation_ids),
  'seen_operation_ids',v_seen,'rows',v_inventory
 );
END;
$$;

REVOKE ALL ON FUNCTION public.xb_read_inventory_reconciliation(uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xb_read_inventory_reconciliation(uuid,uuid,uuid[]) TO authenticated;
COMMIT;
