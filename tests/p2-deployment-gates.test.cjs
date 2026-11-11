const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pre=read('cloudbase/sql/011_xb_p2_predeploy_readonly.sql');
const post=read('cloudbase/sql/012_xb_p2_postdeploy_readonly.sql');
const capabilities=read('cloudbase/sql/013_xb_p2_capabilities_readonly.sql');
const purchasePost=read('cloudbase/sql/014_xb_p2_purchase_postflight_readonly.sql');
const atomicPost=read('cloudbase/sql/015_xb_p2_atomic_purchase_postflight_readonly.sql');
const aclDiag=read('cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql');
const contract=read('tests/postgres/p2_purchase_contract.sql');
const forbidden=/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|COPY|CALL|EXECUTE|PERFORM|SET|RESET)\b/i;
function actualSql(sql){
 return sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''").trim();
}
test('P2 preflight and postflight are single SELECT-only inspection queries',()=>{
 for(const sql of [pre,post,capabilities,purchasePost,atomicPost,aclDiag]){
  const text=actualSql(sql);
  assert.match(text,/^(?:SELECT\s|WITH\s)/i);
  assert.equal((text.match(/;/g)||[]).length,1);
  assert.ok(text.endsWith(';'));
  assert.doesNotMatch(text,forbidden);
  assert.doesNotMatch(text,/\buser_uid\b\s*(?:AS|,|FROM)|\baccess_token\b|\binvite_token\b/i);
 }
});
test('P2 first-deploy preflight checks current members and unexpected prior deployments',()=>{
 for(const marker of [
  'existing_one_family_preserved','existing_two_members_preserved',
  'existing_two_xb_grants_preserved','existing_alias_rpc_present',
  'first_deploy_business_tables_absent','first_deploy_purchase_table_absent',
  'legacy_stock_only_rpc_absent','full_purchase_rpc_not_yet_deployed'
 ])assert.ok(pre.includes(marker),marker);
});
test('P2 capability check covers SHA-256 and transaction advisory lock without writing',()=>{
 for(const marker of [
  'postgresql_supported_version','sha256_function_available',
  'uuid_generation_available','family_lock_hash_available',
  'transaction_advisory_lock_available','auth_claim_functions_available',
  'family_permission_function_available'
 ])assert.ok(capabilities.includes(marker),marker);
});
test('P2 stage 008 purchase-table checkpoint audits 15 security and history flags',()=>{
 const markers=[
  'purchase_table_exists','purchase_history_empty',
  'purchase_rls_enabled','authenticated_can_select_purchases',
  'anonymous_cannot_select_purchases','authenticated_cannot_insert_purchases',
  'authenticated_cannot_update_purchases','authenticated_cannot_delete_purchases',
  'purchase_family_read_policy_exists','purchase_operation_scope_fk_exists',
  'operation_scope_unique_constraint_exists','purchase_history_index_exists',
  'original_family_preserved','original_members_preserved','original_xb_grants_preserved'
 ];
 assert.equal(markers.length,15);
 for(const m of markers)assert.ok(purchasePost.includes('AS '+m),m);
});
test('P2 stage 009 postflight validates 21 security and empty-data facts',()=>{
 const markers=[
  'atomic_purchase_rpc_exists','legacy_stock_only_rpc_absent',
  'purchase_rpc_is_security_definer','purchase_rpc_is_volatile',
  'purchase_rpc_returns_jsonb','purchase_rpc_search_path_fixed',
  'untrusted_roles_cannot_create_public',
  'authenticated_can_execute_purchase_rpc','anonymous_cannot_execute_purchase_rpc',
  'one_reverse_per_source_index_exists','reverse_operation_consistency_check_exists',
  'read_reconciliation_rpc_not_installed_yet',
  'purchase_history_still_empty','inventory_ops_still_empty',
  'inventory_still_empty','babies_still_empty',
  'direct_business_writes_still_denied',
  'rpc_contains_purchase_and_retry_validation',
  'original_family_preserved','original_members_preserved','original_xb_grants_preserved'
 ];
 assert.equal(markers.length,21);
 for(const marker of markers)assert.ok(atomicPost.includes('AS '+marker),marker);
});
test('P2 016 diagnostic separates explicit ACL grant, effective privilege and CloudBase schema usage',()=>{
 for(const marker of [
  'purchase_function_found','authenticated_role_exists',
  'authenticated_public_schema_usage','effective_authenticated_execute',
  'effective_anon_execute','explicit_authenticated_execute_grant',
  'public_execute_grant_present','explicit_anon_execute_grant',
  'purchase_function_has_default_acl','comparison_alias_authenticated_execute',
  'purchase_function_owned_by_cloudbase_postgres'
 ])assert.ok(aclDiag.includes('AS '+marker),marker);
 assert.match(aclDiag,/pg_catalog\.aclexplode/);
 assert.doesNotMatch(aclDiag,/\bSELECT\s+\*\s+FROM\s+public\.families\b/i);
});
test('P2 postflight refuses to confuse schema presence with permissions or empty data',()=>{
 for(const marker of [
  'all_seven_business_tables_exist','all_seven_tables_rls_enabled',
  'first_deploy_created_no_business_data',
  'authenticated_browser_cannot_write_business_rows',
  'expected_read_and_migration_privileges',
  'legacy_stock_only_rpc_removed',
  'audited_purchase_rpc_installed_as_definer',
  'inventory_read_rpc_installed_as_definer',
  'member_alias_rpc_preserved'
 ])assert.ok(post.includes(marker),marker);
});
test('P2 isolated PG contract runs both inspections before creating synthetic child',()=>{
 const index=x=>contract.indexOf(x);
 const before='\\i cloudbase/sql/011_xb_p2_predeploy_readonly.sql';
 const after='\\i cloudbase/sql/012_xb_p2_postdeploy_readonly.sql';
 const capability='\\i cloudbase/sql/013_xb_p2_capabilities_readonly.sql';
 const schema='\\i cloudbase/sql/005_xb_core_schema_draft.sql';
 const stage006='\\i cloudbase/sql/006_xb_core_schema_postflight.sql';
 const stage008='\\i cloudbase/sql/008_xb_transactions_schema_draft.sql';
 const stage014='\\i cloudbase/sql/014_xb_p2_purchase_postflight_readonly.sql';
 const stage009='\\i cloudbase/sql/009_xb_purchase_atomic_rpc_draft.sql';
 const stage015='\\i cloudbase/sql/015_xb_p2_atomic_purchase_postflight_readonly.sql';
 const stage016='\\i cloudbase/sql/016_xb_p2_rpc_acl_diagnostic_readonly.sql';
 const stage010='\\i cloudbase/sql/010_xb_inventory_reconcile_rpc_draft.sql';
 const child='INSERT INTO public.xb_children';
 assert.ok(index(before)>0);
 assert.ok(index(before)<index(schema));
 assert.ok(index(before)<index(capability) && index(capability)<index(schema));
 assert.ok(index(schema)<index(stage006));
 assert.ok(index(stage006)<index(stage008));
 assert.ok(index(stage008)<index(stage014));
 assert.ok(index(stage014)<index(stage009));
 assert.ok(index(stage009)<index(stage015));
 assert.ok(index(stage015)<index(stage016));
 assert.ok(index(stage015)<index(stage010));
 assert.ok(index(schema)<index(after));
 assert.ok(index(after)<index(child));
 assert.ok(!contract.includes('\\i cloudbase/sql/007_xb_inventory_rpc_draft.sql'));
});
