/* M3 verified CAS documents overlay: old transactions and stock immutable. */
(function(root){
'use strict';
const kinds=['quotes','reference','growth','profile','settings'];
const settingKeys=['currentSize','sizeMode','autoSize','replenishPolicy','preset',
 'goalPrice','plannedBudget','target','daily'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function fail(code){throw Error('primary_overlay:'+code);}
function records(values){
 if(!Array.isArray(values)||values.length>10000)fail('invalid_items');
 const seen=new Set();
 for(const item of values){
  if(!object(item)||typeof item.id!=='string'||!item.id||seen.has(item.id))
   fail('invalid_item_id');
  seen.add(item.id);
 }
 return clone(values);
}
function apply(original,snapshot){
 if(!original||original.canWrite!==false||original.synthetic===true
   ||!object(original.state)||!object(original.revisions)
   ||!snapshot||snapshot.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
   ||!object(snapshot.documents))fail('unverified_source');
 const docs=snapshot.documents,versions={};
 let family=null,child=null;
 for(const kind of kinds){
  const d=docs[kind];
  if(!d||d.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
    ||d.kind!==kind||!object(d.body)
    ||!Number.isSafeInteger(d.revision)||d.revision<0
    ||typeof d.familyId!=='string'||!d.familyId
    ||typeof d.childId!=='string'||!d.childId)
   fail('document_revision_or_scope_unverified');
  if(family!==null&&(family!==d.familyId||child!==d.childId))
   fail('mixed_family_documents');
  family=d.familyId;child=d.childId;versions[kind]=d.revision;
 }
 // Five documents could be mutually consistent but belong to a different
 // child. Compare with the already receipt-verified primary before overlay.
 if(original.status!=='PRIMARY_READ_ONLY_READY'
    ||original.source!=='cloudbase-primary-receipt-verified'
    ||original.familyId!==family||original.childId!==child
    ||typeof original.actorUid!=='string'||!original.actorUid)
  fail('document_primary_scope_mismatch');
 const state=clone(original.state);
 const inventory=JSON.stringify(state.inventory);
 const transactions=JSON.stringify(state.transactions);
 state.quotes=records(docs.quotes.body.items);
 state.weightRecords=records(docs.growth.body.items);
 const refs=docs.reference.body.referenceOverrides;
 if(!object(refs))fail('invalid_reference_prices');
 for(const value of Object.values(refs)){
  if(typeof value!=='number'||!Number.isFinite(value)
    ||value<=0||value>100
    ||Math.abs(value*1000-Math.round(value*1000))>1e-7)
   fail('invalid_reference_prices');
 }
 state.referenceOverrides=clone(refs);
 const settings=docs.settings.body,profile=docs.profile.body;
 if(!object(settings.target)||!object(settings.daily)
   ||!object(profile.babyProfile))fail('invalid_profile_settings');
 for(const key of settingKeys){
  if(Object.prototype.hasOwnProperty.call(settings,key))state[key]=clone(settings[key]);
 }
 state.babyProfile=clone(profile.babyProfile);
 for(const key of ['dueDate','birthDate','babyWeight']){
  if(Object.prototype.hasOwnProperty.call(profile,key))state[key]=clone(profile[key]);
 }
 if(JSON.stringify(state.inventory)!==inventory
   ||JSON.stringify(state.transactions)!==transactions)
  fail('historical_inventory_mutated');
 return Object.freeze({...original,state:Object.freeze(state),
  documentRevisions:Object.freeze(versions),
  sharedBusinessDocumentsVerified:true,historyLedgerPreserved:true,
  cloudDocumentsActorScope:Object.freeze({familyId:family,childId:child})
 });
}
const api=Object.freeze({apply});
if(root)root.XBPrimaryDocumentsOverlay=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
