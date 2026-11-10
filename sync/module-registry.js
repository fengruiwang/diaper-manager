/* v1.2.0 module registry. Declarative only: NO DB schema or network side effects. */
(function(root){
 'use strict';
 const MODULES=Object.freeze({
  children:Object.freeze({scope:'child',phase:'v1.2.0',table:'xb_children',sync:'versioned'}),
  diaper:Object.freeze({scope:'child',phase:'v1.2.0',table:'xb_inventory_operations',sync:'ledger'}),
  growth:Object.freeze({scope:'child',phase:'v1.2.0',table:'xb_weight_records',sync:'versioned'}),
  price:Object.freeze({scope:'family',phase:'v1.2.0',table:'xb_quotes',sync:'versioned'}),
  preferences:Object.freeze({scope:'family',phase:'v1.2.0',table:'xb_settings',sync:'versioned'}),
  feeding:Object.freeze({scope:'child',phase:'future',table:'xb_feeding_records',sync:'versioned'}),
  vaccination:Object.freeze({scope:'child',phase:'future',table:'xb_vaccination_records',sync:'versioned'}),
  reminders:Object.freeze({scope:'child',phase:'future',table:'xb_reminders',sync:'versioned'}),
  sleep:Object.freeze({scope:'child',phase:'future',table:'xb_sleep_sessions',sync:'versioned'})
 });
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function moduleFor(name){return MODULES[name]||null}
 function envelope({app='xb',module,familyId,childId=null,operationId,actorUid,payload,version=1}){
  const m=moduleFor(module);
  if(app!=='xb'||!m)throw new Error('module_contract: unknown_module');
  if(!UUID.test(String(familyId))||!UUID.test(String(operationId)))throw new Error('module_contract: invalid_ids');
  if(m.scope==='child'&&!UUID.test(String(childId)))throw new Error('module_contract: child_id_required');
  if(m.scope==='family'&&childId!==null)throw new Error('module_contract: unexpected_child_id');
  if(typeof actorUid!=='string'||!actorUid||actorUid.length>128)throw new Error('module_contract: invalid_actor_uid');
  if(!payload||Array.isArray(payload)||typeof payload!=='object')throw new Error('module_contract: invalid_payload');
  if(!Number.isSafeInteger(version)||version<1)throw new Error('module_contract: invalid_version');
  return {app,module,familyId,childId,operationId,actorUid,version,payload:JSON.parse(JSON.stringify(payload))};
 }
 const api=Object.freeze({MODULES,moduleFor,envelope});
 if(root)root.XBModuleRegistry=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
