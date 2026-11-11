-- XiaoBao v1.2.0 / P2-1 / Stage 009 - minimal RPC ACL correction.
-- Scope: ONLY the existing, already installed 10-argument purchase RPC.
-- No CREATE OR REPLACE FUNCTION, no tables, no families, no business data.
-- User authorized scoped P2-1 permissions and RPC installation.
-- 016 real diagnostics: effective_authenticated_execute=true and
-- effective_anon_execute=true, with explicit EXECUTE to both roles.
-- IMPORTANT: CloudBase PostgREST may ignore function EXECUTE ACL.
-- Function-body authentication and family access checks remain essential.
-- Run this ONE transaction ONCE, then rerun read-only 015 and 016.
BEGIN;

-- Ensure exact function exists. Fail atomically rather than modifying
-- a similarly named overload or silently accepting missing function.
DO $xb_p2_acl$
BEGIN
  IF to_regprocedure(
    'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'xb_purchase_rpc_missing_stop'
      USING ERRCODE='42883';
  END IF;
END
$xb_p2_acl$;

REVOKE EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
  uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
  uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb
) TO authenticated;

COMMIT;
