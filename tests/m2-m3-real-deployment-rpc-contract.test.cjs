const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const sql={
 '021':read('cloudbase/sql/021_xb_migration_receipt_preflight_DRAFT_DO_NOT_DEPLOY.sql'),
 '022':read('cloudbase/sql/022_xb_legacy_archive_atomic_STAGE_DRAFT_DO_NOT_DEPLOY.sql'),
 '023':read('cloudbase/sql/023_xb_legacy_promotion_atomic_DRAFT_DO_NOT_DEPLOY.sql'),
 '024':read('cloudbase/sql/024_xb_legacy_history_read_DRAFT_DO_NOT_DEPLOY.sql'),
 '025':read('cloudbase/sql/025_xb_create_primary_child_owner_only_DRAFT_DO_NOT_DEPLOY.sql'),
 '026':read('cloudbase/sql/026_xb_primary_document_cas_DRAFT_DO_NOT_DEPLOY.sql'),
 '027':read('cloudbase/sql/027_xb_primary_stocktake_batch_DRAFT_DO_NOT_DEPLOY.sql')
};
const executor=read('sync/legacy-migration-executor.js');
const receipt=read('sync/cloudbase-migration-receipt-preview.js');
const history=read('sync/cloudbase-legacy-history-reader.js');
const docClient=read('sync/primary-documents-client.js');
const batch=read('sync/primary-stocktake-batch-client.js');
function params(src,fn){
 const match=src.match(new RegExp('CREATE FUNCTION public\\.'+fn+
  '\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS\\s+\\w+','m'));
 assert.ok(match,'SQL function signature missing '+fn);
 return [...match[1].matchAll(/\b(p_[a-z_]+)\s+(?:uuid|text|jsonb|bigint|integer)/g)]
  .map(m=>m[1]).sort();
}
function requested(src,fn){
 const i=src.indexOf("'"+fn+"'");
 assert.notEqual(i,-1,'JS RPC caller missing '+fn);
 const args=src.slice(i+fn.length+2,i+fn.length+800);
 const bracket=args.indexOf('{'),close=args.indexOf('}',bracket+1);
 assert.ok(bracket>=0&&close>bracket,'no RPC argument object '+fn);
 return [...args.slice(bracket+1,close).matchAll(/\b(p_[a-z_]+)\s*:/g)]
  .map(m=>m[1]).sort();
}
test('021/022/023/024 client-to-SQL named RPC parameters match exactly',()=>{
 const links=[
  ['021','xb_preview_legacy_migration_receipt',receipt],
  ['022','xb_stage_legacy_archive_draft',executor],
  ['023','xb_promote_legacy_archive_draft',executor],
  ['024','xb_read_legacy_history_page_draft',history],
  ['024','xb_read_legacy_settings_draft',history]
 ];
 for(const [num,fn,client] of links)
  assert.deepEqual(requested(client,fn),params(sql[num],fn),fn+' mismatched');
});
test('026/027 existing SDK client uses exact server RPC function names and argument keys',()=>{
 for(const [num,fn,src] of [
  ['026','xb_read_primary_document_draft',docClient],
  ['026','xb_put_primary_document_draft',docClient],
  ['026','xb_check_primary_document_request_draft',docClient],
  ['027','xb_primary_stocktake_batch_draft',batch],
  ['027','xb_read_primary_stocktake_batch_receipt_draft',batch]
 ]){
  assert.deepEqual(requested(src,fn),params(sql[num],fn),fn+' mismatched');
 }
});
test('Stage A leaves all five newly installed write RPCs ungranted while read-only RPCs remain explicitly granted',()=>{
 const active=[
  ['025','xb_create_primary_child','uuid'],
  ['022','xb_stage_legacy_archive_draft','uuid,uuid,uuid,text'],
  ['023','xb_promote_legacy_archive_draft','uuid,uuid,uuid,text'],
  ['026','xb_put_primary_document_draft','uuid,uuid,text,bigint,uuid,jsonb'],
  ['027','xb_primary_stocktake_batch_draft','uuid,uuid,uuid,jsonb']
 ];
 for(const [num,name,args] of active){
  const rpc='public.'+name+'('+args+')';
  assert.ok(sql[num].includes('REVOKE ALL ON FUNCTION '+rpc),
   num+' write RPC is not explicitly revoked');
  const grant=new RegExp('GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+'+
   rpc.replace(/[().]/g,'\\$&')+'\\s+TO\\s+authenticated','m');
  assert.doesNotMatch(sql[num],grant,
   num+' stage A must never auto-grant write');
 }
 for(const [num,fn] of [
  ['021','xb_preview_legacy_migration_receipt'],
  ['024','xb_read_legacy_settings_draft'],
  ['026','xb_read_primary_document_draft'],
  ['027','xb_read_primary_stocktake_batch_receipt_draft']]){
  assert.ok(sql[num].includes('GRANT EXECUTE ON FUNCTION public.'+fn),
   num+' read-only RPC not available');
 }
});
test('promotion remains receipt-last, six one-time stock baselines, never replay historic purchases',()=>{
 const p=sql['023'];
 const eventPos=p.indexOf('INSERT INTO public.xb_inventory_operations');
 const historyPos=p.indexOf('INSERT INTO public.xb_legacy_history_entries');
 const receiptPos=p.lastIndexOf('INSERT INTO public.xb_migrations');
 assert.ok(eventPos>0&&historyPos>eventPos&&receiptPos>historyPos);
 assert.match(p,/['"]migration_baseline['"]/);
 assert.match(p,/kind='primary'|legacy_slot='primary'/);
 assert.doesNotMatch(p,/INSERT INTO public\.xb_transactions/);
 assert.ok(receiptPos>p.indexOf('INSERT INTO public.xb_weight_records'));
 assert.match(executor,/source\.transactions\.length\+source\.quotes\.length\+source\.weightRecords\.length/);
 assert.match(executor,/readHistory\.readAll\(\{familyId,childId,kind:'all',limit:50\}\)/);
 assert.match(executor,/cloudWritesEnabled!==true\|\|input\.operatorApproved!==true/);
});
test('only SQL 025 creates primary row; installing SQL 025 does not invoke child creation',()=>{
 assert.match(sql['025'],/INSERT INTO public\.xb_children/);
 for(const num of ['021','022','023','024','026','027'])
  assert.doesNotMatch(sql[num],/INSERT INTO public\.xb_children\s*\(/,
   num+' must not create child');
 assert.match(sql['025'],/CREATE FUNCTION public\.xb_create_primary_child/);
 assert.doesNotMatch(sql['025'],/SELECT public\.xb_create_primary_child/);
});
