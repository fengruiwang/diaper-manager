/* T03-P2-01 rc.5 deterministic full-write test candidate build; never deploys. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc5');
const SOURCE_SHA="95052656b463a33cfd74394e6acace87f67ec458",TAG="rc5",VER="1.2.0-rc.5";
const read=p=>fs.readFileSync(path.join(ROOT,p)),text=p=>read(p).toString('utf8');
function ch(s,oldValue,newValue){
 const num=s.split(oldValue).length-1;
 if(num!==1)throw Error("source drift "+num+": "+oldValue.slice(0,110));
 return s.replace(oldValue,newValue);
}
function htmlCandidate(s,sourceSha,tag){
 s=ch(s,'<style>#pwaLaunch,#pwaMigrationNotice,#pwaUpdateNotice{display:none!important}</style>','');
 s=ch(s,'<title>M3 独立预览 · 小宝管家 V1.2.0 · 独立联网测试版 M1-01</title>','<title>小宝管家 V1.2.0 · 家庭云端管理</title>');
 s=ch(s,'<meta name="robots" content="noindex,nofollow" />',
  '<meta name="xiaobao-pages-candidate-source" content="'+sourceSha+'" />');
 s=ch(s,'<meta name="description" content="纸尿裤备货计划、库存管理、采购记录、参考好价提醒和单片比价。" />',
  '<meta name="description" content="纸尿裤备货计划、库存管理、采购记录、参考好价提醒和单片比价。" />\n'
  +'<link rel="manifest" href="./manifest.webmanifest" />\n'
  +'<link rel="icon" href="./icons/icon-192.png" type="image/png" />\n'
  +'<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />');
 s=ch(s,'🆕 检测到新版本。更新仅替换网页程序，不会清空本机库存、采购记录和参考价。',
  '🆕 检测到新版本。更新只替换程序，不主动清除原 V1.1.2 本机数据；云端数据需登录后读取。');
 const from=s.indexOf('  <div class="pwa-notice migration" id="pwaMigrationNotice" hidden>');
 const to=s.indexOf('  </div>',from);
 if(from<0||to<=from)throw Error('missing legacy migration banner');
 s=s.slice(0,from)+s.slice(to+'  </div>'.length);
 s=ch(s,'M3 独立页面不包含 M1-02 测试宝宝创建/采购入口，所有云端操作只读。',
  '当前家庭的库存与价格记录可通过联网保存和刷新共享。');
 s=ch(s,'保存后实时应用到比价提醒，并随备份导出。',
  '保存后同步至云端，家庭成员刷新后可看到更新。');
 s=ch(s,'专用测试宝宝 · 已确认云端采购（不含原本机流水，也不含未提交的离线购买）',
  '已确认云端采购（不含未提交的本机请求）');
 s=ch(s,'这里只展示最新250条记录，导出备份会保留全部记录。',
  '这里只展示最新250条；完整记录以云端历史为准。');
 s=ch(s,'多尺码批量盘点功能尚未开放，请等待下一阶段。',
  '多尺码批量盘点暂时不可用，请刷新后重试；本次未保存任何库存修改。');
 const begin=s.indexOf('<div class="head"><h2>💾 数据备份与恢复</h2></div>');
 const end=s.indexOf('      </div>\n    </section>',begin);
 if(begin<0||end<=begin)throw Error('backup section drift');
 const previous=s.slice(begin,end+'      </div>'.length);
 const next='<div class="head"><h2>☁️ 云端与旧版数据</h2></div>\n'
 +'      <div class="card"><p class="sub">当前家庭的库存、采购、参考价、成长记录和设置通过云端保存与共享，'
 +'另一台设备刷新后即可查看。原 V1.1.2 的本机记录不会自动删除或迁移，使用前请核对历史数据。'
 +'本版本尚不支持云端整库导入、导出或一键清空。</p>'
 +'<div hidden aria-hidden="true">'
 +'<button id="exportData" disabled type="button"></button>'
 +'<button id="importDataBtn" disabled type="button"></button>'
 +'<button id="resetAll" disabled type="button"></button>'
 +'<input type="file" id="importFile" disabled /></div></div>';
 s=ch(s,previous,next);
 s=ch(s,'<script src="../m1-controller.js" defer></script>',
  '<script src="./m1-controller.js?v='+tag+'" defer></script>');
 s=ch(s,'<script src="../formal-controller.js" defer></script>',
  '<script src="./formal-controller.js?v='+tag+'" defer></script>\n'
  +'<script src="./pwa.js?v='+tag+'" defer></script>');
 if(s.includes('/xb-test/')||s.includes('src="../')
  ||s.includes('本候选版仅读取授权家庭')
  ||s.includes('所有云端操作只读。'))throw Error('candidate forbidden reference');
 return s;
}
function formalCandidate(s){
 s=ch(s,'const FORMAL_WRITE_ENABLED=false;','const FORMAL_WRITE_ENABLED=true;');
 const oldHeader="/* Feature-only V1.2.0 formal login + five-tab cloud shell.\n * General formal business writes stay disabled; completed shared-document\n * domains use a separate narrow switch. Inventory/purchase remain disabled.\n * Never loaded by V1.1.2, accepted M1-02 or M3 preview.\n */";
 const newHeader="/* Standalone V1.2.0 rc.5 full-write test candidate.\n * All implemented authenticated inventory and shared-document write domains\n * are enabled. CloudBase session, family scope, child scope, server RPC/RLS,\n * revision checks and ACK/readback verification remain authoritative.\n * Never loaded by V1.1.2, accepted M1-02 or the synthetic M3 preview.\n */";
 s=ch(s,oldHeader,newHeader);
 for(const flag of ["const FORMAL_WRITE_ENABLED=true;","const FORMAL_DOCUMENT_WRITE_ENABLED=true;","const FORMAL_PURCHASE_ENABLED=true;","purchaseOperatorApproved:()=>FORMAL_PURCHASE_ENABLED","purchaseOnly:true,allowConsume:true,allowReverse:true","allowStocktake:true,allowBatchStocktake:true,fastBatchStocktake:true","allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true","allowSettings:true,"])
  if(!s.includes(flag))throw Error('write domain not enabled: '+flag);
 return s;
}
function swCandidate(s){
 s=ch(s,'PWA v1.1.2','PWA V1.2.0 rc.5 candidate');
 s=ch(s,"const CACHE_NAME = 'xiaobao-shell-v1.1.2';",
 "const CACHE_NAME = 'xiaobao-shell-v1.2.0-rc4';");
 s=ch(s,"const SHELL = ['./index.html','./pwa.js','./growth.js','./manifest.webmanifest',",
 "const SHELL = ['./index.html','./pwa.js','./m1-controller.js',\n  './formal-controller.js','./growth.js','./manifest.webmanifest',");
 s=ch(s,"  './icons/apple-touch-icon.png'];",
 "  './icons/apple-touch-icon.png','./icons/icon.svg'];");
 return s;
}
const data=new Map([
 ['.nojekyll',read('.nojekyll')],['manifest.webmanifest',read('manifest.webmanifest')],
 ['growth.js',read('growth.js')],['pwa.js',read('scripts/pages-v120-pwa.js')],
 ['m1-controller.js',read('preview/v1.2.0/m1-controller.js')],
 ...['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','icon.svg']
 .map(name=>['icons/'+name,read('icons/'+name)])
]);
data.set('index.html',Buffer.from(htmlCandidate(text('preview/v1.2.0/formal/index.html'),SOURCE_SHA,TAG)));
data.set('formal-controller.js',Buffer.from(formalCandidate(text('preview/v1.2.0/formal-controller.js'))));
data.set('sw.js',Buffer.from(swCandidate(text('sw.js'))));
data.set('version.json',Buffer.from(JSON.stringify({version:VER,channel:'release-candidate',
 source_sha:SOURCE_SHA,released:'2026-11-19',
 notes:'V1.2.0 全部已实现业务写入开放；009/027盘点恢复修复；CloudBase正常账号及家庭权限保持有效；隔离候选，未部署'},null,2)+'\n'));
const check=process.argv.includes('--check');
for(const [name,bytes] of data){
 const target=path.join(OUT,name);
 if(check){assert.ok(fs.existsSync(target),'missing '+name);
  assert.deepEqual(fs.readFileSync(target),bytes,'stale '+name);
 }else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
}
if(check){
 const actual=[];
 function walk(dir,rel=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const p=rel?rel+'/'+entry.name:entry.name;
  if(entry.isDirectory())walk(path.join(dir,entry.name),p);else actual.push(p);
 }}
 walk(OUT);assert.deepEqual(actual.sort(),[...data.keys()].sort());
}
console.log('T03_P2_01_RC5_'+(check?'PARITY_PASS':'GENERATED'),VER,data.size);
