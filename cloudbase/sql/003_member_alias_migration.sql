-- XiaoBao v1.2.0 / P1: add friendly family member aliases without recreating members.
-- DRAFT FOR REVIEW: only run after explicit approval on existing xiaobao-family PG environment.
-- No auth users, families, membership roles, invites, purchases or historical records are deleted.
-- Keep 001_shared_foundation.sql as historical initial setup; this is the ONLY delta migration.
BEGIN;

-- Fail closed if shared foundation is missing.
DO $$
BEGIN
  IF to_regclass('public.families') IS NULL
     OR to_regclass('public.family_members') IS NULL
     OR to_regclass('public.family_app_access') IS NULL
     OR to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'xb_alias_migration_missing_foundation';
  END IF;
END;
$$;

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS member_alias text,
  ADD COLUMN IF NOT EXISTS alias_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alias_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS alias_updated_by text;

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conrelid='public.family_members'::regclass
    AND conname='family_member_alias_valid'
  ) THEN
    ALTER TABLE public.family_members
      ADD CONSTRAINT family_member_alias_valid CHECK (
        member_alias IS NULL OR (
          char_length(member_alias) BETWEEN 1 AND 24
          AND member_alias = btrim(member_alias)
          AND member_alias !~ '[[:cntrl:]]'
        )
      );
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conrelid='public.family_members'::regclass
    AND conname='family_member_alias_revision_nonnegative'
  ) THEN
    ALTER TABLE public.family_members
      ADD CONSTRAINT family_member_alias_revision_nonnegative CHECK(alias_revision >= 0);
  END IF;
END;
$$;

-- Private audit events are inserted by an authenticated, authorized RPC only.
-- Browser roles may neither read nor change the audit table.
CREATE TABLE IF NOT EXISTS public.family_member_alias_audit (
  family_id uuid NOT NULL,
  target_uid text NOT NULL,
  alias_revision bigint NOT NULL CHECK(alias_revision > 0),
  old_alias text,
  new_alias text,
  actor_uid text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id,target_uid,alias_revision),
  FOREIGN KEY(family_id,target_uid)
    REFERENCES public.family_members(family_id,user_uid) ON DELETE CASCADE
);
ALTER TABLE public.family_member_alias_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_member_alias_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.xb_set_member_alias(
  p_family_id uuid, p_member_uid text, p_alias text, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_uid text;
  v_actor_role text;
  v_previous_alias text;
  v_previous_revision bigint;
  v_clean_alias text;
  v_new_revision bigint;
BEGIN
  -- IMPORTANT: CloudBase /rpc may not enforce GRANT EXECUTE, so check each caller.
  IF COALESCE(auth.role(),'') <> 'authenticated'
     OR NULLIF(auth.uid(),'') IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;
  v_actor_uid := auth.uid();
  IF p_family_id IS NULL OR NULLIF(p_member_uid,'') IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_alias_request' USING ERRCODE='22023';
  END IF;
  IF NOT xb_private.can_use_app(p_family_id,'xb') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;

  SELECT member_role INTO v_actor_role
    FROM public.family_members
   WHERE family_id=p_family_id AND user_uid=v_actor_uid;
  IF v_actor_role IS NULL OR
     (v_actor_uid <> p_member_uid AND v_actor_role <> 'owner') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  -- XB membership is separate from future JJ app access.
  IF NOT EXISTS (
    SELECT 1 FROM public.family_app_access
     WHERE family_id=p_family_id AND user_uid=p_member_uid AND app_code='xb'
  ) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;

  v_clean_alias := NULLIF(btrim(COALESCE(p_alias,'')), '');
  IF v_clean_alias IS NOT NULL AND
     (char_length(v_clean_alias)>24 OR v_clean_alias ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_alias' USING ERRCODE='22023';
  END IF;

  SELECT member_alias,alias_revision
    INTO v_previous_alias,v_previous_revision
    FROM public.family_members
   WHERE family_id=p_family_id AND user_uid=p_member_uid
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE='42501';
  END IF;

  IF v_previous_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'alias_revision_conflict' USING ERRCODE='40001';
  END IF;
  IF v_previous_alias IS NOT DISTINCT FROM v_clean_alias THEN
    RETURN jsonb_build_object('saved',true,'changed',false,
      'family_id',p_family_id,'member_uid',p_member_uid,
      'member_alias',v_clean_alias,'alias_revision',v_previous_revision);
  END IF;

  v_new_revision := v_previous_revision + 1;
  UPDATE public.family_members
     SET member_alias=v_clean_alias,alias_revision=v_new_revision,
         alias_updated_at=now(),alias_updated_by=v_actor_uid
   WHERE family_id=p_family_id AND user_uid=p_member_uid;
  INSERT INTO public.family_member_alias_audit(
    family_id,target_uid,alias_revision,old_alias,new_alias,actor_uid)
    VALUES(p_family_id,p_member_uid,v_new_revision,
           v_previous_alias,v_clean_alias,v_actor_uid);

  RETURN jsonb_build_object('saved',true,'changed',true,
    'family_id',p_family_id,'member_uid',p_member_uid,
    'member_alias',v_clean_alias,'alias_revision',v_new_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.xb_set_member_alias(uuid,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xb_set_member_alias(uuid,text,text,bigint) TO authenticated;

COMMIT;
