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
 const SOURCE_SHA=/^[0-9a-f]{64}$/;
 // A controller-owned, process-memory-only cache. No history leaves this
 // module except a fresh JSON copy. Only a full successful primary read can
 // populate it, and invalidation also blocks an older in-flight reader.
 const historyCacheSlots=new WeakMap();
 function createHistoryCache(){
  const handle=Object.freeze({invalidate(){
   const slot=historyCacheSlots.get(handle);
   if(slot){slot.version++;slot.entry=null;}
  }});
  historyCacheSlots.set(handle,{version:0,entry:null});
  return handle;
 }
 function verifiedHistory(value){
  return value?.complete===true&&value.canEdit===false&&value.canUpload===false
   &&value.hasMore===false&&value.offset===0&&Array.isArray(value.rows)
   &&Number.isSafeInteger(value.total)&&value.total>=0
   &&value.total===value.rows.length;
 }
 function fail(code){throw Error('primary_view:'+code);}
 function numbers(rows){
  if(!Array.isArray(rows)||rows.length!==6)fail('incomplete_inventory');
  const inventory={},revisions={};
  for(const r of rows){
   if(!r||!SIZES.includes(r.size)||Object.prototype.hasOwnProperty.call(inventory,r.size)
      ||!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>100000
      ||!Number.isSafeInteger(r.revision)||r.revision<0)
    fail('invalid_inventory');
   inventory[r.size]=r.quantity;revisions[r.size]=r.revision;
  }
  if(SIZES.some(s=>!Object.prototype.hasOwnProperty.call(inventory,s)))fail('incomplete_inventory');
  return {inventory,revisions};
 }
 function equalStock(a,b){
  const x=numbers(a),y=numbers(b);
  return SIZES.every(s=>x.inventory[s]===y.inventory[s]&&x.revisions[s]===y.revisions[s]);
 }
 function create({app,childReader,scopeGuard,accessPreflight,
  inventoryClient,legacyHistoryReader,historyCache=null}={}){
  if(!app||!childReader?.create||!scopeGuard?.requireLegacyMigrationTarget
     ||!accessPreflight?.create||!inventoryClient?.create
     ||!legacyHistoryReader?.create||typeof app.rdb!=='function')
    fail('dependencies_required');
  const children=childReader.create(app,scopeGuard);
  const inventory=inventoryClient.create(app);
  const legacy=legacyHistoryReader.create(app);
  const slot=historyCacheSlots.get(historyCache)||null;
  // This small RLS SELECT is a source digest hint, NOT a migration receipt.
  // Fresh readSettings() verifies the committed receipt and that this
  // settings row's source SHA matches it. The fresh profile also has to match.
  async function verifiedSource(familyId,childId){
   try{
    const result=await app.rdb().from('xb_legacy_settings')
     .select('family_id,child_id,source_sha256')
     .eq('family_id',familyId).eq('child_id',childId).limit(2);
    const row=result?.data?.length===1?result.data[0]:null;
    if(result?.error||!row||row.family_id!==familyId
      ||row.child_id!==childId||!SOURCE_SHA.test(row.source_sha256))
     return null;
    return row.source_sha256;
   }catch(_){return null;}
  }
  async function read({familyId,actorUid,limit=50}={}){
   if(!UUID.test(String(familyId))||typeof actorUid!=='string'
     ||!actorUid||actorUid.length>128||!Number.isSafeInteger(limit)||limit<1||limit>50)
    fail('invalid_request');
   // A fresh verified CloudBase session is necessary for every explicit read.
   const preflight=accessPreflight.create(app);
   // Production preflight owns the proof lifecycle (try/finally). Existing
   // unit-test doubles that expose verifyAccess only remain compatible.
   const withinRead=typeof preflight.withVerifiedReadAccess==='function'
    ?preflight.withVerifiedReadAccess.bind(preflight)
    :async (scope,work)=>work(await preflight.verifyAccess(scope));
   return withinRead({familyId,actorUid},async grant=>{
    if(grant.member!==true||grant.appCode!=='xb'
       ||grant.familyId!==familyId||grant.actorUid!==actorUid)
     fail('grant_unverified');
   const trusted=accessPreflight.verifiedReadGrant?.(grant,{
    app,familyId,actorUid
   })===true;
   let target;
   try{target=await children.inspectLegacyTarget(trusted
    ?{familyId,verifiedReadGrant:grant}:{familyId});}
   catch(e){
    if(e?.message==='child_reader:legacy_primary_unavailable')
     return Object.freeze({status:'PRIMARY_NOT_READY',canWrite:false,
      noDataImported:true});
    throw e;
   }
   if(target.familyId!==familyId||!UUID.test(target.childId)
      ||target.readyForMigration!==false)fail('primary_scope_unverified');
   const childId=target.childId;
   if(trusted)accessPreflight.bindVerifiedReadChild?.(grant,{app,familyId,actorUid,childId});
   const scope=trusted?{familyId,childId,verifiedReadGrant:grant}
    :{familyId,childId};
   // A completed receipt is required BEFORE showing any stock in a formal UI.
   // SQL 024 does not exist in the real database until independently approved.
   let settings,history,sourceHash=null,profileEarly=null,cacheVersion=slot?.version;
   try{
    if(slot){
     // Each complete refresh still validates the current receipt/settings
     // and fetches the live profile. Only the 50-item history pages are reused.
     [settings,profileEarly,sourceHash]=await Promise.all([
      legacy.readSettings(scope),
      app.rdb().from('xb_baby_profiles').select('family_id,child_id,profile_data')
       .eq('family_id',familyId).eq('child_id',childId).limit(2),
      verifiedSource(familyId,childId)
     ]);
     const profileSha=profileEarly?.data?.length===1
      &&profileEarly.data[0]?.family_id===familyId
      &&profileEarly.data[0]?.child_id===childId
      ?profileEarly.data[0]?.profile_data?.legacySourceSha256:null;
     const sourceValid=SOURCE_SHA.test(sourceHash||'')
      &&sourceHash===profileSha;
     const candidate=slot.entry;
     const matches=sourceValid&&candidate?.app===app
      &&candidate.familyId===familyId&&candidate.actorUid===actorUid
      &&candidate.childId===childId&&candidate.sourceHash===sourceHash;
     if(candidate&&!matches){
      // Source / actor / family / child changed, so older in-flight reads
      // cannot repopulate a now-invalid scope.
      slot.version++;slot.entry=null;cacheVersion=slot.version;
     }
     if(matches){
      try{
       const saved=JSON.parse(candidate.serialized);
       if(verifiedHistory(saved))history=saved;
      }catch(_){/* malformed in-memory cache is a miss, not success */}
     }
     if(!history)history=await legacy.readAll({...scope,kind:'all',limit});
    }else{
     // Uncached adapter callers retain the original parallel read path.
     [settings,history]=await Promise.all([
      legacy.readSettings(scope),legacy.readAll({...scope,kind:'all',limit})
     ]);
    }
   }catch(e){
    // Do not echo RPC/SDK exceptions: they may contain private row details.
    return Object.freeze({status:'MIGRATION_READ_NOT_READY',canWrite:false,
      noDataImported:true});
   }
   if(settings.complete!==true||settings.canEdit!==false
      ||settings.canUpload!==false||!verifiedHistory(history))
    fail('legacy_receipt_unverified');
   // Only the selected PRIMARY is ever used in all cloud data queries.
   const before=await inventory.readReconciliation({...scope,operationIds:[]});
   if(before.complete!==true||before.actorUid!==actorUid
      ||before.familyId!==familyId||before.childId!==childId)
    fail('server_scope_unverified');
   const [currentPurchases,currentUses,profileQuery]=await Promise.all([
    inventory.readPurchases(scope),
    inventory.readUses(scope),
    slot?Promise.resolve(profileEarly):app.rdb().from('xb_baby_profiles')
     .select('family_id,child_id,profile_data')
     .eq('family_id',familyId).eq('child_id',childId).limit(2)
   ]);
   if(!Array.isArray(currentPurchases))fail('current_purchases_unverified');
   if(!Array.isArray(currentUses))fail('current_uses_unverified');
   const after=await inventory.readReconciliation({...scope,operationIds:[]});
   if(after.complete!==true||after.actorUid!==actorUid
     ||after.familyId!==familyId||after.childId!==childId
     ||!equalStock(before.rows,after.rows))fail('server_changed_during_read');
   const stock=numbers(after.rows);
   // Profile is a separate migrated table: never borrow sandbox baby details.
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
   // Populate only after complete primary verification (including the
   // second authoritative stock snapshot), never after a partial page or
   // failed receipt check. Only the immutable legacy history is serialized.
   if(slot&&SOURCE_SHA.test(sourceHash||'')
     &&profile.legacySourceSha256===sourceHash
     &&slot.version===cacheVersion){
    slot.entry={app,familyId,actorUid,childId,sourceHash,
     serialized:JSON.stringify(history)};
   }
   // Never sum historical purchases into inventory. They are archival facts,
   // and original v1.1.2 stocktake is already the authoritative baseline.
   return Object.freeze({
    status:'PRIMARY_READ_ONLY_READY',familyId,childId,actorUid,
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
    liveUses:Object.freeze(currentUses.slice()),
    legacyPurchasesAppliedToInventory:false
   });
   });
  }
  return Object.freeze({read});
 }
 const api=Object.freeze({create,numbers,equalStock,createHistoryCache});
 if(root)root.XBPrimaryCloudReadModel=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
