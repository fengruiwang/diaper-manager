/* XiaoBao v1.2.0 future cloud-child read/migration safety guard.
 * Pure module only; NOT loaded by production PWA. No I/O or storage.
 * A cloud child query MUST include both legacy_slot and deleted_at.
 */
(function(root){
 'use strict';
 const SMOKE_PREFIX='__xb_smoke_';
 const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
 function parse(row){
  if(!row||typeof row!=='object'||Array.isArray(row)
      ||!own(row,'legacy_slot')||!own(row,'deleted_at'))
   throw Error('child_scope:required_classification_fields_missing');
  if(row.legacy_slot!==null&&typeof row.legacy_slot!=='string')
   throw Error('child_scope:invalid_legacy_slot');
  if(row.deleted_at!==null&&typeof row.deleted_at!=='string')
   throw Error('child_scope:invalid_deleted_at');
  return Object.freeze({
   smoke:typeof row.legacy_slot==='string'&&row.legacy_slot.startsWith(SMOKE_PREFIX),
   archived:row.deleted_at!==null,
   primary:row.legacy_slot==='primary'
  });
 }
 function activeBusinessChildren(rows){
  if(!Array.isArray(rows))throw Error('child_scope:expected_array');
  const out=[];
  for(const row of rows){
   const label=parse(row);
   if(!label.smoke&&!label.archived)out.push(row);
  }
  return Object.freeze(out);
 }
 function requireLegacyMigrationTarget(row){
  const scope=parse(row);
  if(!scope.primary||scope.smoke||scope.archived)
   throw Error('child_scope:legacy_migration_target_must_be_active_primary');
  return true;
 }
 const api=Object.freeze({parse,activeBusinessChildren,requireLegacyMigrationTarget,SMOKE_PREFIX});
 if(root)root.XBChildScopeGuard=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
