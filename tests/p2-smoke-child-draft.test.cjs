const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const draft=read('cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql');
const check=read('cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql');
const harness=read('tests/postgres/p2_purchase_contract.sql');
const smoke=read('tests/postgres/p2_smoke_child_contract.sql');
const core=read('cloudbase/sql/005_xb_core_schema_draft.sql');

test('P2-3B scripts have unambiguous live deployment stop markers and are only wired into isolated PG',()=>{
 assert.match(draft,/NOT AUTHORIZED FOR LIVE DEPLOYMENT/);
 assert.match(draft,/DO NOT EXECUTE IN REAL CLOUDBase/);
 assert.match(check,/DO NOT RUN IN REAL CLOUDBase/);
 assert.match(draft,/^BEGIN;[\s\S]*COMMIT;\s*$/m);
 assert.match(check,/^SELECT\s/mi);
 const i=frag=>harness.indexOf(frag);
 assert.ok(i('\\i cloudbase/sql/012_xb_p2_postdeploy_readonly.sql')>=0);
 assert.ok(i('\\i cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql')>
           i('\\i cloudbase/sql/012_xb_p2_postdeploy_readonly.sql'));
 assert.ok(i('\\i cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql')>
           i('\\i cloudbase/sql/019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql'));
 assert.ok(i('\\i cloudbase/sql/020_xb_smoke_child_postflight_draft_DO_NOT_DEPLOY.sql')<
           i('INSERT INTO public.xb_children'));
 assert.match(harness,/\\i tests\/postgres\/p2_smoke_child_contract\.sql/);
});

test('P2-3B draft uses fixed, separate reserved smoke legacy slot and no live primary mutation',()=>{
 assert.match(core,/xb_children_legacy_slot_unique/);
 assert.match(draft,/legacy_slot='__xb_smoke_v1__'/);
 assert.match(draft,/VALUES \(p_family_id,'__xb_smoke_v1__','测试宝宝（仅云端联调）',v_uid\)/);
 assert.doesNotMatch(draft,/legacy_slot='primary'/);
 assert.match(draft,/smoke_child_permanently_retired/);
 assert.match(draft,/deleted_at=now\(\),updated_at=now\(\),/);
 assert.doesNotMatch(draft,/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i);
 assert.doesNotMatch(draft,/CREATE TABLE|ALTER TABLE|GRANT INSERT ON|GRANT UPDATE ON/i);
});

test('P2-3B function body checks authenticated identity, owner, xb authorization, singleton and locks',()=>{
 for(const marker of [
  "auth.role()","auth.uid()","xb_private.is_family_owner",
  "xb_private.can_use_app","pg_catalog.pg_advisory_xact_lock",
  "FOR UPDATE","RAISE EXCEPTION 'permission_denied'",
  "RETURN jsonb_build_object('child_id'","revision=revision+1"
 ])assert.ok(draft.includes(marker),marker);
 for(const marker of [
  "CREATE FUNCTION public.xb_create_smoke_child(p_family_id uuid)",
  "CREATE FUNCTION public.xb_retire_smoke_child(",
  "FROM PUBLIC,anon","TO authenticated;"
 ])assert.ok(draft.includes(marker),marker);
 assert.match(draft,/LANGUAGE plpgsql VOLATILE SECURITY DEFINER/g);
});

test('P2-3B create and retire serialize with production 009 inventory family transaction lock',()=>{
 const prod=read('cloudbase/sql/009_xb_purchase_atomic_rpc_draft.sql');
 const lockKey='xb.inventory.family:';
 assert.ok(prod.includes(lockKey),'existing 009 lock key is authoritative');
 assert.equal(draft.split(lockKey).length-1,2,'both new smoke RPCs use the SAME family key');
 assert.ok(!draft.includes('xb:smoke-v1:'),'must never use a different advisory lock domain');
 assert.doesNotMatch(draft,/CREATE OR REPLACE FUNCTION/i);
 assert.match(draft,/CREATE FUNCTION public\.xb_create_smoke_child/);
 assert.match(draft,/CREATE FUNCTION public\.xb_retire_smoke_child/);
});
test('P2-3B postflight validates eighteen schema, ACL, no-write and family-preservation facts',()=>{
 const flags=[
  'smoke_create_rpc_exists','smoke_retire_rpc_exists',
  'create_rpc_is_volatile_definer','retire_rpc_is_volatile_definer',
  'create_rpc_returns_jsonb','retire_rpc_returns_jsonb',
  'both_smoke_rpcs_have_fixed_search_path',
  'authenticated_can_execute_smoke_rpcs',
  'anonymous_cannot_execute_smoke_rpcs',
  'no_smoke_rpc_public_or_anon_grants',
  'create_owner_and_app_check_present','retire_owner_and_app_check_present',
  'test_slot_unique_index_preserved','no_smoke_baby_created_by_migration',
  'client_still_cannot_write_children',
  'original_family_preserved','original_members_preserved','original_xb_grants_preserved'
 ];
 assert.equal(flags.length,18);
 for(const flag of flags)assert.ok(check.includes('AS '+flag),flag);
 assert.doesNotMatch(check,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\s+(?:INTO|ON|FROM|TABLE|FUNCTION)\b/i);
});

test('P2-3B synthetic lifecycle covers revoked owner grant, member/stranger/anon denials and irreversible retire',()=>{
 for(const marker of [
  '$test_member_create_denied$','$test_stranger_create_denied$',
  '$test_owner_without_grant$','$test_primary_retire_denied$',
  '$test_member_retire_denied$','$test_owner_retire$',
  '$test_no_revival$','$test_retired_purchase_denied$',
  '$test_anon_create_denied$',
  'duplicate retire idempotent',
  'smoke child never creates a private migration receipt',
  'primary child remains untouched'
 ])assert.ok(smoke.includes(marker),marker);
});
