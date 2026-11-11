const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const script=read('cloudbase/smoke/idb-offline-sw.js');
const html=read('cloudbase/smoke/idb-offline-test.html');
const base='https://example.test/xb-test/';
const page=base+'idb-offline-test.html';

function setup(){
 const handlers=new Map(),responses=new Map(),deleted=[],networkRequests=[];
 let networkOn=true;
 const cache={
  async match(url){return responses.get(url)||undefined;},
  async put(url,response){responses.set(url,response);}
 };
 const cacheNames=['other-app-cache','xiaobao-p3-idb-offline-shell-old',
  'xiaobao-p3-idb-offline-shell-v1'];
 const caches={
  async open(name){assert.equal(name,'xiaobao-p3-idb-offline-shell-v1');return cache;},
  async keys(){return cacheNames;},
  async delete(name){deleted.push(name);return true;}
 };
 const serviceWorker={
  location:{href:base+'idb-offline-sw.js'},
  clients:{claim:async()=>{}},
  skipWaiting:async()=>{},
  addEventListener(name,fn){handlers.set(name,fn);}
 };
 const fetch=async(url)=>{
  const href=typeof url==='string'?url:url.url;
  networkRequests.push(href);
  if(!networkOn)throw Error('network_offline');
  return {ok:true,content:'synthetic diagnostic page',clone(){return this;}};
 };
 vm.runInNewContext(script,{self:serviceWorker,caches,fetch,URL});
 async function lifecycle(name){
  let pending;
  handlers.get(name)({waitUntil(p){pending=p;}});
  assert.ok(pending,'waitUntil required for '+name);
  await pending;
 }
 function nav(url,{method='GET',mode='navigate'}={}){
  let response=null;
  handlers.get('fetch')({
   request:{url,method,mode},
   respondWith(p){response=p;}
  });
  return response;
 }
 return {lifecycle,nav,responses,deleted,networkRequests,
  setNetwork(value){networkOn=value;}};
}

test('P3 SW is restricted to the synthetic diagnostic page and not production origins',()=>{
 assert.match(html,/serviceWorker\.register\(\s*['"]\.\/idb-offline-sw\.js['"]\s*,\s*\{scope:['"]\.\/idb-offline-test\.html['"]\}/);
 assert.match(html,/离线页面缓存已就绪/);
 assert.match(script,/xiaobao-p3-idb-offline-shell-v1/);
 assert.doesNotMatch(script,/xiaobao_diaper_planner_v1|CloudBase|signInWithOtp|fetch\(.*\/rpc\//i);
 assert.doesNotMatch(script,/\bindexedDB\b|\blocalStorage\b/);
});
test('installation caches the standalone HTML and offline navigation reads it without network',async()=>{
 const x=setup();
 await x.lifecycle('install');
 assert.ok(x.responses.has(page));
 assert.deepEqual(x.networkRequests,[page]);
 x.setNetwork(false);
 const resp=x.nav(page);
 assert.ok(resp,'P3 page navigation is intercepted');
 assert.equal((await resp).content,'synthetic diagnostic page');
 assert.deepEqual(x.networkRequests,[page],'offline navigation did not attempt CloudBase/network');
});
test('other pages, CloudBase APIs, cross-origin requests and writes are not intercepted',async()=>{
 const x=setup();
 await x.lifecycle('install');
 assert.equal(x.nav(base+'auth-test.html'),null);
 assert.equal(x.nav('https://example.test/index.html'),null);
 assert.equal(x.nav('https://another.test/xb-test/idb-offline-test.html'),null);
 assert.equal(x.nav(page,{method:'POST'}),null);
 assert.equal(x.nav(page,{mode:'cors'}),null);
 assert.ok(x.nav(page+'?offline=true'),'query params on same diagnostic navigation allowed');
});
test('activation prunes only prior P3 diagnostic cache revisions',async()=>{
 const x=setup();
 await x.lifecycle('activate');
 assert.deepEqual(x.deleted,['xiaobao-p3-idb-offline-shell-old']);
});
test('unavailable initial HTML fails installation instead of claiming offline readiness',async()=>{
 const x=setup();
 x.setNetwork(false);
 await assert.rejects(x.lifecycle('install'),/network_offline/);
 assert.equal(x.responses.size,0);
});
