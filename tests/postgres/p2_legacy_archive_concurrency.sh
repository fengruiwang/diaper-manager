#!/usr/bin/env bash
# P2-4E-B1: TWO real disposable PG16 connections racing to archive the same
# synthetic backup. Requires 022 and the full PG fixture already installed.
# NEVER call with a real CloudBase endpoint or user's exported JSON.
set -euo pipefail
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
F='e98d0e45-bf18-4c95-889c-6f19731a8ae5'
C='f75f0e45-bf18-4c95-889c-6f19731a8ae5'
DB='xb_p2_contract'
run_sql(){
 docker run --rm --network host -e PGPASSWORD=test-only-ephemeral \
   postgres:16 psql -X -h 127.0.0.1 -U postgres -d "$DB" \
   -v ON_ERROR_STOP=1 -Atqc "$1"
}
run_sql "
 INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('$F','CONCURRENT SYNTHETIC ARCHIVE','parallel-archive-owner');
 INSERT INTO public.family_members(family_id,user_uid,member_role)
 VALUES('$F','parallel-archive-owner','owner');
 INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by)
 VALUES('$F','parallel-archive-owner','xb','parallel-archive-owner');
 INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by)
 VALUES('$C','$F','primary','PARALLEL SYNTHETIC BABY','parallel-archive-owner');
"
# Reuse the exact same synthetic JSON in the PG16 contract. No personal data.
payload="$(python3 - <<'PY'
from pathlib import Path
source=Path('tests/postgres/p2_legacy_archive_atomic_contract.sql').read_text()
parts=source.split('$synthetic_source$')
assert len(parts)>=3, 'Synthetic PG fixture not found'
print(parts[1].strip())
PY
)"
run_request(){
 local stage_id="$1" dest="$2"
 run_sql "
 BEGIN;
 SET ROLE authenticated;
 SELECT set_config('xb.test.role','authenticated',false);
 SELECT set_config('xb.test.uid','parallel-archive-owner',false);
 SELECT public.xb_stage_legacy_archive_draft(
  '$F','$C','$stage_id',\$payload\$
$payload
\$payload\$)->>'status';
 SELECT pg_sleep(1);
 COMMIT;
 " >"$dest" 2>&1
}
set +e
run_request 'e45f0e45-bf18-4c95-889c-6f19731a8ae5' "$tmpdir/first.log" &
pid1=$!
run_request 'd45f0e45-bf18-4c95-889c-6f19731a8ae5' "$tmpdir/second.log" &
pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
if [[ "$rc1" -ne 0 || "$rc2" -ne 0 ]]; then
 echo "FAIL P2-4E-B1 concurrent requests: one or both RPCs errored"
 exit 1
fi
if [[ "$(cat "$tmpdir/first.log" "$tmpdir/second.log" |
  grep -c '^ARCHIVED_ONLY_NOT_MIGRATED$' || true)" != '1' ]] ||
  [[ "$(cat "$tmpdir/first.log" "$tmpdir/second.log" |
  grep -c '^ALREADY_STAGED_SAME_SOURCE$' || true)" != '1' ]]; then
 echo "FAIL P2-4E-B1 first stage and duplicate status not exactly one each"
 exit 1
fi
count="$(run_sql "SELECT count(*) FROM public.xb_legacy_staging WHERE family_id='$F';")"
entries="$(run_sql "SELECT count(*) FROM public.xb_legacy_stage_records WHERE family_id='$F';")"
live="$(run_sql "SELECT (SELECT count(*) FROM public.xb_inventory WHERE family_id='$F')+
 (SELECT count(*) FROM public.xb_inventory_operations WHERE family_id='$F')+
 (SELECT count(*) FROM public.xb_transactions WHERE family_id='$F')+
 (SELECT count(*) FROM public.xb_migrations WHERE family_id='$F');")"
if [[ "$count" != '1' || "$entries" != '4' || "$live" != '0' ]]; then
 echo "FAIL P2-4E-B1 incorrect final stage/history/operational row counts"
 exit 1
fi
echo 'PASS P2-4E-B1 concurrent same-backup archiving: 1 new stage, 1 safe duplicate; 4 archived history records, ZERO live business rows or final receipts'
