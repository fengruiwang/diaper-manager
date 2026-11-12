/* Existing backup page upgraded to run the EXISTING strict gate + SQL 022
 * compatibility gap checker. No network, storage writes, cloud SDK or import.
 */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const vault=window.XBLegacyBackupVault;
 const deps={
  vault,strictGate:window.XBStrictMigrationGate,
  contract:window.XBMigrationContract,
  manifest:window.XBLegacyMigrationManifest,
  purchaseAudit:window.XBLegacyPurchaseAudit,
  projection:window.XBLegacyRestoreProjection,
  growth:window.XBGrowth,
  stage022:window.XBLegacyStage022Preflight,
  cryptoProvider:crypto
 };
 let checker=null,newArchive=null,verifiedOriginal=null,busy=false;
 const ensureChecker=()=>checker||(checker=window.XBLegacySingleExportPreflight.create(deps));
 const simple=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{1,90}$/.test(x)?x:'LOCAL_CHECK_FAILED';
 const say=x=>{$('report').textContent=x;};
 const resetBundle=()=>{newArchive=null;$('downloadBundle').disabled=true;};
 const resetRecovery=()=>{verifiedOriginal=null;$('downloadOriginal').disabled=true;};
 const format=result=>{
  if(!result||result.backupIntegrity!=='PASS')return '备份格式 / SHA：未通过\n错误码：'+simple(result?.status)+'\n正式迁移：未授权。';
  const rows=[
   '① 备份格式与 SHA-256：PASS',
   '② 严格迁移门禁：'+(result.strictStatus==='MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED'?'PASS':'REVIEW')+' · '+simple(result.strictStatus),
   '③ 已部署 SQL 022 本地兼容检查：'+(result.sql022Status==='SQL022_LOCAL_SHAPE_PASS'?'PASS':'BLOCKED')+' · '+simple(result.sql022Status),
   '④ 本地综合结论：'+simple(result.status)
  ];
  const c=result.counts;
  if(c){
   rows.push('');rows.push('脱敏计数（不展示任何记录内容）：');
   rows.push('采购 '+c.purchases+' 条 · 消耗 '+c.consumption+' 条 · 候选价 '+c.quotes+' 条');
   rows.push('成长 '+c.growth+' 条 · 自定义参考价 '+c.references+' 项 · 库存尺码 '+c.stockSizes+' 项');
  }
  rows.push('旧版导入归一化差异：'+(result.projectionDifferenceCount===0?'0 项':
   Number.isSafeInteger(result.projectionDifferenceCount)?result.projectionDifferenceCount+' 项':'未取得精确差异数量'));
  if(result.issues?.length){
   rows.push('');rows.push('待处理：');
   for(const item of result.issues){
    rows.push(simple(item.code)+' ['+String(item.section||'unknown_extension').replace(/[^a-zA-Z]/g,'').slice(0,35)+'] ×'+item.count);
   }
  }
  rows.push('');rows.push('真实迁移：未授权 · 未创建 primary · 未上传数据');
  rows.push('如旧版仍在录入，新生成的记录需在未来真实停写后重新导出最终备份。');
  return rows.join('\n');
 };
 function act(button,fn){
  if(busy)return;busy=true;button.disabled=true;
  Promise.resolve().then(fn).catch(_=>say('本地检查未通过：LOCAL_FILE_CHECK_FAILED。未修改原始数据。'))
   .finally(()=>{busy=false;$('protect').disabled=false;$('verify').disabled=false;
    $('downloadBundle').disabled=!newArchive;$('downloadOriginal').disabled=!verifiedOriginal;});
 }
 async function fileText(id,max){
  const file=$(id).files?.[0];
  if(!file||file.size<1||file.size>max)throw Error('SOURCE_FILE_INVALID');
  const rawBytes=new Uint8Array(await file.arrayBuffer());
  const value=new TextDecoder('utf-8',{fatal:true}).decode(rawBytes);
  const reencoded=new TextEncoder().encode(value);
  if(reencoded.length!==rawBytes.length||reencoded.some((n,i)=>n!==rawBytes[i]))
   throw Error('SOURCE_NOT_EXACT_UTF8');
  return value;
 }
 function saveText(value,filename){
  const url=URL.createObjectURL(new Blob([value],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 $('sourceFile').addEventListener('change',()=>{resetBundle();resetRecovery();say('已选择文件，尚未检查。所有处理仅在本地内存。');});
 $('bundleFile').addEventListener('change',()=>{resetRecovery();say('已选择保护副本，尚未校验。');});
 $('protect').addEventListener('click',()=>act($('protect'),async()=>{
  resetBundle();resetRecovery();
  const raw=await fileText('sourceFile',vault.MAX_BYTES);
  const result=await ensureChecker().run(raw,{createdAt:new Date().toISOString()});
  if(result.backupIntegrity==='PASS'){
   newArchive=result.getProtectedArchive();
  }
  say(format(result)+(newArchive?'\n可下载原字节保护副本并重新读取复检。':''));
 }));
 $('downloadBundle').addEventListener('click',()=>{
  if(!newArchive)return;
  saveText(JSON.stringify(newArchive,null,2),'小宝管家_保护副本.json');
  say('保护副本已发起本机下载。请在步骤②重新选择真实下载的文件；未执行恢复或云端迁移。');
 });
 $('verify').addEventListener('click',()=>act($('verify'),async()=>{
  resetRecovery();
  const raw=await fileText('bundleFile',vault.MAX_BYTES*2+1024*1024);
  let archive;
  try{archive=JSON.parse(raw);}catch(_){throw Error('BAD_ARCHIVE');}
  const result=await ensureChecker().verifyProtectedArchive(archive);
  if(result.backupIntegrity==='PASS'&&typeof result.getVerifiedOriginal==='function'){
   verifiedOriginal=result.getVerifiedOriginal();
  }
  say('保护副本重新读取：'+(result.backupIntegrity==='PASS'?'SHA-256 PASS':'FAILED')+'\n'+format(result));
 }));
 $('downloadOriginal').addEventListener('click',()=>{
  if(verifiedOriginal===null)return;
  saveText(verifiedOriginal,'小宝管家_已校验原始备份.json');
  say('原始 JSON 已发起本机下载；该文件未导入旧版，也未上传云端。');
 });
})();
