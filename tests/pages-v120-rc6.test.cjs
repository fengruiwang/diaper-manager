const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc6');
const read=p=>fs.readFileSync(path.join(ROOT,p)),file=p=>fs.readFileSync(path.join(OUT,p)),text=p=>file(p).toString('utf8');
const expected=['.nojekyll','index.html','m1-controller.js','formal-controller.js','pwa.js','sw.js','version.json','manifest.webmanifest','growth.js','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg'];
test('RC6 package has complete resources and audited source provenance',()=>{
 const v=JSON.parse(text('version.json'));assert.equal(v.version,'1.2.0-rc.6');assert.equal(v.channel,'release-candidate');assert.equal(v.source_sha,'16a6a15d0d158b288e331c4b9d1d6abea72d42c3');
 const actual=[];function walk(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(dir,e.name),p);else actual.push(p);}}walk(OUT);assert.deepEqual(actual.sort(),expected.sort());
 assert.deepEqual(file('m1-controller.js'),read('preview/v1.2.0/m1-controller.js'));assert.deepEqual(file('pwa.js'),read('scripts/pages-v120-pwa.js'));assert.deepEqual(file('growth.js'),read('growth.js'));assert.deepEqual(file('manifest.webmanifest'),read('manifest.webmanifest'));
 for(const p of expected.filter(x=>x.startsWith('icons/')))assert.deepEqual(file(p),read(p));
});
test('RC6 opens all implemented authenticated write domains without extra operator approval',()=>{
 const c=text('formal-controller.js'),h=text('index.html');for(const flag of ["const FORMAL_WRITE_ENABLED=true;","const FORMAL_DOCUMENT_WRITE_ENABLED=true;","const FORMAL_PURCHASE_ENABLED=true;","purchaseOperatorApproved:()=>FORMAL_PURCHASE_ENABLED","purchaseOnly:true,allowConsume:true,allowReverse:true","allowStocktake:true,allowBatchStocktake:true,fastBatchStocktake:true","allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true","allowSettings:true,"])assert.ok(c.includes(flag),'missing '+flag);
 assert.match(c,/documentOperatorApproved:\(\)=>documentWritesEnabled===true/);assert.match(c,/cloudWritesEnabled:FORMAL_DOCUMENT_WRITE_ENABLED/);assert.match(c,/cloudWritesEnabled:purchaseReleaseEnabled===true/);
 assert.doesNotMatch(c,/const FORMAL_(?:WRITE|DOCUMENT_WRITE|PURCHASE)_ENABLED=false;/);assert.doesNotMatch(h,/所有云端操作只读|正式业务写入尚未批准|M3 独立预览/);assert.doesNotMatch(h,/多尺码批量盘点功能尚未开放/);
});
test('RC6 includes T03 single and batch stocktake restore fix and isolated PWA resources',()=>{
 const c=text('formal-controller.js'),h=text('index.html'),sw=text('sw.js');assert.match(c,/expectedStocktake===null/);assert.match(c,/expectedBatch===null/);
 assert.match(c,/verified\.revisions\[expectedStocktake\.size\]>expectedStocktake\.expectedRevision/);assert.match(c,/verified\.revisions\[item\.size\]>item\.expectedRevision/);
 assert.match(h,/src="\.\/m1-controller\.js\?v=rc6"/);assert.match(h,/src="\.\/formal-controller\.js\?v=rc6"/);assert.match(h,/src="\.\/pwa\.js\?v=rc6"/);assert.doesNotMatch(h,/<script[^>]*src="\.\.\//);assert.doesNotMatch(h,/\/xb-test\//);
 assert.match(sw,/xiaobao-shell-v1\.2\.0-rc6/);for(const p of ['index.html','m1-controller.js','formal-controller.js','pwa.js','growth.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg'])assert.ok(sw.includes("'./"+p+"'"),p);
 assert.doesNotMatch(sw,/localStorage\.(?:clear|removeItem)|indexedDB\.deleteDatabase/);
});
test('RC6 embeds current reviewed CloudBase operation modules',()=>{
 const h=text('index.html');for(const p of ['sync/primary-cloud-read-model.js','sync/primary-cloud-operations.js','sync/primary-documents-client.js','sync/primary-documents-operations.js','sync/primary-documents-business-commands.js','sync/primary-stocktake-batch-client.js','sync/inventory-outbox-runner.js','sync/inventory-sync-reader.js'])assert.ok(h.includes(read(p).toString('utf8').trim()),'inline parity '+p);
 // RC6 captures the current audited Feature action module, allowing only
 // the pre-existing candidate-only batch-unavailable wording replacement.
 const current=read('sync/primary-formal-ui-actions.js').toString('utf8').trim()
  .replace('多尺码批量盘点功能尚未开放，请等待下一阶段。',
   '多尺码批量盘点暂时不可用，请刷新后重试；本次未保存任何库存修改。');
 assert.ok(h.includes(current),'T04 Feature action module parity');
 assert.ok(h.includes(read('sync/primary-business-commands.js').toString('utf8').trim()),
  'T04 Feature operation commands parity');
});
test('RC6 serves every resource below isolated /pages-rc6/ path',async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/pages-rc6/')){res.writeHead(404).end();return;}const rel=decodeURIComponent(url.pathname.slice('/pages-rc6/'.length))||'index.html';const target=path.resolve(OUT,rel);if(!(target===OUT||target.startsWith(OUT+path.sep))){res.writeHead(403).end();return;}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end();return;}const ext=path.extname(target);res.setHeader('Content-Type',ext==='.js'?'application/javascript':ext==='.json'||ext==='.webmanifest'?'application/json':ext==='.html'?'text/html; charset=utf-8':ext==='.svg'?'image/svg+xml':'application/octet-stream');res.writeHead(200);res.end(data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const origin='http://127.0.0.1:'+server.address().port+'/pages-rc6/';for(const p of expected.filter(x=>x!=='.nojekyll')){const r=await fetch(origin+p);assert.equal(r.status,200,'GET '+p);assert.ok((await r.arrayBuffer()).byteLength>0,'empty '+p);}}finally{await new Promise(resolve=>server.close(resolve));}
});

