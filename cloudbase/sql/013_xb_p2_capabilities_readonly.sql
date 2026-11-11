-- XiaoBao v1.2.0 / CloudBase P2 function-capability preflight.
-- SELECT ONLY: no tables, permissions, family data or user information changed.
-- Run before approving or executing 005 / 008 / 009 / 010.
-- Expect one row with every flag true. A false flag means STOP.
SELECT
  current_setting('server_version_num')::integer >= 140000
    AS postgresql_supported_version,
  to_regprocedure('pg_catalog.sha256(bytea)') IS NOT NULL
    AS sha256_function_available,
  to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL
    AS uuid_generation_available,
  to_regprocedure('pg_catalog.hashtextextended(text,bigint)') IS NOT NULL
    AS family_lock_hash_available,
  to_regprocedure('pg_catalog.pg_advisory_xact_lock(bigint)') IS NOT NULL
    AS transaction_advisory_lock_available,
  to_regprocedure('auth.uid()') IS NOT NULL
    AND to_regprocedure('auth.role()') IS NOT NULL
    AS auth_claim_functions_available,
  to_regprocedure('xb_private.can_use_app(uuid,text)') IS NOT NULL
    AS family_permission_function_available;
