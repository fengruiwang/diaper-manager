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
test('P4-04A candidate is complete and generated scripts exactly reuse existing proven sources',()=>{
 for(const p of expected)assert.ok(fs.existsSync(path.join(OUT,p)),p);
 assert.deepEqual(c('m1-controller.js'),load('preview/v1.2.0/m1-controller.js'));
 assert.deepEqual(c('formal-controller.js'),load('preview/v1.2.0/formal-controller.js'));
 assert.deepEqual(c('growth.js'),load('growth.js'));
 assert.deepEqual(c('pwa.js'),load('scripts/pages-v120-pwa.js'));
 for(const icon of expected.filter(x=>x.startsWith('icons/')))
  assert.deepEqual(c(icon),load(icon));
 const html=text('index.html');
 for(const script of ['./m1-controller.js?v=e52cfdd',
  './formal-controller.js?v=e52cfdd','./pwa.js?v=e52cfdd'])
  assert.ok(html.includes('src="'+script+'"'),script);
 assert.ok(html.indexOf('src="./m1-controller')<html.indexOf('src="./formal-controller'));
 for(const name of ['primary-documents-operations','primary-documents-business-commands',
  'primary-documents-client','primary-formal-ui-actions','idb-outbox',
  'outbox-contract','primary-cloud-operations','inventory-client'])
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
 assert.equal(version.version,'1.2.0-rc.1');
 assert.equal(version.channel,'release-candidate');
 assert.equal(version.source_sha,'e52cfdd7a24cc74018e429d6b0a021967ef58b7e');
});
test('P4-04A new SW shell uses a distinct cache and manual-only update, never clears data',()=>{
 const sw=text('sw.js'),pwa=text('pwa.js'),index=text('index.html');
 assert.match(sw,/xiaobao-shell-v1\.2\.0-rc1/);
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
 assert.match(index,/src="\.\/pwa\.js\?v=e52cfdd"/);
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
