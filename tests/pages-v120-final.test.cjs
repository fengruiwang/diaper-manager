/* T06-FINAL-01: frozen 1.2.0 root-upgrade candidate verification; NO DEPLOY. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {checkPinnedResources,historicEmbeddedModule}=require('./historical-candidate-baselines.cjs');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-final');
const SHA='eb2fec3a9d9e5aa5e29e273929a25bac5e02632c';
const EXPECTED=[
 '.nojekyll','index.html','formal-controller.js','m1-controller.js','growth.js',
 'pwa.js','sw.js','manifest.webmanifest','version.json',
 'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png',
 'icons/apple-touch-icon.png','icons/icon.svg'
];
const file=name=>fs.readFileSync(path.join(OUT,name));
const read=name=>file(name).toString('utf8');

test('FINAL exactly 14 immutable resources and reviewed source SHA',()=>{
 const actual=[];
 function walk(dir,rel=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const name=rel?rel+'/'+entry.name:entry.name;
   if(entry.isDirectory())walk(path.join(dir,entry.name),name);
   else actual.push(name);
  }
 }
 walk(OUT);
 assert.deepEqual(actual.sort(),[...EXPECTED].sort());
 const v=JSON.parse(read('version.json'));
 assert.equal(v.version,'1.2.0');
 assert.equal(v.channel,'stable');
 assert.equal(v.source_sha,SHA);
 const pinned=checkPinnedResources(file,'final');
 assert.equal(pinned.count,14);
 assert.equal(pinned.sourceSha,SHA);
 assert.ok(read('index.html').includes('xiaobao-pages-candidate-source" content="'+SHA+'"'));
});
test('FINAL builder uses immutable audited Git inputs, not moving Feature sources',()=>{
 const builder=fs.readFileSync(path.join(ROOT,'scripts/build-pages-v120-final.cjs'),'utf8');
 assert.ok(builder.includes('SOURCE_SHA="'+SHA+'"'));
 assert.ok(builder.includes("execFileSync('git',['show',SOURCE_SHA+':'+p]"));
 assert.ok(builder.includes("const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-final')"));
});
test('T06-P1-01 stable cold start and authorized login are in packaged resources',()=>{
 const h=read('index.html'),c=read('formal-controller.js');
 assert.ok(h.includes('id="formalGateMessage" role="status" aria-live="polite">正在进入小宝管家…</p>'));
 assert.ok(c.includes("const BOOT_MESSAGE='正在进入小宝管家…'"));
 assert.ok(c.includes("const viewingCache=Boolean(cachedPreview)&&next==='cached'"));
 const cachePath=c.slice(c.indexOf('function showCachedInventory('),c.indexOf('function bootStage('));
 assert.ok(cachePath.includes('cachedPreview='));
 assert.ok(!cachePath.includes("screen('boot')"),'normal boot must not flash cached tiles');
 assert.ok(h.includes('<div id="formalCachedInventory" hidden'));
 assert.ok(c.includes("screen('ready')"));
 for(const marker of [
  '欢迎使用小宝管家，请使用邮箱验证码登录。',
  '当前离线，未清除登录会话。',
  '家庭授权未通过，已隐藏业务内容。',
  "status==='LOGIN_REQUIRED'",
  "status==='OFFLINE_LOCAL_ONLY'"
 ])assert.ok(c.includes(marker),marker);
});
test('T06-P2-01 five-tab touch pull, 64px threshold and live feedback are packaged',()=>{
 const h=read('index.html'),c=read('formal-controller.js');
 for(const tab of ['overview','compare','history','growth','settings'])
  assert.ok(h.includes('data-tab="'+tab+'"'),'missing '+tab);
 for(const marker of [
  "const threshold=64","navigator?.maxTouchPoints",
  "doc.scrollingElement","xiaobao-pull-touch",
  "touchstart","touchmove","touchend","touchcancel",
  "const safe=(checkTop=true)","editedFields",
  "event.preventDefault()","fetchCloudLatest().then(",
  "restore({requireComplete:true,automatic})"
 ])assert.ok(c.includes(marker),'missing '+marker);
 for(const marker of [
  'data-pull-phase="armed"','content:"下拉刷新"',
  'content:"松开刷新"','content:"正在获取云端最新数据…"',
  'content:"云端数据已更新"','html.xiaobao-pull-touch'
 ])assert.ok(h.includes(marker),'missing '+marker);
 assert.ok(!h.includes('id="formalRefresh"'),'top refresh button removed intentionally');
 assert.ok(h.includes('id="formalGetCloudLatest"'));
});
test('T06-P2-02 final fixes hidden parent dialog blocking five-page top pull',()=>{
 const h=read('index.html'),c=read('formal-controller.js');
 assert.ok(h.includes('id="priceEditor" role="presentation" hidden>'));
 assert.ok(h.includes('role="dialog" aria-modal="true"'));
 assert.ok(c.includes("const dialogs=doc.querySelectorAll?.('[role=\"dialog\"],[aria-modal=\"true\"]')"));
 assert.ok(c.includes("!dialog.closest?.('[hidden]')"));
 assert.ok(c.includes('dialog.getClientRects().length>0'));
 assert.ok(c.includes("if(event.touches?.length!==1||!safe()"));
 assert.ok(c.includes("pullFeedback(pull.armed?'armed':'pulling')"));
 assert.ok(c.includes("void fetchCloudLatest().then("));
 assert.ok(!c.includes("'[role=\"dialog\"]:not([hidden]),[aria-modal=\"true\"]:not([hidden])'"));
});
test('V1.2.0 stable script URLs, service-worker cache and metadata agree',()=>{
 const html=read('index.html'),sw=read('sw.js'),v=JSON.parse(read('version.json'));
 for(const p of ['m1-controller.js','formal-controller.js','pwa.js'])
  assert.ok(html.includes('./'+p+'?v=1.2.0'),p);
 assert.ok(sw.includes("const CACHE_NAME = 'xiaobao-shell-v1.2.0';"));
 assert.equal(v.version,'1.2.0');
 assert.equal(v.channel,'stable');
 assert.equal(v.source_sha,SHA);
});
test('T07 stable UI is clean and all necessary action/status nodes survive',()=>{
 const h=read('index.html');
 assert.doesNotMatch(h,/id="formalRefresh"/);
 assert.doesNotMatch(h,/id="pwaMigrationNotice"|id="pwaImportOld"|id="pwaMigrationDismiss"/);
 assert.doesNotMatch(h,/<div class="footer-note">|☁️ 云端与旧版数据|💾 数据备份与恢复/);
 for(const id of ['formalNotice','formalSyncState','formalSyncNow','formalResolveDocumentConflict',
  'formalResolveBatchConflict','formalSignOut','formalGetCloudLatest','formalSubmitPending',
  'formalPendingCount','formalCloudSyncFeedback','pwaUpdateNow','pwaUpdateNotice',
  'formalLegacyPlaceholders','exportData','importDataBtn','resetAll','importFile'])
  assert.ok(h.includes('id="'+id+'"'),id);
 assert.ok(h.includes('#formalNotice.sync-line{display:none;'));
 assert.ok(h.includes('#formalNotice:has(>button:not([hidden])){display:flex}'));
 assert.ok(h.includes('#formalSyncState{display:inline}'));
 assert.ok(h.includes('🆕 发现新版本，更新只替换程序，不清除本机数据。'));
});
test('T07 stable settings order ends with account and cloud sync',()=>{
 const h=read('index.html');
 const settings=h.slice(h.indexOf('<section class="panel" id="settings">'),
  h.indexOf('    </section>\n  </main>',h.indexOf('<section class="panel" id="settings">')));
 const ordered=['👶 宝宝基本资料','🧷 纸尿裤尺码与采购偏好','🎯 备货目标与日均用量',
  '🔐 账号与家庭','☁️ 云端数据同步'];
 const pos=ordered.map(label=>settings.indexOf(label));
 assert.ok(pos.every((p,i)=>p>=0&&(i===0||p>pos[i-1])),String(pos));
});
test('FINAL keeps authenticated purchase, consume, reverse, stocktake and shared-document writes',()=>{
 const c=read('formal-controller.js'),h=read('index.html');
 for(const flag of [
  'const FORMAL_WRITE_ENABLED=true;',
  'const FORMAL_DOCUMENT_WRITE_ENABLED=true;',
  'const FORMAL_PURCHASE_ENABLED=true;',
  'purchaseOperatorApproved:()=>FORMAL_PURCHASE_ENABLED',
  'purchaseOnly:true,allowConsume:true,allowReverse:true',
  'allowStocktake:true,allowBatchStocktake:true,fastBatchStocktake:true',
  'allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true',
  'allowSettings:true,'
 ])assert.ok(c.includes(flag),flag);
 assert.ok(c.includes('cloudWritesEnabled:FORMAL_DOCUMENT_WRITE_ENABLED'));
 assert.ok(c.includes('cloudWritesEnabled:purchaseReleaseEnabled===true'));
 assert.ok(!h.includes('所有云端操作只读。'));
 assert.ok(!h.includes('/xb-test/'));
 assert.ok(!h.includes('src="../'));
});
test('FINAL embedded cloud and business modules exactly match reviewed Git blob SHAs',()=>{
 const html=read('index.html');
 for(const source of [
  'sync/primary-cloud-read-model.js','sync/primary-cloud-operations.js',
  'sync/primary-documents-client.js','sync/primary-documents-operations.js',
  'sync/primary-stocktake-batch-client.js','sync/inventory-outbox-runner.js',
  'sync/inventory-sync-reader.js','sync/primary-business-commands.js'
 ])assert.ok(historicEmbeddedModule(html,'final',source).length>100,source);
});
test('same installed PWA identity, controlled SW update and no local-data reset',()=>{
 const current=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'));
 const candidate=JSON.parse(read('manifest.webmanifest'));
 assert.deepEqual(candidate,current);
 for(const field of ['id','start_url','scope'])assert.equal(candidate[field],'./');
 assert.deepEqual(candidate.icons,current.icons);
 const sw=read('sw.js'),pwa=read('pwa.js');
 assert.ok(sw.includes("const CACHE_NAME = 'xiaobao-shell-v1.2.0'"));
 assert.ok(sw.includes("const CACHE_PREFIX = 'xiaobao-shell-'"));
 assert.ok(sw.includes('cache.addAll(SHELL_URLS'));
 assert.ok(sw.includes("event.data.type === 'SKIP_WAITING'"));
 assert.ok(sw.includes('self.clients.claim()'));
 assert.ok(pwa.includes("registration.waiting.postMessage({type:'SKIP_WAITING'})"));
 assert.ok(pwa.includes('window.confirm('));
 assert.ok(pwa.includes("navigator.serviceWorker.register('./sw.js',{scope:'./'})"));
 assert.ok(pwa.includes('window.location.reload()'));
 for(const name of ['sw.js','pwa.js','formal-controller.js'])
  assert.doesNotMatch(read(name),/indexedDB\.deleteDatabase|localStorage\.clear\(|localStorage\.removeItem\(/);
 for(const name of ['pwa.js','manifest.webmanifest','growth.js','m1-controller.js',
  'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png','icons/icon.svg'])
  assert.deepEqual(file(name),fs.readFileSync(path.join(ROOT,'release-candidate/pages-v1.2.0-rc7',name)));
});
test('RC5 through published RC9 remain pinned independently of Feature HEAD',()=>{
 for(const tag of ['rc5','rc6','rc7','rc8','rc9']){
  const root=path.join(ROOT,'release-candidate/pages-v1.2.0-'+tag);
  assert.equal(checkPinnedResources(name=>fs.readFileSync(path.join(root,name)),tag).count,14);
 }
});
test('FINAL integrity check catches modified bytes without touching package',()=>{
 const corrupt=Buffer.from(read('index.html')+'\n/*tampered*/');
 assert.throws(()=>checkPinnedResources(name=>name==='index.html'?corrupt:file(name),'final'),
  /final frozen resource modified: index.html/);
});
test('FINAL standalone directory serves 13 nonempty HTTP resources',async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/pages-final/')){res.writeHead(404).end();return;}
  const rel=decodeURIComponent(pathname.slice('/pages-final/'.length))||'index.html';
  const target=path.resolve(OUT,rel);
  if(!target.startsWith(OUT+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(target,(error,data)=>{
   if(error){res.writeHead(404).end();return;}
   res.writeHead(200);res.end(data);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port+'/pages-final/';
  for(const name of EXPECTED.filter(x=>x!=='.nojekyll')){
   const res=await fetch(base+name);
   assert.equal(res.status,200,name);
   assert.ok((await res.arrayBuffer()).byteLength>0,name);
  }
 }finally{
  await new Promise(resolve=>server.close(resolve));
 }
});
