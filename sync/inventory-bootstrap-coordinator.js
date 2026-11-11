/* XiaoBao v1.2.0 P2-3E — gated first-local-baseline coordinator.
 * FEATURE/ISOLATED TEST ONLY. Not imported by production v1.1.2.
 * No CloudBase writes or purchase RPC. No network work until explicit call.
 * Real deployment: history clearance verifier is NOT yet implemented.
 * permitIsolatedLocalSeed is OFF by default and MUST NOT be enabled in
 * production until verified server migration receipts and rollback are ready.
 * Even successful local-only initialization NEVER enables uploads.
 */
(function(root){
 'use strict';
 const SIZES=Object.freeze(['NB','S','M','L','XL','XXL']);
 const INVENTORY_TYPES=new Set(['inventory.delta','inventory.count','transaction.reverse']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const MAX_OPS=50;
 function fail(code){throw Error('bootstrap:'+code);}
 function outcome(status,extra={}){
  return Object.freeze({status,uploadAllowed:false,
   localChanged:false,...extra});
 }
 function scopeOf(input){
  if(!input||typeof input!=='object'
   ||typeof input.familyId!=='string'||!UUID.test(input.familyId)
   ||typeof input.childId!=='string'||!UUID.test(input.childId)
   ||typeof input.actorUid!=='string'||!input.actorUid
   ||input.actorUid.length>128)fail('invalid_scope');
  return {familyId:input.familyId,childId:input.childId,actorUid:input.actorUid};
 }
 function exactServer(reply,scope){
  if(!reply||reply.complete!==true||reply.familyId!==scope.familyId
     ||reply.childId!==scope.childId||reply.actorUid!==scope.actorUid
     ||!Array.isArray(reply.checkedOperationIds)
     ||reply.checkedOperationIds.length!==0
     ||!Array.isArray(reply.seenOperationIds)
     ||reply.seenOperationIds.length!==0
     ||!Array.isArray(reply.rows)||reply.rows.length!==6)
   fail('invalid_remote_baseline');
  const inventory={},revisions={};
  for(const row of reply.rows){
   if(!row||!SIZES.includes(row.size)
      ||Object.prototype.hasOwnProperty.call(inventory,row.size)
      ||!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>100000
      ||!Number.isSafeInteger(row.revision)||row.revision<0)
    fail('invalid_remote_baseline');
   inventory[row.size]=row.quantity;
   revisions[row.size]=row.revision;
  }
  if(SIZES.some(x=>!Object.prototype.hasOwnProperty.call(inventory,x)))
   fail('invalid_remote_baseline');
  return {inventory,revisions};
 }
 function sameInventory(a,b){
  return SIZES.every(s=>a.inventory[s]===b.inventory[s]
    &&a.revisions[s]===b.revisions[s]);
 }
 function inspectQueue(rows,scope){
  if(!Array.isArray(rows)||rows.length>MAX_OPS)fail('queue_unverified');
  const seen=new Set();
  let hasChildOperations=false;
  for(const row of rows){
   if(!row||row.familyId!==scope.familyId||row.actorUid!==scope.actorUid
      ||typeof row.id!=='string'||!UUID.test(row.id)||seen.has(row.id)
      ||typeof row.type!=='string'||!row.payload
      ||typeof row.payload!=='object'||Array.isArray(row.payload))
    fail('queue_unverified');
   seen.add(row.id);
   // A malformed inventory operation must never be treated as unrelated
   // just because its child ID is absent.
   if(INVENTORY_TYPES.has(row.type)
      &&(typeof row.payload.childId!=='string'||!UUID.test(row.payload.childId)))
    fail('queue_unverified');
   if(row.payload.childId===scope.childId)hasChildOperations=true;
  }
  // Validate the ENTIRE queue before classifying it as merely nonempty.
  // A corrupt later operation must not be hidden behind an earlier valid one.
  if(hasChildOperations)fail('existing_child_operations');
 }
 function clearanceValid(proof,scope){
  return !!proof&&proof.kind==='verified-server-migration-receipt'
   &&proof.familyId===scope.familyId&&proof.childId===scope.childId
   &&proof.actorUid===scope.actorUid
   &&proof.backupVerified===true&&proof.legacyReconciled===true
   &&proof.receiptsVerified===true;
 }
 function create({verifyAccess,children,outbox,remote,
   verifyHistoryClearance=null,permitIsolatedLocalSeed=false}={}){
  if(typeof verifyAccess!=='function'||!children
      ||typeof children.listActiveChildren!=='function'||!outbox
      ||typeof outbox.list!=='function'
      ||typeof outbox.readInventory!=='function'
      ||typeof outbox.initializeInventory!=='function'
      ||!remote||typeof remote.readReconciliation!=='function'
      ||(verifyHistoryClearance!==null
         &&typeof verifyHistoryClearance!=='function'))
   fail('dependencies_required');
  let busy=false;
  async function initialize(input={}){
   const scope=scopeOf(input);
   if(input.readEnabled!==true)return outcome('disabled');
   if(busy)return outcome('already-running');
   busy=true;
   try{
    let authorization;
    try{authorization=await verifyAccess({
     familyId:scope.familyId,actorUid:scope.actorUid
    });}catch(_){return outcome('authorization-unverified');}
    if(!authorization||authorization.familyId!==scope.familyId
       ||authorization.actorUid!==scope.actorUid
       ||authorization.appCode!=='xb'||authorization.member!==true)
     return outcome('authorization-unverified');

    let active;
    try{active=await children.listActiveChildren({familyId:scope.familyId});}
    catch(_){return outcome('child-read-unverified');}
    if(!active||active.familyId!==scope.familyId
       ||!Array.isArray(active.activeChildren)
       ||active.activeChildren.filter(c=>c?.id===scope.childId).length!==1)
     return outcome('child-not-active-or-test-excluded');

    // The existing v1.1.2 data must NEVER be inferred empty from CloudBase.
    // There is deliberately no production history verifier in this release.
    if(!verifyHistoryClearance)return outcome('history-clearance-required');
    let proof;
    try{proof=await verifyHistoryClearance({...scope});}
    catch(_){return outcome('history-clearance-unverified');}
    if(!clearanceValid(proof,scope))
     return outcome('history-clearance-unverified');

    const localScope={familyId:scope.familyId,actorUid:scope.actorUid};
    try{
     const existing=await outbox.readInventory(localScope,scope.childId);
     if(existing!==null)return outcome('existing-local-snapshot');
     inspectQueue(await outbox.list(localScope,{includeAcked:true}),scope);
    }catch(e){
     if(String(e?.message||'')==='bootstrap:existing_child_operations')
      return outcome('existing-child-queue-preserved');
     return outcome('local-queue-or-snapshot-review-required');
    }

    const read=()=>remote.readReconciliation({
     familyId:scope.familyId,childId:scope.childId,operationIds:[]
    });
    let first,second;
    try{first=exactServer(await read(),scope);
      second=exactServer(await read(),scope);}
    catch(_){return outcome('server-baseline-unverified');}
    if(!sameInventory(first,second))
     return outcome('server-changed-before-bootstrap');

    // This is only a local bootstrap possibility, NEVER a network upload
    // authorization. No write unless two separate explicit opt-ins are set.
    if(input.seedLocal!==true||permitIsolatedLocalSeed!==true)
     return outcome('verified-preview-local-seed-disabled',{
      sixSizesVerified:true,serverChecks:2
     });

    // Re-check auth, legacy receipts and queued local records right before
    // committing, then IDB's own readwrite transaction rejects a newly
    // created snapshot or a newly queued operation in the same identity.
    try{
     authorization=await verifyAccess({familyId:scope.familyId,actorUid:scope.actorUid});
     if(!authorization||authorization.familyId!==scope.familyId
       ||authorization.actorUid!==scope.actorUid
       ||authorization.appCode!=='xb'||authorization.member!==true)
      return outcome('authorization-changed-before-bootstrap');
     proof=await verifyHistoryClearance({...scope});
     if(!clearanceValid(proof,scope))
      return outcome('history-clearance-changed-before-bootstrap');
     inspectQueue(await outbox.list(localScope,{includeAcked:true}),scope);
    }catch(e){
     if(String(e?.message||'')==='bootstrap:existing_child_operations')
      return outcome('existing-child-queue-preserved');
     return outcome('precommit-recheck-unverified');
    }
    try{
     await outbox.initializeInventory(localScope,{
      childId:scope.childId,inventory:second.inventory,
      serverRevisions:second.revisions,source:'verified-server'
     });
    }catch(_){
     return outcome('local-bootstrap-transaction-rejected');
    }
    // The remote may change after a successful IDB transaction; do not
    // overwrite the just-committed snapshot or interpret it as upload-ready.
    try{
     const third=exactServer(await read(),scope);
     if(!sameInventory(second,third))
      return outcome('local-seeded-cloud-changed-review-required',
       {localChanged:true,serverChecks:3});
    }catch(_){
     return outcome('local-seeded-cloud-recheck-unverified',
      {localChanged:true,serverChecks:2});
    }
    return outcome('local-seeded-upload-still-disabled',{
     localChanged:true,sixSizesVerified:true,serverChecks:3
    });
   }finally{busy=false;}
  }
  return Object.freeze({initialize});
 }
 const api=Object.freeze({create,SIZES});
 if(root)root.XBInventoryBootstrapCoordinator=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
