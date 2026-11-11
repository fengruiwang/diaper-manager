-- XiaoBao v1.2.0 / P2-4E-B1 / DRAFT 022 / DO NOT DEPLOY.
-- Isolated PostgreSQL 16 contract ONLY. Live CloudBase/user data are off limits.
-- Stage an entire original v1 export byte-for-byte (as UTF-8 TEXT) and its
-- three record collections, ATOMICALLY, without touching live inventory.
-- An archive stage is NOT a completed migration: no xb_migrations receipt,
-- no inventory initialization, no purchase replay, and NO upload permission.
-- Data is sensitive; real storage requires separate explicit user approval.
BEGIN;
DO $req$
BEGIN
 IF to_regclass('public.xb_migrations') IS NULL
  OR to_regclass('public.xb_children') IS NULL
  OR to_regprocedure('xb_private.is_family_owner(uuid)') IS NULL
  OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
  OR to_regprocedure('public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)') IS NULL
  OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
  RAISE EXCEPTION 'xb_archive_stage_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END $req$;

CREATE TABLE public.xb_legacy_staging(
 family_id uuid NOT NULL,
 child_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_format text NOT NULL DEFAULT 'xiaobao-diapers:v1'
   CHECK(source_format='xiaobao-diapers:v1'),
 source_text text NOT NULL,
 source_bytes integer NOT NULL CHECK(source_bytes BETWEEN 2 AND 10485760),
 state_data jsonb NOT NULL CHECK(jsonb_typeof(state_data)='object'),
 counts jsonb NOT NULL CHECK(jsonb_typeof(counts)='object'),
 initiated_by text NOT NULL CHECK(char_length(initiated_by) BETWEEN 1 AND 128),
 staged_at timestamptz NOT NULL DEFAULT now(),
 stage_status text NOT NULL DEFAULT 'archive_only'
   CHECK(stage_status='archive_only'),
 PRIMARY KEY(family_id,child_id),
 UNIQUE(family_id,stage_id),
 UNIQUE(family_id,source_format,source_sha256),
 FOREIGN KEY(family_id,child_id)
  REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.xb_legacy_stage_records(
 family_id uuid NOT NULL,
 child_id uuid NOT NULL,
 record_kind text NOT NULL CHECK(record_kind IN ('transaction','quote','weight')),
 legacy_record_id text NOT NULL CHECK(char_length(legacy_record_id) BETWEEN 1 AND 200),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 10000),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(family_id,child_id,record_kind,legacy_record_id),
 UNIQUE(family_id,child_id,record_kind,ordinal),
 FOREIGN KEY(family_id,child_id)
  REFERENCES public.xb_legacy_staging(family_id,child_id) ON DELETE RESTRICT
);
REVOKE ALL ON public.xb_legacy_staging,public.xb_legacy_stage_records
 FROM PUBLIC,anon,authenticated;
ALTER TABLE public.xb_legacy_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_legacy_stage_records ENABLE ROW LEVEL SECURITY;
-- No authenticated SELECT policy: archives contain private household history.

