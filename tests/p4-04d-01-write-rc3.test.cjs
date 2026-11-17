const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc3');
const read=p=>fs.readFileSync(path.join(ROOT,p));
const file=p=>fs.readFileSync(path.join(OUT,p));
const str=p=>file(p).toString('utf8');
const expected=['.nojekyll','index.html','formal-controller.js','m1-controller.js',
 'pwa.js','sw.js','growth.js','manifest.webmanifest','version.json',
 'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png',
 'icons/apple-touch-icon.png','icons/icon.svg'];
test('P4-04D rc3 has complete independent immutable assets and new PWA identity',()=>{
 for(const p of expected)assert.ok(fs.existsSync(path.join(OUT,p)),p);
 const version=JSON.parse(str('version.json'));
 assert.equal(version.version,'1.2.0-rc.3');
 assert.equal(version.source_sha,'693cdcb96e3a2136136564a152451a3ecba9dcc5');
 assert.deepEqual(file('manifest.webmanifest'),read('manifest.webmanifest'));
 for(const p of expected.filter(x=>x.startsWith('icons/')))assert.deepEqual(file(p),read(p));
 for(const p of ['growth.js','m1-controller.js','pwa.js']){
  const source=p==='m1-controller.js'?'preview/v1.2.0/m1-controller.js':
   p==='pwa.js'?'scripts/pages-v120-pwa.js':p;
  assert.deepEqual(file(p),read(source),p);
 }
 const shell=str('sw.js'),html=str('index.html');
 assert.match(shell,/xiaobao-shell-v1\.2\.0-rc3/);
 assert.doesNotMatch(shell,/xiaobao-shell-v1\.2\.0-rc2/);
 for(const name of ['m1-controller','formal-controller','pwa'])
  assert.match(html,new RegExp('./'+name+'\\.js\\?v=p404d01'));
 assert.doesNotMatch(html,/p404c01|1\.2\.0-rc\.2|\/xb-test\/|src="\.\.\//);
 assert.doesNotMatch(shell+str('pwa.js'),/localStorage\.(?:clear|removeItem|setItem)|indexedDB\.deleteDatabase/);
});
test('P4-04D candidate enables both write domains and explicit user-approved business submit',()=>{
 const control=str('formal-controller.js'),html=str('index.html');
 assert.match(control,/const FORMAL_WRITE_ENABLED=true;/);
 assert.match(control,/const FORMAL_PURCHASE_ENABLED=true;/);
 assert.match(control,/purchaseOperatorApproved:\(\)=>true/);
 assert.match(control,/documentOperatorApproved:\(\)=>documentWritesEnabled===true/);
 assert.match(control,/primaryFactory:\(\{controller,host,cloudWritesEnabled=false\}\)=>/);
 assert.match(control,/purchaseOnly:true,allowConsume:true,allowReverse:true/);
 assert.match(control,/allowStocktake:true/);
 assert.match(control,/referenceAndQuotes:true,allowGrowth:true,allowProfile:true,allowSettings:true/);
 assert.match(control,/readModelFactory:cloud=>/);
 assert.match(control,/scopeGuard:root\.XBChildScopeGuard/);
 assert.match(control,/accessPreflight:root\.XBCloudbaseAccessPreflight/);
 assert.match(control,/documentsOverlay:root\.XBPrimaryDocumentsOverlay/);
 assert.match(control,/batchStocktakeFactory:/);
 assert.match(control,/onPurchaseReadback:/);
 assert.match(control,/onReferenceReadback:/);
 assert.match(control,/onQuotesReadback:/);
 assert.match(control,/onGrowthReadback:/);
 assert.match(control,/onProfileReadback:/);
 assert.match(control,/onSettingsReadback:/);
 assert.match(html,/id="formalRefresh"/);
 assert.match(html,/id="formalSyncNow"/);
 assert.match(html,/id="formalResolveDocumentConflict"/);
 assert.match(control,/正在刷新云端数据/);
 assert.match(control,/已同步 · /);
 assert.doesNotMatch(html,/正式业务测试入口|提交待同步操作（尚未授权）|家庭云端数据<\/strong>/);
 assert.match(html,/id="formalNotice" role="status"/);
 assert.doesNotMatch(html,/<button[^>]*(?:id="m3Demo"|id="m102Create")/);
 for(const m of ['primary-business-date','primary-ui-projection','primary-business-commands']){
  assert.ok(html.includes(read('sync/'+m+'.js').toString('utf8').trim()),m);
 }
 assert.match(html,/xb_apply_inventory_operation/);
 assert.match(html,/xb_put_primary_document_draft/);
 assert.match(html,/xb_check_primary_document_request_draft/);
 assert.match(html,/xb_primary_stocktake_batch_draft/);
 assert.match(html,/xb_read_primary_stocktake_batch_receipt_draft/);
 assert.doesNotMatch(html,/<script[^>]+src="\.\.\//);
});
test('P4-04D original V1.1.2 and read-only rc2 are not converted into write builds',()=>{
 assert.equal(JSON.parse(read('version.json').toString()).version,'1.1.2');
 assert.equal(JSON.parse(read('release-candidate/pages-v1.2.0/version.json').toString()).version,'1.2.0-rc.2');
 assert.match(read('release-candidate/pages-v1.2.0/formal-controller.js').toString(),
  /const FORMAL_WRITE_ENABLED=false;/);
 assert.match(read('release-candidate/pages-v1.2.0/formal-controller.js').toString(),
  /const FORMAL_PURCHASE_ENABLED=false;/);
 assert.match(read('preview/v1.2.0/formal-controller.js').toString(),
  /const FORMAL_WRITE_ENABLED=false;/);
 const html=str('index.html');
 for(const id of ['exportData','importDataBtn','resetAll','importFile'])
  assert.match(html,new RegExp('id="'+id+'"\\s+disabled'));
 assert.doesNotMatch(html,/id="pwaImportOld"/);
});
test('P4-04D isolated HTTP host serves all fourteen rc3 resources under target subpath',async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/xb-test/pages-rc3/'))return res.writeHead(404).end();
  const relative=decodeURIComponent(pathname.slice('/xb-test/pages-rc3/'.length))||'index.html';
  const absolute=path.resolve(OUT,relative);
  if(!absolute.startsWith(OUT+path.sep))return res.writeHead(403).end();
  fs.readFile(absolute,(error,bytes)=>{
   if(error)return res.writeHead(404).end();
   res.writeHead(200);res.end(bytes);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const root='http://127.0.0.1:'+server.address().port+'/xb-test/pages-rc3/';
  for(const p of ['index.html',...expected.filter(x=>x!=='.nojekyll')]){
   const r=await fetch(root+p);
   assert.equal(r.status,200,p);
   assert.ok((await r.arrayBuffer()).byteLength>0,p);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
