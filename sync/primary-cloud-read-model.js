/* XiaoBao V1.2.0 M3 early integration: READ-ONLY view-model adapter for the
 * existing formal UI. Feature only; never imported into the v1.1.2 main PWA.
 *
 * Only an active legacy_slot='primary' child can be selected. The existing
 * child reader + access preflight must authenticate the actor and family.
 * SQL 024 must verify a COMMITTED migration receipt before this module will
 * show a formal history, settings, or stock view.
 *
 * Historical buys/uses are PRESENTED, NEVER replayed into current inventory.
 * Current stock comes solely from 010 authoritative six-size read RPC.
 * Current (post-migration) purchases come solely from xb_transactions scoped
 * to the same child. Zero automatic network calls or write methods on import.
 */
(function(root){
 'use strict';
 const SIZES=['NB','S','M','L','XL','XXL'];
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function fail(code){throw Error('primary_view:'+code);}
 function numbers(rows){
  if(!Array.isArray(rows)||rows.length!==6)fail('incomplete_inventory');
  const inventory={},revisions={};
  for(const r of rows){
   if(!r||!SIZES.includes(r.size)||Object.hasOwn(inventory,r.size)
      ||!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>100000
      ||!Number.isSafeInteger(r.revision)||r.revision<0)
    fail('invalid_inventory');
   inventory[r.size]=r.quantity;revisions[r.size]=r.revision;
  }
  if(SIZES.some(s=>!Object.hasOwn(inventory,s)))fail('incomplete_inventory');
  return {inventory,revisions};
 }
 function equalStock(a,b){
  const x=numbers(a),y=numbers(b);
  return SIZES.every(s=>x.inventory[s]===y.inventory[s]&&x.revisions[s]===y.revisions[s]);
 }
 function create({app,childReader,scopeGuard,accessPreflight,
  inventoryClient,legacyHistoryReader}={}){
  if(!app||!childReader?.create||!scopeGuard?.requireLegacyMigrationTarget
     ||!accessPreflight?.create||!inventoryClient?.create
     ||!legacyHistoryReader?.create||typeof app.rdb!=='function')
    fail('dependencies_required');
  const children=childReader.create(app,scopeGuard);
  const inventory=inventoryClient.create(app);
  const legacy=legacyHistoryReader.create(app);
  async function read({familyId,actorUid,offset=0,limit=50}={}){
   if(!UUID.test(String(familyId))||typeof actorUid!=='string'
     ||!actorUid||actorUid.length>128||!Number.isSafeInteger(offset)
     ||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>50)
    fail('invalid_request');
   // A fresh verified CloudBase session is necessary for every explicit read.
   const grant=await accessPreflight.create(app).verifyAccess({familyId,actorUid});
   if(grant.member!==true||grant.appCode!=='xb'
      ||grant.familyId!==familyId||grant.actorUid!==actorUid)
    fail('grant_unverified');
   let target;
   try{target=await children.inspectLegacyTarget({familyId});}
   catch(e){
    if(e?.message==='child_reader:legacy_primary_unavailable')
     return Object.freeze({status:'PRIMARY_NOT_READY',canWrite:false,
      noDataImported:true});
    throw e;
   }
   if(target.familyId!==familyId||!UUID.test(target.childId)
      ||target.readyForMigration!==false)fail('primary_scope_unverified');
   const childId=target.childId;
   const scope={familyId,childId};
   // A completed receipt is required BEFORE showing any stock in a formal UI.
   // SQL 024 does not exist in the real database until independently approved.
   let settings,history;
   try{
    settings=await legacy.readSettings(scope);
    history=await legacy.readPage({...scope,kind:'all',offset,limit});
   }catch(e){
    // Do not echo RPC/SDK exceptions: they may contain private row details.
    return Object.freeze({status:'MIGRATION_READ_NOT_READY',canWrite:false,
      noDataImported:true});
   }
   if(settings.complete!==true||settings.canEdit!==false
      ||settings.canUpload!==false||history.complete!==true
      ||history.canEdit!==false||history.canUpload!==false)
    fail('legacy_receipt_unverified');
   // Only the selected PRIMARY is ever used in all cloud data queries.
   const before=await inventory.readReconciliation({...scope,operationIds:[]});
   if(before.complete!==true||before.actorUid!==actorUid
      ||before.familyId!==familyId||before.childId!==childId)
    fail('server_scope_unverified');
   const currentPurchases=await inventory.readPurchases(scope);
   if(!Array.isArray(currentPurchases))fail('current_purchases_unverified');
   const after=await inventory.readReconciliation({...scope,operationIds:[]});
   if(after.complete!==true||after.actorUid!==actorUid
     ||after.familyId!==familyId||after.childId!==childId
     ||!equalStock(before.rows,after.rows))fail('server_changed_during_read');
   const stock=numbers(after.rows);
   // Profile is a separate migrated table: never borrow sandbox baby details.
   const profileQuery=await app.rdb().from('xb_baby_profiles')
    .select('family_id,child_id,profile_data')
    .eq('family_id',familyId).eq('child_id',childId).limit(2);
   if(profileQuery?.error||!Array.isArray(profileQuery?.data)
      ||profileQuery.data.length!==1
      ||profileQuery.data[0].family_id!==familyId
      ||profileQuery.data[0].child_id!==childId
      ||!profileQuery.data[0].profile_data
      ||typeof profileQuery.data[0].profile_data!=='object'
      ||Array.isArray(profileQuery.data[0].profile_data))
    fail('formal_profile_unverified');
   const profile=profileQuery.data[0].profile_data;
   if(!profile.babyProfile||typeof profile.babyProfile!=='object'
     ||Array.isArray(profile.babyProfile))fail('formal_profile_unverified');
   // Never sum historical purchases into inventory. They are archival facts,
   // and original v1.1.2 stocktake is already the authoritative baseline.
   return Object.freeze({
    status:'PRIMARY_READ_ONLY_READY',familyId,childId,
    source:'cloudbase-primary-receipt-verified',canWrite:false,
    inventory:Object.freeze(stock.inventory),
    revisions:Object.freeze(stock.revisions),
    settings:settings.settings,settingsRevision:settings.revision,
    profileData:Object.freeze({...profile}),
    legacyHistory:Object.freeze({
      rows:history.rows,total:history.total,offset:history.offset,
      hasMore:history.hasMore,complete:history.complete
    }),
    livePurchases:Object.freeze(currentPurchases.slice()),
    legacyPurchasesAppliedToInventory:false
   });
  }
  return Object.freeze({read});
 }
 const api=Object.freeze({create,numbers,equalStock});
 if(root)root.XBPrimaryCloudReadModel=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
