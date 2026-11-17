/* P4-04A offline deterministic candidate build; NEVER writes repo root or deploys. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc3');
const SHA='693cdcb96e3a2136136564a152451a3ecba9dcc5',VER='1.2.0-rc.3',TAG='p404d01';
const read=p=>fs.readFileSync(path.join(ROOT,p)),text=p=>read(p).toString('utf8');
 // Original rc.3 is frozen; never overwrite/re-version it from newer sources.
 if(process.argv.includes('--check')){
  require('./verify-v120-frozen-candidates.cjs').check('rc3');
  process.exit(0);
 }
 throw Error('frozen_candidate_not_regeneratable_create_new_version_instead');
function change(s,a,b){assert.equal(s.split(a).length-1,1,'source drift: '+a.slice(0,90));return s.replace(a,b);}
function html(){
 let s=text('preview/v1.2.0/formal/index.html');
 // Preview-only suppression must not override candidate PWA state transitions.
 s=change(s,'<style>#pwaLaunch,#pwaMigrationNotice,#pwaUpdateNotice{display:none!important}</style>','');
 s=change(s,'<title>M3 独立预览 · 小宝管家 V1.2.0 · 独立联网测试版 M1-01</title>',
  '<title>小宝管家 V1.2.0 · 家庭云端管理</title>');
 s=change(s,'<meta name="robots" content="noindex,nofollow" />',
  '<meta name="xiaobao-pages-candidate-source" content="'+SHA+'" />');
 s=change(s,
  '<meta name="description" content="纸尿裤备货计划、库存管理、采购记录、参考好价提醒和单片比价。" />',
  '<meta name="description" content="纸尿裤备货计划、库存管理、采购记录、参考好价提醒和单片比价。" />\n'
  +'<link rel="manifest" href="./manifest.webmanifest" />\n'
  +'<link rel="icon" href="./icons/icon-192.png" type="image/png" />\n'
  +'<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />');
 s=change(s,'🆕 检测到新版本。更新仅替换网页程序，不会清空本机库存、采购记录和参考价。',
  '🆕 检测到新版本。更新只替换程序，不主动清除原 V1.1.2 本机数据；云端数据需登录后读取。');
 const from=s.indexOf('  <div class="pwa-notice migration" id="pwaMigrationNotice" hidden>');
 const to=s.indexOf('  </div>',from);
 assert.ok(from>=0&&to>from,'migration marker');
 s=s.slice(0,from)+s.slice(to+'  </div>'.length);
 s=change(s,'小宝管家 V1.2.0 · 正式业务测试入口','小宝管家 V1.2.0 · 家庭云端数据');
 s=change(s,'等待正式 primary；目前不允许真实云端业务写入。',
  '正在核验家庭及正式宝宝数据；当前候选版本暂不开放业务写入。');
 s=change(s,'M3 独立页面不包含 M1-02 测试宝宝创建/采购入口，所有云端操作只读。',
  '仅显示当前家庭已授权的正式宝宝数据；未准备好的数据不以演示内容替代。');
 s=change(s,'保存后实时应用到比价提醒，并随备份导出。',
  '保存后经云端读回核验，供家庭成员刷新查看。');
 s=change(s,'专用测试宝宝 · 已确认云端采购（不含原本机流水，也不含未提交的离线购买）',
  '已确认云端采购（不含未提交的本机请求）');
 s=change(s,'这里只展示最新250条记录，导出备份会保留全部记录。',
  '这里只展示最新250条；完整记录以经核验的云端历史为准。');
 const left=s.indexOf('<div class="head"><h2>💾 数据备份与恢复</h2></div>');
 const right=s.indexOf('      </div>\n    </section>',left);
 assert.ok(left>=0&&right>left,'backup marker');
 const old=s.slice(left,right+'      </div>'.length);
 const backup='<div class="head"><h2>☁️ 云端与旧版数据</h2></div>\n'
  +'      <div class="card"><p class="sub">本候选版仅读取授权家庭的正式云端数据。'
  +'不会读取、清空或自动迁移 V1.1.2 的浏览器本地记录；旧数据仍留在原同源存储，'
  +'发布前须核对迁移结果。当前不提供云端数据备份、导入或一键清空。</p>'
  +'<div hidden aria-hidden="true">'
  +'<button id="exportData" disabled type="button"></button>'
  +'<button id="importDataBtn" disabled type="button"></button>'
  +'<button id="resetAll" disabled type="button"></button>'
  +'<input type="file" id="importFile" disabled /></div></div>';
 s=change(s,old,backup);
 s=change(s,'<script src="../m1-controller.js" defer></script>',
  '<script src="./m1-controller.js?v='+TAG+'" defer></script>');
 s=change(s,'<script src="../formal-controller.js" defer></script>',
  '<script src="./formal-controller.js?v='+TAG+'" defer></script>\n'
  +'<script src="./pwa.js?v='+TAG+'" defer></script>');
 s=change(s,"<div class=\"card\" id=\"formalNotice\" role=\"status\" aria-live=\"polite\">\n   <strong>小宝管家 V1.2.0 · 家庭云端数据</strong>\n   <div id=\"formalSyncState\" class=\"fine\">正在核验家庭及正式宝宝数据；当前候选版本暂不开放业务写入。</div>\n   <button id=\"formalRefresh\" class=\"btn secondary sm\" type=\"button\">刷新云端数据</button>\n   <button id=\"formalSyncNow\" class=\"btn sm\" type=\"button\" disabled title=\"等待独立数据库部署和业务写入授权\">提交待同步操作（尚未授权）</button>\n   <button id=\"formalResolveDocumentConflict\" class=\"btn secondary sm\" type=\"button\" hidden disabled>放弃本次修改并刷新</button>\n  </div>","<div class=\"sync-strip\" id=\"formalNotice\" role=\"status\" aria-live=\"polite\">\n   <span id=\"formalSyncState\" class=\"fine\">正在同步…</span>\n   <button id=\"formalRefresh\" class=\"btn secondary sm\" type=\"button\">刷新</button>\n   <button id=\"formalSyncNow\" class=\"btn secondary sm\" type=\"button\" disabled>核验待处理</button>\n   <button id=\"formalResolveDocumentConflict\" class=\"btn secondary sm\" type=\"button\" hidden disabled>放弃本次修改并刷新</button>\n  </div>");
 s=change(s,"</head>","<style>\n#formalNotice.sync-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0 4px;padding:4px 0;background:transparent;border:0;box-shadow:none}\n#formalNotice #formalSyncState{flex:1;min-width:150px;font-size:12px;color:#68768b;line-height:1.5}\n#formalNotice .btn{font-size:12px;padding:7px 10px}\n</style>\n</head>");
 assert.ok(!s.includes('/xb-test/')&&!s.includes('src="../'));
 return Buffer.from(s);
}
function formalController(){
 let s=text('preview/v1.2.0/formal-controller.js');
 s=change(s,"const FORMAL_WRITE_ENABLED=false;","const FORMAL_WRITE_ENABLED=true;");
 s=change(s,"const FORMAL_PURCHASE_ENABLED=false;","const FORMAL_PURCHASE_ENABLED=true;");
 s=change(s,"const now=()=>typeof host.Date?.now==='function'?host.Date.now():Date.now();","const now=()=>typeof host.Date?.now==='function'?host.Date.now():Date.now();\n const lastUpdated=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());");
 s=change(s,"const app=create({\n","const app=create({\n  purchaseOperatorApproved:()=>true,\n");
 s=change(s,"on('formalRefresh',restore);","on('formalRefresh',()=>{if(mode==='ready')$('formalSyncState').textContent='正在刷新云端数据…';return restore();});");
 s=change(s,"$('formalSyncState').textContent=\n    '正式宝宝及五类共享文档已验证；本测试版本关闭云端写入。';","$('formalSyncState').textContent='已同步 · '+lastUpdated();");
 s=change(s,"'正式宝宝及库存已验证，但五类共享文档读取失败或超时；当前仅显示历史迁移快照，不能视为实时同步。请点击“刷新云端数据”重试；正式写入关闭。';","'库存已更新，共享数据读取未完成，请点击刷新重试。';");
 s=change(s,"$('formalSyncState').textContent=documentsVerified?\n    '正式宝宝及五类共享文档已验证；本测试版本关闭云端写入。':\n    documentsClient?\n    '已验证正式宝宝及库存；正在核验五类共享文档（双轮读取），当前暂显示历史迁移快照，不代表实时同步；正式写入关闭。':\n    '已验证正式宝宝及库存；共享文档读取组件不可用，当前仅显示历史迁移快照，不代表实时同步；正式写入关闭。';","$('formalSyncState').textContent=documentsVerified?\n     '已同步 · '+lastUpdated():\n     documentsClient?\n     '库存已更新，正在同步家庭数据…':\n     '库存已更新，共享数据暂未加载，请刷新重试。';");
 s=change(s,"$('formalSyncNow').textContent='重新核验待确认操作';","$('formalSyncNow').textContent='核验待处理';");
 return Buffer.from(s);
}
function sw(){
 let s=text('sw.js');
 s=change(s,'PWA v1.1.2','PWA V1.2.0 candidate');
 s=change(s,"const CACHE_NAME = 'xiaobao-shell-v1.1.2';",
  "const CACHE_NAME = 'xiaobao-shell-v1.2.0-rc3';");
 s=change(s,"const SHELL = ['./index.html','./pwa.js','./growth.js','./manifest.webmanifest',",
  "const SHELL = ['./index.html','./pwa.js','./m1-controller.js',\n"
  +"  './formal-controller.js','./growth.js','./manifest.webmanifest',");
 s=change(s,"  './icons/apple-touch-icon.png'];",
  "  './icons/apple-touch-icon.png','./icons/icon.svg'];");
 return Buffer.from(s);
}
const version=JSON.stringify({version:VER,channel:'release-candidate',source_sha:SHA,
 released:'2026-11-17',notes:'V1.2.0 双端联网五页面完整写入候选；仅供隔离试用，未部署'},null,2)+'\n';
const pairs=[
 ['.nojekyll','.nojekyll'],['manifest.webmanifest','manifest.webmanifest'],
 ['growth.js','growth.js'],['pwa.js','scripts/pages-v120-pwa.js'],
 ['m1-controller.js','preview/v1.2.0/m1-controller.js'],
 ['formal-controller.js','preview/v1.2.0/formal-controller.js'],
 ...['icon-192.png','icon-512.png','icon-maskable-512.png',
  'apple-touch-icon.png','icon.svg'].map(n=>['icons/'+n,'icons/'+n])
];
const content=new Map(pairs.map(([dest,src])=>[dest,read(src)]));
content.set('index.html',html());content.set('formal-controller.js',formalController());content.set('sw.js',sw());
content.set('version.json',Buffer.from(version));
const check=process.argv.includes('--check');
for(const [dest,bytes] of content){
 const target=path.join(OUT,dest);
 if(check){assert.ok(fs.existsSync(target),'missing '+dest);
  assert.deepEqual(fs.readFileSync(target),bytes,'stale '+dest);}
 else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
}
if(check){
 const actual=[];
 function walk(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=rel?rel+'/'+e.name:e.name;
  if(e.isDirectory())walk(path.join(dir,e.name),p);else actual.push(p);
 }}
 walk(OUT);
 assert.deepEqual(actual.sort(),[...content.keys()].sort());
}
console.log('P4_04D_RC3_'+(check?'PARITY_PASS':'GENERATED'),VER,content.size);
