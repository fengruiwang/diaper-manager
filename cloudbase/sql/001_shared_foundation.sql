-- 小宝管家 v1.2.0 / P0 shared foundation
-- ⚠️ DRAFT: 先运行 000_preflight_readonly.sql 并完成人工审阅；未在真实 CloudBase 执行。
-- 本脚本不插入宝宝信息、不触碰 v1.1.2 本地数据。
-- 安全约束：CloudBase PostgREST 对 RPC 的 EXECUTE GRANT 检查不能单独作为安全边界；
-- 每个 SECURITY DEFINER 的外部 RPC 都在函数体内检查 auth.role()/auth.uid()。
BEGIN;

CREATE SCHEMA IF NOT EXISTS xb_private;
REVOKE ALL ON SCHEMA xb_private FROM PUBLIC;
REVOKE ALL ON SCHEMA xb_private FROM anon;
GRANT USAGE ON SCHEMA xb_private TO authenticated;

CREATE TABLE IF NOT EXISTS public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  owner_uid text NOT NULL CHECK (char_length(owner_uid) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.family_members (
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_uid text NOT NULL CHECK (char_length(user_uid) BETWEEN 1 AND 128),
  member_role text NOT NULL CHECK (member_role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_uid)
);

CREATE TABLE IF NOT EXISTS public.family_app_access (
  family_id uuid NOT NULL,
  user_uid text NOT NULL,
  app_code text NOT NULL CHECK (app_code IN ('xb','jj')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL,
  PRIMARY KEY (family_id, user_uid, app_code),
  FOREIGN KEY (family_id,user_uid)
    REFERENCES public.family_members(family_id,user_uid) ON DELETE CASCADE
);
-- v1.2.0: 一个用户在一个应用内只能加入一个家庭。将来如需多家庭再显式迁移。
CREATE UNIQUE INDEX IF NOT EXISTS family_app_one_household_per_user
  ON public.family_app_access(user_uid,app_code);

CREATE TABLE IF NOT EXISTS public.family_invites (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  app_code text NOT NULL CHECK (app_code = 'xb'), -- 本轮只开放小宝管家
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  redeemed_at timestamptz,
  redeemed_by text,
  CHECK (expires_at > created_at),
  CHECK ((redeemed_at IS NULL AND redeemed_by IS NULL) OR
         (redeemed_at IS NOT NULL AND redeemed_by IS NOT NULL))
);

-- 仅在非公开 schema 中实现 RLS 成员辅助判断，防止递归查询。
CREATE OR REPLACE FUNCTION xb_private.is_family_member(p_family_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(auth.role(),'') = 'authenticated'
     AND NULLIF(auth.uid(),'') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.family_members m
       WHERE m.family_id = p_family_id AND m.user_uid = auth.uid()
     );
$$;

CREATE OR REPLACE FUNCTION xb_private.can_use_app(p_family_id uuid, p_app_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(auth.role(),'') = 'authenticated'
     AND NULLIF(auth.uid(),'') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.family_members m
       JOIN public.family_app_access a
         ON a.family_id = m.family_id AND a.user_uid = m.user_uid
       WHERE m.family_id = p_family_id
         AND m.user_uid = auth.uid()
         AND a.app_code = p_app_code
     );
$$;

CREATE OR REPLACE FUNCTION xb_private.is_family_owner(p_family_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(auth.role(),'') = 'authenticated'
    AND NULLIF(auth.uid(),'') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.families f
      JOIN public.family_members m
        ON m.family_id=f.id
      WHERE f.id=p_family_id
        AND f.owner_uid=auth.uid()
        AND m.user_uid=auth.uid()
        AND m.member_role='owner'
    );
$$;

REVOKE ALL ON FUNCTION xb_private.is_family_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION xb_private.can_use_app(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION xb_private.is_family_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xb_private.is_family_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION xb_private.can_use_app(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION xb_private.is_family_owner(uuid) TO authenticated;

-- 默认禁写。浏览器只获得最低限度的 SELECT，并由 RLS 进一步隔离。
REVOKE ALL ON TABLE public.families,public.family_members,
  public.family_app_access,public.family_invites FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.families,public.family_members,
  public.family_app_access TO authenticated;

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_app_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS families_select_member ON public.families;
CREATE POLICY families_select_member ON public.families
  FOR SELECT TO authenticated
  USING (xb_private.is_family_member(id));

DROP POLICY IF EXISTS family_members_select_member ON public.family_members;
CREATE POLICY family_members_select_member ON public.family_members
  FOR SELECT TO authenticated
  USING (xb_private.is_family_member(family_id));

DROP POLICY IF EXISTS family_app_access_select_authorized ON public.family_app_access;
CREATE POLICY family_app_access_select_authorized ON public.family_app_access
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,app_code));
-- family_invites 没有 SELECT / INSERT / UPDATE / DELETE 策略或普通客户端授权。

-- SECURITY DEFINER RPC #1：创建新家庭，同时仅授权当前用户使用 xb。
CREATE OR REPLACE FUNCTION public.xb_create_family(p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_uid text; v_family_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'authenticated'
     OR NULLIF(auth.uid(),'') IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;
  v_uid := auth.uid();
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_family_name' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.family_app_access
             WHERE user_uid=v_uid AND app_code='xb') THEN
    RAISE EXCEPTION 'already_in_xb_family' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.families(display_name,owner_uid)
    VALUES (btrim(p_name),v_uid) RETURNING id INTO v_family_id;
  INSERT INTO public.family_members(family_id,user_uid,member_role)
    VALUES (v_family_id,v_uid,'owner');
  INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by)
    VALUES (v_family_id,v_uid,'xb',v_uid);
  RETURN jsonb_build_object('family_id',v_family_id,'app_code','xb');
END;
$$;

-- SECURITY DEFINER RPC #2：管理员生成一次性高熵 UUID 邀请票据。
CREATE OR REPLACE FUNCTION public.xb_create_invite(p_family_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_token uuid; v_expires timestamptz;
BEGIN
  IF COALESCE(auth.role(),'') <> 'authenticated'
    OR NULLIF(auth.uid(),'') IS NULL
    OR NOT xb_private.is_family_owner(p_family_id)
    OR NOT xb_private.can_use_app(p_family_id,'xb') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.family_invites(family_id,app_code,created_by)
    VALUES(p_family_id,'xb',auth.uid())
    RETURNING token,expires_at INTO v_token,v_expires;
  RETURN jsonb_build_object('invite_token',v_token,'expires_at',v_expires);
END;
$$;

-- SECURITY DEFINER RPC #3：带行锁的邀请核销，仅允许一次。
CREATE OR REPLACE FUNCTION public.xb_accept_invite(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_uid text; v_invite public.family_invites%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'authenticated'
     OR NULLIF(auth.uid(),'') IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';
  END IF;
  v_uid := auth.uid();
  SELECT * INTO v_invite
  FROM public.family_invites
  WHERE token=p_token
  FOR UPDATE;
  IF NOT FOUND OR v_invite.app_code <> 'xb'
    OR v_invite.redeemed_at IS NOT NULL
    OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_invalid_or_expired' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.family_app_access
             WHERE user_uid=v_uid AND app_code='xb') THEN
    RAISE EXCEPTION 'already_in_xb_family' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.family_members(family_id,user_uid,member_role)
    VALUES(v_invite.family_id,v_uid,'member')
    ON CONFLICT (family_id,user_uid) DO NOTHING;
  INSERT INTO public.family_app_access(family_id,user_uid,app_code,granted_by)
    VALUES(v_invite.family_id,v_uid,'xb',v_invite.created_by);
  UPDATE public.family_invites
     SET redeemed_at=now(),redeemed_by=v_uid
   WHERE token=p_token;
  RETURN jsonb_build_object('family_id',v_invite.family_id,'app_code','xb');
END;
$$;

REVOKE ALL ON FUNCTION public.xb_create_family(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.xb_create_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.xb_accept_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xb_create_family(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xb_create_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xb_accept_invite(uuid) TO authenticated;

COMMIT;
