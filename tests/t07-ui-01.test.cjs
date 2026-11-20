/* T07-UI-01: UI-only contract for the final V1.2.0 source; no production data. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('preview/v1.2.0/formal/index.html');
const controller=read('preview/v1.2.0/formal-controller.js');
const inSettings=html.slice(html.indexOf('<section class="panel" id="settings">'),
 html.indexOf('    </section>\n  </main>',html.indexOf('<section class="panel" id="settings">')));
test('T07: five tabs and normal view remain available',()=>{
 for(const tab of ['overview','compare','history','growth','settings'])
  assert.ok(html.includes('data-tab="'+tab+'"'),'tab '+tab);
 assert.ok(html.includes('id="formalGate"'));
});
test('T07: top refresh and routine sync copy gone, gesture container/status preserved',()=>{
 assert.doesNotMatch(html,/<button[^>]*id="formalRefresh"/);
 for(const id of ['formalNotice','formalSyncState','formalSyncNow',
  'formalResolveDocumentConflict','formalResolveBatchConflict'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('#formalNotice.sync-line{display:none;'));
 assert.ok(html.includes('#formalNotice:has(>button:not([hidden])){display:flex}'));
 assert.ok(html.includes('#formalNotice:is([data-pull-phase]'));
 assert.ok(html.includes('[data-sync-phase="partial"]'));
 assert.ok(controller.includes("const threshold=64"));
 assert.ok(controller.includes("void fetchCloudLatest().then("));
 assert.ok(controller.includes("!dialog.closest?.('[hidden]')"));
});
test('T07: ordinary header sync hidden, pending/conflicts and errors display',()=>{
 assert.ok(html.includes('#formalNotice #formalSyncState{display:none}'));
 assert.match(html,/data-sync-phase="pending"[^]*#formalSyncState\{display:inline\}/);
 assert.ok(html.includes('id="formalSyncNow"'));
 assert.ok(html.includes('id="formalResolveDocumentConflict"'));
 assert.ok(html.includes('id="formalResolveBatchConflict"'));
 assert.ok(html.includes('data-pull-phase="armed"'));
 assert.ok(html.includes('content:"松开刷新"'));
});
test('T07: PWA update confirmation stays while obsolete migration prompt is removed',()=>{
 assert.ok(html.includes('id="pwaUpdateNotice"'));
 assert.ok(html.includes('id="pwaUpdateNow"'));
 assert.ok(html.includes('🆕 发现新版本，更新只替换程序，不清除本机数据。'));
 for(const id of ['pwaMigrationNotice','pwaImportOld','pwaMigrationDismiss'])
  assert.ok(!html.includes('id="'+id+'"'),id);
 const pwa=read('scripts/pages-v120-pwa.js');
 assert.ok(pwa.includes("registration.waiting.postMessage({type:'SKIP_WAITING'})"));
 assert.ok(pwa.includes('window.confirm('));
});
test('T07: settings order moves account/sync below profile, size, plans',()=>{
 const labels=['👶 宝宝基本资料','🧷 纸尿裤尺码与采购偏好',
  '🎯 备货目标与日均用量','🔐 账号与家庭','☁️ 云端数据同步'];
 const positions=labels.map(l=>inSettings.indexOf(l));
 assert.ok(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])),
  'unexpected settings section order: '+positions);
 for(const id of ['formalAccountSection','formalCurrentAccount',
  'formalCurrentFamily','formalAccountState','formalSignOut',
  'formalCloudSyncSection','formalGetCloudLatest','formalSubmitPending',
  'formalPendingCount','formalCloudSyncFeedback'])
  assert.ok(inSettings.includes('id="'+id+'"'),id);
});
test('T07: deprecated cloud/legacy info removed, JS compatibility nodes preserved',()=>{
 assert.ok(!inSettings.includes('☁️ 云端与旧版数据'));
 assert.ok(!inSettings.includes('💾 数据备份与恢复'));
 assert.ok(inSettings.includes('id="formalLegacyPlaceholders" hidden'));
 for(const id of ['exportData','importDataBtn','resetAll','importFile'])
  assert.ok(inSettings.includes('id="'+id+'"'),id);
});
test('T07: global footer text gone while regular business hints remain',()=>{
 assert.ok(!html.includes('<div class="footer-note">'));
 assert.ok(!html.includes('常见尺码与每阶段消耗量仅供采购估算'));
 assert.ok(html.includes('目标是希望手头保有多少片'));
});
test('T07: no PWA identity or CloudBase storage/client changes',()=>{
 const manifest=JSON.parse(read('manifest.webmanifest'));
 for(const prop of ['id','start_url','scope'])assert.equal(manifest[prop],'./');
 assert.ok(controller.includes("on('formalGetCloudLatest',fetchCloudLatest)"));
 assert.ok(controller.includes("on('formalSignOut',signOut)"));
 assert.ok(controller.includes('hasPendingPageReview()'));
 assert.ok(!/indexedDB\.deleteDatabase|localStorage\.clear\(/.test(controller));
});
