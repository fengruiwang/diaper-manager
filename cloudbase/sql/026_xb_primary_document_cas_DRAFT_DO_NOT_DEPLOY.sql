-- XiaoBao V1.2.0 M3 non-stock business documents (draft, DO NOT DEPLOY).
-- Must NOT be run against real xiaobao-family without a new explicit approval.
-- Depends on 005 base, 023 migrated baseline and receipt, 024 legacy readers.
-- Installing this script does NOT read/upload real household data or migrate it.
-- The functions require an already-committed migration receipt and active
-- legacy_slot='primary'. Smoke S140 is never selected or modified.
--
-- Documents are fully shared between A/B, with CAS revision and stable
-- request_id idempotency. Native original migrated history remains immutable.
-- Growth/quote edits live in versioned documents; original history ledger
-- can always be audited separately. Stock is never derived from documents.
BEGIN;
DO $requirements$
BEGIN
 IF to_regclass('public.xb_children') IS NULL
  OR to_regclass('public.xb_migrations') IS NULL
  OR to_regclass('public.xb_legacy_settings') IS NULL
  OR to_regclass('public.xb_legacy_history_entries') IS NULL
  OR to_regclass('public.xb_baby_profiles') IS NULL
  OR to_regprocedure('auth.role()') IS NULL
  OR to_regprocedure('auth.uid()') IS NULL
  OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
  OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
  RAISE EXCEPTION 'xb_primary_docs_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END $requirements$;

CREATE TABLE public.xb_primary_documents(
 family_id uuid NOT NULL,
 child_id uuid NOT NULL,
 document_kind text NOT NULL CHECK(document_kind IN
  ('quotes','reference','growth','profile','settings')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 revision bigint NOT NULL CHECK(revision>=1),
 updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 128),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,child_id,document_kind),
 FOREIGN KEY(family_id,child_id)
  REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.xb_primary_document_commands(
 family_id uuid NOT NULL,
 request_id uuid NOT NULL,
 child_id uuid NOT NULL,
 document_kind text NOT NULL,
 expected_revision bigint NOT NULL CHECK(expected_revision>=0),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
 resulting_revision bigint NOT NULL CHECK(resulting_revision>=1),
 actor_uid text NOT NULL CHECK(char_length(actor_uid) BETWEEN 1 AND 128),
 committed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,request_id),
 FOREIGN KEY(family_id,child_id,document_kind)
  REFERENCES public.xb_primary_documents(family_id,child_id,document_kind)
  ON DELETE RESTRICT
);
REVOKE ALL ON public.xb_primary_documents,public.xb_primary_document_commands
 FROM PUBLIC,anon,authenticated;
ALTER TABLE public.xb_primary_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_primary_document_commands ENABLE ROW LEVEL SECURITY;
-- Direct authenticated client DML and SELECT remain forbidden.
-- Definer RPCs below are the ONLY client access.

