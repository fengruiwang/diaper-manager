const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const folder=path.join(__dirname,'../cloudbase/sql');
const file={
  '021':'021_xb_migration_receipt_preflight_DRAFT_DO_NOT_DEPLOY.sql',
  '022':'022_xb_legacy_archive_atomic_STAGE_DRAFT_DO_NOT_DEPLOY.sql',
  '023':'023_xb_legacy_promotion_atomic_DRAFT_DO_NOT_DEPLOY.sql',
  '024':'024_xb_legacy_history_read_DRAFT_DO_NOT_DEPLOY.sql',
  '025':'025_xb_create_primary_child_owner_only_DRAFT_DO_NOT_DEPLOY.sql'
};
const sql=Object.fromEntries(Object.entries(file).map(([k,v])=>
 [k,fs.readFileSync(path.join(folder,v),'utf8')]));
test('021 through 025 are complete standalone transactions and remain undeployed drafts',()=>{
 for(const [n,s] of Object.entries(sql)){
  assert.match(s,/\bBEGIN\s*;/);
  assert.match(s,/COMMIT\s*;\s*$/);
  assert.match(s,/DO NOT DEPLOY|DO NOT execute|NEVER execute|DRAFT/i,n);
 }
});
test('025 creates only active primary owner-gated RPC and uses same advisory lock as smoke 019',()=>{
 const p=sql['025'];const smoke=fs.readFileSync(path.join(folder,
  '019_xb_smoke_child_rpc_draft_DO_NOT_DEPLOY.sql'),'utf8');
 for(const str of ['public.xb_create_primary_child(p_family_id uuid)',
  'xb_private.is_family_owner(p_family_id)',
  "xb_private.can_use_app(p_family_id,'xb')",
  "legacy_slot='primary'","VALUES(p_family_id,'primary'",
  "'xb.inventory.family:'"])
  assert.ok(p.includes(str),str);
 assert.match(smoke,/xb\.inventory\.family:/);
 assert.doesNotMatch(p,/\b(?:TRUNCATE|DELETE\s+FROM|DROP\s+TABLE)\b/i);
 assert.doesNotMatch(p,/__xb_smoke_v1__'\s*,\s*'/);
});
test('receipt, staging and promotion all scope checks to active primary and per-child data',()=>{
 assert.match(sql['021'],/legacy_slot='primary'/);
 assert.match(sql['022'],/legacy_slot='primary'/);
 assert.match(sql['023'],/legacy_slot='primary'/);
 assert.match(sql['022'],/WHERE family_id=p_family_id AND child_id=p_child_id/);
 assert.match(sql['023'],/WHERE family_id=p_family_id AND child_id=p_child_id/);
});
test('023 migrates old stock as absolute baseline and receipt last, not as replayed buys',()=>{
 const s=sql['023'];
 assert.match(s,/v_state->'inventory'/);
 assert.match(s,/\b'migration_baseline'\b/);
 assert.match(s,/INSERT INTO public\.xb_legacy_history_entries/);
 assert.match(s,/INSERT INTO public\.xb_inventory/);
 assert.match(s,/INSERT INTO public\.xb_migrations/);
 assert.ok(s.lastIndexOf('INSERT INTO public.xb_migrations')>
  s.lastIndexOf('INSERT INTO public.xb_legacy_history_entries'));
});
test('024 requires active primary in both history and settings readers',()=>{
 const s=sql['024'];
 assert.equal((s.match(/legacy_slot='primary' AND deleted_at IS NULL/g)||[]).length,2);
 assert.match(s,/STABLE SECURITY DEFINER/);
 assert.match(s,/\bcan_upload\b/);
});
