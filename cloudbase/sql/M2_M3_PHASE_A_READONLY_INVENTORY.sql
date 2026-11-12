-- 小宝管家 V1.2.0｜CloudBase 现有对象只读盘点（集中一批）
-- 仅 SELECT / PostgreSQL 系统目录；无 DDL、DML、锁、RPC 调用和数据更改。
-- 必须在 CloudBase 的 SQL 控制台运行，不要在正式 PWA / 浏览器控制台执行。
-- 不返回用户邮箱、家庭 UUID、原始备份、验证码或历史个人记录。
-- 建议执行全部，提交文字/截图时只需这几张结果表。
-- 如果提示某张表不存在，请停止并只反馈错误码和前面已生成的结果。
--
-- A. 平台 PG 版本和当前角色（确认实际 CloudBase vs 隔离 PG16）
SELECT
 current_setting('server_version') AS pg_version,
 current_user AS sql_console_role,
 to_regprocedure('pg_catalog.sha256(bytea)') IS NOT NULL AS sha256_available,
 to_regprocedure('pg_catalog.hashtextextended(text,bigint)') IS NOT NULL AS family_lock_hash_available,
 to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_available,
 to_regprocedure('auth.role()') IS NOT NULL AS auth_role_available,
 to_regprocedure('xb_private.can_use_app(uuid,text)') IS NOT NULL AS family_xb_grant_helper_available,
 to_regprocedure('xb_private.is_family_owner(uuid)') IS NOT NULL AS family_owner_helper_available;

-- B. 本轮需要的表：是否已存在、是否启用 RLS、客户端直接读写权限
WITH expected(name,scope) AS (
 VALUES
 ('families','M1-existing'),('family_members','M1-existing'),
 ('family_app_access','M1-existing'),('xb_children','M1-02-existing'),
 ('xb_transactions','M1-02-existing'),('xb_inventory','M1-02-existing'),
 ('xb_inventory_operations','M1-02-existing'),
 ('xb_baby_profiles','M1-02-existing'),
 ('xb_weight_records','M1-02-existing'),
 ('xb_migrations','M1-02-existing'),
 ('xb_legacy_staging','022-new'),('xb_legacy_stage_records','022-new'),
 ('xb_legacy_history_entries','023-new'),('xb_legacy_settings','023-new'),
 ('xb_primary_documents','026-new'),
 ('xb_primary_document_commands','026-new'),
 ('xb_stocktake_batch_receipts','027-new')
)
SELECT e.scope,e.name AS table_name,c.oid IS NOT NULL AS exists_now,
 COALESCE(c.relrowsecurity,false) AS rls_enabled,
 COALESCE(has_table_privilege('anon',c.oid,'SELECT'),false) AS anon_select,
 COALESCE(has_table_privilege('authenticated',c.oid,'SELECT'),false) AS auth_select,
 COALESCE(has_table_privilege('authenticated',c.oid,'INSERT'),false) AS auth_insert,
 COALESCE(has_table_privilege('authenticated',c.oid,'UPDATE'),false) AS auth_update,
 COALESCE(has_table_privilege('authenticated',c.oid,'DELETE'),false) AS auth_delete
FROM expected e
LEFT JOIN pg_catalog.pg_class c
 ON c.oid=to_regclass('public.'||e.name)
ORDER BY e.scope,e.name;

-- C. RPC 精确签名和 EXECUTE；新增写入函数在阶段 A 安装后必须 auth_execute=false
WITH expected(stage,signature,access_kind) AS (
 VALUES
 ('M1','public.xb_apply_inventory_operation(uuid,uuid,uuid,text,text,integer,bigint,uuid,timestamptz,jsonb)','existing-write'),
 ('M1','public.xb_read_inventory_reconciliation(uuid,uuid,uuid[])','existing-read'),
 ('M1','public.xb_create_smoke_child(uuid)','existing-write'),
 ('M1','public.xb_retire_smoke_child(uuid,uuid)','existing-write'),
 ('025','public.xb_create_primary_child(uuid)','new-write-LOCKED'),
 ('021','public.xb_preview_legacy_migration_receipt(uuid,uuid,text,text)','new-read'),
 ('022','public.xb_stage_legacy_archive_draft(uuid,uuid,uuid,text)','new-write-LOCKED'),
 ('023','public.xb_promote_legacy_archive_draft(uuid,uuid,uuid,text)','new-write-LOCKED'),
 ('024','public.xb_read_legacy_history_page_draft(uuid,uuid,text,integer,integer)','new-read'),
 ('024','public.xb_read_legacy_settings_draft(uuid,uuid)','new-read'),
 ('026','public.xb_primary_document_baseline_draft(uuid,uuid,text)','private-helper'),
 ('026','public.xb_read_primary_document_draft(uuid,uuid,text)','new-read'),
 ('026','public.xb_put_primary_document_draft(uuid,uuid,text,bigint,uuid,jsonb)','new-write-LOCKED'),
 ('026','public.xb_check_primary_document_request_draft(uuid,uuid,uuid)','new-read'),
 ('027','public.xb_primary_stocktake_batch_draft(uuid,uuid,uuid,jsonb)','new-write-LOCKED'),
 ('027','public.xb_read_primary_stocktake_batch_receipt_draft(uuid,uuid,uuid)','new-read')
)
SELECT e.stage,e.access_kind,e.signature,
 p.oid IS NOT NULL AS exists_now,
 COALESCE(p.prosecdef,false) AS security_definer,
 COALESCE(has_function_privilege('anon',p.oid,'EXECUTE'),false) AS anon_execute,
 COALESCE(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) AS auth_execute
