const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../cloudbase/sql/005_xb_core_schema_draft.sql'),'utf8');
test('P2 initial schema is additive and never seeds real data',()=>{
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
 for(const name of ['xb_children','xb_baby_profiles','xb_weight_records','xb_inventory','xb_inventory_operations','xb_migrations']){
  assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+name+'\\b'));
  assert.match(sql,new RegExp('ALTER TABLE public\\.'+name+' ENABLE ROW LEVEL SECURITY'));
 }
 assert.doesNotMatch(sql,/\bINSERT INTO\b|\bUPDATE public\.families\b|\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b/i);
 assert.doesNotMatch(sql,/xiaobao_diaper_planner_v1/);
});
test('P2 read permission is RLS-scoped to xb while mutation is RPC-only',()=>{
 assert.match(sql,/xb_private\.can_use_app\(family_id,'xb'\)/);
 assert.match(sql,/REVOKE ALL ON public\.xb_children/);
 assert.match(sql,/GRANT SELECT ON public\.xb_children/);
 assert.doesNotMatch(sql,/\bGRANT\s+(INSERT|UPDATE|DELETE)\b/i);
 assert.match(sql,/No client SELECT policy or grant on xb_migrations/);
});
test('stable child identity, legacy mapping, stock idempotency and conflict revision are modeled',()=>{
 assert.match(sql,/xb_children_legacy_slot_unique/);
 assert.match(sql,/FOREIGN KEY\(family_id,child_id\)/);
 assert.match(sql,/PRIMARY KEY\(family_id,operation_id\)/);
 assert.match(sql,/payload_sha256/);
 assert.match(sql,/expected_revision/);
 assert.match(sql,/reverses_operation_id/);
 assert.match(sql,/xb_inventory_legacy_transaction_unique/);
 assert.match(sql,/source_sha256/);
});
test('postflight requires unchanged family and zero uploaded business records',()=>{
 const p=fs.readFileSync(path.join(__dirname,'../cloudbase/sql/006_xb_core_schema_postflight.sql'),'utf8');
 for(const key of ['original_family_preserved','original_members_preserved','xb_grants_preserved','no_children_uploaded','no_inventory_uploaded','no_ops_uploaded','no_migration_performed','all_business_rls_enabled','client_ops_insert_denied'])assert.ok(p.includes(key));
});
