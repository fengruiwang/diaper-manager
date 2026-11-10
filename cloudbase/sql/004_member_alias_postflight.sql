-- XiaoBao P1 alias migration postflight: read-only, one row, no member IDs exposed.
-- Execute only AFTER 003_member_alias_migration.sql was applied.
SELECT
  (SELECT count(*)=2 FROM public.family_members) AS two_members_preserved,
  (SELECT count(*)=1 FROM public.families) AS original_family_preserved,
  (SELECT count(*)=2 FROM public.family_app_access WHERE app_code='xb') AS xb_grants_preserved,
  (SELECT count(*)=0 FROM public.family_members WHERE member_alias IS NOT NULL) AS existing_aliases_unset,
  (SELECT count(*)=0 FROM public.family_members WHERE alias_revision<>0) AS initial_revisions_zero,
  (SELECT count(*)=0 FROM public.family_member_alias_audit) AS audit_empty_before_use,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.family_members'::regclass) AS member_rls_still_enabled,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.family_member_alias_audit'::regclass) AS alias_audit_rls_enabled,
  NOT has_table_privilege('anon','public.family_members','UPDATE') AS anon_cannot_direct_update,
  NOT has_table_privilege('authenticated','public.family_members','UPDATE') AS users_cannot_direct_update,
  NOT has_table_privilege('authenticated','public.family_member_alias_audit','SELECT') AS audit_not_readable_by_client,
  to_regprocedure('public.xb_set_member_alias(uuid,text,text,bigint)') IS NOT NULL AS alias_rpc_available;
-- The first three assertions are specific to the current verified 1-family / 2-member test environment.
-- A failure in any other environment is a stop condition, not permission to delete users.
