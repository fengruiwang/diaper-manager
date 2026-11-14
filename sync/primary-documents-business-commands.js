/* M3 domain commands for A/B shared CAS documents.
 * Uses existing document SDK read + durable command queue. Original migration
 * history entries remain untouched by quote/growth corrections.
 * Not loaded by any accepted M3 synthetic preview or production V1.1.2.
 */
(function(root){
'use strict';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const reply=(status,extra={})=>Object.freeze({status,...extra});
const sizeSet=new Set(['NB','S','M','L','XL','XXL']);
function create({client,queue,uuid}={}){
 if(!client?.read||!queue?.queue||!queue?.pending||typeof uuid!=='function')
  throw Error('document_commands:dependencies_required');
 let busy=false;
 function transform(kind,action,body,record){
  const next=clone(body);
  if(kind==='quotes'||kind==='growth'){
   if(!Array.isArray(next.items))throw Error('invalid_list');
   if(action==='clear'){
    if(kind!=='quotes')throw Error('unsupported_list_action');
    next.items=[];
    return next;
   }
   if(!object(record))throw Error('invalid_record');
   if(action==='add'){
    if(typeof record.id!=='string'||!record.id
      ||next.items.some(x=>x.id===record.id))throw Error('duplicate_record');
    next.items.push(clone(record));
   }else if(action==='edit'){
    const index=next.items.findIndex(x=>x.id===record.id);
    if(index<0)throw Error('record_missing');
    // Preserve all unknown fields from the originally migrated record.
    next.items[index]={...next.items[index],...clone(record)};
   }else if(action==='delete'){
    const index=next.items.findIndex(x=>x.id===record.id);
    if(index<0)throw Error('record_missing');
    next.items.splice(index,1);
   }else throw Error('unsupported_list_action');
  }else if(kind==='reference'){
   if(!object(next.referenceOverrides)||!record?.key)
    throw Error('invalid_reference');
   if(action==='reset')delete next.referenceOverrides[record.key];
   else if(action==='set'){
    if(typeof record.value!=='number'||!Number.isFinite(record.value)
      ||record.value<=0||record.value>100
      ||Math.abs(record.value*1000-Math.round(record.value*1000))>1e-7)
     throw Error('reference_precision');
    next.referenceOverrides[record.key]=record.value;
   }else throw Error('unsupported_reference_action');
  }else if(kind==='settings'){
   if(action!=='patch'||!object(record))throw Error('invalid_settings');
   const editable=new Set(['currentSize','sizeMode','autoSize','replenishPolicy',
    'preset','goalPrice','plannedBudget','target','daily']);
   for(const [k,v] of Object.entries(record)){
    if(!editable.has(k))throw Error('unknown_edit_field');
    if((k==='target'||k==='daily')&&!object(v))
     throw Error('invalid_settings');
    next[k]=clone(v);
   }
   if(!object(next.target)||!object(next.daily))
    throw Error('invalid_settings');
   for(const k of ['target','daily']){
    for(const [sz,val] of Object.entries(next[k])){
     if(!sizeSet.has(sz)||!Number.isSafeInteger(val)||val<0
       ||(k==='daily'&&val<1))throw Error('invalid_settings');
    }
   }
  }else if(kind==='profile'){
   if(action!=='patch'||!object(record))throw Error('invalid_profile');
   const editable=new Set(['babyProfile','dueDate','birthDate','babyWeight']);
   for(const [k,v] of Object.entries(record)){
    if(!editable.has(k))throw Error('unknown_edit_field');
    if(k==='babyProfile'){
     if(!object(v))throw Error('invalid_profile');
     next.babyProfile={...next.babyProfile,...clone(v)};
    }else next[k]=clone(v);
   }
  }else throw Error('unknown_document_kind');
  return next;
 }
 async function submit({familyId,actorUid,kind,action,record,
  expectedRevision=null,operatorApproved=false}={}){
  if(queue.cloudWritesEnabled!==true||operatorApproved!==true)
   return reply('DOCUMENT_WRITES_NOT_AUTHORIZED');
  if(busy)return reply('BUSY');
  busy=true;
  try{
   // Do not issue a second request while a prior ACK or conflict is unsettled.
   const wait=await queue.pending();
   if(wait.status!=='DOCUMENT_QUEUE_COUNTS_VERIFIED'
     ||wait.outstanding>0)
    return reply('DOCUMENT_PENDING_REVIEW_REQUIRED');
   const read=await client.read({familyId,actorUid,kind,readEnabled:true});
   if(read.status!=='PRIMARY_DOCUMENT_READ_VERIFIED')
    return reply('DOCUMENT_BASELINE_UNVERIFIED');
   // For on-screen reference/quote edits, use the revision that was
   // actually displayed; never substitute a newly advanced revision.
   if((kind==='reference'||kind==='quotes')&&(expectedRevision===null
     ||!Number.isSafeInteger(expectedRevision)||expectedRevision<0))
    return reply(kind==='quotes'?'QUOTES_DISPLAYED_BASELINE_REQUIRED':
     'REFERENCE_DISPLAYED_BASELINE_REQUIRED');
   if(expectedRevision!==null&&read.revision!==expectedRevision)
    return reply('DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
   const body=transform(kind,action,read.body,record);
   const requestId=uuid();
   const saved=await queue.queue({kind,nextBody:body,
    expectedRevision:read.revision,requestId,operatorApproved:true,
    action});
   return reply(saved.status,{
    requestId:saved.requestId||requestId,cloudWriteCommitted:false
   });
  }catch(_){return reply('DOCUMENT_COMMAND_REJECTED');}
  finally{busy=false;}
 }
 return Object.freeze({submit,transform});
}
const api=Object.freeze({create});
if(root)root.XBPrimaryDocumentsBusinessCommands=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
