/* M2 full readback of native PostgreSQL migration targets, via existing RLS.
 * Read-only. Explicit call only. No access to private xb_migrations receipts.
 * Legacy originals remain in 024; these two native tables independently prove
 * the six baseline events and materialized growth rows match the snapshot.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function fail(code){throw Error('migration_readback:'+code);}
 function create(app){
  if(!app?.auth?.getSession||typeof app.rdb!=='function')
   fail('sdk_required');
  const db=app.rdb();
  if(!db?.from)fail('database_required');
  async function rows(table,fields,{familyId,childId},max){
   if(!UUID.test(String(familyId))||!UUID.test(String(childId)))
    fail('invalid_scope');
   const sess=await app.auth.getSession();
   if(sess?.error||!sess?.data?.session)
    fail('session_unavailable');
   const query=db.from(table).select(fields).eq('family_id',familyId)
    .eq('child_id',childId);
   if(typeof query.limit!=='function')fail('bounded_read_unsupported');
   const res=await query.limit(max);
   if(res?.error||!Array.isArray(res?.data)||res.data.length>=max)
    fail('native_read_incomplete_or_unverified');
   return res.data;
  }
  async function readBaselineOperations(scope){
   return rows('xb_inventory_operations',
    'family_id,child_id,size,kind,delta,old_quantity,new_quantity,expected_revision,resulting_revision,legacy_transaction_id,reverses_operation_id',
    scope,7);
  }
  async function readNativeWeights(scope){
   return rows('xb_weight_records',
    'family_id,child_id,legacy_record_id,measured_on,measured_at,weight_kg,note,deleted_at',
    scope,10001);
  }
  return Object.freeze({readBaselineOperations,readNativeWeights});
 }
 const api=Object.freeze({create});
 if(root)root.XBLegacyMigrationReadback=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
