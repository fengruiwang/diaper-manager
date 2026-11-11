-- XiaoBao v1.2.0 P2-4E-B2 / 023 DRAFT - DO NOT DEPLOY.
-- Isolated PG16 CI only. No live CloudBase or user's backup authorized.
-- Promote a previously validated, server-digested v1 archive in ONE DB call:
-- profile, six stocktake baseline rows + six migration_baseline operations,
-- native weight rows, all historical events (NO purchase replay), preferences,
-- all counts verified, and FINAL xb_migrations receipt (LAST).
-- This does not enable the outbox, existing UI or historical editing.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.xb_legacy_staging') IS NULL
   OR to_regclass('public.xb_legacy_stage_records') IS NULL
   OR to_regclass('public.xb_migrations') IS NULL
   OR to_regclass('public.xb_inventory') IS NULL
   OR to_regclass('public.xb_inventory_operations') IS NULL
   OR to_regclass('public.xb_baby_profiles') IS NULL
   OR to_regclass('public.xb_weight_records') IS NULL
   OR to_regclass('public.xb_transactions') IS NULL
   OR to_regprocedure('xb_private.is_family_owner(uuid)') IS NULL
   OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL
   OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL THEN
  RAISE EXCEPTION 'xb_promotion_prerequisites_missing' USING ERRCODE='42P01';
 END IF;
END
$preflight$;

-- Dedicated legacy ledger: old buys/uses/quotes are not real-time operations.
-- Future edit/correction must use an audited RPC, never direct client DML.
CREATE TABLE public.xb_legacy_history_entries (
 family_id uuid NOT NULL,
 child_id uuid NOT NULL,
 record_kind text NOT NULL CHECK(record_kind IN ('transaction','quote','weight')),
 legacy_record_id text NOT NULL CHECK(char_length(legacy_record_id) BETWEEN 1 AND 200),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 10000),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 migrated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,child_id,record_kind,legacy_record_id),
 UNIQUE(family_id,child_id,record_kind,ordinal),
 FOREIGN KEY(family_id,child_id)
   REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);
CREATE INDEX xb_legacy_history_child_time
 ON public.xb_legacy_history_entries(family_id,child_id,record_kind,ordinal);
REVOKE ALL ON public.xb_legacy_history_entries
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.xb_legacy_history_entries TO authenticated;
ALTER TABLE public.xb_legacy_history_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY xb_legacy_history_family_read
 ON public.xb_legacy_history_entries FOR SELECT TO authenticated
 USING (xb_private.can_use_app(family_id,'xb'));

