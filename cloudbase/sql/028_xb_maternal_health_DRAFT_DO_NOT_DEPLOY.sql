-- V1.3.0 family-scoped maternal health. Install only with separate authorization.
-- Depends on 001 shared foundation. The write RPC is installed without EXECUTE
-- for application roles until separately approved.
BEGIN;

CREATE TABLE public.xb_maternal_health_documents (
 family_id uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE RESTRICT,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 revision bigint NOT NULL CHECK (revision >= 0),
 updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.xb_maternal_health_requests (
 family_id uuid NOT NULL REFERENCES public.xb_maternal_health_documents(family_id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
 resulting_revision bigint NOT NULL CHECK (resulting_revision = expected_revision + 1),
 body_sha256 bytea NOT NULL CHECK (octet_length(body_sha256) = 32),
 actor_uid text NOT NULL CHECK (char_length(actor_uid) BETWEEN 1 AND 128),
 committed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (family_id, request_id)
);

ALTER TABLE public.xb_maternal_health_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_maternal_health_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xb_maternal_health_documents, public.xb_maternal_health_requests
 FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.xb_read_maternal_health(p_family_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $read$
DECLARE
 v_revision bigint;
 v_payload jsonb;
BEGIN
 IF NOT xb_private.can_use_app(p_family_id, 'xb') THEN
  RAISE EXCEPTION 'maternal_health_permission_denied' USING ERRCODE = '42501';
 END IF;

 SELECT revision, payload INTO v_revision, v_payload
 FROM public.xb_maternal_health_documents WHERE family_id = p_family_id;

 RETURN jsonb_build_object('family_id', p_family_id,
  'revision', COALESCE(v_revision, 0),
  'body', COALESCE(v_payload, '{"schemaVersion":1,"items":[]}'::jsonb));
END;
$read$;

CREATE FUNCTION public.xb_put_maternal_health(
 p_family_id uuid, p_expected_revision bigint, p_request_id uuid, p_next_body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $put$
DECLARE
 v_actor text;
 v_revision bigint;
 v_hash bytea;
 v_previous public.xb_maternal_health_requests%ROWTYPE;
BEGIN
 IF NOT xb_private.can_use_app(p_family_id, 'xb') THEN
  RAISE EXCEPTION 'maternal_health_permission_denied' USING ERRCODE = '42501';
 END IF;
 v_actor := auth.uid();

 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
   OR jsonb_typeof(p_next_body) IS DISTINCT FROM 'object'
   OR p_next_body->'schemaVersion' IS DISTINCT FROM '1'::jsonb
   OR jsonb_typeof(p_next_body->'items') IS DISTINCT FROM 'array'
   OR octet_length(p_next_body::text) > 1048576 THEN
  RAISE EXCEPTION 'invalid_maternal_health_document' USING ERRCODE = '22023';
 END IF;
 v_hash := sha256(convert_to(p_next_body::text, 'UTF8'));

 -- A first writer creates the row inside this transaction. The unique key
 -- serializes concurrent first writes, and the row lock covers later writes.
 INSERT INTO public.xb_maternal_health_documents (family_id, payload, revision, updated_by)
 VALUES (p_family_id, '{"schemaVersion":1,"items":[]}'::jsonb, 0, v_actor)
 ON CONFLICT (family_id) DO NOTHING;
 SELECT revision INTO STRICT v_revision
 FROM public.xb_maternal_health_documents WHERE family_id = p_family_id FOR UPDATE;

 SELECT * INTO v_previous FROM public.xb_maternal_health_requests
 WHERE family_id = p_family_id AND request_id = p_request_id;
 IF FOUND THEN
  IF v_previous.actor_uid <> v_actor OR v_previous.expected_revision <> p_expected_revision
    OR v_previous.body_sha256 <> v_hash THEN
   RAISE EXCEPTION 'maternal_health_request_id_reused' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object('saved', true, 'duplicate', true, 'family_id', p_family_id,
   'request_id', p_request_id, 'revision', v_previous.resulting_revision);
 END IF;

 IF v_revision <> p_expected_revision THEN
  RAISE EXCEPTION 'maternal_health_revision_conflict' USING ERRCODE = '40001';
 END IF;

 -- Record-specific fields for constipation and recovery can be added when
 -- their forms are defined. The common record contract applies to all kinds.
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_next_body->'items') AS entry(item)
  WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
   OR char_length(btrim(item->>'id')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(item->'date') IS DISTINCT FROM 'string'
   OR item->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR NOT pg_input_is_valid(item->>'date', 'date')
   OR COALESCE(item->>'kind', '') NOT IN ('weight', 'constipation', 'postpartum_recovery')
   OR (item->>'kind' = 'weight' AND CASE
    WHEN jsonb_typeof(item->'weightKg') = 'number' THEN (item->>'weightKg')::numeric <= 0
    ELSE true END)
 ) OR EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_next_body->'items') AS entry(item)
  GROUP BY item->>'id' HAVING count(*) > 1
 ) THEN
  RAISE EXCEPTION 'invalid_maternal_health_record' USING ERRCODE = '22023';
 END IF;

 UPDATE public.xb_maternal_health_documents
 SET payload = p_next_body, revision = v_revision + 1, updated_by = v_actor, updated_at = now()
 WHERE family_id = p_family_id;

 INSERT INTO public.xb_maternal_health_requests
  (family_id, request_id, expected_revision, resulting_revision, body_sha256, actor_uid)
 VALUES (p_family_id, p_request_id, p_expected_revision, v_revision + 1, v_hash, v_actor);

 RETURN jsonb_build_object('saved', true, 'duplicate', false, 'family_id', p_family_id,
  'request_id', p_request_id, 'revision', v_revision + 1);
END;
$put$;

CREATE FUNCTION public.xb_check_maternal_health_request(p_family_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $receipt$
DECLARE
 v_revision bigint;
BEGIN
 IF NOT xb_private.can_use_app(p_family_id, 'xb') THEN
  RAISE EXCEPTION 'maternal_health_permission_denied' USING ERRCODE = '42501';
 END IF;
 IF p_request_id IS NULL THEN
  RAISE EXCEPTION 'invalid_maternal_health_request' USING ERRCODE = '22023';
 END IF;

 SELECT resulting_revision INTO v_revision FROM public.xb_maternal_health_requests
 WHERE family_id = p_family_id AND request_id = p_request_id AND actor_uid = auth.uid();
 IF NOT FOUND THEN
  RETURN jsonb_build_object('status', 'NO_RECEIPT', 'family_id', p_family_id,
   'request_id', p_request_id);
 END IF;

 RETURN jsonb_build_object('status', 'COMMITTED', 'family_id', p_family_id,
  'request_id', p_request_id, 'revision', v_revision);
END;
$receipt$;

REVOKE ALL ON FUNCTION public.xb_read_maternal_health(uuid),
 public.xb_put_maternal_health(uuid,bigint,uuid,jsonb),
 public.xb_check_maternal_health_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xb_read_maternal_health(uuid),
 public.xb_check_maternal_health_request(uuid,uuid) TO authenticated;

COMMIT;
