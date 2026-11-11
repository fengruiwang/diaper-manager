#!/usr/bin/env bash
# P2-4E-B2: TWO real independent disposable PG16 sessions promote the SAME
# already-staged synthetic backup. 021/022/023 are draft-only, NEVER live.
# Run AFTER p2_legacy_archive_concurrency.sh in the PG16 GitHub workflow.
set -euo pipefail
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
F='e98d0e45-bf18-4c95-889c-6f19731a8ae5'
C='f75f0e45-bf18-4c95-889c-6f19731a8ae5'
run_sql(){
 docker run --rm --network host -e PGPASSWORD=test-only-ephemeral \
  postgres:16 psql -X -h 127.0.0.1 -U postgres -d xb_p2_contract \
  -v ON_ERROR_STOP=1 -Atqc "$1"
}
digest="$(run_sql "SELECT source_sha256 FROM public.xb_legacy_staging
 WHERE family_id='$F' AND child_id='$C'")"
if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
 echo "FAIL P2-4E-B2 staged digest missing from synthetic archive"
 exit 1
fi
request(){
 local migration_id="$1" outfile="$2"
 run_sql "
 BEGIN;
 SET ROLE authenticated;
 SELECT set_config('xb.test.role','authenticated',false);
 SELECT set_config('xb.test.uid','parallel-archive-owner',false);
 SELECT public.xb_promote_legacy_archive_draft(
  '$F','$C','$migration_id','$digest')->>'status';
 SELECT pg_sleep(1);
 COMMIT;
 " >"$outfile" 2>&1
}
set +e
request '875f0e45-bf18-4c95-889c-6f19731a8ae5' "$tmpdir/a.log" &
a=$!
request '975f0e45-bf18-4c95-889c-6f19731a8ae5' "$tmpdir/b.log" &
b=$!
wait "$a"; ra=$?
wait "$b"; rb=$?
set -e
if [[ "$ra" -ne 0 || "$rb" -ne 0 ]]; then
 echo "FAIL P2-4E-B2 one of the competing migration transactions returned error"
 exit 1
fi
new="$(grep -h '^PROMOTED_HISTORY_AND_BASELINE$' "$tmpdir/"*.log|wc -l|tr -d ' ')"
duplicate="$(grep -h '^ALREADY_PROMOTED_SAME_SOURCE$' "$tmpdir/"*.log|wc -l|tr -d ' ')"
if [[ "$new" != "1" || "$duplicate" != "1" ]]; then
 echo "FAIL P2-4E-B2 expected one committed migration and one safe duplicate"
 exit 1
fi
counts="$(run_sql "SELECT
 (SELECT count(*) FROM public.xb_migrations WHERE family_id='$F') || ',' ||
 (SELECT count(*) FROM public.xb_inventory WHERE family_id='$F') || ',' ||
 (SELECT count(*) FROM public.xb_inventory_operations
     WHERE family_id='$F' AND kind='migration_baseline') || ',' ||
 (SELECT count(*) FROM public.xb_legacy_history_entries WHERE family_id='$F') || ',' ||
 (SELECT count(*) FROM public.xb_weight_records WHERE family_id='$F') || ',' ||
 (SELECT count(*) FROM public.xb_transactions WHERE family_id='$F') || ',' ||
 (SELECT sum(quantity) FROM public.xb_inventory WHERE family_id='$F');")"
if [[ "$counts" != "1,6,6,4,1,0,49" ]]; then
 echo "FAIL P2-4E-B2 incorrect final stock/history/receipt counts"
 exit 1
fi
echo 'PASS P2-4E-B2 two real PostgreSQL sessions: 1 promotion, 1 safe duplicate; 6 baselines, 4 archived history, 1 native weight, 0 replayed purchases, 1 final receipt'
