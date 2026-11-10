-- XiaoBao v1.2.0: read-only foundation postflight. Execute only AFTER 001_shared_foundation.sql.
-- Returns one row of booleans. All should be true; SQL-console admin context does not test client-side RLS.
SELECT
 to_regclass('public.families') IS NOT NULL AS families_exists,
 to_regclass('public.family_members') IS NOT NULL AS members_exists,
 to_regclass('public.family_app_access') IS NOT NULL AS app_access_exists,
 to_regclass('public.family_invites') IS NOT NULL AS invites_exists,
 COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.families')),false) AS families_rls,
 COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.family_members')),false) AS members_rls,
 COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.family_app_access')),false) AS app_access_rls,
 COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.family_invites')),false) AS invites_rls,
 to_regprocedure('public.xb_create_family(text)') IS NOT NULL AS create_family_rpc,
 to_regprocedure('public.xb_create_invite(uuid)') IS NOT NULL AS create_invite_rpc,
 to_regprocedure('public.xb_accept_invite(uuid)') IS NOT NULL AS accept_invite_rpc,
 NOT has_table_privilege('anon','public.family_invites','SELECT') AS anonymous_cannot_read_invites,
 NOT has_table_privilege('authenticated','public.family_invites','SELECT') AS members_cannot_read_invites,
 (SELECT count(*)=3 FROM pg_policies WHERE schemaname='public'
   AND tablename IN ('families','family_members','family_app_access')) AS three_select_policies,
 NOT EXISTS(
   SELECT 1 FROM public.families
 ) AS families_still_empty;
-- Important: need additional real JWT/SDK tests to prove cross-family denial (P1).
