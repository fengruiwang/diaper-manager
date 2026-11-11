/* Local-only UI for existing exported v1.1.2 backup files.
 * No network, CloudBase SDK, localStorage, IndexedDB or automatic import.
 */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const vault=window.XBLegacyBackupVault;
 let newArchive=null,verifiedArchive=null,busy=false;
 const safe=error=>{
  const code=String(error&&error.message||'');
  return /^legacy_vault:[a-z_]+$/.test(code)?code:'LOCAL_FILE_CHECK_FAILED';
 };
 function say(value){$('report').textContent=value;}
 function resetBundle(){newArchive=null;$('downloadBundle').disabled=true;}
 function resetRecovery(){verifiedArchive=null;$('downloadOriginal').disabled=true;}
 function action(button,fn){
  if(busy)return;
  busy=true;button.disabled=true;
  Promise.resolve().then(fn).catch(error=>{
   say('未通过：'+safe(error)+'。\n未修改任何正式数据；可检查文件后重试。');
  }).finally(()=>{
   busy=false;
   $('protect').disabled=false;
   $('verify').disabled=false;
   $('downloadBundle').disabled=!newArchive;
   $('downloadOriginal').disabled=!verifiedArchive;
  });
 }
 async function fileText(id,maxBytes){
  const file=$(id).files&&$(id).files[0];
  if(!file)throw Error('legacy_vault:file_required');
  if(file.size<1||file.size>maxBytes)
   throw Error('legacy_vault:file_size_invalid');
  return file.text();
 }
 function saveText(value,filename){
  const url=URL.createObjectURL(new Blob([value],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 function time(){
  const d=new Date();
  return d.toISOString();
 }
 $('sourceFile').addEventListener('change',()=>{
  resetBundle();resetRecovery();
  say('已选择原始备份文件；尚未进行校验，不会上传内容。');
 });
 $('bundleFile').addEventListener('change',()=>{
  resetRecovery();
  say('已选择保护副本；点击验证后才能恢复原始文件。');
 });
 $('protect').addEventListener('click',()=>action($('protect'),async()=>{
  resetBundle();resetRecovery();
  if(!vault)throw Error('legacy_vault:module_missing');
  const raw=await fileText('sourceFile',vault.MAX_BYTES);
  const pending=await vault.createFromExport(raw,{createdAt:time(),cryptoProvider:crypto});
  const preview=await vault.verify(pending,{cryptoProvider:crypto});
  newArchive=pending; // Only enable download after successful local self-check.
  say('原始导出文件：格式正确。\n保护副本：生成并自检 PASS。\n完整性校验：SHA-256。\n可恢复原始文件：'+preview.recoveryPreview+
   '。\n正式云端迁移：仍未授权。\n下一步：下载保护副本，然后重新选择该文件验证。');
 }));
 $('downloadBundle').addEventListener('click',()=>{
  if(!newArchive)return;
  const date=newArchive.createdAt.slice(0,10);
  saveText(JSON.stringify(newArchive,null,2),'小宝管家_历史保护副本_'+date+'.json');
  say('保护副本已发起本地下载。请务必在“②”重新选择下载后的文件核验。\n原来的 JSON 备份仍然需要单独保管。');
 });
 $('verify').addEventListener('click',()=>action($('verify'),async()=>{
  resetRecovery();
  if(!vault)throw Error('legacy_vault:module_missing');
  const raw=await fileText('bundleFile',vault.MAX_BYTES*2+1024*1024);
  let archive;
  try{archive=JSON.parse(raw);}catch(_){throw Error('legacy_vault:archive_format_invalid');}
  const checked=await vault.verify(archive,{cryptoProvider:crypto});
  if(checked.integrity!=='PASS')throw Error('legacy_vault:archive_checksum_mismatch');
  verifiedArchive=archive;
  say('保护副本核验 PASS。\n原始文件字节长度：'+checked.byteLength+
   '。\nSHA-256 校验：一致。\n原始备份完整恢复预览：PASS。'+
   '\n不会自动覆盖原有库存、采购或参考价。\n真实云端迁移：仍然禁止。');
 }));
 $('downloadOriginal').addEventListener('click',()=>action($('downloadOriginal'),async()=>{
  if(!verifiedArchive)throw Error('legacy_vault:verification_required');
  const text=await vault.extractVerifiedOriginal(verifiedArchive,{cryptoProvider:crypto});
  saveText(text,'小宝管家_已校验原始备份.json');
  say('已发起原始导出备份文件的本地下载。\n没有将数据写入小宝管家或腾讯云。\n请与原始备份分开保存；不要在当前正式版里直接尝试恢复覆盖。');
 }));
})();
