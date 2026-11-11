#!/usr/bin/env bash
# P2-4E only: two independent disposable PostgreSQL sessions simulate two
# client requests colliding on ONE FIRST migration. No CloudBase, no real data.
set -euo pipefail
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
F="e28d0e45-bf18-4c95-889c-6f19731a8ae5"
C="f35f0e45-bf18-4c95-889c-6f19731a8ae5"
run_sql() {
  docker run --rm --network host \
    -e PGPASSWORD=test-only-ephemeral \
    postgres:16 psql -X -h 127.0.0.1 -U postgres -d xb_p2_contract \
    -v ON_ERROR_STOP=1 -Atqc "$1"
}
run_sql "
 INSERT INTO public.families(id,display_name,owner_uid)
 VALUES('$F','PARALLEL SYNTHETIC FAMILY','parallel-only-owner');
 INSERT INTO public.xb_children(id,family_id,legacy_slot,display_name,created_by)
 VALUES('$C','$F','primary','PARALLEL ONLY CHILD','parallel-only-owner');
"
# Even if one request reaches the DB earlier, the family advisory lock and
# unique receipt index must permit exactly one transaction to commit.
# Distinct request UUIDs and even different backup hashes cannot create a
# second initial-v1 import for this same child.
start_request() {
  local migration_id="$1" hash_letter="$2" output="$3"
  run_sql "
   BEGIN;
   SELECT pg_advisory_xact_lock(
     hashtextextended('xb.inventory.family:$F',0));
   INSERT INTO public.xb_migrations(
    family_id,migration_id,child_id,source_sha256,source_format,
    counts,initiated_by)
   VALUES('$F','$migration_id','$C',repeat('$hash_letter',64),
    'xiaobao-diapers:v1','{\"synthetic\":true}'::jsonb,'parallel-only-owner');
   SELECT pg_sleep(1);
   COMMIT;
  " >"$output" 2>&1
}
set +e
start_request "f45f0e45-bf18-4c95-889c-6f19731a8ae5" "a" "$tmpdir/first.log" &
pid1=$!
start_request "a45f0e45-bf18-4c95-889c-6f19731a8ae5" "b" "$tmpdir/second.log" &
pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
if ! { [[ "$rc1" -eq 0 && "$rc2" -ne 0 ]] || [[ "$rc1" -ne 0 && "$rc2" -eq 0 ]]; }; then
  echo "FAIL P2-4E dual-session migration receipt race: both succeeded or both failed"
  exit 1
fi
if [[ "$rc1" -eq 0 ]]; then
  grep -q 'duplicate key value violates unique constraint' "$tmpdir/second.log" || {
    echo "FAIL P2-4E loser was not rejected by UNIQUE";exit 1;}
else
  grep -q 'duplicate key value violates unique constraint' "$tmpdir/first.log" || {
    echo "FAIL P2-4E loser was not rejected by UNIQUE";exit 1;}
fi
rows="$(run_sql "SELECT count(*) FROM public.xb_migrations WHERE family_id='$F';")"
if [[ "$rows" != "1" ]]; then
 echo "FAIL P2-4E expected exactly one final receipt, got $rows"
 exit 1
fi
echo "PASS P2-4E two independent PostgreSQL transactions: exactly one receipt committed, other UNIQUE-rejected"
