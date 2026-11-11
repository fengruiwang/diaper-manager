-- XiaoBao v1.2.0 P2-1 / STAGE 005: only empty business tables, RLS and indexes.
-- User authorized scoped DDL in existing xiaobao-family and explicitly accepted
-- no user-accessible shared-cluster backup risk on 2026-11-11. Never migrate data.
-- Execute THIS FILE AS ONE TRANSACTION, then run 006 postflight independently.
-- Do not run 008/009/010 until 006 is confirmed all true.
-- SQL behavior unchanged from reviewed/isolated-PG-tested draft.
-- Creates empty child/diaper/weight/migration tables. No family, member, invite, legacy PWA or other app data is modified.
-- Real mutations must later use authorized, atomic, idempotent SECURITY DEFINER RPCs;
-- ordinary browser users receive only RLS-scoped SELECT.
BEGIN;

DO $$
BEGIN
 IF to_regclass('public.families') IS NULL OR
    to_regclass('public.family_members') IS NULL OR
    to_regclass('public.family_app_access') IS NULL OR
    to_regprocedure('xb_private.can_use_app(uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'xb_p2_missing_shared_foundation';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.xb_children (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE RESTRICT,
  legacy_slot text,
  display_name text NOT NULL DEFAULT '小宝',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  deleted_at timestamptz,
  PRIMARY KEY(id),
  UNIQUE(family_id,id),
  CHECK (legacy_slot IS NULL OR (char_length(legacy_slot) BETWEEN 1 AND 40)),
  CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CHECK (char_length(created_by) BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX IF NOT EXISTS xb_children_legacy_slot_unique
 ON public.xb_children(family_id,legacy_slot)
 WHERE legacy_slot IS NOT NULL;

-- Keep a per-baby versioned profile record; unknown legacy fields can be
-- retained in profile_data until a formally reviewed column-level mapping exists.
CREATE TABLE IF NOT EXISTS public.xb_baby_profiles (
  family_id uuid NOT NULL,
  child_id uuid NOT NULL,
  profile_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(profile_data)='object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id,child_id),
  FOREIGN KEY(family_id,child_id)
    REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.xb_weight_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  child_id uuid NOT NULL,
  legacy_record_id text,
  measured_on date NOT NULL,
  measured_at time without time zone NOT NULL,
  weight_kg numeric(6,3) NOT NULL CHECK(weight_kg>=0.300 AND weight_kg<=40.000),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=120),
  created_by text NOT NULL CHECK(char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  deleted_at timestamptz,
  PRIMARY KEY(id),
  UNIQUE(family_id,id),
  FOREIGN KEY(family_id,child_id)
    REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT,
  CHECK (legacy_record_id IS NULL OR char_length(legacy_record_id) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS xb_weight_legacy_unique
  ON public.xb_weight_records(family_id,child_id,legacy_record_id)
  WHERE legacy_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.xb_inventory (
  family_id uuid NOT NULL,
  child_id uuid NOT NULL,
  size text NOT NULL CHECK(size IN ('NB','S','M','L','XL','XXL')),
  quantity integer NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 100000),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by text NOT NULL CHECK(char_length(updated_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id,child_id,size),
  FOREIGN KEY(family_id,child_id)
    REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);

-- Every accepted inventory command has one stable UUID and a payload fingerprint.
-- Server-side transaction RPC must lock the inventory row, check expected_revision
-- for absolute counts, reject forged actor_uid, update quantity and insert this row
-- atomically. DO NOT write rows from the browser directly.
CREATE TABLE IF NOT EXISTS public.xb_inventory_operations (
  family_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  child_id uuid NOT NULL,
  size text NOT NULL CHECK(size IN ('NB','S','M','L','XL','XXL')),
  kind text NOT NULL CHECK(kind IN
   ('buy','use','stocktake','reverse','migration_baseline')),
  delta integer,
  old_quantity integer NOT NULL CHECK(old_quantity BETWEEN 0 AND 100000),
  new_quantity integer NOT NULL CHECK(new_quantity BETWEEN 0 AND 100000),
  expected_revision bigint CHECK(expected_revision IS NULL OR expected_revision>=0),
  resulting_revision bigint NOT NULL CHECK(resulting_revision>=0),
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_uid text NOT NULL CHECK(char_length(actor_uid) BETWEEN 1 AND 128),
  legacy_transaction_id text,
  reverses_operation_id uuid,
  occurred_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id,operation_id),
  FOREIGN KEY(family_id,child_id,size)
    REFERENCES public.xb_inventory(family_id,child_id,size) ON DELETE RESTRICT,
  FOREIGN KEY(family_id,reverses_operation_id)
    REFERENCES public.xb_inventory_operations(family_id,operation_id),
  CHECK (legacy_transaction_id IS NULL OR char_length(legacy_transaction_id) BETWEEN 1 AND 200),
  CHECK (reverses_operation_id IS NULL OR reverses_operation_id<>operation_id),
  CHECK (
    (kind='stocktake' AND expected_revision IS NOT NULL AND delta IS NULL) OR
    (kind='migration_baseline' AND delta IS NULL) OR
    (kind IN ('buy','use','reverse') AND delta IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS xb_inventory_legacy_transaction_unique
  ON public.xb_inventory_operations(family_id,child_id,legacy_transaction_id)
  WHERE legacy_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS xb_inventory_operations_child_cursor
  ON public.xb_inventory_operations(family_id,child_id,committed_at,operation_id);

-- Migration receipts contain only metadata/checksums; no full user backups
-- are ever written automatically. A receipt is committed with the baseline
-- and all migrated entities in one server transaction.
CREATE TABLE IF NOT EXISTS public.xb_migrations (
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE RESTRICT,
  migration_id uuid NOT NULL,
  child_id uuid NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK(source_format='xiaobao-diapers:v1'),
  counts jsonb NOT NULL CHECK(jsonb_typeof(counts)='object'),
  initiated_by text NOT NULL CHECK(char_length(initiated_by) BETWEEN 1 AND 128),
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id,migration_id),
  FOREIGN KEY(family_id,child_id)
    REFERENCES public.xb_children(family_id,id) ON DELETE RESTRICT
);

REVOKE ALL ON public.xb_children,public.xb_baby_profiles,
  public.xb_weight_records,public.xb_inventory,
  public.xb_inventory_operations,public.xb_migrations
  FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.xb_children,public.xb_baby_profiles,
  public.xb_weight_records,public.xb_inventory,
  public.xb_inventory_operations TO authenticated;

ALTER TABLE public.xb_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_baby_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_weight_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xb_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS xb_children_family_read ON public.xb_children;
CREATE POLICY xb_children_family_read ON public.xb_children
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,'xb'));

DROP POLICY IF EXISTS xb_profiles_family_read ON public.xb_baby_profiles;
CREATE POLICY xb_profiles_family_read ON public.xb_baby_profiles
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,'xb'));

DROP POLICY IF EXISTS xb_weight_family_read ON public.xb_weight_records;
CREATE POLICY xb_weight_family_read ON public.xb_weight_records
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,'xb'));

DROP POLICY IF EXISTS xb_inventory_family_read ON public.xb_inventory;
CREATE POLICY xb_inventory_family_read ON public.xb_inventory
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,'xb'));

DROP POLICY IF EXISTS xb_inventory_ops_family_read ON public.xb_inventory_operations;
CREATE POLICY xb_inventory_ops_family_read ON public.xb_inventory_operations
  FOR SELECT TO authenticated
  USING (xb_private.can_use_app(family_id,'xb'));

-- No client SELECT policy or grant on xb_migrations. Idempotency receipts are internal.

COMMIT;
