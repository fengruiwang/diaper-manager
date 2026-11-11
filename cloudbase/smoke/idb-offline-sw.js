/* XiaoBao v1.2.0 P3 test-only offline shell.
 * Deploy beside idb-offline-test.html under xb-test/ on HTTPS hosting.
 * Explicit scope MUST be ./idb-offline-test.html (not / or ./).
 * Never handles login, CloudBase APIs, auth-test.html or production PWA.
 * Caches only the synthetic P3 diagnostic HTML, not business data.
 */
'use strict';
const CACHE_NAME='xiaobao-p3-idb-offline-shell-v1';
const CACHE_PREFIX='xiaobao-p3-idb-offline-shell-';
const PAGE_URL=new URL('./idb-offline-test.html',self.location.href);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const response=await fetch(PAGE_URL.href,{cache:'reload'});
    if(!response.ok)throw new Error('offline_shell_page_unavailable');
    const cache=await caches.open(CACHE_NAME);
    await cache.put(PAGE_URL.href,response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys
      .filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME)
      .map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||event.request.mode!=='navigate')return;
  const requested=new URL(event.request.url);
  if(requested.origin!==PAGE_URL.origin||requested.pathname!==PAGE_URL.pathname)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const saved=await cache.match(PAGE_URL.href);
    if(saved)return saved;
    // Fail without inventing a locally persisted result. The page still
    // works normally online if a user clears just the shell cache.
    return fetch(event.request);
  })());
});
