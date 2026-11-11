const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const pre=read('cloudbase/sql/011_xb_p2_predeploy_readonly.sql');
const post=read('cloudbase/sql/012_xb_p2_postdeploy_readonly.sql');
const contract=read('tests/postgres/p2_purchase_contract.sql');
const forbidden=/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DO|COPY|CALL|EXECUTE|PERFORM|SET|RESET)\b/i;
function actualSql(sql){
 return sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''").trim();
}
test('P2 preflight and postflight are single SELECT-only inspection queries',()=>{
 for(const sql of [pre,post]){
  const text=actualSql(sql);
  assert.match(text,/^SELECT\s/i);
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
 const schema='\\i cloudbase/sql/005_xb_core_schema_draft.sql';
 const child='INSERT INTO public.xb_children';
 assert.ok(index(before)>0);
 assert.ok(index(before)<index(schema));
 assert.ok(index(schema)<index(after));
 assert.ok(index(after)<index(child));
 assert.ok(!contract.includes('\\i cloudbase/sql/007_xb_inventory_rpc_draft.sql'));
});
