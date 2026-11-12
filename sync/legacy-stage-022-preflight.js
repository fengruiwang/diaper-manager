/* XiaoBao 022 server-stage compatibility GAP checker (local, read-only).
 * This is intentionally NOT another business validator. Run the existing
 * strict-migration-gate first. This checks the server-only constraints that
 * the existing client gate does not fully enforce, including raw JSON keys.
 * It never authorizes a stage, primary creation, upload, or cloud write.
 */
(function(root){
 'use strict';
 const PROFILE=['name','sex','birthTime','birthWeight','birthLength'];
 const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const answer=(code,issues)=>Object.freeze({
  status:issues.length?'SQL022_COMPATIBILITY_BLOCKED':'SQL022_LOCAL_SHAPE_PASS',
  code,issues:Object.freeze(issues.map(x=>Object.freeze(x))),
  canUpload:false,canCommit:false,serverVerified:false
 });
 // SQL 022 invokes xb_v1_unique_json_keys(original::json) before jsonb cast.
 // JSON.parse discards duplicate keys, so preserve a *lexical* scan here.
 // The parser intentionally inspects only JSON syntax/keys, never values.
 function scanRawKeys(raw){
  let i=0;const n=raw.length;
  const white=()=>{while(i<n&&/\s/.test(raw[i]))i++;};
  function word(){
   if(raw[i]!=='"')throw Error('SQL022_INVALID_JSON');
   const start=i++;
   let escape=false;
   while(i<n){
    const ch=raw[i++];
    if(escape){escape=false;continue;}
    if(ch==='\\'){escape=true;continue;}
    if(ch==='"')return JSON.parse(raw.slice(start,i));
   }
   throw Error('SQL022_INVALID_JSON');
  }
  function value(depth){
   if(depth>32)throw Error('SQL022_JSON_DEPTH_EXCEEDED');
   white();const c=raw[i];
   if(c==='{'){
    i++;white();const names=new Set();
    if(raw[i]==='}') {i++;return;}
    while(i<n){
     white();const key=word();
     if(names.has(key))throw Error('SQL022_DUPLICATE_JSON_KEY');
     names.add(key);white();if(raw[i++]!==':')throw Error('SQL022_INVALID_JSON');
     value(depth+1);white();
     if(raw[i]==='}') {i++;return;}
     if(raw[i++]!==',')throw Error('SQL022_INVALID_JSON');
    }
   }else if(c==='['){
    i++;white();if(raw[i]===']'){i++;return;}
    while(i<n){value(depth+1);white();if(raw[i]===']'){i++;return;}
     if(raw[i++]!==',')throw Error('SQL022_INVALID_JSON');}
   }else if(c==='"'){word();return;}
   else {
    const rest=raw.slice(i),m=/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(rest);
    if(!m)throw Error('SQL022_INVALID_JSON');i+=m[0].length;return;
   }
   throw Error('SQL022_INVALID_JSON');
  }
  value(0);white();if(i!==n)throw Error('SQL022_INVALID_JSON');
 }
 const problem=(section,code)=>({section,code});
 function review(raw){
  const issues=[];let exported;
  if(typeof raw!=='string'||!raw.length)return answer('INVALID_SOURCE',[problem('source','SQL022_SOURCE_REQUIRED')]);
  try{scanRawKeys(raw);}catch(e){
   const code=['SQL022_DUPLICATE_JSON_KEY','SQL022_JSON_DEPTH_EXCEEDED'].includes(e?.message)
    ?e.message:'SQL022_INVALID_JSON';
   issues.push(problem('source',code));
  }
  try{exported=JSON.parse(raw);}catch(_){
   if(!issues.length)issues.push(problem('source','SQL022_INVALID_JSON'));
   return answer('INVALID_SOURCE',issues);
  }
  if(!object(exported)||Object.keys(exported).length!==4
    ||!['app','version','exportedAt','data'].every(k=>has(exported,k)))
   issues.push(problem('envelope','SQL022_ENVELOPE_EXACT_FOUR_KEYS_REQUIRED'));
  const d=exported?.data;
  if(!object(d))return answer('INVALID_STATE',[...issues,problem('source','SQL022_STATE_OBJECT_REQUIRED')]);
  const p=d.babyProfile;
  if(!object(p))issues.push(problem('babyProfile','SQL022_PROFILE_OBJECT_REQUIRED'));
  else {
   for(const key of PROFILE){
    if(!has(p,key))issues.push(problem('babyProfile','SQL022_PROFILE_FIELD_MISSING'));
    else if(typeof p[key]!=='string')issues.push(problem('babyProfile','SQL022_PROFILE_FIELD_NOT_STRING'));
   }
   if(Object.keys(p).some(k=>!PROFILE.includes(k)))
    issues.push(problem('babyProfile','SQL022_PROFILE_UNKNOWN_FIELD'));
   if(typeof p.name==='string'&&(!p.name.trim()||p.name.trim().length>80))
    issues.push(problem('babyProfile','SQL022_PROFILE_NAME_INVALID'));
  }
  if(typeof d.babyWeight!=='string')
   issues.push(problem('babyWeight','SQL022_BABY_WEIGHT_NOT_STRING'));
  if(!object(d.replenishPolicy)||typeof d.replenishPolicy.mode!=='string'
   ||typeof d.replenishPolicy.days!=='number')
   issues.push(problem('replenishPolicy','SQL022_POLICY_VALUE_TYPE_MISMATCH'));
  for(const name of ['transactions','quotes','weightRecords']){
   if(!Array.isArray(d[name]))issues.push(problem(name,'SQL022_RECORD_COLLECTION_REQUIRED'));
  }
  return answer('SQL022_LOCAL_GAP_CHECK',issues);
 }
 const api=Object.freeze({review});
 if(root)root.XBLegacyStage022Preflight=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
