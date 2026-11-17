const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc4');
const read=p=>fs.readFileSync(path.join(ROOT,p));
const candidate=p=>fs.readFileSync(path.join(OUT,p));
const txt=p=>candidate(p).toString('utf8');
const files=['.nojekyll','index.html','formal-controller.js','m1-controller.js',
 'pwa.js','growth.js','sw.js','manifest.webmanifest','version.json',
 'icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png',
 'icons/icon-maskable-512.png','icons/icon.svg'];
test('P4-04C-02 rc4 14 files, version, PWA scope, all images, SW cache and original data paths',()=>{
 assert.deepEqual(fs.readdirSync(OUT).sort(),
  ['.nojekyll','formal-controller.js','growth.js','icons','index.html',
   'm1-controller.js','manifest.webmanifest','pwa.js','sw.js','version.json'].sort());
 for(const name of files)assert.ok(fs.existsSync(path.join(OUT,name)),name);
 const ver=JSON.parse(txt('version.json'));
 assert.equal(ver.version,'1.2.0-rc.4');
 assert.equal(ver.source_sha,'a637dac357c27331e92ecff67a717b4d14e2bcc1');
 const original=JSON.parse(read('manifest.webmanifest'));
 const manifest=JSON.parse(txt('manifest.webmanifest'));
 assert.deepEqual(manifest,original);
 assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
 for(const name of files.filter(x=>x.startsWith('icons/')))
  assert.deepEqual(candidate(name),read(name),name);
 assert.match(txt('sw.js'),/xiaobao-shell-v1\.2\.0-rc4/);
 assert.doesNotMatch(txt('sw.js'),/xiaobao-shell-v1\.2\.0-rc[123]/);
 assert.deepEqual(candidate('pwa.js'),read('scripts/pages-v120-pwa.js'));
 assert.deepEqual(candidate('m1-controller.js'),read('preview/v1.2.0/m1-controller.js'));
 assert.deepEqual(candidate('growth.js'),read('growth.js'));
 assert.equal(JSON.parse(read('version.json')).version,'1.1.2');
 assert.doesNotMatch(txt('sw.js')+txt('pwa.js'),/indexedDB\.deleteDatabase|localStorage\.clear\(/);
});
test('P4-04C-02 status is a compact line after tabs; real pending and conflict actions remain reachable',()=>{
 const html=txt('index.html'),ctrl=txt('formal-controller.js');
 assert.ok(html.indexOf('id="formalNotice"')>html.indexOf('</nav>'));
 assert.match(html,/class="sync-line" id="formalNotice"/);
 assert.doesNotMatch(html,/class="card" id="formalNotice"/);
 assert.match(html,/id="formalSyncNow"[^>]*hidden disabled/);
 assert.match(html,/id="formalResolveDocumentConflict"[^>]*hidden disabled/);
 assert.match(html,/id="formalResolveBatchConflict"[^>]*hidden disabled/);
 assert.match(ctrl,/requireComplete:true/);
 assert.match(ctrl,/confirmedFullRead\(\)/);
 assert.match(ctrl,/sharedBusinessDocumentsVerified!==true/);
 assert.match(ctrl,/正在刷新…/);
 assert.match(ctrl,/已同步 · /);
 assert.match(ctrl,/pendingReviewSerial/);
 assert.match(ctrl,/BATCH_CONFLICT_ABANDONED/);
 assert.match(ctrl,/on\('formalResolveBatchConflict'/);
 assert.match(ctrl,/on\('formalResolveDocumentConflict'/);
 assert.doesNotMatch(html,/本候选版仅读取授权家庭|所有云端操作只读|本测试版本关闭云端写入/);
 assert.match(html,/本版本尚不支持云端整库导入、导出或一键清空/);
 for(const id of ['exportData','importDataBtn','resetAll','importFile'])
  assert.match(html,new RegExp('id="'+id+'"\\s+disabled'));
});
test('P4-04C-02 rc4 has all write domains, original UUID/readback, C-01 and latest C-03 sources',()=>{
 const html=txt('index.html'),ctrl=txt('formal-controller.js');
 assert.match(ctrl,/const FORMAL_WRITE_ENABLED=true;/);
 assert.match(ctrl,/const FORMAL_PURCHASE_ENABLED=true;/);
 assert.match(ctrl,/purchaseOperatorApproved:\(\)=>true/);
 assert.match(ctrl,/documentOperatorApproved:\(\)=>documentWritesEnabled===true/);
 for(const name of ['primary-business-date','primary-business-commands',
  'primary-ui-projection','primary-stocktake-batch-client','idb-outbox',
  ]){
  assert.ok(html.includes(read('sync/'+name+'.js').toString('utf8').trim()),
   'rc4 inline source not current: '+name);
 }
 assert.match(html,/XBPrimaryFormalUIActions/);
 assert.match(html,/abandonStocktakeBatchConflict/);
 assert.match(html,/BATCH_CONFLICT_ABANDONED/);
 for(const rpc of ['xb_apply_inventory_operation','xb_put_primary_document_draft',
  'xb_check_primary_document_request_draft','xb_primary_stocktake_batch_draft',
  'xb_read_primary_stocktake_batch_receipt_draft'])
  assert.match(html,new RegExp(rpc));
 for(const id of ['m1-controller','formal-controller','pwa'])
  assert.ok(html.includes('./'+id+'.js?v=p404c02'));
 assert.doesNotMatch(html,/src="\.\.\//);
 assert.doesNotMatch(html,/\/xb-test\//);
});
test('P4-04C-02 previous rc2 and rc3 artifacts remain frozen and main stays V1.1.2',()=>{
 const frozen=require('../scripts/verify-v120-frozen-candidates.cjs');
 frozen.check('rc2');frozen.check('rc3');frozen.check('rc4');
 const old=txt('version.json');
 assert.match(old,/rc\.4/);
 assert.equal(JSON.parse(read('release-candidate/pages-v1.2.0-rc3/version.json')).version,
  '1.2.0-rc.3');
 assert.equal(JSON.parse(read('release-candidate/pages-v1.2.0/version.json')).version,
  '1.2.0-rc.2');
});
test('P4-04C-02 isolated target path serves all 14 resources without deployment',async()=>{
 const srv=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost').pathname;
  if(!url.startsWith('/xb-test/pages-rc4/'))return res.writeHead(404).end();
  const relative=decodeURIComponent(url.slice('/xb-test/pages-rc4/'.length))||'index.html';
  const full=path.resolve(OUT,relative);
  if(!full.startsWith(OUT+path.sep))return res.writeHead(403).end();
  fs.readFile(full,(err,bytes)=>{
   if(err)return res.writeHead(404).end();
   res.writeHead(200);res.end(bytes);
  });
 });
 await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
 try{
  const base='http://127.0.0.1:'+srv.address().port+'/xb-test/pages-rc4/';
  for(const name of files.filter(x=>x!=='.nojekyll')){
   const res=await fetch(base+name);
   assert.equal(res.status,200,name);
   assert.ok((await res.arrayBuffer()).byteLength>0,name);
  }
 }finally{await new Promise(ok=>srv.close(ok));}
});
