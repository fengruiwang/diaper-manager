'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const files=[
 '.nojekyll','index.html','formal-controller.js','m1-controller.js','growth.js','pwa.js','sw.js',
 'manifest.webmanifest','version.json','outbox-contract.js','idb-outbox.js','maternal-health-client.js',
 'maternal-health-operations.js','maternal-weight.js','maternal-constipation.js',
 'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg',
];
const text=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
test('main production contains all 20 approved V1.3.0 stable files',()=>{
 for(const p of files)assert.ok(fs.existsSync(path.join(ROOT,p)),p);
});
test('provenance, version and CloudBase write gates are verified',()=>{
 const v=JSON.parse(text('version.json')), c=text('formal-controller.js');
 assert.equal(v.version,'1.3.0');
 assert.equal(v.source_sha,'734e8730cf8f263fd210cd8917c898db98b1d88b');
 assert.equal(v.channel,'stable');
 for(const flag of ['const FORMAL_WRITE_ENABLED=true;','const FORMAL_DOCUMENT_WRITE_ENABLED=true;','const FORMAL_PURCHASE_ENABLED=true;'])assert.ok(c.includes(flag),flag);
});
test('T04 trusted daily, unqueued offline and login stages are present',()=>{
 const h=text('index.html'),c=text('formal-controller.js');
 for(const marker of ["dailySettingsStatus!=='verified'",'OFFLINE_FORMAL_QUEUE_NOT_APPROVED','PRIMARY_QUEUE_UNVERIFIED_PRESERVE_ORIGINAL_ID'])assert.ok(h.includes(marker),marker);
 assert.ok(c.includes("const BOOT_MESSAGE='正在进入小宝管家…'"));
 assert.ok(h.includes('id="formalGateMessage" role="status" aria-live="polite">正在进入小宝管家…'));
 assert.ok(c.includes("const viewingCache=Boolean(cachedPreview)&&next==='cached'"));
});
test('V1.1.2 localStorage data is not loaded, overwritten or cleared by V1.3.0',()=>{
 const h=text('index.html'),sw=text('sw.js');
 assert.match(h,/function load\(\)\{return defaults\(\);\}/);
 assert.match(h,/function save\(\)\{return false;\}/);
 assert.doesNotMatch(h,/\bindexedDB\.deleteDatabase\b|\blocalStorage\.clear\s*\(/);
 assert.doesNotMatch(sw,/\bindexedDB\.deleteDatabase\b|\blocalStorage\.clear\s*\(/);
});
test('GitHub Pages root PWA paths, versioned scripts and cache are isolated',()=>{
 const h=text('index.html'),sw=text('sw.js'),manifest=JSON.parse(text('manifest.webmanifest'));
 for(const p of [
  './m1-controller.js?v=1.3.0','./outbox-contract.js?v=1.3.0','./idb-outbox.js?v=1.3.0',
  './maternal-health-client.js?v=1.3.0','./maternal-health-operations.js?v=1.3.0',
  './maternal-weight.js?v=1.3.0','./maternal-constipation.js?v=1.3.0',
  './formal-controller.js?v=1.3.0','./pwa.js?v=1.3.0',
 ])assert.ok(h.includes(p),p);
 assert.doesNotMatch(h,/<script[^>]*src="\.\.\//);
 assert.match(sw,/const CACHE_NAME = 'xiaobao-shell-v1\.3\.0';/);
 assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
});
test('every production resource responds at a root-scoped HTTP path',async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),rel=decodeURIComponent(url.pathname.slice(1))||'index.html';
  const target=path.resolve(ROOT,rel);
  if(!target.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(target,(err,bytes)=>err?res.writeHead(404).end():res.writeHead(200).end(bytes));
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{const origin='http://127.0.0.1:'+server.address().port+'/';
  for(const p of files.filter(p=>p!=='.nojekyll')){
   const r=await fetch(origin+p);assert.equal(r.status,200,p);
   assert.ok((await r.arrayBuffer()).byteLength>0,p);
  }
 }finally{await new Promise(ok=>server.close(ok));}
});
