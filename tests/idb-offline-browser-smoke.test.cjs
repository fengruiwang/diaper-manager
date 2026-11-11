const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/idb-offline-test.html'),'utf8');
test('standalone P3 browser test embeds required offline modules, never fetches live user data',()=>{
 assert.match(html,/XBDurableOutbox/);
 assert.match(html,/XBInventoryReconciler/);
 assert.match(html,/XBInventoryProjection/);
 assert.match(html,/xiaobao-p3-browser-test-only-v1/);
 assert.match(html,/测试页/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
 assert.doesNotMatch(html,/f495637659-d2gnuzz2jf5657da8/);
 assert.doesNotMatch(html,/https?:\/\/[^\s"'<>]*(?:cloudbase|github)/i);
 assert.doesNotMatch(html,/signInWithOtp|refreshSession\(\)/);
});
test('P3 browser test never claims server success and uses a clear simulated receipt',()=>{
 assert.match(html,/模拟云端收到全部操作/);
 assert.match(html,/没有实际云端请求/);
 assert.match(html,/await store\.commitInventory/);
 assert.match(html,/await store\.reconcileInventory/);
 assert.match(html,/crypto\?\.randomUUID/);
});
