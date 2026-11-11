-- XiaoBao v1.2.0 P2-4F-A / 024 DRAFT - DO NOT DEPLOY.
-- ISOLATED PG16 ONLY; requires 021 + 022 + 023. This installs owner + family
-- member READ-ONLY functions for committed legacy history and settings.
-- It never returns raw private archived source text, source digest or UID;
-- never reads uncommitted archive-only stages; never writes business data.
BEGIN;
DO $required$
BEGIN
 IF to_regclass('public.xb_legacy_history_entries') IS NULL
  OR to_regclass('public.xb_legacy_settings') IS NULL
  OR to_regclass('public.xb_migrations') IS NULL
  OR to_regclass('public.xb_children') IS NULL
  OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'xb_history_read_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END
$required$;

CREATE FUNCTION public.xb_read_legacy_history_page_draft(
 p_family_id uuid,p_child_id uuid,p_record_kind text,
 p_offset integer,p_limit integer
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $read_page$
DECLARE
 v_receipt public.xb_migrations%ROWTYPE;
 v_count integer;
 v_rows jsonb;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
   OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL
   OR p_record_kind IS NULL OR p_record_kind NOT IN
      ('all','transaction','quote','weight')
   OR p_offset IS NULL OR p_offset<0 OR p_offset>10000
   OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
  RAISE EXCEPTION 'invalid_legacy_history_page' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.xb_children
  WHERE family_id=p_family_id AND id=p_child_id
   AND deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'child_unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_receipt FROM public.xb_migrations
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_format='xiaobao-diapers:v1';
 IF NOT FOUND OR v_receipt.counts->>'archiveVerified'<>'true'
   OR v_receipt.counts->>'migration_schema'<>'legacy-history-v1' THEN
  RAISE EXCEPTION 'committed_history_receipt_required' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_count FROM public.xb_legacy_history_entries
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_sha256=v_receipt.source_sha256
   AND (p_record_kind='all' OR record_kind=p_record_kind);
 -- This immutable migration ledger cannot be edited. A stable sort by
 -- category+ordinal+ID makes bounded OFFSET pages deterministic.
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'kind',page.record_kind,'id',page.legacy_record_id,
  'ordinal',page.ordinal,'payload',page.payload)
  ORDER BY page.record_kind,page.ordinal,page.legacy_record_id),'[]'::jsonb)
 INTO v_rows
 FROM(
  SELECT record_kind,legacy_record_id,ordinal,payload
  FROM public.xb_legacy_history_entries
  WHERE family_id=p_family_id AND child_id=p_child_id
    AND source_sha256=v_receipt.source_sha256
    AND (p_record_kind='all' OR record_kind=p_record_kind)
  ORDER BY record_kind,ordinal,legacy_record_id
  LIMIT p_limit OFFSET p_offset
 ) page;
 RETURN jsonb_build_object(
  'complete',true,'record_kind',p_record_kind,'offset',p_offset,
  'limit',p_limit,'total',v_count,'has_more',p_offset+jsonb_array_length(v_rows)<v_count,
  'rows',v_rows,'can_edit',false,'can_upload',false);
END;
$read_page$;

CREATE FUNCTION public.xb_read_legacy_settings_draft(
 p_family_id uuid,p_child_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $read_settings$
DECLARE
 v_receipt public.xb_migrations%ROWTYPE;
 v_settings public.xb_legacy_settings%ROWTYPE;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
   OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL THEN
  RAISE EXCEPTION 'invalid_settings_scope' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.xb_children
  WHERE family_id=p_family_id AND id=p_child_id
   AND deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'child_unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_receipt FROM public.xb_migrations
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_format='xiaobao-diapers:v1';
 IF NOT FOUND OR v_receipt.counts->>'archiveVerified'<>'true'
   OR v_receipt.counts->>'migration_schema'<>'legacy-history-v1' THEN
  RAISE EXCEPTION 'committed_history_receipt_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_settings FROM public.xb_legacy_settings
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_sha256=v_receipt.source_sha256;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'legacy_settings_mismatch' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object(
  'complete',true,'revision',v_settings.revision,
  'settings',v_settings.settings_data,
  'can_edit',false,'can_upload',false);
END;
$read_settings$;

REVOKE ALL ON FUNCTION public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)
 FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.xb_read_legacy_settings_draft(uuid,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.xb_read_legacy_settings_draft(uuid,uuid)
 TO authenticated;
COMMIT;
