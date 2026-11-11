/* XiaoBao v1.2.0 cloud child read-only adapter, feature branch only.
 * Never imported into production v1.1.2.
 * A valid session and the user's family xb app grant are required.
 * The child scope guard fails closed if classification fields are omitted.
 * No create/retire RPC, mutations, cloud calls or local storage at import time.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const MAX_CHILDREN=100;
 function fail(code){throw new Error('child_reader:'+code);}
 function requireFamilyId(value){
  if(typeof value!=='string'||!UUID.test(value))fail('invalid_family_id');
  return value;
 }
 function create(app,guard){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'||typeof app.rdb!=='function'
    ||!guard||typeof guard.activeBusinessChildren!=='function'
    ||typeof guard.requireLegacyMigrationTarget!=='function')
   fail('dependencies_required');
  const db=app.rdb();
  if(!db||typeof db.from!=='function')fail('database_select_unavailable');
  async function select(table,fields,scope,limit){
   try{
    let q=db.from(table).select(fields);
    for(const [column,value] of scope)q=q.eq(column,value);
    const result=await q.limit(limit);
    if(result&&result.error)fail('cloudbase_query_failed');
    if(!result||!Array.isArray(result.data))fail('invalid_server_rows');
    return result.data;
   }catch(error){
    if(error instanceof Error&&error.message.startsWith('child_reader:'))throw error;
    fail('cloudbase_query_failed');
   }
  }
  async function requireAuthorizedFamily(familyId){
   let session;
   try{session=await app.auth.getSession();}
   catch(_){fail('session_unavailable');}
   if(!session||session.error)fail('session_unavailable');
   if(!session.data||!session.data.session)fail('login_required');
   const visible=await select('families','id',[['id',familyId]],2);
   if(visible.length!==1||visible[0].id!==familyId)
    fail('family_access_denied');
   // Do not hard-code the current 2-member household into future releases.
   // RLS checks the caller's app access; more family members may be added later.
   const grants=await select('family_app_access','app_code',
    [['family_id',familyId],['app_code','xb']],MAX_CHILDREN+1);
   if(grants.length===0||grants.length>MAX_CHILDREN
      ||grants.some(row=>row.app_code!=='xb'))
    fail('app_access_denied');
  }
  async function load({familyId}={}){
   const family=requireFamilyId(familyId);
   await requireAuthorizedFamily(family);
   // Every query MUST select both legacy_slot and deleted_at.
   const rows=await select('xb_children',
    'id,family_id,display_name,legacy_slot,deleted_at,revision',
    [['family_id',family]],MAX_CHILDREN+1);
   if(rows.length>MAX_CHILDREN)fail('child_limit_exceeded');
   const knownIds=new Set();
   for(const row of rows){
    if(!row||row.family_id!==family||!UUID.test(String(row.id))
       ||knownIds.has(row.id)
       ||typeof row.display_name!=='string'||!row.display_name.trim()
       ||!Number.isSafeInteger(row.revision)||row.revision<0)
     fail('invalid_child_rows');
    knownIds.add(row.id);
   }
   let active;
   try{active=guard.activeBusinessChildren(rows);}
   catch(_){fail('unclassified_child_rows');}
   return Object.freeze({
    familyId:family,
    totalVisible:rows.length,
    activeChildren:Object.freeze(active.map(row=>Object.freeze({
     id:row.id,displayName:row.display_name,revision:row.revision
    }))),
    // Deliberately no raw row, test child ID, email or token in the response.
    suppressedCount:rows.length-active.length
   });
  }
  async function migrationTarget({familyId}={}){
   const family=requireFamilyId(familyId);
   await requireAuthorizedFamily(family);
   const rows=await select('xb_children',
    'id,family_id,display_name,legacy_slot,deleted_at,revision',
    [['family_id',family],['legacy_slot','primary']],2);
   if(rows.length!==1)fail('legacy_primary_unavailable');
   const row=rows[0];
   if(!row||row.family_id!==family||!UUID.test(String(row.id)))
    fail('invalid_child_rows');
   try{guard.requireLegacyMigrationTarget(row);}
   catch(_){fail('legacy_primary_unavailable');}
   return Object.freeze({childId:row.id,familyId:family,readyForMigration:false});
   // The target can be identified; actual history upload remains disabled.
  }
  return Object.freeze({listActiveChildren:load,inspectLegacyTarget:migrationTarget});
 }
 const api=Object.freeze({create});
 if(root)root.XBCloudbaseChildReader=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
