const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'release-candidate/pages-v1.2.0');
const load=p=>fs.readFileSync(path.join(ROOT,p));
const c=p=>load('release-candidate/pages-v1.2.0/'+p);
const text=p=>c(p).toString('utf8');
const expected=[
 '.nojekyll','index.html','m1-controller.js','formal-controller.js','pwa.js',
 'sw.js','version.json','manifest.webmanifest','growth.js',
 'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png',
 'icons/apple-touch-icon.png','icons/icon.svg'
];
test('P4-04A frozen rc2 candidate preserves verified assets and archived module identity',()=>{
 for(const p of expected)assert.ok(fs.existsSync(path.join(OUT,p)),p);
 assert.deepEqual(c('m1-controller.js'),load('preview/v1.2.0/m1-controller.js'));
 assert.match(c('formal-controller.js').toString('utf8'),/const FORMAL_WRITE_ENABLED=false;/);
 // Frozen rc.2 must not be silently rewritten when development source advances.
 assert.deepEqual(c('growth.js'),load('growth.js'));
 assert.deepEqual(c('pwa.js'),load('scripts/pages-v120-pwa.js'));
 for(const icon of expected.filter(x=>x.startsWith('icons/')))
  assert.deepEqual(c(icon),load(icon));
 const html=text('index.html');
 for(const source of ['primary-business-date','primary-ui-projection','primary-business-commands']){
  const body=load('sync/'+source+'.js').toString('utf8').trim();
  assert.ok(html.includes(body),'inline source parity: '+source);
 }
 assert.ok(html.indexOf('XBPrimaryBusinessDate')<html.indexOf('XBPrimaryUIProjection'));
 for(const script of ['./m1-controller.js?v=p404c01',
  './formal-controller.js?v=p404c01','./pwa.js?v=p404c01'])
  assert.ok(html.includes('src="'+script+'"'),script);
 assert.ok(html.indexOf('src="./m1-controller')<html.indexOf('src="./formal-controller'));
 for(const name of ['primary-documents-operations','primary-documents-business-commands',
  'primary-documents-client',
  'outbox-contract','primary-cloud-operations','cloudbase-inventory-client'])
  assert.ok(html.includes(load('sync/'+name+'.js').toString('utf8').trim()),name);
});
test('P4-04A read-only production build gates, no Tencent test assets or fake release controls',()=>{
 const html=text('index.html'),controller=text('formal-controller.js');
 assert.match(controller,/const FORMAL_WRITE_ENABLED=false;/);
 assert.match(controller,/const FORMAL_PURCHASE_ENABLED=false;/);
 assert.doesNotMatch(controller,/const FORMAL_WRITE_ENABLED=true;/);
 assert.doesNotMatch(html,/<script[^>]*src="\.\.\//);
 assert.doesNotMatch(html,/\/xb-test\/|XiaoBao-P4-03D-REFONLY/);
 assert.match(html,/小宝管家 V1\.2\.0 · 家庭云端管理/);
 assert.match(html,/正式宝宝数据/);
 assert.doesNotMatch(html,/M3 独立预览 ·|正式业务测试入口|专用测试宝宝 ·/);
 assert.doesNotMatch(html,/id="pwaImportOld"/);
 for(const id of ['exportData','importDataBtn','resetAll','importFile'])
  assert.match(html,new RegExp('id="'+id+'"\\s+disabled'));
 assert.match(html,/hidden aria-hidden="true"/);
 assert.match(html,/当前不提供云端数据备份、导入或一键清空/);
 // Source demo fixtures remain test-only code, never wired to a released button.
 assert.doesNotMatch(html,/<button[^>]*(?:demo|S140)/i);
 assert.doesNotMatch(html,/window\.XBM3UI\.demo\s*\(/);
});
test('P4-04A original Pages V1.1.2 root files and legacy data keys remain untouched',()=>{
 const rootIndex=load('index.html').toString('utf8');
 assert.match(load('sw.js').toString('utf8'),/xiaobao-shell-v1\.1\.2/);
 assert.equal(JSON.parse(load('version.json')).version,'1.1.2');
 assert.match(rootIndex,/小宝管家 · 备货比价/);
 assert.doesNotMatch(rootIndex,/xiaobao-pages-candidate-source/);
 assert.match(load('pwa.js').toString('utf8'),/xiaobao_diaper_planner_v1/);
});
test('P4-04A Manifest retains installed PWA identity, scope, start_url and all old icons',()=>{
 const old=JSON.parse(load('manifest.webmanifest'));
 const manifest=JSON.parse(c('manifest.webmanifest'));
 assert.deepEqual(manifest,old);
 assert.equal(manifest.id,'./');
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 for(const i of manifest.icons)assert.ok(c(i.src.replace(/^\.\//,'')).length>100);
 assert.match(text('index.html'),/href="\.\/manifest\.webmanifest"/);
 assert.match(text('index.html'),/href="\.\/icons\/apple-touch-icon\.png"/);
 const version=JSON.parse(c('version.json'));
 assert.equal(version.version,'1.2.0-rc.2');
 assert.equal(version.channel,'release-candidate');
 assert.equal(version.source_sha,'38a75ce9bdabdd7264f7eff85d56060df031b67c');
});
test('P4-04A new SW shell uses a distinct cache and manual-only update, never clears data',()=>{
 const sw=text('sw.js'),pwa=text('pwa.js'),index=text('index.html');
 assert.match(sw,/xiaobao-shell-v1\.2\.0-rc2/);
 assert.doesNotMatch(sw,/const CACHE_NAME = 'xiaobao-shell-v1\.1\.2'/);
 for(const f of ['index.html','m1-controller.js','formal-controller.js','pwa.js',
  'manifest.webmanifest','growth.js','icons/icon-192.png',
  'icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png',
  'icons/icon.svg'])assert.ok(sw.includes("'./"+f+"'"),f);
 assert.match(sw,/event\.data\.type === 'SKIP_WAITING'/);
 assert.match(pwa,/registration\.waiting\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
 assert.match(pwa,/register\('\.\/sw\.js',\{scope:'\.\/'\}\)/);
 assert.match(sw,/if\(url\.href\.split\('\?'\)\[0\] === VERSION_URL\) return/);
 assert.doesNotMatch(sw+pwa,/caches\.delete\(['"]xiaobao_diaper_planner/);
 assert.doesNotMatch(sw+pwa,/localStorage\.(?:clear|removeItem|setItem)|indexedDB\.deleteDatabase/);
 assert.match(index,/src="\.\/pwa\.js\?v=p404c01"/);
});
test('P4-04A local HTTP host at /diaper-manager/ returns entry and every referenced resource',async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith('/diaper-manager/')){
   res.writeHead(404).end();return;
  }
  const rel=decodeURIComponent(url.pathname.slice('/diaper-manager/'.length))
   ||'index.html';
  const file=path.resolve(OUT,rel);
  if(!(file===OUT||file.startsWith(OUT+path.sep))){
   res.writeHead(403).end();return;
  }
  fs.readFile(file,(e,buf)=>{
   if(e){res.writeHead(404).end();return;}
   const ext=path.extname(file);
   res.setHeader('Content-Type',
    ext==='.js'?'application/javascript':
    ext==='.json'||ext==='.webmanifest'?'application/json':
    ext==='.html'?'text/html; charset=utf-8':
    ext==='.svg'?'image/svg+xml':'application/octet-stream');
   res.writeHead(200);res.end(buf);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+server.address().port+'/diaper-manager/';
  for(const f of ['',...expected.filter(x=>x!=='.nojekyll')]){
   const r=await fetch(origin+f);
   assert.equal(r.status,200,'GET '+f);
   assert.ok((await r.arrayBuffer()).byteLength>0,'empty '+f);
  }
  const html=await (await fetch(origin)).text();
  assert.match(html,/家庭云端管理/);
  assert.equal(new URL('./manifest.webmanifest',origin).pathname,
   '/diaper-manager/manifest.webmanifest');
 }finally{await new Promise(resolve=>server.close(resolve));}
});


test('P4-04A-FIX candidate PWA CSS respects runtime hidden state and formal gate',()=>{
 const html=text('index.html'),preview=load('preview/v1.2.0/formal/index.html').toString('utf8');
 const pwa=text('pwa.js');
 assert.match(preview,/<style>#pwaLaunch,#pwaMigrationNotice,#pwaUpdateNotice\{display:none!important\}<\/style>/);
 assert.doesNotMatch(html,/#pwaLaunch,#pwaMigrationNotice,#pwaUpdateNotice\{display:none!important\}/);
 const rules=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 for(const fragment of rules.split('}'))
  if(/#pwa(?:Launch|UpdateNotice)\b/.test(fragment))
   assert.doesNotMatch(fragment,/display\s*:\s*none\s*!important/);
 assert.match(html,/<div class="pwa-launch" id="pwaLaunch">/);
 assert.match(html,/<div class="pwa-notice" id="pwaUpdateNotice" hidden>/);
 assert.match(html,/\[hidden\]\{display:none!important\}/);
 assert.match(html,/body:not\(\[data-formal-state="ready"\]\) \.wrap\{display:none!important\}/);
 assert.match(pwa,/launch\.hidden=standalone\(\)/);
 assert.match(pwa,/updateNotice\.hidden=false/);
 assert.doesNotMatch(html,/id="pwaImportOld"/);
});

test('P4-04A-FIX real PWA click listeners bypass formal capture; unknown/legacy business clicks remain blocked',async()=>{
 const vm=require('node:vm'),Bridge=require('../sync/primary-formal-ui-actions.js');
 const button=(id,hidden=false)=>({id,hidden,dataset:{},handlers:{},
  addEventListener(type,fn){this.handlers[type]=fn;},
  closest(){return this;}});
 const elements=new Map([
  ['pwaLaunch',button('pwaLaunch',true)],
  ['installPwa',button('installPwa')],
  ['pwaInstallTip',{textContent:''}],
  ['pwaUpdateNotice',button('pwaUpdateNotice',true)],
  ['pwaUpdateNow',button('pwaUpdateNow')]
 ]);
 let capture=null,submissions=0;
 const notifications=[],messages=[];
 const doc={
  getElementById(id){return elements.get(id)||null;},
  addEventListener(type,fn,capturing){if(type==='click'&&capturing===true)capture=fn;},
  removeEventListener(){}
 };
 const bound=Bridge.create({
  commands:{submit:async()=>{submissions++;throw Error('unexpected write');}},
  primary:{read:async()=>({})},
  readPurchase:()=>({}),readQuote:()=>({}),readTransaction:()=>({}),
  notify:r=>notifications.push(r.status),
  formalModeSelected:()=>true,buildAllowsWrites:false,operatorApproved:()=>false
 }).attach(doc);
 const reg={waiting:{postMessage:m=>messages.push(m.type)},
  addEventListener(){},update:async()=>{}};
 const navigator={userAgent:'Chrome',onLine:true,standalone:false,
  serviceWorker:{controller:{},addEventListener(){},
   register:async()=>reg}};
 const window={navigator,isSecureContext:true,matchMedia:()=>({matches:false}),
  addEventListener(){},confirm:()=>true,location:{reload(){}}};
 vm.runInNewContext(text('pwa.js'),{window,document:doc,navigator,
  setInterval(){},fetch:async()=>({})},{timeout:1000});
 await Promise.resolve();await Promise.resolve();
 assert.equal(elements.get('pwaLaunch').hidden,false,'install area visible');
 assert.equal(elements.get('pwaUpdateNotice').hidden,false,'waiting SW notice visible');
 function fire(id){
  const el=elements.get(id)||button(id);
  let prevented=false,stopped=false,received=false;
  const event={target:el,
   preventDefault(){prevented=true;},
   stopImmediatePropagation(){stopped=true;}};
  capture(event);
  if(!stopped&&el.handlers.click){received=true;el.handlers.click(event);}
  return {prevented,stopped,received};
 }
 assert.deepEqual(fire('installPwa'),{prevented:false,stopped:false,received:true});
 assert.match(elements.get('pwaInstallTip').textContent,/Chrome 或 Edge/);
 assert.deepEqual(fire('pwaUpdateNow'),{prevented:false,stopped:false,received:true});
 assert.deepEqual(messages,['SKIP_WAITING'],'manual update reaches waiting SW');
 assert.equal(elements.get('pwaUpdateNow').disabled,true);
 for(const id of ['unknownBusinessAction','buyNow','saveProfile']){
  const e=fire(id);
  assert.equal(e.prevented,true,id);
  assert.equal(e.stopped,true,id);
  assert.equal(e.received,false,id);
 }
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(submissions,0,'no cloud or local write reached');
 assert.equal(notifications.length,3,'three unknown/legacy business commands were intercepted');
 bound.detach();
});
