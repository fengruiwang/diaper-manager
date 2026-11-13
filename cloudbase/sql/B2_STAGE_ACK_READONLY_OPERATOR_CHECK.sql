-- XiaoBao B2 / 022 unknown ACK. READ ONLY, never run during Phase A/B1.
-- Operator: after an approved 022 returns unknown ACK, stop first.
-- Fill FOUR ORIGINAL inputs, verify same PG environment and console role.
-- Does not return source_text, state_data, names, record IDs or SHA.
WITH args AS (
 SELECT '__FAMILY_UUID__'::uuid family_id,
        '__CHILD_UUID__'::uuid child_id,
        '__ORIGINAL_STAGE_UUID__'::uuid stage_id,
        '__ORIGINAL_SOURCE_SHA256__'::text source_sha256
),
saved AS (
 SELECT s.* FROM public.xb_legacy_staging s JOIN args a
   ON s.family_id=a.family_id AND s.child_id=a.child_id
),
expected AS (
 SELECT 'transaction'::text kind,r.ordinality::int ordinal,
  r.value->>'id' record_id,r.value payload
 FROM saved s CROSS JOIN LATERAL jsonb_array_elements(s.state_data->'transactions')
 WITH ORDINALITY AS r(value,ordinality)
 UNION ALL
 SELECT 'quote',r.ordinality::int,r.value->>'id',r.value
 FROM saved s CROSS JOIN LATERAL jsonb_array_elements(s.state_data->'quotes')
 WITH ORDINALITY AS r(value,ordinality)
 UNION ALL
 SELECT 'weight',r.ordinality::int,r.value->>'id',r.value
 FROM saved s CROSS JOIN LATERAL jsonb_array_elements(s.state_data->'weightRecords')
 WITH ORDINALITY AS r(value,ordinality)
),
actual AS (
 SELECT r.record_kind kind,r.ordinal,r.legacy_record_id record_id,r.payload
 FROM public.xb_legacy_stage_records r JOIN args a
  ON r.family_id=a.family_id AND r.child_id=a.child_id
),
record_check AS (
 SELECT (SELECT count(*) FROM expected) expected_count,
        (SELECT count(*) FROM actual) actual_count,
        NOT EXISTS (
         SELECT 1 FROM expected e FULL OUTER JOIN actual t
          ON e.kind=t.kind AND e.ordinal=t.ordinal
         WHERE e.ordinal IS NULL OR t.ordinal IS NULL
           OR e.record_id IS DISTINCT FROM t.record_id
           OR e.payload IS DISTINCT FROM t.payload
        ) exact_record_match
),
checks AS (
 SELECT
  current_user='cloudbase_postgres_postgres_j17zp5ey' role_match,
  EXISTS(SELECT 1 FROM public.xb_children c WHERE c.family_id=a.family_id
   AND c.id=a.child_id AND c.legacy_slot='primary' AND c.deleted_at IS NULL)
   primary_ok,
  EXISTS(SELECT 1 FROM public.xb_migrations m WHERE m.family_id=a.family_id
   AND (m.child_id=a.child_id OR
        (m.source_format='xiaobao-diapers:v1'
         AND m.source_sha256=a.source_sha256))) receipt_exists,
  EXISTS(SELECT 1 FROM public.xb_legacy_staging x
   WHERE x.family_id=a.family_id AND x.child_id<>a.child_id
    AND (x.stage_id=a.stage_id OR x.source_sha256=a.source_sha256))
   other_child_conflict,
  s.family_id IS NOT NULL stage_exists,
  COALESCE(s.stage_id=a.stage_id,false) stage_id_match,
  COALESCE(s.source_sha256=a.source_sha256,false)
   AND COALESCE(s.source_sha256=encode(
      sha256(convert_to(s.source_text,'UTF8')),'hex'),false) sha_match,
  COALESCE(s.source_format='xiaobao-diapers:v1'
   AND s.stage_status='archive_only',false) archived_only,
  COALESCE(s.source_bytes=octet_length(s.source_text)
   AND s.source_bytes BETWEEN 2 AND 10485760,false) bytes_match,
  COALESCE(s.state_data=(s.source_text::jsonb)->'data',false)
   source_state_match,
  COALESCE((s.counts->>'transactions')::integer=
     jsonb_array_length(s.state_data->'transactions')
   AND (s.counts->>'quotes')::integer=
     jsonb_array_length(s.state_data->'quotes')
   AND (s.counts->>'weightRecords')::integer=
     jsonb_array_length(s.state_data->'weightRecords')
   AND (s.counts->>'referenceOverrides')::integer=
     (SELECT count(*) FROM jsonb_object_keys(s.state_data->'referenceOverrides'))
   AND (s.counts->>'inventorySizes')::integer=6,false) counts_match,
  r.expected_count,r.actual_count,r.exact_record_match,
  NOT EXISTS(SELECT 1 FROM public.xb_inventory x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_inventory_operations x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_transactions x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_baby_profiles x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_weight_records x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_legacy_history_entries x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   AND NOT EXISTS(SELECT 1 FROM public.xb_legacy_settings x WHERE x.family_id=a.family_id AND x.child_id=a.child_id)
   target_empty
 FROM args a CROSS JOIN record_check r LEFT JOIN saved s ON true
)
SELECT CASE
 WHEN NOT role_match THEN 'QUERY_CONTEXT_UNVERIFIED_STOP'
 WHEN NOT primary_ok THEN 'PRIMARY_SCOPE_UNVERIFIED_STOP'
 WHEN receipt_exists THEN 'RECEIPT_PRESENT_STOP_READBACK_ONLY'
 WHEN other_child_conflict THEN 'STAGE_SCOPE_CONFLICT_STOP'
 WHEN NOT stage_exists THEN 'STAGE_NOT_FOUND_STOP'
 WHEN NOT (stage_id_match AND sha_match AND archived_only AND
   bytes_match AND source_state_match AND counts_match AND
   exact_record_match AND expected_count=actual_count)
  THEN 'STAGE_SOURCE_OR_RECORD_MISMATCH_STOP'
 WHEN NOT target_empty THEN 'TARGET_NOT_EMPTY_STOP'
 ELSE 'STAGED_SAME_SOURCE_VERIFIED'
 END operator_status,
 role_match,primary_ok,receipt_exists,stage_id_match,sha_match,
 archived_only,bytes_match,source_state_match,counts_match,
 exact_record_match,expected_count,actual_count,target_empty
FROM checks;
-- SQL timeout/error/no result, wrong instance, unknown role, or any non-PASS:
-- STOP. This query does not grant 022/023 EXECUTE or authorization.
