/* M2: one controlled entrypoint joining the EXISTING migration modules.
 * No new migration format/protocol. No CloudBase side effect until explicit
 * execute() with independently approved build/operator AND server ACL.
 *
 * 1. prepare() local-only multi-device/final freeze review.
 * 2. preflight() server-only receipt/primary READ, never upload.
 * 3. execute() existing 022-stage/023-promote, exact receipts and complete
 *    history, stock, baseline event, native growth, profile/settings readback.
 *
 * Neither prepare nor preflight creates a baby. 025 primary is separately
 * owner-authorized. This file is NOT included in any deployed PWA or M3 demo.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function create({app,cutoverGate,strictReview,digest,receiptModule,
  childModule,scopeGuard,legacyModule,inventoryModule,
  nativeReadbackModule,executorModule,cloudWritesEnabled=false}={}){
  if(!app?.auth?.getSession||!app?.rdb||!cutoverGate?.prepare
     ||!cutoverGate?.verifyBeforeUpload
     ||typeof strictReview!=='function'||typeof digest!=='function'
     ||!receiptModule?.create||!childModule?.create
     ||!scopeGuard?.requireLegacyMigrationTarget
     ||!legacyModule?.create||!inventoryModule?.create
     ||!nativeReadbackModule?.create||!executorModule?.create)
   throw Error('migration_runtime:dependencies_required');
  const receipts=receiptModule.create(app);
  const children=childModule.create(app,scopeGuard);
  const history=legacyModule.create(app);
  const inventory=inventoryModule.create(app);
  const native=nativeReadbackModule.create(app);
  const db=app.rdb();
  if(typeof db.from!=='function')throw Error('migration_runtime:read_api_required');
  async function readProfile({familyId,childId}={}){
   if(!UUID.test(String(familyId))||!UUID.test(String(childId)))
    throw Error('migration_runtime:invalid_profile_scope');
   const sess=await app.auth.getSession();
   if(sess?.error||!sess?.data?.session)
    throw Error('migration_runtime:login_required');
   const query=db.from('xb_baby_profiles')
    .select('family_id,child_id,profile_data')
    .eq('family_id',familyId).eq('child_id',childId);
   const response=await query.limit(2);
   if(response?.error||!Array.isArray(response?.data)
      ||response.data.length!==1
      ||response.data[0]?.family_id!==familyId
      ||response.data[0]?.child_id!==childId
      ||!response.data[0]?.profile_data
      ||typeof response.data[0].profile_data!=='object'
      ||Array.isArray(response.data[0].profile_data))
    throw Error('migration_runtime:profile_read_unverified');
   return response.data[0].profile_data;
  }
  const coordinator=executorModule.create({
   app,cutoverGate,strictReview,digest,
   receiptPreview:receipts,
   resolvePrimary:({familyId})=>children.inspectLegacyTarget({familyId}),
   readHistory:history,
   readInventory:scope=>inventory.readInventory(scope),
   readPurchases:scope=>inventory.readPurchases(scope),
   readProfile,
   readBaselineOperations:scope=>native.readBaselineOperations(scope),
   readNativeWeights:scope=>native.readNativeWeights(scope),
   cloudWritesEnabled
  });
  return Object.freeze({
   prepare:input=>cutoverGate.prepare({...input,strictReview,digest}),
   preflight:input=>coordinator.preflight(input),
   reconcile:input=>coordinator.reconcile(input),
   execute:input=>coordinator.execute(input),
   // This is NEVER automatic; only after operator SQL verification and B-3 consent.
   resumeVerifiedStage:input=>coordinator.resumeVerifiedStage(input),
   get cloudWritesEnabled(){return coordinator.cloudWritesEnabled;}
  });
 }
 const api=Object.freeze({create});
 if(root)root.XBLegacyMigrationRuntime=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
