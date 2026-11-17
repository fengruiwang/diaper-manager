-- P4-04D-01: MANUAL permission enablement, NOT executed by CI.
-- Run ONLY after confirming the isolated /xb-test/pages-rc3/ deployment
-- is intended to write to this CloudBase database and A/B has an active primary.
-- Existing SECURITY DEFINER function bodies still enforce authenticated family
-- membership, active primary child, migration receipt and CAS/idempotency.
-- No table DML privileges, schema/function replacements, or data migrations.
BEGIN;
DO $xb_rpc_check$
BEGIN
 IF to_regprocedure(
  'public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)'
 ) IS NULL THEN RAISE EXCEPTION 'missing_009_inventory_rpc'; END IF;
 IF to_regprocedure(
  'public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)'
 ) IS NULL THEN RAISE EXCEPTION 'missing_026_document_put_rpc'; END IF;
 IF to_regprocedure(
  'public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)'
 ) IS NULL THEN RAISE EXCEPTION 'missing_027_batch_rpc'; END IF;
 IF to_regprocedure(
  'public.xb_check_primary_document_request_draft(uuid,uuid,uuid)'
 ) IS NULL THEN RAISE EXCEPTION 'missing_026_request_receipt_rpc'; END IF;
 IF to_regprocedure(
  'public.xb_read_primary_stocktake_batch_receipt_draft(uuid,uuid,uuid)'
 ) IS NULL THEN RAISE EXCEPTION 'missing_027_batch_receipt_rpc'; END IF;
END
$xb_rpc_check$;
REVOKE EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_apply_inventory_operation(
 uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.xb_put_primary_document_draft(
 uuid,uuid,text,bigint,uuid,jsonb
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_put_primary_document_draft(
 uuid,uuid,text,bigint,uuid,jsonb
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.xb_primary_stocktake_batch_draft(
 uuid,uuid,uuid,jsonb
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.xb_primary_stocktake_batch_draft(
 uuid,uuid,uuid,jsonb
) TO authenticated;
COMMIT;

-- Read-only postflight; verify effective roles with real A/B browser accounts too.
SELECT p.oid::regprocedure::text AS rpc,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
 AND p.proname IN (
  'xb_apply_inventory_operation',
  'xb_put_primary_document_draft',
  'xb_primary_stocktake_batch_draft',
  'xb_check_primary_document_request_draft',
  'xb_read_primary_stocktake_batch_receipt_draft'
 )
ORDER BY 1;
-- Note: CloudBase RPC gateway may not enforce PostgreSQL EXECUTE ACL fully.
-- Server-body auth and family/primary checks are the security boundary.