CREATE FUNCTION public.xb_primary_document_baseline_draft(
 p_family_id uuid,p_child_id uuid,p_kind text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $baseline$
DECLARE v_settings jsonb;v_profile jsonb;v_items jsonb;
BEGIN
 -- Private helper is never executable by clients.
 SELECT settings_data INTO v_settings FROM public.xb_legacy_settings
  WHERE family_id=p_family_id AND child_id=p_child_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'migrated_settings_baseline_required' USING ERRCODE='23514';
 END IF;
 IF p_kind='quotes' OR p_kind='growth' THEN
  SELECT COALESCE(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb)
   INTO v_items FROM public.xb_legacy_history_entries
   WHERE family_id=p_family_id AND child_id=p_child_id
     AND record_kind=CASE WHEN p_kind='quotes' THEN 'quote' ELSE 'weight' END;
  RETURN jsonb_build_object('items',v_items);
 ELSIF p_kind='reference' THEN
  RETURN jsonb_build_object('referenceOverrides',
   COALESCE(v_settings->'referenceOverrides','{}'::jsonb));
 ELSIF p_kind='settings' THEN
  RETURN v_settings - 'referenceOverrides' - 'dueDate'
    - 'birthDate' - 'babyWeight';
 ELSIF p_kind='profile' THEN
  SELECT profile_data INTO v_profile FROM public.xb_baby_profiles
   WHERE family_id=p_family_id AND child_id=p_child_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'migrated_profile_baseline_required' USING ERRCODE='23514';
  END IF;
  RETURN v_profile;
 END IF;
 RAISE EXCEPTION 'unknown_primary_document_kind' USING ERRCODE='22023';
END;
$baseline$;
REVOKE ALL ON FUNCTION public.xb_primary_document_baseline_draft(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.xb_read_primary_document_draft(
 p_family_id uuid,p_child_id uuid,p_kind text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $read$
DECLARE v_doc public.xb_primary_documents%ROWTYPE;v_body jsonb;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated' OR NULLIF(auth.uid(),'') IS NULL
  THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
 IF p_family_id IS NULL OR p_child_id IS NULL OR
    p_kind NOT IN ('quotes','reference','growth','profile','settings')
  THEN RAISE EXCEPTION 'invalid_document_scope' USING ERRCODE='22023'; END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.xb_children
    WHERE family_id=p_family_id AND id=p_child_id
      AND legacy_slot='primary' AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'active_primary_required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.xb_migrations
    WHERE family_id=p_family_id AND child_id=p_child_id
      AND source_format='xiaobao-diapers:v1')
  THEN RAISE EXCEPTION 'completed_migration_receipt_required'
     USING ERRCODE='42501'; END IF;
 SELECT * INTO v_doc FROM public.xb_primary_documents
  WHERE family_id=p_family_id AND child_id=p_child_id
    AND document_kind=p_kind;
 IF FOUND THEN v_body:=v_doc.payload;
 ELSE v_body:=public.xb_primary_document_baseline_draft(
   p_family_id,p_child_id,p_kind);END IF;
 IF jsonb_typeof(v_body)<>'object' THEN
  RAISE EXCEPTION 'document_baseline_invalid' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('complete',true,'kind',p_kind,
  'family_id',p_family_id,'child_id',p_child_id,
  'revision',CASE WHEN v_doc.revision IS NULL THEN 0 ELSE v_doc.revision END,
  'body',v_body,'can_upload',false);
END;
$read$;
REVOKE ALL ON FUNCTION public.xb_read_primary_document_draft(uuid,uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_read_primary_document_draft(uuid,uuid,text)
 TO authenticated;

CREATE FUNCTION public.xb_put_primary_document_draft(
 p_family_id uuid,p_child_id uuid,p_kind text,
 p_expected_revision bigint,p_request_id uuid,p_next_body jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $put$
DECLARE
 v_actor text;v_sha text;v_doc public.xb_primary_documents%ROWTYPE;
 v_old public.xb_primary_document_commands%ROWTYPE;
 v_current jsonb;v_revision bigint;v_count bigint;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated' OR NULLIF(auth.uid(),'') IS NULL
  THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_request_id IS NULL
   OR p_kind NOT IN ('quotes','reference','growth','profile','settings')
   OR p_expected_revision IS NULL OR p_expected_revision<0
   OR jsonb_typeof(p_next_body)<>'object'
   OR octet_length(p_next_body::text)>1048576
  THEN RAISE EXCEPTION 'invalid_document_put' USING ERRCODE='22023';END IF;
 IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';END IF;
 -- Serialize with 009 inventory operations and all other app writes,
 -- including two family accounts editing the same field concurrently.
 PERFORM pg_advisory_xact_lock(
  hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 PERFORM 1 FROM public.xb_children WHERE family_id=p_family_id
  AND id=p_child_id AND legacy_slot='primary'
  AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'active_primary_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.xb_migrations
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_format='xiaobao-diapers:v1') THEN
  RAISE EXCEPTION 'migration_receipt_required' USING ERRCODE='42501';END IF;
 v_sha:=encode(sha256(convert_to(p_next_body::text,'UTF8')),'hex');
 SELECT * INTO v_old FROM public.xb_primary_document_commands
  WHERE family_id=p_family_id AND request_id=p_request_id;
 IF FOUND THEN
  IF v_old.child_id<>p_child_id OR v_old.document_kind<>p_kind
    OR v_old.expected_revision<>p_expected_revision OR v_old.body_sha256<>v_sha
   THEN RAISE EXCEPTION 'request_id_reused_different_document'
     USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('saved',true,'duplicate',true,
   'request_id',p_request_id,'revision',v_old.resulting_revision,
   'kind',p_kind,'family_id',p_family_id,'child_id',p_child_id);
 END IF;
 SELECT * INTO v_doc FROM public.xb_primary_documents
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND document_kind=p_kind FOR UPDATE;
 IF FOUND THEN v_current:=v_doc.payload;v_revision:=v_doc.revision;
 ELSE v_current:=public.xb_primary_document_baseline_draft(
   p_family_id,p_child_id,p_kind);v_revision:=0;
 END IF;
 IF v_revision<>p_expected_revision THEN
  RAISE EXCEPTION 'primary_document_revision_conflict'
   USING ERRCODE='40001';END IF;
 -- Kind-specific strict minimum schemas. New versions must not silently
 -- discard existing settings/profile keys, even ones unknown to this UI.
 IF p_kind IN ('settings','profile') THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_current) key
    WHERE NOT p_next_body ? key) THEN
   RAISE EXCEPTION 'existing_document_key_dropped' USING ERRCODE='23514';
  END IF;
  IF p_kind='settings' AND
    (jsonb_typeof(p_next_body->'target')<>'object'
      OR jsonb_typeof(p_next_body->'daily')<>'object') THEN
   RAISE EXCEPTION 'invalid_settings_shape' USING ERRCODE='22023';END IF;
  IF p_kind='profile' AND
    jsonb_typeof(p_next_body->'babyProfile')<>'object' THEN
   RAISE EXCEPTION 'invalid_profile_shape' USING ERRCODE='22023';END IF;
 ELSIF p_kind='reference' THEN
  IF jsonb_typeof(p_next_body->'referenceOverrides')<>'object'
   OR EXISTS(SELECT 1 FROM jsonb_each(p_next_body->'referenceOverrides') entry
    WHERE jsonb_typeof(entry.value)<>'number'
      OR (entry.value::text)::numeric<=0
      OR (entry.value::text)::numeric>100
      OR (entry.value::text)::numeric*1000<>
       trunc((entry.value::text)::numeric*1000)) THEN
   RAISE EXCEPTION 'invalid_reference_price_precision' USING ERRCODE='22023';END IF;
 ELSIF p_kind IN ('quotes','growth') THEN
  IF jsonb_typeof(p_next_body->'items')<>'array'
     OR jsonb_array_length(p_next_body->'items')>10000 THEN
   RAISE EXCEPTION 'invalid_document_items' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(
   p_next_body->'items') item
   WHERE jsonb_typeof(item)<>'object' OR NOT(item ? 'id')
     OR jsonb_typeof(item->'id')<>'string'
     OR length(item->>'id') NOT BETWEEN 1 AND 200;
  IF v_count>0 THEN
   RAISE EXCEPTION 'invalid_document_record_ids' USING ERRCODE='22023';END IF;
  IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_next_body->'items') item
   GROUP BY item->>'id' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'duplicate_document_ids' USING ERRCODE='23505';END IF;
 END IF;
 IF v_revision=0 THEN
  INSERT INTO public.xb_primary_documents(
   family_id,child_id,document_kind,payload,revision,updated_by)
  VALUES(p_family_id,p_child_id,p_kind,p_next_body,1,v_actor);
 ELSE
  UPDATE public.xb_primary_documents SET payload=p_next_body,
   revision=v_revision+1,updated_by=v_actor,updated_at=now()
   WHERE family_id=p_family_id AND child_id=p_child_id
    AND document_kind=p_kind;
 END IF;
 INSERT INTO public.xb_primary_document_commands(
  family_id,request_id,child_id,document_kind,expected_revision,
  body_sha256,resulting_revision,actor_uid)
 VALUES(p_family_id,p_request_id,p_child_id,p_kind,
  p_expected_revision,v_sha,v_revision+1,v_actor);
 RETURN jsonb_build_object('saved',true,'duplicate',false,
  'request_id',p_request_id,'revision',v_revision+1,
  'kind',p_kind,'family_id',p_family_id,'child_id',p_child_id);
END;
$put$;
REVOKE ALL ON FUNCTION public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)
 TO authenticated;
COMMIT;
