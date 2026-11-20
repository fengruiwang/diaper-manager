/* Family-scoped CloudBase client for SQL 028. Writes are opt-in. */
(function(root){
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid=value=>typeof value==='string'&&UUID.test(value);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validRevision=value=>Number.isSafeInteger(value)&&value>=0;
const kinds=new Set(['weight','constipation','postpartum_recovery']);
const outcome=(status,fields={})=>Object.freeze({status,...fields});

function validBody(body){
 if(!isObject(body)||body.schemaVersion!==1||!Array.isArray(body.items))return false;
 const ids=new Set();
 for(const item of body.items){
  if(!isObject(item)||typeof item.id!=='string'||!item.id.trim()||item.id.trim().length>200
    ||ids.has(item.id)||!kinds.has(item.kind)||typeof item.date!=='string'
    ||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(item.date)||item.date.startsWith('0000-'))
   return false;
  const time=Date.parse(item.date+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==item.date)return false;
  if(item.kind==='weight'&&(!Number.isFinite(item.weightKg)||item.weightKg<=0))return false;
  ids.add(item.id);
 }
 return true;
}

function errorStatus(error,status){
 const code=String(error?.code??error?.errorCode??error?.status??status??'');
 if(code==='40001')return 'REVISION_CONFLICT';
 if(code==='23505')return 'REQUEST_ID_CONFLICT';
 if(code==='22023')return 'INVALID_INPUT';
 if(['42501','401','403'].includes(code)||[401,403].includes(Number(status)))
  return 'PERMISSION_DENIED';
 return 'UNKNOWN';
}

function create({controller,cloudWritesEnabled=false}={}){
 if(typeof controller?.verifiedContext!=='function')throw Error('maternal_health:controller_required');
 const writesEnabled=cloudWritesEnabled===true;
 const sameContext=(ctx,current)=>ctx.app===current?.app&&ctx.familyId===current.familyId
  &&ctx.actorUid===current.actorUid;

 async function rpc({familyId,actorUid},name,params,decode){
  try{
   const ctx=controller.verifiedContext();
   if(!isUuid(familyId)||!ctx?.app||ctx.familyId!==familyId
     ||typeof actorUid!=='string'||!actorUid||actorUid!==ctx.actorUid)
    return outcome('PERMISSION_DENIED');
   const session=await ctx.app.auth.getSession();
   if(!session||session.error)return outcome('UNKNOWN');
   const active=session.data?.session;
   const ids=[session.data?.user?.id,active?.user?.id].filter(id=>id!=null);
   if(!active||!ids.length||ids.some(id=>id!==ctx.actorUid)
     ||!sameContext(ctx,controller.verifiedContext()))return outcome('PERMISSION_DENIED');

   const rpcFamilyId=familyId.toLowerCase();
   const response=await ctx.app.rdb().rpc(name,{p_family_id:rpcFamilyId,...params});
   if(!sameContext(ctx,controller.verifiedContext()))return outcome('UNKNOWN');
   if(response?.error||Number(response?.status)>=400)
    return outcome(errorStatus(response.error,response.status));
   const data=Array.isArray(response?.data)&&response.data.length===1
    ?response.data[0]:response?.data;
   if(!isObject(data)||data.family_id!==rpcFamilyId)return outcome('UNKNOWN');
   return decode(data,{familyId,actorUid});
  }catch(error){return outcome(errorStatus(error));}
 }

 function read(scope={}){
  return rpc(scope,'xb_read_maternal_health',{},(data,who)=>
   validRevision(data.revision)&&validBody(data.body)
     &&(data.revision!==0||data.body.items.length===0)
    ?outcome('READ_VERIFIED',{...who,revision:data.revision,body:data.body})
    :outcome('UNKNOWN'));
 }

 function put(input={}){
  if(!writesEnabled)return Promise.resolve(outcome('WRITES_DISABLED'));
  const {requestId,expectedRevision,nextBody}=input;
  let payload;
  try{payload=JSON.parse(JSON.stringify(nextBody));}catch(_){return Promise.resolve(outcome('INVALID_INPUT'));}
  if(!isUuid(requestId)||!validRevision(expectedRevision)
    ||!validRevision(expectedRevision+1)||!validBody(payload))
   return Promise.resolve(outcome('INVALID_INPUT'));
  const id=requestId.toLowerCase();
  return rpc(input,'xb_put_maternal_health',{
   p_request_id:id,p_expected_revision:expectedRevision,p_next_body:payload
  },(data,who)=>data.saved===true&&data.request_id===id
    &&data.revision===expectedRevision+1&&typeof data.duplicate==='boolean'
   ?outcome('COMMITTED',{...who,requestId,revision:data.revision,duplicate:data.duplicate})
   :outcome('UNKNOWN'));
 }

 function checkRequest(input={}){
  const {requestId}=input;
  if(!isUuid(requestId))return Promise.resolve(outcome('INVALID_INPUT'));
  const id=requestId.toLowerCase();
  return rpc(input,'xb_check_maternal_health_request',{p_request_id:id},(data,who)=>{
   if(data.request_id!==id)return outcome('UNKNOWN');
   if(data.status==='NO_RECEIPT'&&data.revision===undefined)
    return outcome('NO_RECEIPT',{...who,requestId});
   if(data.status==='COMMITTED'&&validRevision(data.revision)&&data.revision>0)
    return outcome('COMMITTED',{...who,requestId,revision:data.revision});
   return outcome('UNKNOWN');
  });
 }
 return Object.freeze({read,put,checkRequest,cloudWritesEnabled:writesEnabled});
}

const api=Object.freeze({create,isUuid,validBody});
if(root)root.XBMaternalHealthClient=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