-- Version-zero snapshot of the settings from the original legacy state.
-- Excludes duplicated history/stock/profile, but leaves each setting exactly
-- as represented in the validated original v1 JSON.
CREATE TABLE public.xb_legacy_settings (
 family_id uuid NOT NULL,
 child_id uuid NOT NULL,
 settings_data jsonb NOT NULL CHECK(jsonb_typeof(settings_data)='object'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 migrated_by text NOT NULL CHECK(char_length(migrated_by) BETWEEN 1 AND 128),
 migrated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,child_id),
 FOREIGN KEY(family_id,child_id)
   REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON public.xb_legacy_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.xb_legacy_settings TO authenticated;
ALTER TABLE public.xb_legacy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY xb_legacy_settings_family_read
 ON public.xb_legacy_settings FOR SELECT TO authenticated
 USING (xb_private.can_use_app(family_id,'xb'));

CREATE FUNCTION public.xb_promote_legacy_archive_draft(
 p_family_id uuid,p_child_id uuid,p_migration_id uuid,p_source_sha256 text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $promote$
DECLARE
 v_actor text;
 v_stage public.xb_legacy_staging%ROWTYPE;
 v_prior public.xb_migrations%ROWTYPE;
 v_state jsonb;
 v_record record;
 v_size text;
 v_qty integer;
 v_operation_id uuid;
 v_digest text;
 v_arr jsonb;
 v_type text;
 v_count integer;
 v_expected integer;
 v_verified integer;
 v_history_count integer;
 v_weight_count integer;
 v_stock_total bigint:=0;
 v_settings jsonb;
 v_exported_at timestamptz;
 v_receipt_counts jsonb;
BEGIN
 IF COALESCE(auth.role(),'')<>'authenticated'
   OR NULLIF(auth.uid(),'') IS NULL THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
 END IF;
 v_actor:=auth.uid();
 IF p_family_id IS NULL OR p_child_id IS NULL OR p_migration_id IS NULL
   OR p_source_sha256 IS NULL
   OR p_source_sha256 !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid_promotion_request' USING ERRCODE='22023';
 END IF;
 IF NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;

 -- Same advisory family lock as 009 purchase and 022 stage. Obtained BEFORE
 -- receipt lookup, so competing devices cannot both believe they won.
 PERFORM pg_advisory_xact_lock(
  hashtextextended('xb.inventory.family:'||p_family_id::text,0));
 PERFORM 1 FROM public.xb_children
  WHERE family_id=p_family_id AND id=p_child_id
   AND legacy_slot='primary' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'active_primary_child_required' USING ERRCODE='42501';
 END IF;

 SELECT * INTO v_prior FROM public.xb_migrations
  WHERE family_id=p_family_id AND child_id=p_child_id
   AND source_format='xiaobao-diapers:v1';
 IF FOUND THEN
  IF v_prior.source_sha256<>p_source_sha256 THEN
   RAISE EXCEPTION 'child_already_migrated_different_source'
     USING ERRCODE='23505';
  END IF;
  -- A lost response can be retried even with a new migration UUID.
  RETURN jsonb_build_object(
   'status','ALREADY_PROMOTED_SAME_SOURCE','duplicate',true,
   'receipt_committed',true,'can_upload',false,
   'outbox_enabled',false,'history_edit_enabled',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.xb_migrations
   WHERE family_id=p_family_id AND source_format='xiaobao-diapers:v1'
    AND source_sha256=p_source_sha256) THEN
  RAISE EXCEPTION 'backup_already_migrated_other_child' USING ERRCODE='23505';
 END IF;
 SELECT * INTO v_stage FROM public.xb_legacy_staging
  WHERE family_id=p_family_id AND child_id=p_child_id FOR UPDATE;
 IF NOT FOUND OR v_stage.source_sha256<>p_source_sha256
    OR v_stage.source_format<>'xiaobao-diapers:v1'
    OR v_stage.stage_status<>'archive_only'
    OR v_stage.source_bytes<>octet_length(v_stage.source_text) THEN
  RAISE EXCEPTION 'verified_archive_stage_required' USING ERRCODE='22023';
 END IF;
 v_digest:=encode(sha256(convert_to(v_stage.source_text,'UTF8')),'hex');
 IF v_digest<>v_stage.source_sha256
   OR (v_stage.source_text::jsonb)->'data'<>v_stage.state_data THEN
  RAISE EXCEPTION 'archived_source_integrity_mismatch' USING ERRCODE='23514';
 END IF;
 v_state:=v_stage.state_data;
 IF jsonb_typeof(v_state->'inventory')<>'object'
    OR jsonb_typeof(v_state->'babyProfile')<>'object'
    OR jsonb_typeof(v_state->'weightRecords')<>'array'
    OR jsonb_typeof(v_state->'transactions')<>'array'
    OR jsonb_typeof(v_state->'quotes')<>'array'
    OR (SELECT count(*) FROM jsonb_object_keys(v_state->'inventory'))<>6
    OR NOT(v_state->'inventory' ?& ARRAY['NB','S','M','L','XL','XXL']) THEN
  RAISE EXCEPTION 'archived_state_invalid' USING ERRCODE='23514';
 END IF;
 -- Reject stale stage counts/rows before touching ANY live business table.
 FOREACH v_type IN ARRAY ARRAY['transaction','quote','weight'] LOOP
  v_arr:=CASE v_type
    WHEN 'transaction' THEN v_state->'transactions'
    WHEN 'quote' THEN v_state->'quotes'
    ELSE v_state->'weightRecords' END;
  v_expected:=jsonb_array_length(v_arr);
  v_count:=(
   SELECT count(*) FROM public.xb_legacy_stage_records
    WHERE family_id=p_family_id AND child_id=p_child_id
      AND record_kind=v_type);
  IF v_count<>v_expected THEN
   RAISE EXCEPTION 'archive_count_mismatch' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
   SELECT 1
    FROM jsonb_array_elements(v_arr) WITH ORDINALITY AS src(value,ordinality)
    LEFT JOIN public.xb_legacy_stage_records st
      ON st.family_id=p_family_id AND st.child_id=p_child_id
        AND st.record_kind=v_type
        AND st.ordinal=src.ordinality::integer
        AND st.legacy_record_id=src.value->>'id'
        AND st.payload=src.value
    WHERE st.legacy_record_id IS NULL
  ) THEN
   RAISE EXCEPTION 'archive_record_mismatch' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF (v_stage.counts->>'transactions')::integer<>jsonb_array_length(v_state->'transactions')
  OR (v_stage.counts->>'quotes')::integer<>jsonb_array_length(v_state->'quotes')
  OR (v_stage.counts->>'weightRecords')::integer<>jsonb_array_length(v_state->'weightRecords')
  OR (v_stage.counts->>'referenceOverrides')::integer<>
     (SELECT count(*) FROM jsonb_object_keys(v_state->'referenceOverrides')) THEN
  RAISE EXCEPTION 'archive_stored_count_mismatch' USING ERRCODE='23514';
 END IF;

 IF EXISTS(SELECT 1 FROM public.xb_inventory
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_inventory_operations
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_transactions
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_baby_profiles
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_weight_records
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_legacy_history_entries
     WHERE family_id=p_family_id AND child_id=p_child_id)
 OR EXISTS(SELECT 1 FROM public.xb_legacy_settings
     WHERE family_id=p_family_id AND child_id=p_child_id) THEN
  RAISE EXCEPTION 'target_not_empty_for_first_migration' USING ERRCODE='23505';
 END IF;

 v_exported_at:=((v_stage.source_text::jsonb)->>'exportedAt')::timestamptz;
 INSERT INTO public.xb_baby_profiles(
  family_id,child_id,profile_data,revision,updated_by
 ) VALUES(
  p_family_id,p_child_id,
  jsonb_build_object(
   'babyProfile',v_state->'babyProfile',
   'dueDate',v_state->'dueDate',
   'birthDate',v_state->'birthDate',
   'babyWeight',v_state->'babyWeight',
   'legacySourceSha256',v_digest),
  1,v_actor
 );

 -- Six absolute baselines, including zero quantities, NOT old buy/use deltas.
 FOREACH v_size IN ARRAY ARRAY['NB','S','M','L','XL','XXL'] LOOP
  IF jsonb_typeof(v_state->'inventory'->v_size)<>'number'
    OR (v_state->'inventory'->>v_size) !~ '^(0|[1-9][0-9]{0,5})$'
    OR (v_state->'inventory'->>v_size)::numeric>100000 THEN
   RAISE EXCEPTION 'invalid_archived_inventory_baseline' USING ERRCODE='23514';
  END IF;
  v_qty:=(v_state->'inventory'->>v_size)::integer;
  v_stock_total:=v_stock_total+v_qty;
  INSERT INTO public.xb_inventory(
   family_id,child_id,size,quantity,revision,updated_by
  ) VALUES(p_family_id,p_child_id,v_size,v_qty,1,v_actor);
  v_operation_id:=gen_random_uuid();
  INSERT INTO public.xb_inventory_operations(
    family_id,operation_id,child_id,size,kind,delta,
    old_quantity,new_quantity,expected_revision,resulting_revision,
    payload_sha256,actor_uid,occurred_at
  ) VALUES(
   p_family_id,v_operation_id,p_child_id,v_size,'migration_baseline',NULL,
   0,v_qty,NULL,1,
   encode(sha256(convert_to(
    jsonb_build_array('xb.legacy.baseline.v1',p_family_id,p_child_id,
      v_digest,v_size,v_qty)::text,'UTF8')),'hex'),
   v_actor,v_exported_at
  );
 END LOOP;

 -- Readable original events are independent history, not stock deltas.
 INSERT INTO public.xb_legacy_history_entries(
  family_id,child_id,record_kind,legacy_record_id,ordinal,payload,source_sha256
 )
 SELECT family_id,child_id,record_kind,legacy_record_id,ordinal,payload,v_digest
 FROM public.xb_legacy_stage_records
 WHERE family_id=p_family_id AND child_id=p_child_id;

 -- Native weight entries permit growth screens while exact original time
 -- (including blank time) remains unmodified in legacy_history_entries.
 INSERT INTO public.xb_weight_records(
   family_id,child_id,legacy_record_id,measured_on,measured_at,
   weight_kg,note,created_by,updated_by
 )
 SELECT p_family_id,p_child_id,legacy_record_id,
        (payload->>'date')::date,
        COALESCE(NULLIF(payload->>'time',''),'00:00')::time,
        (payload->>'weight')::numeric(6,3),
        COALESCE(payload->>'note',''),v_actor,v_actor
 FROM public.xb_legacy_stage_records
 WHERE family_id=p_family_id AND child_id=p_child_id
   AND record_kind='weight';

 v_settings:=v_state - 'inventory' - 'transactions' - 'quotes'
   - 'weightRecords' - 'babyProfile';
 INSERT INTO public.xb_legacy_settings(
   family_id,child_id,settings_data,source_sha256,migrated_by
 ) VALUES(p_family_id,p_child_id,v_settings,v_digest,v_actor);

 -- Explicit cross-table postconditions, before the FINAL receipt insert.
 SELECT count(*) INTO v_verified FROM public.xb_inventory
  WHERE family_id=p_family_id AND child_id=p_child_id AND revision=1;
 IF v_verified<>6 OR
   (SELECT sum(quantity) FROM public.xb_inventory
     WHERE family_id=p_family_id AND child_id=p_child_id)<>v_stock_total OR
   (SELECT count(*) FROM public.xb_inventory_operations
     WHERE family_id=p_family_id AND child_id=p_child_id
      AND kind='migration_baseline' AND delta IS NULL
      AND resulting_revision=1)<>6 OR
   (SELECT count(*) FROM public.xb_transactions
     WHERE family_id=p_family_id AND child_id=p_child_id)<>0 THEN
  RAISE EXCEPTION 'migration_baseline_verification_failed' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO v_history_count FROM public.xb_legacy_history_entries
   WHERE family_id=p_family_id AND child_id=p_child_id;
 SELECT count(*) INTO v_weight_count FROM public.xb_weight_records
   WHERE family_id=p_family_id AND child_id=p_child_id;
 IF v_history_count<>(
     jsonb_array_length(v_state->'transactions')+
     jsonb_array_length(v_state->'quotes')+
     jsonb_array_length(v_state->'weightRecords'))
  OR v_weight_count<>jsonb_array_length(v_state->'weightRecords')
  OR NOT EXISTS(SELECT 1 FROM public.xb_legacy_settings
    WHERE family_id=p_family_id AND child_id=p_child_id
      AND settings_data=v_settings AND source_sha256=v_digest)
  OR NOT EXISTS(SELECT 1 FROM public.xb_baby_profiles
    WHERE family_id=p_family_id AND child_id=p_child_id
      AND profile_data->'babyProfile'=v_state->'babyProfile') THEN
  RAISE EXCEPTION 'migration_records_verification_failed' USING ERRCODE='23514';
 END IF;
 v_receipt_counts:=jsonb_build_object(
   'migration_schema','legacy-history-v1',
   'inventorySizes',6,'stockUnits',v_stock_total,
   'transactions',jsonb_array_length(v_state->'transactions'),
   'quotes',jsonb_array_length(v_state->'quotes'),
   'weightRecords',v_weight_count,'historyEntries',v_history_count,
   'referenceOverrides',
      (SELECT count(*) FROM jsonb_object_keys(v_state->'referenceOverrides')),
   'stageId',v_stage.stage_id,'archiveVerified',true,
   'purchaseHistoryReplayed',false);

 -- FINAL statement that records migration completion. Any failure here
 -- also rolls back all preceding profile, stock, history and settings inserts.
 INSERT INTO public.xb_migrations(
  family_id,migration_id,child_id,source_sha256,source_format,counts,initiated_by
 ) VALUES(p_family_id,p_migration_id,p_child_id,v_digest,
  'xiaobao-diapers:v1',v_receipt_counts,v_actor);

 RETURN jsonb_build_object(
   'status','PROMOTED_HISTORY_AND_BASELINE','duplicate',false,
   'receipt_committed',true,'can_upload',false,'outbox_enabled',false,
   'history_edit_enabled',false,'stock_units',v_stock_total,
   'history_count',v_history_count,'weight_count',v_weight_count);
END;
$promote$;
REVOKE ALL ON FUNCTION public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)
 TO authenticated;
COMMIT;
