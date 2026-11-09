/* 小宝纸尿裤管家 PWA v1.0.0 — cache ONLY app shell, never cached user data. */
'use strict';
const CACHE_NAME = 'xiaobao-shell-v1.0.0';
const CACHE_PREFIX = 'xiaobao-shell-';
const SHELL = ['./index.html','./pwa.js','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'];
const SHELL_URLS = SHELL.map(path => new URL(path, self.registration.scope).href);
const INDEX_URL = new URL('./index.html',self.registration.scope).href;
const VERSION_URL = new URL('./version.json',self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // An incomplete deployment must not activate a broken offline version.
    await cache.addAll(SHELL_URLS.map(url => new Request(url,{cache:'reload'})));
  })());
  // No automatic skipWaiting: changes become active only on user's request.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET')return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope))return;
  // Never serve version checks from cache or intercept JSON backup downloads.
  if(url.href.split('?')[0] === VERSION_URL) return;
  if(req.mode === 'navigate') {
    const allowed = new URL('./',self.registration.scope).pathname;
    if(url.pathname !== allowed && url.pathname !== new URL(INDEX_URL).pathname)return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(INDEX_URL)) || fetch(req);
    })());
    return;
  }
  const resource = new URL(url.pathname,url.origin).href;
  if(!SHELL_URLS.includes(resource))return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(resource)) || fetch(req);
  })());
});