test('RC6 T04-P1/P2 and R01-02 protections are present in the released business modules',()=>{
 const h=text('index.html'),c=text('formal-controller.js');
 assert.match(h,/PRIMARY_DAILY_SETTINGS_LOADING/);
 assert.match(h,/PRIMARY_DAILY_SETTINGS_UNVERIFIED/);
 assert.match(h,/dailySettingsStatus==='verified'/);
 assert.match(h,/OFFLINE_FORMAL_QUEUE_NOT_APPROVED/);
 assert.match(h,/PRIMARY_QUEUE_UNVERIFIED_PRESERVE_ORIGINAL_ID/);
 assert.match(h,/isOnline\(\)===false/);
 assert.match(c,/isOnline:\(\)=>host\.navigator\?\.onLine!==false/);
 assert.match(c,/正在检查登录状态…/);
 assert.match(c,/正在获取家庭与库存数据…/);
 assert.match(c,/正在核对本机库存…/);
 assert.match(h,/id="formalGateMessage" role="status" aria-live="polite">正在检查登录状态…/);
 assert.match(h,/欢迎使用小宝管家，请使用邮箱验证码登录。/);
});
test('RC6 all 009/026/027 inline operation modules match audited Feature inputs',()=>{
 const h=text('index.html');
 for(const source of [
  'sync/primary-business-commands.js','sync/primary-formal-ui-actions.js',
  'sync/primary-cloud-operations.js','sync/primary-documents-client.js',
  'sync/primary-documents-operations.js','sync/primary-documents-business-commands.js',
  'sync/primary-stocktake-batch-client.js','sync/inventory-outbox-runner.js',
  'sync/inventory-sync-reader.js']){
  let raw=read(source).toString('utf8').trim();
  if(source==='sync/primary-formal-ui-actions.js')
   raw=raw.replace('多尺码批量盘点功能尚未开放，请等待下一阶段。',
    '多尺码批量盘点暂时不可用，请刷新后重试；本次未保存任何库存修改。');
  assert.ok(h.includes(raw),'missing current Feature module '+source);
 }
});
test('RC6 standalone cache, candidate-only URLs, manifest and provenance remain isolated',()=>{
 const h=text('index.html'),c=text('formal-controller.js'),sw=text('sw.js');
 const v=JSON.parse(text('version.json')),manifest=JSON.parse(text('manifest.webmanifest'));
 assert.equal(v.source_sha,'16a6a15d0d158b288e331c4b9d1d6abea72d42c3');
 assert.match(h,/xiaobao-pages-candidate-source" content="16a6a15d0d158b288e331c4b9d1d6abea72d42c3"/);
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 assert.equal(manifest.id,'./');
 assert.match(sw,/const CACHE_NAME = 'xiaobao-shell-v1\.2\.0-rc6';/);
 assert.match(sw,/const CACHE_PREFIX = 'xiaobao-shell-v1\.2\.0-rc6';/);
 assert.doesNotMatch(h,/(?:src|href)="[^"]*(?:\/xb-test\/|pages-rc5|rc5|preview\/v1\.2\.0)/);
 assert.doesNotMatch(c,/\bindexedDB\.deleteDatabase\b/);
 assert.doesNotMatch(sw,/\bindexedDB\.deleteDatabase\b|localStorage\.clear/);
 assert.match(h,/\.\/m1-controller\.js\?v=rc6/);
 assert.match(h,/\.\/formal-controller\.js\?v=rc6/);
 assert.match(h,/\.\/pwa\.js\?v=rc6/);
 assert.doesNotMatch(h,/<script[^>]*src="\.\.\//);
});
