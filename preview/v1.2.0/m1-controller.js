/* M1-01 - CloudBase-connected but STRICTLY READ-ONLY independent V1.2.0 app preview.
 * Reuses existing CloudBase and V1.1.2 UI modules embedded in preview/index.html.
 * Purchase, stock, settings edits in this preview are LOCAL SANDBOX ONLY.
 * No createChild, applyOperation, migration, IDB write or RPC DML allowed here.
 */
(function(root){
 'use strict';
 const ENV_ID='f495637659-d2gnuzz2jf5657da8'; // Existing verified PUBLIC environment identifier
 const KEY_NAME='xiaobao_v120_m1_preview_public_key';
 // Public anon-role key, intended for frontend use; NOT a service-role API secret.
 const DEFAULT_PUBLIC_KEY='eyJhbGciOiJSUzI1NiIsImtpZCI6ImY0NWE0ZTE1LWFkZjEtNDdmYi1iODEzLTY2MzRiOWFjZGE5NiJ9.eyJpc3MiOiJodHRwczovL2Y0OTU2Mzc2NTktZDJnbnV6ejJqZjU2NTdkYTguYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6ImY0OTU2Mzc2NTktZDJnbnV6ejJqZjU2NTdkYTgiLCJleHAiOjQwOTc5NzI1OTgsImlhdCI6MTc5NDI4OTM5OCwibm9uY2UiOiJuc1dON2dqSlJvbWFLOG1VWWF0OHl3IiwiYXRfaGFzaCI6Im5zV043Z2pKUm9tYUs4bVVZYXQ4eXciLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoiZjQ5NTYzNzY1OS1kMmdudXp6MmpmNTY1N2RhOCIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.a5QWbOEnmtwX-ObV8jbsAamCQgWyAZMgqiJbUxUWbYFfmP-tHVBwFqUScAUdnXggT0K5oQkkSgBquj8FT_m6dKs57h2NCSk0Rz1O6pa21Dztu0kWOL7IGBZ-W4LKL2DgafmtUZah5_wxM1jnfYSM4MBC2stMxRUAI5BC5-nWZZzkbJij5otS7ZZxZ7m2facJgODfnaE5NFyE2Li_IG_awfUCYmaTWOarCAivSNIsuozlDN8Pa56Ka_lQjN5AyoUjYcHzG0IJieZrLnloI9qJl0VAABaT5q7H2o5bKh4F38szNpq3De_xTdc8mgLOeuLPGqTgTNrhjCMjJskZWZ6FPQ';
 const SDK_URLS=[
  'https://static.cloudbase.net/cloudbase-js-sdk/3.0.1/cloudbase.full.js',
  'https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js'
 ];
 const SIZES=['NB','S','M','L','XL','XXL'];
 function safeCode(e){
  const str=String(e&&e.message||'');
  const m=/^(?:access_preflight|child_reader|inventory_client|family_client|session_recovery):[ _a-z0-9]+$/.exec(str);
  return m?str.replace(/\s+/g,'_'):'CLOUD_REQUEST_UNVERIFIED';
 }
 function sessionUid(result){
  const d=result&&result.data;
  if(!d||!d.session)return null;
  const ids=[d.user&&d.user.id,d.session.user&&d.session.user.id].filter(x=>x!=null);
  if(ids.length===0||ids.some(x=>typeof x!=='string'||!x||x.length>128)
     ||new Set(ids).size!==1)return null;
  return ids[0];
 }
 function parsePublicKey(configValue,storedValue){
  const key=String(configValue||storedValue||'').trim();
  if(!key||key.length>2048||/[\s<>"']/.test(key))return '';
  return key;
 }
 function create({host,storage,view,scriptLoader}={}){
  if(!host||!view||typeof view.status!=='function'||typeof scriptLoader!=='function')
   throw Error('m1:dependencies_required');
  let app=null,familyClient=null,sessionRecovery=null,busy=false;
  let familyId=null,activeChildId=null,actorUid=null,verifiedFamily=false;
  const getKey=()=>{
   let cached='';
   try{cached=storage&&storage.getItem(KEY_NAME)||'';}catch(_){}
   const cfg=host.XBM1PublicConfig||null;
   return parsePublicKey(cfg&&cfg.publishableKey||DEFAULT_PUBLIC_KEY,cached);
  };
  function emit(code,detail){
   view.status(code,detail||'');
   return code;
  }
  async function sdk(){
   if(host.cloudbase&&typeof host.cloudbase.init==='function')return host.cloudbase;
   for(const url of SDK_URLS){
    try{
     await scriptLoader(url);
     if(host.cloudbase&&typeof host.cloudbase.init==='function')return host.cloudbase;
    }catch(_){}
   }
   throw Error('m1:sdk_unavailable');
  }
  async function connect(){
   if(busy)return 'BUSY';
   const key=getKey();
   if(!key){view.needsKey(true);return emit('CONFIG_REQUIRED');}
   if(app)return checkSession();
   busy=true;emit('CONNECTING');
   try{
    const sdkInstance=await sdk();
    app=sdkInstance.init({env:ENV_ID,accessKey:key,timeout:15000});
    if(!app||!app.auth||typeof app.auth.getSession!=='function'||typeof app.rdb!=='function')
     throw Error('m1:invalid_cloudbase_sdk');
    familyClient=host.XBCloudbaseFamilyClient.create(app);
    sessionRecovery=host.XBSessionRecovery.create({auth:app.auth});
    view.needsKey(false);
    busy=false;
    return checkSession();
   }catch(_){
    app=null;familyClient=null;sessionRecovery=null;
    return emit('CONNECT_FAILED');
   }finally{busy=false;}
  }
  async function checkSession(){
   if(!app||!sessionRecovery)return emit('CONFIG_REQUIRED');
   if(host.navigator&&host.navigator.onLine===false){
    view.cloudStock(null);
    return emit('OFFLINE_LOCAL_ONLY');
   }
   try{
    const recovered=await sessionRecovery.restore({online:true});
    if(recovered.status==='auth-required'){
     familyId=null;actorUid=null;activeChildId=null;verifiedFamily=false;
     view.identity(false);view.cloudStock(null);
     return emit('LOGIN_REQUIRED');
    }
    if(recovered.status!=='authenticated'){
     view.cloudStock(null);
     return emit('SESSION_UNVERIFIED');
    }
    const s=await app.auth.getSession();
    actorUid=sessionUid(s);
    if(!actorUid){
     view.identity(false);view.cloudStock(null);
     return emit('IDENTITY_UNVERIFIED');
    }
    view.identity(true);
    return readFamily();
   }catch(e){
    view.cloudStock(null);
    return emit('SESSION_UNVERIFIED',safeCode(e));
   }
  }
  async function readFamily(){
   verifiedFamily=false;
   if(!app||!actorUid)return emit('LOGIN_REQUIRED');
   try{
    const db=app.rdb();
    const found=await db.from('families').select('id').limit(2);
    if(found&&found.error)throw Error('m1:family_query_failed');
    const families=found&&found.data;
    if(!Array.isArray(families)||families.length!==1){
     familyId=null;activeChildId=null;view.cloudStock(null);
     return emit(families&&families.length===0?'NO_VISIBLE_FAMILY':'FAMILY_REVIEW_REQUIRED');
    }
    familyId=families[0].id;
    const access=host.XBCloudbaseAccessPreflight.create(app);
    const verification=await access.verifyAccess({familyId,actorUid});
    if(!verification.member||verification.appCode!=='xb'){
     familyId=null;return emit('FAMILY_PERMISSION_DENIED');
    }
    verifiedFamily=true;
    const reader=host.XBCloudbaseChildReader.create(app,host.XBChildScopeGuard);
    const children=await reader.listActiveChildren({familyId});
    view.family(true,children.activeChildren.length);
    if(!children.activeChildren.length){
     activeChildId=null;view.cloudStock(null);
     return emit('FAMILY_READY_NO_BUSINESS_CHILD');
    }
    // Do not pick a child silently if several real children are active.
    if(children.activeChildren.length!==1){
     activeChildId=null;view.cloudStock(null);
     return emit('CHILD_SELECTION_REQUIRED');
    }
    activeChildId=children.activeChildren[0].id;
    const inventory=host.XBInventoryClient.create(app);
    const response=await inventory.readReconciliation({
     familyId,childId:activeChildId,operationIds:[]
    });
    if(!response||response.complete!==true||response.actorUid!==actorUid
       ||!Array.isArray(response.rows)||response.rows.length!==6)
     throw Error('m1:invalid_stock_response');
    const foundSizes=new Set();
    for(const row of response.rows){
     if(!SIZES.includes(row.size)||foundSizes.has(row.size)
        ||!Number.isSafeInteger(row.quantity)||row.quantity<0
        ||!Number.isSafeInteger(row.revision)||row.revision<0)
      throw Error('m1:invalid_stock_row');
     foundSizes.add(row.size);
    }
    view.cloudStock(response.rows.map(x=>({
     size:x.size,quantity:x.quantity,revision:x.revision
    })));
    return emit('CLOUD_READ_ONLY_CONNECTED');
   }catch(e){
    verifiedFamily=false;
    view.family(false,0);view.cloudStock(null);
    return emit('CLOUD_READ_UNVERIFIED',safeCode(e));
   }
  }
  async function requestOtp(email){
   if(!familyClient)return emit('CONFIG_REQUIRED');
   if(!email||typeof email!=='string')return emit('EMAIL_REQUIRED');
   try{await familyClient.requestCode(email);return emit('OTP_REQUESTED');}
   catch(e){return emit('OTP_REQUEST_FAILED',safeCode(e));}
  }
  async function confirmOtp(code){
   if(!familyClient)return emit('CONFIG_REQUIRED');
   try{
    await familyClient.confirmCode(code);
    return checkSession();
   }catch(e){return emit('OTP_INVALID_OR_EXPIRED',safeCode(e));}
  }
  async function signOut(){
   if(!familyClient)return emit('CONFIG_REQUIRED');
   try{
    await familyClient.logout();
    actorUid=null;familyId=null;activeChildId=null;verifiedFamily=false;
    if(root&&root.XBM102&&typeof root.XBM102.reset==='function')root.XBM102.reset();
    view.identity(false);view.family(false,0);view.cloudStock(null);
    // Never remove any business cache or old v1.1.2 localStorage.
    return emit('LOGIN_REQUIRED');
   }catch(e){return emit('SIGNOUT_FAILED',safeCode(e));}
  }
  function savePublicKeyOnce(input){
   const key=parsePublicKey(input,'');
   if(!key)return emit('PUBLIC_KEY_INVALID');
   try{
    if(!storage)throw Error('storage');
    storage.setItem(KEY_NAME,key);
    view.needsKey(false);
    return emit('PUBLIC_KEY_CONFIGURED');
   }catch(_){return emit('PUBLIC_KEY_NOT_SAVED');}
  }
  return Object.freeze({
   connect,checkSession,requestOtp,confirmOtp,signOut,savePublicKeyOnce,
   verifiedContext:()=>verifiedFamily&&app&&familyId&&actorUid?
    Object.freeze({app,familyId,actorUid}):null,
   envId:ENV_ID,source:'M1-01-READ-ONLY + M1-02-SMOKE',
   get configured(){return !!getKey();}
  });
 }
 function browserStart(){
  if(!root.document)return;
  const doc=root.document,$=id=>doc.getElementById(id);
  const need=['m1Status','m1Config','m1Key','m1SaveKey','m1Email','m1Otp',
   'm1SendOtp','m1ConfirmOtp','m1SignOut','m1Refresh','m1Family','m1Stock'];
  if(need.some(x=>!$(x)))return;
  const view={
   status:(code,detail)=>{
    $('m1Status').textContent='云端连接：'+code+(detail?' ('+detail+')':'')+
       '。默认只用独立本机演练区；仅手动启用 M1-02 隔离云端模式且单独批准写入后，购买才会联网同步。';
   },
   needsKey:needed=>{$('m1Config').hidden=!needed;},
   identity:ok=>{$('m1SignOut').disabled=!ok;},
   family:(ok,num)=>{
    $('m1Family').textContent=ok?
      '家庭 xb 授权已核对；正式可用宝宝：'+num+' 个。':
      '家庭与授权尚未验证。';
   },
   cloudStock:rows=>{
    $('m1Stock').replaceChildren();
    if(!rows){$('m1Stock').textContent='暂无已确认的云端库存可显示（不会自动建立库存）。';return;}
    const title=doc.createElement('strong');
    title.textContent='云端权威库存（只读，独立于下方本机演练）：';
    $('m1Stock').append(title);
    const list=doc.createElement('div');list.style.cssText=
      'display:flex;gap:8px;flex-wrap:wrap;margin-top:9px';
    for(const row of rows){
     const el=doc.createElement('span');el.style.cssText=
      'padding:5px 10px;border-radius:9px;background:#eef2fc';
     el.textContent=row.size+' '+row.quantity+'片 · r'+row.revision;
     list.append(el);
    }
    $('m1Stock').append(list);
   }
  };
  const scriptLoader=url=>new Promise((resolve,reject)=>{
   const script=doc.createElement('script');
   script.src=url;script.async=true;
   const timer=setTimeout(()=>{script.remove();reject(Error('SDK_TIMEOUT'));},12000);
   script.onload=()=>{clearTimeout(timer);resolve();};
   script.onerror=()=>{clearTimeout(timer);reject(Error('SDK_UNAVAILABLE'));};
   doc.head.append(script);
  });
  const app=create({host:root,storage:root.localStorage,view,scriptLoader});
  root.XBM1Preview=app;
  const on=(id,fn)=>$(id).addEventListener('click',()=>{Promise.resolve(fn()).catch(()=>{
   view.status('ACTION_UNVERIFIED');
  });});
  on('m1SaveKey',async()=>{const code=app.savePublicKeyOnce($('m1Key').value);$('m1Key').value='';
   if(code==='PUBLIC_KEY_CONFIGURED')await app.connect();});
  on('m1SendOtp',()=>app.requestOtp($('m1Email').value.trim()));
  on('m1ConfirmOtp',()=>{const code=$('m1Otp').value.trim();$('m1Otp').value='';return app.confirmOtp(code);});
  on('m1Refresh',()=>app.connect());
  on('m1SignOut',()=>app.signOut());
  root.addEventListener('online',()=>app.connect());
  root.addEventListener('offline',()=>view.status('OFFLINE_LOCAL_ONLY'));
  doc.addEventListener('visibilitychange',()=>{
   if(doc.visibilityState==='visible')app.connect();
  });
  view.cloudStock(null);view.identity(false);view.family(false,0);
  view.needsKey(!app.configured);
  if(app.configured)app.connect();
  else view.status('CONFIG_REQUIRED');
 }
 const api=Object.freeze({create,parsePublicKey,sessionUid});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root&&root.document){
  root.XBM1PreviewModule=api;
  if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
  else browserStart();
 }
})(typeof window!=='undefined'?window:null);