CREATE FUNCTION xb_private.xb_v1_valid_date(p_date text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,pg_temp
AS $v1_date$
DECLARE d date;
BEGIN
 IF p_date IS NULL OR p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RETURN false;
 END IF;
 BEGIN
  d:=p_date::date;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN false;
 END;
 RETURN to_char(d,'YYYY-MM-DD')=p_date;
END;
$v1_date$;
REVOKE ALL ON FUNCTION xb_private.xb_v1_valid_date(text)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.xb_stage_legacy_archive_draft(
 p_family_id uuid,p_child_id uuid,p_stage_id uuid,p_export_text text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $stage$
DECLARE
 v_actor text; v_export jsonb; v_state jsonb; v_rec jsonb;
 v_digest text; v_len integer; v_exported_at text;
 v_prior public.xb_legacy_staging%ROWTYPE;
 v_size text; v_n numeric;
 v_kind text; v_section text; v_num integer;
 v_old_record_id text; v_found_ids text[];
 v_total_fen numeric; v_units numeric;
 v_count_tx integer; v_count_q integer; v_count_w integer;
 v_name text;
BEGIN
 -- Server-side identity is mandatory even if HTTP EXECUTE ACL is bypassed.
 IF COALESCE(auth.role(),'')<>'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_stage_id IS NULL
   OR p_export_text IS NULL THEN
  RAISE EXCEPTION 'invalid_archive_stage_request' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 v_len:=octet_length(p_export_text);
 IF v_len<2 OR v_len>10485760 THEN
  RAISE EXCEPTION 'invalid_archive_file_size' USING ERRCODE='22023';
 END IF;
 v_digest:=encode(sha256(convert_to(p_export_text,'UTF8')),'hex');
 -- Serialize against 009 purchases and against all concurrent stages.
 PERFORM pg_advisory_xact_lock(
  hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 PERFORM 1 FROM public.xb_children
  WHERE family_id=p_family_id AND id=p_child_id
    AND legacy_slot='primary' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'active_primary_child_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_prior FROM public.xb_legacy_staging
  WHERE family_id=p_family_id AND child_id=p_child_id;
 IF FOUND THEN
  IF v_prior.source_sha256<>v_digest
     OR v_prior.source_text<>p_export_text THEN
   RAISE EXCEPTION 'archive_stage_child_conflict' USING ERRCODE='23505';
  END IF;
  -- A duplicate stage is a read of the same archived source, NOT a new write.
  RETURN jsonb_build_object(
   'status','ALREADY_STAGED_SAME_SOURCE','duplicate',true,
   'archive_only',true,'can_commit',false,'can_upload',false,
   'receipt_committed',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.xb_legacy_staging
   WHERE family_id=p_family_id AND source_sha256=v_digest) THEN
  RAISE EXCEPTION 'archive_stage_source_other_child' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM public.xb_migrations
   WHERE family_id=p_family_id AND
       (child_id=p_child_id OR source_sha256=v_digest)) THEN
  RAISE EXCEPTION 'migration_already_receipted' USING ERRCODE='23505';
 END IF;
 -- An archive must never be staged over existing operational business rows.
 IF EXISTS(SELECT 1 FROM public.xb_inventory
   WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_inventory_operations
   WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_transactions
   WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_baby_profiles
   WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_weight_records
   WHERE family_id=p_family_id AND child_id=p_child_id) THEN
  RAISE EXCEPTION 'target_business_data_not_empty' USING ERRCODE='23505';
 END IF;
 BEGIN
  v_export:=p_export_text::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_legacy_export_json' USING ERRCODE='22023';
 END;
 IF jsonb_typeof(v_export)<>'object'
  OR (SELECT count(*) FROM jsonb_object_keys(v_export))<>4
  OR NOT(v_export ?& ARRAY['app','version','exportedAt','data'])
  OR v_export->>'app'<>'xiaobao-diapers'
  OR v_export->'version'<>'1'::jsonb
  OR jsonb_typeof(v_export->'data')<>'object' THEN
  RAISE EXCEPTION 'unsupported_legacy_export_envelope' USING ERRCODE='22023';
 END IF;
 v_exported_at:=v_export->>'exportedAt';
 IF jsonb_typeof(v_export->'exportedAt')<>'string'
   OR v_exported_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
  RAISE EXCEPTION 'invalid_legacy_export_timestamp' USING ERRCODE='22023';
 END IF;
 BEGIN
  IF to_char(v_exported_at::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v_exported_at THEN
   RAISE EXCEPTION 'invalid_legacy_export_timestamp' USING ERRCODE='22023';
  END IF;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'invalid_legacy_export_timestamp' USING ERRCODE='22023';
 END;
 v_state:=v_export->'data';
 -- Reject unknown top-level fields even though original text would preserve
 -- them. New schemas must be reviewed before writing archived personal data.
 IF EXISTS(
  SELECT 1 FROM jsonb_object_keys(v_state) key
  WHERE key<>ALL(ARRAY[
   'dueDate','birthDate','babyProfile','babyWeight','weightRecords',
   'currentSize','sizeMode','autoSize','replenishPolicy','preset',
   'goalPrice','plannedBudget','target','daily','inventory',
   'transactions','quotes','referenceOverrides'])
 ) THEN
  RAISE EXCEPTION 'unknown_legacy_top_level_fields' USING ERRCODE='22023';
 END IF;
 IF NOT(v_state ?& ARRAY[
   'dueDate','birthDate','babyProfile','babyWeight','weightRecords',
   'currentSize','sizeMode','autoSize','replenishPolicy',
   'goalPrice','plannedBudget','target','daily','inventory',
   'transactions','quotes','referenceOverrides']) THEN
  RAISE EXCEPTION 'legacy_required_fields_missing' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(v_state->'inventory')<>'object'
  OR jsonb_typeof(v_state->'target')<>'object'
  OR jsonb_typeof(v_state->'daily')<>'object'
  OR jsonb_typeof(v_state->'transactions')<>'array'
  OR jsonb_typeof(v_state->'quotes')<>'array'
  OR jsonb_typeof(v_state->'weightRecords')<>'array'
  OR jsonb_typeof(v_state->'referenceOverrides')<>'object'
  OR jsonb_typeof(v_state->'babyProfile')<>'object'
  OR jsonb_typeof(v_state->'replenishPolicy')<>'object' THEN
  RAISE EXCEPTION 'invalid_legacy_state_structure' USING ERRCODE='22023';
 END IF;
 FOREACH v_section IN ARRAY ARRAY['inventory','target','daily'] LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(v_state->v_section))<>6
    OR NOT ((v_state->v_section) ?& ARRAY['NB','S','M','L','XL','XXL']) THEN
   RAISE EXCEPTION 'legacy_size_map_incomplete' USING ERRCODE='22023';
  END IF;
  FOREACH v_size IN ARRAY ARRAY['NB','S','M','L','XL','XXL'] LOOP
   IF jsonb_typeof(v_state->v_section->v_size)<>'number'
     OR (v_state->v_section->>v_size) !~ '^(0|[1-9][0-9]{0,5})$' THEN
    RAISE EXCEPTION 'invalid_legacy_size_value' USING ERRCODE='22023';
   END IF;
   v_n:=(v_state->v_section->>v_size)::numeric;
   IF (v_section='inventory' AND v_n>100000)
       OR (v_section='target' AND v_n>10000)
       OR (v_section='daily' AND (v_n<1 OR v_n>30)) THEN
    RAISE EXCEPTION 'legacy_size_out_of_range' USING ERRCODE='22023';
   END IF;
  END LOOP;
 END LOOP;
 IF jsonb_typeof(v_state->'dueDate')<>'string'
  OR jsonb_typeof(v_state->'birthDate')<>'string'
  OR jsonb_typeof(v_state->'currentSize')<>'string'
  OR jsonb_typeof(v_state->'autoSize')<>'string'
  OR jsonb_typeof(v_state->'sizeMode')<>'string'
  OR jsonb_typeof(v_state->'babyWeight')<>'string'
  OR jsonb_typeof(v_state->'replenishPolicy'->'mode')<>'string'
  OR jsonb_typeof(v_state->'replenishPolicy'->'days')<>'number'
  OR NOT xb_private.xb_v1_valid_date(v_state->>'dueDate')
  OR (v_state->>'birthDate'<>''
      AND NOT xb_private.xb_v1_valid_date(v_state->>'birthDate'))
  OR v_state->>'currentSize'<>ALL(ARRAY['NB','S','M','L','XL','XXL'])
  OR v_state->>'autoSize'<>ALL(ARRAY['NB','S','M','L','XL','XXL'])
  OR v_state->>'sizeMode'<>ALL(ARRAY['manual','auto'])
  OR (v_state ? 'preset' AND
      v_state->>'preset'<>ALL(ARRAY['balanced','cautious','relaxed','custom']))
  OR v_state->'replenishPolicy'->>'mode'<>ALL(ARRAY['custom','days'])
  OR v_state->'replenishPolicy'->>'days' NOT IN ('5','7','10')
  OR jsonb_typeof(v_state->'goalPrice')<>'number'
  OR jsonb_typeof(v_state->'plannedBudget')<>'number' THEN
  RAISE EXCEPTION 'invalid_legacy_preferences' USING ERRCODE='22023';
 END IF;
 IF (v_state->>'goalPrice')::numeric<=0
  OR (v_state->>'plannedBudget')::numeric<0 THEN
  RAISE EXCEPTION 'invalid_legacy_prices' USING ERRCODE='22023';
 END IF;
 -- A member profile is not allowed to silently discard unknown extensions.
 IF NOT ((v_state->'babyProfile') ?&
   ARRAY['name','sex','birthTime','birthWeight','birthLength'])
  OR EXISTS(SELECT 1 FROM jsonb_each(v_state->'babyProfile') item
    WHERE jsonb_typeof(item.value)<>'string')
  OR char_length(btrim(v_state->'babyProfile'->>'name')) NOT BETWEEN 1 AND 80
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_state->'babyProfile') key
   WHERE key<>ALL(ARRAY['name','sex','birthTime','birthWeight','birthLength']))
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_state->'replenishPolicy') key
   WHERE key<>ALL(ARRAY['mode','days'])) THEN
  RAISE EXCEPTION 'unmapped_legacy_profile_fields' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(v_state->'transactions')>10000
  OR jsonb_array_length(v_state->'quotes')>10000
  OR jsonb_array_length(v_state->'weightRecords')>10000
  OR (SELECT count(*) FROM jsonb_object_keys(v_state->'referenceOverrides'))>10000 THEN
  RAISE EXCEPTION 'legacy_record_count_limit' USING ERRCODE='22023';
 END IF;

 -- Read all old purchases/uses as ARCHIVE entries, NEVER live stock deltas.
 v_count_tx:=0;v_count_q:=0;v_count_w:=0;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(v_state->'transactions') LOOP
  IF jsonb_typeof(v_rec)<>'object'
   OR NOT(v_rec ?& ARRAY['id','type','date','size','pieces'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_rec) key
     WHERE key<>ALL(ARRAY['id','type','date','brand','series','size','pieces','price']))
   OR jsonb_typeof(v_rec->'id')<>'string'
   OR jsonb_typeof(v_rec->'type')<>'string'
   OR jsonb_typeof(v_rec->'date')<>'string'
   OR jsonb_typeof(v_rec->'size')<>'string'
   OR char_length(v_rec->>'id') NOT BETWEEN 1 AND 200
   OR v_rec->>'type'<>ALL(ARRAY['buy','use'])
   OR NOT xb_private.xb_v1_valid_date(v_rec->>'date')
   OR v_rec->>'size'<>ALL(ARRAY['NB','S','M','L','XL','XXL'])
   OR jsonb_typeof(v_rec->'pieces')<>'number'
   OR (v_rec->>'pieces') !~ '^[1-9][0-9]{0,5}$'
   OR (v_rec->>'pieces')::numeric>100000 THEN
   RAISE EXCEPTION 'invalid_legacy_transaction' USING ERRCODE='22023';
  END IF;
  IF v_rec->>'type'='buy' THEN
   IF NOT (v_rec ?& ARRAY['brand','series','price'])
    OR jsonb_typeof(v_rec->'brand')<>'string'
    OR jsonb_typeof(v_rec->'series')<>'string'
    OR char_length(btrim(v_rec->>'brand')) NOT BETWEEN 1 AND 120
    OR char_length(btrim(v_rec->>'series')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(v_rec->'price')<>'number' THEN
    RAISE EXCEPTION 'invalid_legacy_purchase' USING ERRCODE='22023';
   END IF;
   v_total_fen:=(v_rec->>'price')::numeric*100;
   IF v_total_fen<>trunc(v_total_fen)
      OR v_total_fen<1 OR v_total_fen>10000000 THEN
    RAISE EXCEPTION 'invalid_legacy_purchase_money' USING ERRCODE='22023';
   END IF;
  END IF;
  v_count_tx:=v_count_tx+1;
 END LOOP;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(v_state->'quotes') LOOP
  IF jsonb_typeof(v_rec)<>'object'
    OR NOT(v_rec ?& ARRAY['id','date','brand','series','size',
                       'per','packs','pieces','price','unit'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_rec) key
      WHERE key<>ALL(ARRAY['id','date','brand','series','size',
                           'per','packs','pieces','price','unit']))
    OR jsonb_typeof(v_rec->'id')<>'string'
    OR char_length(v_rec->>'id') NOT BETWEEN 1 AND 200
    OR jsonb_typeof(v_rec->'date')<>'string'
    OR jsonb_typeof(v_rec->'brand')<>'string'
    OR jsonb_typeof(v_rec->'series')<>'string'
    OR jsonb_typeof(v_rec->'size')<>'string'
    OR NOT xb_private.xb_v1_valid_date(v_rec->>'date')
    OR char_length(btrim(v_rec->>'brand')) NOT BETWEEN 1 AND 120
    OR char_length(btrim(v_rec->>'series')) NOT BETWEEN 1 AND 120
    OR v_rec->>'size'<>ALL(ARRAY['NB','S','M','L','XL','XXL'])
    OR jsonb_typeof(v_rec->'per')<>'number'
    OR jsonb_typeof(v_rec->'packs')<>'number'
    OR jsonb_typeof(v_rec->'pieces')<>'number'
    OR (v_rec->>'per') !~ '^[1-9][0-9]{0,3}$'
    OR (v_rec->>'packs') !~ '^[1-9][0-9]{0,2}$'
    OR (v_rec->>'pieces') !~ '^[1-9][0-9]{0,4}$'
    OR (v_rec->>'per')::numeric>1000
    OR (v_rec->>'packs')::numeric>200
    OR (v_rec->>'pieces')::numeric>30000
    OR (v_rec->>'pieces')::numeric<>
      (v_rec->>'per')::numeric*(v_rec->>'packs')::numeric
    OR jsonb_typeof(v_rec->'price')<>'number'
    OR jsonb_typeof(v_rec->'unit')<>'number' THEN
   RAISE EXCEPTION 'invalid_legacy_quote' USING ERRCODE='22023';
  END IF;
  v_total_fen:=(v_rec->>'price')::numeric*100;
  v_units:=(v_rec->>'unit')::numeric;
  IF v_total_fen<>trunc(v_total_fen) OR v_total_fen<1
   OR v_total_fen>10000000 OR v_units<=0
   OR abs(v_units-(v_rec->>'price')::numeric/
          (v_rec->>'pieces')::numeric)>0.0000001 THEN
   RAISE EXCEPTION 'invalid_legacy_quote_money' USING ERRCODE='22023';
  END IF;
  v_count_q:=v_count_q+1;
 END LOOP;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(v_state->'weightRecords') LOOP
  IF jsonb_typeof(v_rec)<>'object'
    OR NOT(v_rec ?& ARRAY['id','date','weight'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_rec) key
      WHERE key<>ALL(ARRAY['id','date','time','weight','note']))
    OR jsonb_typeof(v_rec->'id')<>'string'
    OR char_length(v_rec->>'id') NOT BETWEEN 1 AND 200
    OR jsonb_typeof(v_rec->'date')<>'string'
    OR NOT xb_private.xb_v1_valid_date(v_rec->>'date')
    OR jsonb_typeof(v_rec->'weight')<>'number' THEN
   RAISE EXCEPTION 'invalid_legacy_weight' USING ERRCODE='22023';
  END IF;
  v_n:=(v_rec->>'weight')::numeric;
  IF v_n<0.3 OR v_n>40 OR v_n*1000<>trunc(v_n*1000)
     OR (v_rec ? 'note' AND
       (jsonb_typeof(v_rec->'note')<>'string'
        OR char_length(v_rec->>'note')>120))
     OR (v_rec ? 'time' AND
      (jsonb_typeof(v_rec->'time')<>'string'
       OR (v_rec->>'time'<>''
        AND v_rec->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'))) THEN
   RAISE EXCEPTION 'invalid_legacy_weight_measurement' USING ERRCODE='22023';
  END IF;
  v_count_w:=v_count_w+1;
 END LOOP;
 FOR v_name IN SELECT key FROM jsonb_object_keys(v_state->'referenceOverrides') key LOOP
  IF array_length(string_to_array(v_name,'|'),1)<>3
    OR btrim(split_part(v_name,'|',1))=''
    OR btrim(split_part(v_name,'|',2))=''
    OR split_part(v_name,'|',3)<>ALL(ARRAY['NB','S','M','L','XL'])
    OR jsonb_typeof(v_state->'referenceOverrides'->v_name)<>'number' THEN
   RAISE EXCEPTION 'invalid_legacy_reference_override' USING ERRCODE='22023';
  END IF;
  v_n:=(v_state->'referenceOverrides'->>v_name)::numeric;
  IF v_n<=0 OR v_n>100 OR v_n*1000<>trunc(v_n*1000) THEN
   RAISE EXCEPTION 'invalid_legacy_reference_precision' USING ERRCODE='22023';
  END IF;
 END LOOP;
 -- All source data are now validated server-side. One DB transaction owns
 -- the archive row, every archived record and its counts. NO final receipt.
 INSERT INTO public.xb_legacy_staging(
  family_id,child_id,stage_id,source_sha256,source_text,source_bytes,
  state_data,counts,initiated_by)
 VALUES(p_family_id,p_child_id,p_stage_id,v_digest,p_export_text,v_len,
  v_state,jsonb_build_object(
   'transactions',v_count_tx,'quotes',v_count_q,'weightRecords',v_count_w,
   'inventorySizes',6,
   'referenceOverrides',(SELECT count(*)
     FROM jsonb_object_keys(v_state->'referenceOverrides'))),
  v_actor);
 INSERT INTO public.xb_legacy_stage_records(
  family_id,child_id,record_kind,legacy_record_id,ordinal,payload)
 SELECT p_family_id,p_child_id,'transaction',value->>'id',ordinality::integer,value
 FROM jsonb_array_elements(v_state->'transactions') WITH ORDINALITY AS t(value,ordinality);
 INSERT INTO public.xb_legacy_stage_records(
  family_id,child_id,record_kind,legacy_record_id,ordinal,payload)
 SELECT p_family_id,p_child_id,'quote',value->>'id',ordinality::integer,value
 FROM jsonb_array_elements(v_state->'quotes') WITH ORDINALITY AS t(value,ordinality);
 INSERT INTO public.xb_legacy_stage_records(
  family_id,child_id,record_kind,legacy_record_id,ordinal,payload)
 SELECT p_family_id,p_child_id,'weight',value->>'id',ordinality::integer,value
 FROM jsonb_array_elements(v_state->'weightRecords') WITH ORDINALITY AS t(value,ordinality);
 IF (SELECT count(*) FROM public.xb_legacy_stage_records
       WHERE family_id=p_family_id AND child_id=p_child_id)
     <>v_count_tx+v_count_q+v_count_w THEN
  RAISE EXCEPTION 'archive_record_count_mismatch' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object(
  'status','ARCHIVED_ONLY_NOT_MIGRATED','duplicate',false,
  'archive_only',true,'can_commit',false,'can_upload',false,
  'receipt_committed',false,
  'archived_transaction_count',v_count_tx,
  'archived_quote_count',v_count_q,
  'archived_weight_count',v_count_w);
END;
$stage$;
REVOKE ALL ON FUNCTION public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text)
 TO authenticated;
COMMIT;
