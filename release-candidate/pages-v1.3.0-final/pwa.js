/* V1.3.0 stable PWA shell. No localStorage/IndexedDB mutation or fake backup controls. */
(() => {
 'use strict';
 const el=id=>document.getElementById(id);
 const launch=el('pwaLaunch'),installBtn=el('installPwa'),tip=el('pwaInstallTip');
 const updateNotice=el('pwaUpdateNotice'),updateBtn=el('pwaUpdateNow');
 let registration=null,prompt=null,updating=false;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches
  ||window.navigator.standalone===true;
 function showInstall(){
  if(!launch||!tip)return;
  launch.hidden=standalone();
  tip.textContent=prompt?'可直接安装到桌面':'打开一次，日后可从桌面图标进入';
 }
 window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();prompt=e;showInstall();
 });
 window.addEventListener('appinstalled',()=>{
  prompt=null;if(tip)tip.textContent='已安装到桌面';showInstall();
 });
 if(installBtn)installBtn.addEventListener('click',async()=>{
  if(prompt){
   const p=prompt;prompt=null;
   try{await p.prompt();}catch(_){}
   showInstall();return;
  }
  if(tip)tip.textContent=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')
   ?'在 Safari 中选择分享 → 添加到主屏幕'
   :'在 Chrome 或 Edge 菜单中选择「安装应用」或「添加到主屏幕」';
 });
 showInstall();
 function offerUpdate(){
  if(registration?.waiting&&navigator.serviceWorker?.controller&&updateNotice)
   updateNotice.hidden=false;
 }
 if(updateBtn)updateBtn.addEventListener('click',()=>{
  if(!registration?.waiting||updating)return;
  if(!window.confirm('应用即将重新打开。请先完成当前编辑。新版本不会清除本机旧数据，是否更新？'))
   return;
  updating=true;updateBtn.disabled=true;
  registration.waiting.postMessage({type:'SKIP_WAITING'});
 });
 if(!('serviceWorker' in navigator)||!window.isSecureContext)return;
 let controlledBefore=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(updating&&controlledBefore)window.location.reload();
  controlledBefore=true;
 });
 navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(reg=>{
  registration=reg;offerUpdate();
  reg.addEventListener('updatefound',()=>{
   const worker=reg.installing;
   worker?.addEventListener('statechange',()=>{
    if(worker.state==='installed')offerUpdate();
   });
  });
  const check=()=>{if(navigator.onLine!==false)reg.update().catch(()=>{});};
  window.addEventListener('online',check);
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible')check();
  });
  setInterval(check,6*60*60*1000);
  fetch('./version.json',{cache:'no-store'}).catch(()=>{});
 }).catch(()=>{
  if(tip)tip.textContent='网页可正常使用；当前浏览器未启用 PWA 安装';
 });
})(); 