FROM expected e
LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.stage,e.signature;

-- D. 必需列及其实际 SQL 类型；核对名称/类型即可，不读取任何业务行
WITH expected(table_name,column_name) AS (
 VALUES
 ('xb_children','id'),('xb_children','family_id'),
 ('xb_children','legacy_slot'),('xb_children','deleted_at'),
 ('xb_children','created_by'),
 ('xb_migrations','family_id'),('xb_migrations','child_id'),
 ('xb_migrations','source_sha256'),('xb_migrations','source_format'),
 ('xb_inventory','size'),('xb_inventory','quantity'),('xb_inventory','revision'),
 ('xb_inventory_operations','kind'),('xb_inventory_operations','resulting_revision'),
 ('xb_inventory_operations','operation_id'),('xb_inventory_operations','payload_sha256'),
 ('xb_transactions','operation_id'),('xb_transactions','total_fen'),
 ('xb_weight_records','legacy_record_id'),('xb_weight_records','measured_on'),
 ('xb_weight_records','measured_at'),('xb_weight_records','weight_kg'),
 ('xb_baby_profiles','profile_data'),
 ('xb_legacy_staging','source_text'),('xb_legacy_staging','source_sha256'),
 ('xb_legacy_stage_records','ordinal'),
 ('xb_legacy_history_entries','payload'),('xb_legacy_settings','settings_data'),
 ('xb_primary_documents','payload'),('xb_primary_documents','revision'),
 ('xb_primary_document_commands','request_id'),
 ('xb_stocktake_batch_receipts','batch_id')
)
SELECT e.table_name,e.column_name,
 a.attname IS NOT NULL AS exists_now,
 CASE WHEN a.attname IS NULL THEN NULL
      ELSE pg_catalog.format_type(a.atttypid,a.atttypmod) END AS sql_type
FROM expected e
LEFT JOIN pg_catalog.pg_attribute a
 ON a.attrelid=to_regclass('public.'||e.table_name)
 AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
ORDER BY e.table_name,e.column_name;

-- E. 防重导入、正式与测试宝宝隔离所需索引，不创建任何索引
WITH expected(name) AS (
 VALUES ('xb_children_legacy_slot_unique'),
 ('xb_weight_legacy_unique'),('xb_inventory_legacy_transaction_unique'),
 ('xb_migration_once_per_child_source_format'),
 ('xb_migration_source_digest_once_per_family'),
 ('xb_legacy_history_child_time'),
 ('xb_primary_documents_pkey'),('xb_primary_document_commands_pkey'),
 ('xb_stocktake_batch_receipts_pkey')
)
SELECT e.name AS index_name, c.oid IS NOT NULL AS exists_now,
 COALESCE(i.indisunique,false) AS is_unique,
 COALESCE(i.indisvalid,false) AS is_valid,
 CASE WHEN c.oid IS NOT NULL THEN pg_catalog.pg_get_indexdef(c.oid) END AS definition
FROM expected e
LEFT JOIN pg_catalog.pg_class c
 ON c.oid=to_regclass('public.'||e.name)
LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
ORDER BY e.name;

-- F. 仅汇总计数、无家庭标识/采购内容；验证 S140/2 的隔离基线
-- 此段只引用先前 M1-02 已实际部署的基础表，不需要 021-027 存在。
SELECT
 (SELECT count(*) FROM public.families) AS family_count,
 (SELECT count(*) FROM public.family_members) AS member_count,
 (SELECT count(*) FROM public.family_app_access WHERE app_code='xb')
  AS xb_grant_count,
 (SELECT count(*) FROM public.xb_children
  WHERE legacy_slot='__xb_smoke_v1__' AND deleted_at IS NULL)
  AS retained_active_smoke_children,
 (SELECT count(*) FROM public.xb_children
  WHERE legacy_slot='primary' AND deleted_at IS NULL)
  AS active_primary_children,
 (SELECT count(*) FROM public.xb_migrations) AS committed_migration_receipts,
 (SELECT count(*) FROM public.xb_inventory i
  JOIN public.xb_children c ON c.family_id=i.family_id AND c.id=i.child_id
  WHERE c.legacy_slot='__xb_smoke_v1__' AND i.size='S'
    AND i.quantity=140 AND i.revision=2)
  AS smoke_s140_revision2_rows,
 (SELECT count(*) FROM public.xb_transactions t
  JOIN public.xb_children c ON c.family_id=t.family_id AND c.id=t.child_id
  WHERE c.legacy_slot='__xb_smoke_v1__') AS smoke_purchase_rows,
 (SELECT count(*) FROM public.xb_inventory_operations o
  JOIN public.xb_children c ON c.family_id=o.family_id AND c.id=o.child_id
  WHERE c.legacy_slot='__xb_smoke_v1__') AS smoke_inventory_audit_rows;
