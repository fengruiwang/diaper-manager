/* T05-RC7-01 isolated candidate/PWA root-upgrade contract, no deployment. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'release-candidate/pages-v1.2.0-rc7');
const read=(file)=>fs.readFileSync(path.join(OUT,file),'utf8');
test('RC7 matches current reviewed Feature inputs byte for byte',()=>{
 const stdout=execFileSync(process.execPath,[path.join(ROOT,'scripts/build-pages-v120-rc7.cjs'),'--check'],{encoding:'utf8'});
 assert.match(stdout,/T05_RC7_01_PARITY_PASS 1\.2\.0-rc\.7 14/);
});
test('same-origin installed PWA manifest identity remains unchanged',()=>{
 const current=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'));
 const candidate=JSON.parse(read('manifest.webmanifest'));
 assert.deepEqual(candidate,current);
 for(const field of ['id','start_url','scope'])assert.equal(candidate[field],'./');
 for(const field of ['name','short_name','icons'])assert.deepEqual(candidate[field],current[field]);
});
test('RC7 SW updates shell only, preserves explicit user-controlled activation and old-cache cleanup',()=>{
 const sw=read('sw.js'),pwa=read('pwa.js');
 assert.match(sw,/const CACHE_NAME = 'xiaobao-shell-v1\.2\.0-rc7'/);
 assert.match(sw,/const CACHE_PREFIX = 'xiaobao-shell-'/);
 assert.match(sw,/k\.startsWith\(CACHE_PREFIX\) && k !== CACHE_NAME/);
 assert.match(sw,/cache\.addAll\(SHELL_URLS/);
 assert.match(sw,/if\(event\.data && event\.data\.type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/);
 assert.doesNotMatch(sw,/indexedDB\.deleteDatabase|localStorage\.clear|localStorage\.removeItem/);
 assert.match(pwa,/window\.confirm\(/);
 assert.match(pwa,/registration\.waiting\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
 assert.match(pwa,/if\(updating&&controlledBefore\)window\.location\.reload\(\)/);
});
test('RC7 metadata and shell entrypoints are complete',()=>{
 const meta=JSON.parse(read('version.json'));
 assert.equal(meta.version,'1.2.0-rc.7');
 assert.equal(meta.source_sha,'1e575db0918fb14ed4839e7fa85798b9e42fdabf');
 const html=read('index.html');
 for(const part of ['m1-controller.js?v=rc7','formal-controller.js?v=rc7','pwa.js?v=rc7','manifest.webmanifest'])
  assert.ok(html.includes(part),'missing '+part);
 assert.match(read('formal-controller.js'),/const FORMAL_WRITE_ENABLED=true;/);
 assert.ok(!html.includes('/xb-test/'));
 const expected=['.nojekyll','manifest.webmanifest','growth.js','pwa.js','m1-controller.js','index.html','formal-controller.js','sw.js','version.json','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','icons/icon.svg'];
 for(const file of expected)assert.ok(fs.statSync(path.join(OUT,file)).isFile(),file);
});
