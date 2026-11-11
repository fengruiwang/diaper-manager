-- XiaoBao v1.2.0 P2-3B / DESIGN DRAFT / NOT AUTHORIZED FOR LIVE DEPLOYMENT.
-- DO NOT EXECUTE IN REAL CLOUDBase until user separately authorizes test-child DDL.
-- This script is executed ONLY in disposable, synthetic PostgreSQL CI.
-- Installs two owner-only test-child RPCs. Does not itself insert any child.
-- Reserved legacy_slot '__xb_smoke_v1__' never equals production 'primary'.
-- At most ONE smoke child per family lifetime. Retired child is NEVER revived.
-- No direct client INSERT/UPDATE, no changes to family/member/transaction tables.
-- First-install CREATE FUNCTION (not REPLACE): never overwrite unknown RPCs.
-- Both RPCs use the SAME family advisory lock key as 009 inventory writes.
BEGIN;

DO $xb_smoke_requirements$
BEGIN
 IF to_regclass('public.xb_children') IS NULL
    OR to_regprocedure('xb_private.is_family_owner(uuid)') IS NULL
    OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'smoke_schema_missing' USING ERRCODE='42P01';
 END IF;
END
$xb_smoke_requirements$;

CREATE FUNCTION public.xb_create_smoke_child(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog,public,pg_temp
AS $xb_create_smoke$
DECLARE
 v_uid text;
 v_child_id uuid;
 v_retired timestamptz;
BEGIN
 IF COALESCE(auth.role(),'') <> 'authenticated' OR NULLIF(auth.uid(),'') IS NULL THEN
   RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 v_uid:=auth.uid();
 IF p_family_id IS NULL THEN
   RAISE EXCEPTION 'invalid_family_id' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
   RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;

 -- Use EXACTLY the same family advisory key as live 009 purchase RPC.
 -- Creation and retirement cannot interleave with a stock write in flight.
 -- Existing partial UNIQUE index is the final duplicate-creation guard.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 SELECT id,deleted_at INTO v_child_id,v_retired
 FROM public.xb_children
 WHERE family_id=p_family_id AND legacy_slot='__xb_smoke_v1__'
 FOR UPDATE;
 IF FOUND THEN
   IF v_retired IS NOT NULL THEN
     RAISE EXCEPTION 'smoke_child_permanently_retired' USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('child_id',v_child_id,'created',false,'test_only',true);
 END IF;
 INSERT INTO public.xb_children(family_id,legacy_slot,display_name,created_by)
 VALUES (p_family_id,'__xb_smoke_v1__','测试宝宝（仅云端联调）',v_uid)
 RETURNING id INTO v_child_id;
 RETURN jsonb_build_object('child_id',v_child_id,'created',true,'test_only',true);
END;
$xb_create_smoke$;

CREATE FUNCTION public.xb_retire_smoke_child(
 p_family_id uuid,p_child_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog,public,pg_temp
AS $xb_retire_smoke$
DECLARE
 v_child_id uuid;
 v_deleted timestamptz;
BEGIN
 IF COALESCE(auth.role(),'') <> 'authenticated' OR NULLIF(auth.uid(),'') IS NULL THEN
   RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL THEN
   RAISE EXCEPTION 'invalid_smoke_child_scope' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
   RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 -- Serialize retirement with 009 stock writes. A transaction that observes an
 -- active child will complete before a retirement can commit, and vice versa.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 SELECT id,deleted_at INTO v_child_id,v_deleted
 FROM public.xb_children
 WHERE family_id=p_family_id AND id=p_child_id
   AND legacy_slot='__xb_smoke_v1__'
 FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'smoke_child_not_found' USING ERRCODE='22023';
 END IF;
 IF v_deleted IS NOT NULL THEN
   RETURN jsonb_build_object('child_id',v_child_id,'retired',false,'already_retired',true);
 END IF;
 UPDATE public.xb_children SET deleted_at=now(),updated_at=now(),
  revision=revision+1
 WHERE family_id=p_family_id AND id=v_child_id
   AND legacy_slot='__xb_smoke_v1__' AND deleted_at IS NULL;
 RETURN jsonb_build_object('child_id',v_child_id,'retired',true,'already_retired',false);
END;
$xb_retire_smoke$;

-- CloudBase HTTP RPC gateway may not enforce SQL EXECUTE ACL:
-- auth.role + auth.uid + owner + xb grant checks above are mandatory.
REVOKE ALL ON FUNCTION public.xb_create_smoke_child(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.xb_retire_smoke_child(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_create_smoke_child(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xb_retire_smoke_child(uuid,uuid) TO authenticated;

COMMIT;
