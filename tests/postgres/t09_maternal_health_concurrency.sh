#!/usr/bin/env bash
# Run after p2_purchase_contract.sql against the disposable PG16 fixture.
set -euo pipefail
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
family='f1300000-0000-4000-8000-000000000003'
body='{"schemaVersion":1,"items":[]}'

run_sql() {
 docker run --rm -i --network host -e PGPASSWORD=test-only-ephemeral \
  postgres:16 psql -X -h 127.0.0.1 -U postgres -d xb_p2_contract \
  -v ON_ERROR_STOP=1 -Atq
}

verify_contention() {
 local revision="$1" first_request="$2" second_request="$3"
 run_sql >"$tmpdir/first.log" 2>&1 <<SQL &
SET application_name = 't09-health-first';
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',true);
SELECT set_config('xb.test.uid','t09-cas-a',true);
SELECT public.xb_put_maternal_health('$family',$revision,'$first_request','$body')->>'revision';
RESET ROLE;
-- Hold the transaction until the second session actually waits for the row.
DO \$\$
DECLARE deadline timestamptz := clock_timestamp() + interval '20 seconds';
BEGIN
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity
   WHERE application_name = 't09-health-second' AND wait_event_type = 'Lock');
  IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'second writer did not contend'; END IF;
  PERFORM pg_sleep(0.05);
 END LOOP;
END \$\$;
COMMIT;
SQL
 local first_pid=$!
 local first_status=0 second_status=0
 run_sql >"$tmpdir/second.log" 2>&1 <<SQL || second_status=$?
SET application_name = 't09-health-second';
DO \$\$
DECLARE deadline timestamptz := clock_timestamp() + interval '20 seconds';
BEGIN
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity
   WHERE application_name = 't09-health-first' AND wait_event = 'PgSleep');
  IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'first writer did not hold transaction'; END IF;
  PERFORM pg_sleep(0.05);
 END LOOP;
END \$\$;
\set VERBOSITY verbose
SET ROLE authenticated;
SELECT set_config('xb.test.role','authenticated',false);
SELECT set_config('xb.test.uid','t09-cas-b',false);
SELECT public.xb_put_maternal_health('$family',$revision,'$second_request','$body');
SQL
 wait "$first_pid" || first_status=$?
 if [[ "$first_status" -ne 0 || "$second_status" -eq 0 ]] \
   || ! grep -Eq '40001: maternal_health_revision_conflict' "$tmpdir/second.log"; then
  cat "$tmpdir/first.log" "$tmpdir/second.log"
  echo "FAIL T09-DB-01 concurrent writes at revision $revision"
  exit 1
 fi

 run_sql <<SQL
SELECT public.xb_test_assert(
 (SELECT revision = $revision + 1 FROM public.xb_maternal_health_documents WHERE family_id = '$family')
 AND (SELECT count(*) = $revision + 1 FROM public.xb_maternal_health_requests WHERE family_id = '$family')
 AND EXISTS (SELECT 1 FROM public.xb_maternal_health_requests
  WHERE family_id = '$family' AND request_id = '$first_request' AND resulting_revision = $revision + 1)
 AND NOT EXISTS (SELECT 1 FROM public.xb_maternal_health_requests
  WHERE family_id = '$family' AND request_id = '$second_request'),
 'one successful revision increment and exactly one receipt for the winning request');
SQL
 echo "PASS T09-DB-01 two PostgreSQL sessions at revision $revision: one save, one CAS conflict"
}

verify_contention 0 'a1300000-0000-4000-8000-000000000011' 'a1300000-0000-4000-8000-000000000012'
verify_contention 1 'a1300000-0000-4000-8000-000000000013' 'a1300000-0000-4000-8000-000000000014'
