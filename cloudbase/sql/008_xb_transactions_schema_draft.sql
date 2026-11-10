-- XiaoBao v1.2.0 P2: purchase history schema (DRAFT, DO NOT DEPLOY).
-- Requires 005_xb_core_schema_draft.sql. NO REAL TRANSACTIONS OR USER RECORDS INSERTED.
-- To be deployed only alongside 009_purchase_atomic_rpc_draft.sql after security review.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.xb_inventory_operations') IS NULL
    OR to_regclass('public.xb_inventory') IS NULL THEN
  RAISE EXCEPTION 'xb_purchase_missing_inventory_foundation';
 END IF;
END $$;

-- Enables a child/size-consistent composite reference to the inventory event.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint
  WHERE conrelid='public.xb_inventory_operations'::regclass
   AND conname='xb_inventory_operation_scope_unique') THEN
  ALTER TABLE public.xb_inventory_operations
   ADD CONSTRAINT xb_inventory_operation_scope_unique
   UNIQUE(family_id,operation_id,child_id,size);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.xb_transactions(
 family_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 child_id uuid NOT NULL,
 size text NOT NULL CHECK(size IN ('NB','S','M','L','XL','XXL')),
 brand text NOT NULL CHECK(
   char_length(btrim(brand)) BETWEEN 1 AND 120
   AND brand=btrim(brand) AND brand !~ '[[:cntrl:]]'),
 series text NOT NULL CHECK(
   char_length(btrim(series)) BETWEEN 1 AND 120
   AND series=btrim(series) AND series !~ '[[:cntrl:]]'),
 pieces integer NOT NULL CHECK(pieces BETWEEN 1 AND 100000),
 total_fen bigint NOT NULL CHECK(total_fen BETWEEN 1 AND 10000000),
 currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 purchase_date date NOT NULL,
 created_by text NOT NULL CHECK(char_length(created_by) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT now(),
 reversed_by_operation_id uuid,
 PRIMARY KEY(family_id,operation_id),
 FOREIGN KEY(family_id,operation_id,child_id,size)
  REFERENCES public.xb_inventory_operations(family_id,operation_id,child_id,size)
  ON DELETE RESTRICT,
 FOREIGN KEY(family_id,reversed_by_operation_id)
  REFERENCES public.xb_inventory_operations(family_id,operation_id)
  ON DELETE RESTRICT,
 CHECK(reversed_by_operation_id IS NULL OR reversed_by_operation_id<>operation_id)
);
CREATE INDEX IF NOT EXISTS xb_transactions_history
 ON public.xb_transactions(family_id,child_id,purchase_date DESC,operation_id);

-- No browser direct writes. Financial history is available only to its xb family.
REVOKE ALL ON public.xb_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.xb_transactions TO authenticated;
ALTER TABLE public.xb_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xb_transactions_family_read ON public.xb_transactions;
CREATE POLICY xb_transactions_family_read ON public.xb_transactions
 FOR SELECT TO authenticated
 USING (xb_private.can_use_app(family_id,'xb'));

COMMIT;
