-- XiaoBao v1.2.0 P2-4E / DRAFT 021 / DO NOT DEPLOY TO REAL CLOUDBASE.
-- Only for isolated PostgreSQL 16 CI until the user separately authorizes DDL.
-- Adds two UNIQUE constraints to the existing private xb_migrations receipts
-- and an OWNER-ONLY, READ-ONLY preview. ZERO business/receipt rows inserted.
-- WARNING: this does NOT implement a migration commit/upload endpoint.
-- A valid preview response is NEVER proof of successful archival or import.
-- Later COMMIT RPC must use one transaction, the SAME FAMILY advisory lock as
-- 009, hash the actual payload server-side, migrate the full business dataset,
-- compare exact counts & revisions, THEN insert receipt LAST atomically.
-- SQL/HTTP permissions alone are not the CloudBase security boundary.
BEGIN;
DO $xb_require$
BEGIN
 IF to_regclass('public.xb_migrations') IS NULL
    OR to_regclass('public.xb_children') IS NULL
    OR to_regclass('public.xb_inventory') IS NULL
    OR to_regclass('public.xb_transactions') IS NULL
    OR to_regclass('public.xb_weight_records') IS NULL
    OR to_regclass('public.xb_baby_profiles') IS NULL
    OR to_regprocedure('xb_private.is_family_owner(uuid)') IS NULL
    OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
    OR to_regprocedure('public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'xb_migration_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END
$xb_require$;

-- One initial v1 import per child. A different migration UUID/source digest
-- CANNOT re-import it. A duplicate source digest within a family CANNOT be
-- assigned to another child, even if a caller changes their operation UUID.
-- The parent (family_id, migration_id) PK already guards receipt ID reuse.
CREATE UNIQUE INDEX xb_migration_once_per_child_source_format
 ON public.xb_migrations(family_id,child_id,source_format);
CREATE UNIQUE INDEX xb_migration_source_digest_once_per_family
 ON public.xb_migrations(family_id,source_format,source_sha256);

-- Only a preview: does not expose counts/receipts, hashes or identity IDs in
-- the result; it never reserves a migration slot or grants upload permission.
CREATE FUNCTION public.xb_preview_legacy_migration_receipt(
 p_family_id uuid,p_child_id uuid,p_source_sha256 text,p_source_format text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $xb_preview$
DECLARE
 v_prior public.xb_migrations%ROWTYPE;
 v_status text;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL
    OR p_source_format IS DISTINCT FROM 'xiaobao-diapers:v1'
    OR p_source_sha256 IS NULL
    OR p_source_sha256 !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid_migration_preview_request' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.xb_children
   WHERE family_id=p_family_id AND id=p_child_id
      AND deleted_at IS NULL AND legacy_slot='primary'
 ) THEN
  RAISE EXCEPTION 'active_primary_child_required' USING ERRCODE='42501';
 END IF;

 -- These are advisory read-only checks, NOT concurrency reservations.
 SELECT * INTO v_prior
 FROM public.xb_migrations
 WHERE family_id=p_family_id AND child_id=p_child_id
    AND source_format=p_source_format;
 IF FOUND THEN
  v_status:=CASE
   WHEN v_prior.source_sha256=p_source_sha256
   THEN 'ALREADY_RECEIPTED_SAME_SOURCE'
   ELSE 'CHILD_HAS_DIFFERENT_RECEIPT'
  END;
 ELSIF EXISTS(
  SELECT 1 FROM public.xb_migrations
  WHERE family_id=p_family_id AND source_format=p_source_format
    AND source_sha256=p_source_sha256
 ) THEN
  v_status:='SOURCE_RECEIPTED_FOR_OTHER_CHILD';
 ELSIF EXISTS(
  SELECT 1 FROM public.xb_baby_profiles
   WHERE family_id=p_family_id AND child_id=p_child_id
 ) OR EXISTS(
  SELECT 1 FROM public.xb_weight_records
   WHERE family_id=p_family_id AND child_id=p_child_id
 ) OR EXISTS(
  SELECT 1 FROM public.xb_inventory
   WHERE family_id=p_family_id AND child_id=p_child_id
 ) OR EXISTS(
  SELECT 1 FROM public.xb_inventory_operations
   WHERE family_id=p_family_id AND child_id=p_child_id
 ) OR EXISTS(
  SELECT 1 FROM public.xb_transactions
   WHERE family_id=p_family_id AND child_id=p_child_id
 ) THEN
  v_status:='TARGET_ALREADY_HAS_BUSINESS_DATA';
 ELSE
  v_status:='PLAN_ONLY_EMPTY_TARGET';
 END IF;
 RETURN jsonb_build_object(
  'status',v_status,'receipt_committed',false,
  'can_upload',false,'can_commit',false,
  'requires_separate_approval',true
 );
END;
$xb_preview$;

REVOKE ALL ON FUNCTION public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)
 TO authenticated;
COMMIT;
