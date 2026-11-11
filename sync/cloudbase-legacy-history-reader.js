/* XiaoBao v1.2.0 P2-4F-A: explicit read-only legacy history/settings.
 * SQL 024 is UNDEPLOYED. This module MUST NOT be loaded in production v1.1.2.
 * No auto login/network/storage at module initialization; every call is
 * explicit and an existing authenticated session is required. Database RPC
 * enforces family membership and a verified, committed migration receipt.
 * Imported buys/uses/quotes NEVER become inventory commands here.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const KINDS=new Set(['all','transaction','quote','weight']);
 const ROW_KINDS=new Set(['transaction','quote','weight']);
 function fail(code){throw new Error('legacy_history_reader:'+code);}
 function id(value,name){
  if(typeof value!=='string'||!UUID.test(value))fail('invalid_'+name);
  return value;
 }
 function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'
      ||typeof app.rdb!=='function')fail('sdk_required');
  const db=app.rdb();
  if(!db||typeof db.rpc!=='function')fail('rpc_required');
  async function session(){
   let res;
   try{res=await app.auth.getSession();}
   catch(_){fail('session_unavailable');}
   if(!res||res.error)fail('session_unavailable');
   if(!res.data?.session)fail('login_required');
   const users=[res.data.user?.id,res.data.session.user?.id]
     .filter(x=>x!==undefined&&x!==null);
   if(!users.length||users.some(u=>typeof u!=='string'||!u||u.length>128)
      ||new Set(users).size!==1)fail('identity_unverified');
  }
  async function rpc(name,params){
   let result;
   try{result=await db.rpc(name,params);}
   catch(_){fail('cloud_read_failed');}
   if(!result||result.error){
    const code=String(result?.error?.code||result?.error?.errorCode||'');
    if(code==='42501'||code==='DATABASE_42501')fail('permission_denied');
    fail('cloud_read_failed');
   }
   const data=Array.isArray(result.data)?
       (result.data.length===1?result.data[0]:null):result.data;
   if(!isObject(data))fail('invalid_server_response');
   return data;
  }
  async function readPage({familyId,childId,kind='all',offset=0,limit=20}={}){
   const family=id(familyId,'family_id'),child=id(childId,'child_id');
   if(!KINDS.has(kind)||!Number.isSafeInteger(offset)||offset<0||offset>10000
      ||!Number.isSafeInteger(limit)||limit<1||limit>50)
    fail('invalid_page_request');
   await session();
   const data=await rpc('xb_read_legacy_history_page_draft',{
    p_family_id:family,p_child_id:child,p_record_kind:kind,
    p_offset:offset,p_limit:limit
   });
   if(data.complete!==true||data.can_edit!==false||data.can_upload!==false
      ||data.record_kind!==kind||data.offset!==offset||data.limit!==limit
      ||!Number.isSafeInteger(data.total)||data.total<0||data.total>30000
      ||typeof data.has_more!=='boolean'||!Array.isArray(data.rows)
      ||data.rows.length>limit)
    fail('invalid_history_page');
   if(data.has_more!==(offset+data.rows.length<data.total)
      ||data.rows.length!==Math.min(limit,Math.max(0,data.total-offset)))
    fail('history_page_incomplete');
   let prevKey='',prevOrdinal=0,prevId='',seen=new Set();
   const rows=data.rows.map(row=>{
    if(!isObject(row)||!ROW_KINDS.has(row.kind)
       ||(kind!=='all'&&row.kind!==kind)
       ||typeof row.id!=='string'||row.id.length<1||row.id.length>200
       ||!Number.isSafeInteger(row.ordinal)||row.ordinal<1||row.ordinal>10000
       ||!isObject(row.payload)||row.payload.id!==row.id)
     fail('invalid_history_row');
    const duplicate=row.kind+'\x00'+row.id;
    if(seen.has(duplicate))fail('duplicate_history_row');
    seen.add(duplicate);
    if(row.kind<prevKey||
        (row.kind===prevKey&&(row.ordinal<prevOrdinal||
          row.ordinal===prevOrdinal&&row.id<=prevId)))
     fail('unordered_history_rows');
    prevKey=row.kind;prevOrdinal=row.ordinal;prevId=row.id;
    return Object.freeze({
     kind:row.kind,id:row.id,ordinal:row.ordinal,payload:row.payload
    });
   });
   return Object.freeze({
    complete:true,kind,offset,limit,total:data.total,
    hasMore:data.has_more,rows:Object.freeze(rows),
    canEdit:false,canUpload:false
   });
  }
  async function readSettings({familyId,childId}={}){
   const family=id(familyId,'family_id'),child=id(childId,'child_id');
   await session();
   const data=await rpc('xb_read_legacy_settings_draft',{
    p_family_id:family,p_child_id:child
   });
   if(data.complete!==true||data.can_edit!==false||data.can_upload!==false
      ||!Number.isSafeInteger(data.revision)||data.revision<0
      ||!isObject(data.settings)
      ||!isObject(data.settings.referenceOverrides)
      ||!isObject(data.settings.target)
      ||!isObject(data.settings.daily))
    fail('invalid_settings_response');
   return Object.freeze({
    complete:true,revision:data.revision,settings:data.settings,
    canEdit:false,canUpload:false
   });
  }
  return Object.freeze({readPage,readSettings});
 }
 const api=Object.freeze({create});
 if(root)root.XBLegacyHistoryReader=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
