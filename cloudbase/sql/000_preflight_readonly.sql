-- XiaoBao v1.2.0 P0 one-row read-only preflight report.
-- Does not create tables or write data. Send only the boolean result screenshot.
SELECT
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') AS auth_schema_ok,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='auth' AND p.proname='uid'
  ) AS auth_uid_function_ok,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='auth' AND p.proname='role'
  ) AS auth_role_function_ok,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') AS anon_role_ok,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') AS authenticated_role_ok,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') AS service_role_ok,
  gen_random_uuid() IS NOT NULL AS uuid_supported,
  to_regclass('public.families') IS NULL AS families_not_created,
  to_regclass('public.family_members') IS NULL AS members_not_created,
  to_regclass('public.family_app_access') IS NULL AS app_access_not_created,
  to_regclass('public.family_invites') IS NULL AS invites_not_created;
