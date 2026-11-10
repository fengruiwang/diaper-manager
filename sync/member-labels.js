/* XiaoBao v1.2.0: family labels. Pure UI/domain utilities (no storage, no network). */
(function(root){
 'use strict';
 const ROLES=Object.freeze({owner:'管理员',member:'家庭成员'});
 function normalizeAlias(value){
  if(value===null||value===undefined)return null;
  if(typeof value!=='string')throw new TypeError('member_alias_must_be_string');
  const alias=value.trim();
  if(alias==='')return null;
  const chars=Array.from(alias);
  if(chars.length>24)throw new RangeError('member_alias_too_long');
  if(/[\u0000-\u001f\u007f]/u.test(alias))throw new TypeError('member_alias_control_char');
  return alias;
 }
 function displayName(member){
  const alias=normalizeAlias(member?.member_alias);
  return alias || ROLES[member?.member_role] || '家庭成员';
 }
 function displayRole(member){return ROLES[member?.member_role]||'家庭成员'}
 function canEditAlias({selfUid,member,ownerUid}){
  if(!selfUid||!member||typeof member.user_uid!=='string')return false;
  return selfUid===member.user_uid||selfUid===ownerUid;
 }
 const api=Object.freeze({normalizeAlias,displayName,displayRole,canEditAlias});
 if(root)root.XBMemberLabels=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
