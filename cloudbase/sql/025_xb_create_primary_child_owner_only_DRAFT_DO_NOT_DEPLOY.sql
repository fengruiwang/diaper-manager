-- XiaoBao V1.2.0 M2 - ONLY a design draft; NEVER execute on live CloudBase
-- without a separate, explicit user approval for DDL and primary creation.
-- This script installs ONE owner-only RPC, but DOES NOT create a primary baby.
-- Existing __xb_smoke_v1__ and all of its S140 purchases remain unchanged.
-- Reuses the existing xb_children_legacy_slot_unique (family_id, legacy_slot)
-- and the same family advisory lock as 009 purchase / 019 smoke-child RPC.
-- No table DDL, no data migration, no inserts, no permission changes to tables.
BEGIN;

DO $requirements$
BEGIN
 IF to_regclass('public.xb_children') IS NULL
    OR to_regprocedure('xb_private.is_family_owner(uuid)') IS NULL
    OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
    OR to_regprocedure('auth.role()') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR NOT EXISTS(
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
      WHERE i.indrelid=to_regclass('public.xb_children')
        AND c.relname='xb_children_legacy_slot_unique'
        AND i.indisvalid AND i.indisunique
    ) THEN
   RAISE EXCEPTION 'primary_create_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END
$requirements$;

-- First install only: never CREATE OR REPLACE an unknown live function.
CREATE FUNCTION public.xb_create_primary_child(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $primary$
DECLARE
 v_uid text;
 v_child_id uuid;
 v_deleted_at timestamptz;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL THEN
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

 -- Serialize primary creation with 009 writes / 019 smoke lifecycle.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('xb.inventory.family:'||p_family_id::text,0)
 );
 SELECT id,deleted_at INTO v_child_id,v_deleted_at
   FROM public.xb_children
  WHERE family_id=p_family_id AND legacy_slot='primary'
  FOR UPDATE;
 IF FOUND THEN
   IF v_deleted_at IS NOT NULL THEN
     RAISE EXCEPTION 'primary_child_retired_no_recreate'
       USING ERRCODE='23505';
   END IF;
   RETURN pg_catalog.jsonb_build_object(
     'child_id',v_child_id,'created',false,'legacy_slot','primary'
   );
 END IF;

 -- Never check the global number of children or global inventory emptiness:
 -- a retained smoke child and its audited S140 MUST NOT block a new primary.
 INSERT INTO public.xb_children(family_id,legacy_slot,display_name,created_by)
 VALUES(p_family_id,'primary','小宝',v_uid)
 RETURNING id INTO v_child_id;
 RETURN pg_catalog.jsonb_build_object(
   'child_id',v_child_id,'created',true,'legacy_slot','primary'
 );
END;
$primary$;

REVOKE ALL ON FUNCTION public.xb_create_primary_child(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_create_primary_child(uuid) TO authenticated;
COMMIT;
