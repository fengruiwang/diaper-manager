const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc5');
const read=p=>fs.readFileSync(path.join(ROOT,p)),file=p=>fs.readFileSync(path.join(OUT,p)),text=p=>file(p).toString('utf8');
const expected=['.nojekyll','index.html','m1-controller.js','formal-controller.js','pwa.js','sw.js','version.json','manifest.webmanifest','growth.js','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg'];
test('RC5 package has complete resources and audited source provenance',()=>{
 const v=JSON.parse(text('version.json'));assert.equal(v.version,'1.2.0-rc.5');assert.equal(v.channel,'release-candidate');assert.equal(v.source_sha,'95052656b463a33cfd74394e6acace87f67ec458');
 const actual=[];function walk(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(dir,e.name),p);else actual.push(p);}}walk(OUT);assert.deepEqual(actual.sort(),expected.sort());
 assert.deepEqual(file('m1-controller.js'),read('preview/v1.2.0/m1-controller.js'));assert.deepEqual(file('pwa.js'),read('scripts/pages-v120-pwa.js'));assert.deepEqual(file('growth.js'),read('growth.js'));assert.deepEqual(file('manifest.webmanifest'),read('manifest.webmanifest'));
 for(const p of expected.filter(x=>x.startsWith('icons/')))assert.deepEqual(file(p),read(p));
});
test('RC5 opens all implemented authenticated write domains without extra operator approval',()=>{
 const c=text('formal-controller.js'),h=text('index.html');for(const flag of ["const FORMAL_WRITE_ENABLED=true;","const FORMAL_DOCUMENT_WRITE_ENABLED=true;","const FORMAL_PURCHASE_ENABLED=true;","purchaseOperatorApproved:()=>FORMAL_PURCHASE_ENABLED","purchaseOnly:true,allowConsume:true,allowReverse:true","allowStocktake:true,allowBatchStocktake:true,fastBatchStocktake:true","allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true","allowSettings:true,"])assert.ok(c.includes(flag),'missing '+flag);
 assert.match(c,/documentOperatorApproved:\(\)=>documentWritesEnabled===true/);assert.match(c,/cloudWritesEnabled:FORMAL_DOCUMENT_WRITE_ENABLED/);assert.match(c,/cloudWritesEnabled:purchaseReleaseEnabled===true/);
 assert.doesNotMatch(c,/const FORMAL_(?:WRITE|DOCUMENT_WRITE|PURCHASE)_ENABLED=false;/);assert.doesNotMatch(h,/所有云端操作只读|正式业务写入尚未批准|M3 独立预览/);assert.doesNotMatch(h,/多尺码批量盘点功能尚未开放/);
});
test('RC5 includes T03 single and batch stocktake restore fix and isolated PWA resources',()=>{
 const c=text('formal-controller.js'),h=text('index.html'),sw=text('sw.js');assert.match(c,/expectedStocktake===null/);assert.match(c,/expectedBatch===null/);
 assert.match(c,/verified\.revisions\[expectedStocktake\.size\]>expectedStocktake\.expectedRevision/);assert.match(c,/verified\.revisions\[item\.size\]>item\.expectedRevision/);
 assert.match(h,/src="\.\/m1-controller\.js\?v=rc5"/);assert.match(h,/src="\.\/formal-controller\.js\?v=rc5"/);assert.match(h,/src="\.\/pwa\.js\?v=rc5"/);assert.doesNotMatch(h,/<script[^>]*src="\.\.\//);assert.doesNotMatch(h,/\/xb-test\//);
 assert.match(sw,/xiaobao-shell-v1\.2\.0-rc5/);for(const p of ['index.html','m1-controller.js','formal-controller.js','pwa.js','growth.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg'])assert.ok(sw.includes("'./"+p+"'"),p);
 assert.doesNotMatch(sw,/localStorage\.(?:clear|removeItem)|indexedDB\.deleteDatabase/);
});
test('RC5 embeds current reviewed CloudBase operation modules',()=>{
 const h=text('index.html');for(const p of ['sync/primary-cloud-read-model.js','sync/primary-cloud-operations.js','sync/primary-documents-client.js','sync/primary-documents-operations.js','sync/primary-documents-business-commands.js','sync/primary-stocktake-batch-client.js','sync/inventory-outbox-runner.js','sync/inventory-sync-reader.js'])assert.ok(h.includes(read(p).toString('utf8').trim()),'inline parity '+p);
 // rc5 stays frozen at its recorded source SHA. Later Feature fixes must not
 // retroactively change the immutable candidate's embedded action module.
 assert.match(h,/const count=day\?Math\.min\(stock,Math\.round\(Math\.max\(1,/);
 assert.doesNotMatch(h,/PRIMARY_DAILY_SETTINGS_(?:LOADING|UNVERIFIED|INVALID)/);
});
test('RC5 serves every resource below isolated /pages-rc5/ path',async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/pages-rc5/')){res.writeHead(404).end();return;}const rel=decodeURIComponent(url.pathname.slice('/pages-rc5/'.length))||'index.html';const target=path.resolve(OUT,rel);if(!(target===OUT||target.startsWith(OUT+path.sep))){res.writeHead(403).end();return;}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end();return;}const ext=path.extname(target);res.setHeader('Content-Type',ext==='.js'?'application/javascript':ext==='.json'||ext==='.webmanifest'?'application/json':ext==='.html'?'text/html; charset=utf-8':ext==='.svg'?'image/svg+xml':'application/octet-stream');res.writeHead(200);res.end(data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const origin='http://127.0.0.1:'+server.address().port+'/pages-rc5/';for(const p of expected.filter(x=>x!=='.nojekyll')){const r=await fetch(origin+p);assert.equal(r.status,200,'GET '+p);assert.ok((await r.arrayBuffer()).byteLength>0,'empty '+p);}}finally{await new Promise(resolve=>server.close(resolve));}
});
