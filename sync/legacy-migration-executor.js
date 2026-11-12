/* XiaoBao V1.2.0 M2 - controlled one-shot migration COORDINATOR.
 * Feature-only, never imported by v1.1.2 or any deployed test page.
 * This code DOES NOT grant migration authorization. Client approval flags are
 * operator interlocks, not database security. Server 021-025 enforce ACLs.
 * All RPCs below are invoked only by an explicit execute(...) call with both
 * cloudWritesEnabled=true (future separately approved build) and
 * operatorApproved=true. Defaults permanently deny writes.
 *
 * Never logs raw backup, stores it in IndexedDB, merges device sources,
 * retries unknown ACKs, creates primary, deletes staging or replays old buys.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const SHA=/^[a-f0-9]{64}$/;
 const SIZES=['NB','S','M','L','XL','XXL'];
 const CATEGORIES=['transaction','quote','weight'];
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const deny=(code)=>Object.freeze({status:code,verified:false,cloudWritesAuthorized:false});
 function create({app,cutoverGate,strictReview,digest,receiptPreview,
  resolvePrimary,readHistory,readInventory,readPurchases,readProfile,
  cloudWritesEnabled=false}={}){
  if(!app||typeof app.rdb!=='function'||!cutoverGate?.verifyBeforeUpload
    ||typeof strictReview!=='function'||typeof digest!=='function'
    ||!receiptPreview?.inspect||typeof resolvePrimary!=='function'
    ||!readHistory?.readAll||!readHistory?.readSettings
    ||typeof readInventory!=='function'||typeof readPurchases!=='function'
    ||typeof readProfile!=='function')
   throw Error('m2_executor:dependencies_required');
  let busy=false;
  const stable=cutoverGate.stable;
  if(typeof stable!=='function')throw Error('m2_executor:stable_required');
  function scope(input){
   if(!input||!UUID.test(input.familyId)||!UUID.test(input.childId)
     ||!UUID.test(input.stageId)||!UUID.test(input.migrationId)
     ||input.stageId===input.migrationId||input.childId===input.stageId
     ||!SHA.test(input.plan?.sourceSha256)
     ||input.plan?.status!=='CUTOVER_LOCAL_REVIEW_READY'
     ||input.plan?.differences?.length!==0||input.plan?.issues?.length!==0
     ||typeof input.raw!=='string')
    return false;
   return true;
  }
  async function preflight(input){
   if(!scope(input))return deny('INVALID_PRIMARY_OR_FINAL_SNAPSHOT');
   const {plan,raw,familyId,childId}=input;
   // Recalculate and validate source before ANY network/SQL mutation.
   const ready=await cutoverGate.verifyBeforeUpload(plan,raw,strictReview,digest);
   if(ready.status!=='SOURCE_UNCHANGED_LOCAL_CHECK'
     ||ready.canUpload!==false)
    return deny(ready.status||'FINAL_SNAPSHOT_UNVERIFIED');
   const target=await resolvePrimary({familyId});
   if(!target||target.familyId!==familyId||target.childId!==childId
     ||target.readyForMigration!==false)
    return deny('PRIMARY_SCOPE_UNVERIFIED');
   const receipt=await receiptPreview.inspect({
    familyId,childId,sourceSha256:plan.sourceSha256,readEnabled:true
   });
   if(receipt?.status==='ALREADY_RECEIPTED_SAME_SOURCE')
    return Object.freeze({status:'RECEIPTED_SAME_SOURCE_VERIFY_ONLY',
     verified:true,preview:receipt.status,cloudWritesAuthorized:false});
   if(receipt?.status!=='PLAN_ONLY_EMPTY_TARGET')
    return deny('RECEIPT_OR_PRIMARY_TARGET_CONFLICT');
   return Object.freeze({status:'READY_FOR_SEPARATELY_AUTHORIZED_EXECUTION',
    verified:true,preview:receipt.status,cloudWritesAuthorized:false});
  }
  async function rpc(name,params){
   let response;
   try{response=await app.rdb().rpc(name,params);}
   catch(_){return null;}
   if(!response||response.error)return null;
   const raw=Array.isArray(response.data)?
    (response.data.length===1?response.data[0]:null):response.data;
   return object(raw)?raw:null;
  }
  function archived(result){
   return result&&['ARCHIVED_ONLY_NOT_MIGRATED','ALREADY_STAGED_SAME_SOURCE']
     .includes(result.status)&&result.archive_only===true
     &&result.can_commit===false&&result.can_upload===false
     &&result.receipt_committed===false;
  }
  function promoted(result){
   return result&&['PROMOTED_HISTORY_AND_BASELINE','ALREADY_PROMOTED_SAME_SOURCE']
     .includes(result.status)&&result.receipt_committed===true
     &&result.can_upload===false;
  }
  function expectedState(raw){
   const obj=JSON.parse(raw);
   if(!object(obj)||!object(obj.data))throw Error('m2_executor:bad_source');
   return obj.data;
  }
  function identical(a,b){return stable(a)===stable(b);}
  function assertHistory(rows,source){
   if(!Array.isArray(rows)||rows.length!==
     source.transactions.length+source.quotes.length+source.weightRecords.length)
    return false;
   const sets={transaction:source.transactions,quote:source.quotes,
    weight:source.weightRecords};
   const observed={transaction:0,quote:0,weight:0};
   for(const row of rows){
    if(!row||!CATEGORIES.includes(row.kind)
      ||!Number.isInteger(row.ordinal)||row.ordinal!==++observed[row.kind])
     return false;
    const record=sets[row.kind][row.ordinal-1];
    if(!record||record.id!==row.id||!identical(record,row.payload))
     return false;
   }
   return CATEGORIES.every(k=>observed[k]===sets[k].length);
  }
  async function reconcile({plan,raw,familyId,childId}){
   const source=expectedState(raw);
   // SQL 021 SAME-source receipt status + SQL 024 receipt-backed content.
   const receipt=await receiptPreview.inspect({
    familyId,childId,sourceSha256:plan.sourceSha256,readEnabled:true
   });
   if(receipt?.status!=='ALREADY_RECEIPTED_SAME_SOURCE')
    return deny('FINAL_RECEIPT_NOT_VERIFIED');
   let settings,history,stocks,purchases,profile;
   try{
    settings=await readHistory.readSettings({familyId,childId});
    history=await readHistory.readAll({familyId,childId,kind:'all',limit:50});
    stocks=await readInventory({familyId,childId});
    purchases=await readPurchases({familyId,childId});
    profile=await readProfile({familyId,childId});
   }catch(_){return deny('CLOUD_READBACK_UNVERIFIED');}
   if(settings?.complete!==true||settings.canEdit!==false
     ||history?.complete!==true||history.hasMore!==false
     ||history.total!==history.rows?.length
     ||!Array.isArray(stocks)||stocks.length!==6
     ||!Array.isArray(purchases)||purchases.length!==0
     ||!object(profile))
    return deny('INCOMPLETE_CLOUD_READBACK');
   const seen=new Set();
   for(const row of stocks){
    if(!row||!SIZES.includes(row.size)||seen.has(row.size)
      ||row.quantity!==source.inventory[row.size]||row.revision!==1)
     return deny('CURRENT_STOCK_BASELINE_MISMATCH');
    seen.add(row.size);
   }
   if(!SIZES.every(s=>seen.has(s))||!assertHistory(history.rows,source))
    return deny('HISTORY_OR_INVENTORY_MISMATCH');
   const expectedSettings={...source};
   for(const k of ['inventory','transactions','quotes','weightRecords','babyProfile'])
    delete expectedSettings[k];
   if(!identical(expectedSettings,settings.settings)
     ||!identical(profile.babyProfile,source.babyProfile)
     ||!identical(profile.babyWeight,source.babyWeight)
     ||!identical(profile.birthDate,source.birthDate)
     ||!identical(profile.dueDate,source.dueDate)
     ||profile.legacySourceSha256!==plan.sourceSha256)
    return deny('PROFILE_SETTINGS_PRICE_MISMATCH');
   // This is a complete comparison of every preserved historical JSON record
   // and setting (including reference-price thousandths and unknown keys).
   return Object.freeze({status:'MIGRATION_FULL_READBACK_MATCH',
    verified:true,cloudWritesAuthorized:false,
    sourceSha256:plan.sourceSha256,historyCount:history.total,
    stockSizes:6,postMigrationNewPurchases:0,
    originalHistoricalPurchasesReplayed:false});
  }
  async function execute(input={}){
   if(busy)return deny('MIGRATION_BUSY');
   // Double interlock: no write path from the current UI or normal build.
   if(cloudWritesEnabled!==true||input.operatorApproved!==true)
    return deny('MIGRATION_WRITES_NOT_AUTHORIZED');
   busy=true;
   try{
    let check;
    try{check=await preflight(input);}
    catch(_){return deny('PRECHECK_UNVERIFIED');}
    if(check.status==='RECEIPTED_SAME_SOURCE_VERIFY_ONLY'){
     // ACK lost previously? Never replay; reconcile existing final data.
     try{return await reconcile(input);}
     catch(_){return deny('EXISTING_RECEIPT_READBACK_FAILED');}
    }
    if(check.status!=='READY_FOR_SEPARATELY_AUTHORIZED_EXECUTION')
     return deny(check.status);
    const {familyId,childId,stageId,migrationId,raw,plan}=input;
    const stage=await rpc('xb_stage_legacy_archive_draft',{
     p_family_id:familyId,p_child_id:childId,
     p_stage_id:stageId,p_export_text:raw
    });
    if(!archived(stage))
     return deny('STOP_STAGE_ACK_UNKNOWN_DO_NOT_REGENERATE_ID');
    const promotion=await rpc('xb_promote_legacy_archive_draft',{
     p_family_id:familyId,p_child_id:childId,
     p_migration_id:migrationId,p_source_sha256:plan.sourceSha256
    });
    if(!promoted(promotion))
     return deny('STOP_PROMOTION_ACK_UNKNOWN_CHECK_RECEIPT_FIRST');
    try{return await reconcile(input);}
    catch(_){return deny('STOP_POST_PROMOTION_READBACK_UNVERIFIED');}
   }finally{busy=false;}
  }
  return Object.freeze({preflight,execute,reconcile,
   get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
 }
 const api=Object.freeze({create});
 if(root)root.XBLegacyMigrationExecutor=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
