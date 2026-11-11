const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/legacy-backup-check.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/legacy-backup-check.js'),'utf8');
test('backup page loads exactly two same-origin scripts and denies outbound connections',()=>{
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/default-src 'none'/);
 assert.match(html,/script-src 'self'/);
 assert.match(html,/<script src="\.\/legacy-backup-vault\.js"><\/script>/);
 assert.match(html,/<script src="\.\/legacy-backup-check\.js"><\/script>/);
 assert.doesNotMatch(html,/<script[^>]+src="https?:/i);
});
test('backup page has real file-only import and explicit manual download controls',()=>{
 for(const id of [
  'sourceFile','bundleFile','protect','verify','downloadBundle',
  'downloadOriginal','report'
 ])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/id="downloadBundle"[^>]+disabled/);
 assert.match(html,/id="downloadOriginal"[^>]+disabled/);
 assert.match(ui,/createFromExport\(/);
 assert.match(ui,/vault\.verify\(/);
 assert.match(ui,/extractVerifiedOriginal\(/);
 assert.match(ui,/\.addEventListener\('click'/);
 assert.match(ui,/URL\.createObjectURL\(/);
 assert.match(ui,/anchor\.download=/);
});
test('backup page never writes browser storage, calls cloud APIs, or logs personal records',()=>{
 for(const s of [html,ui]){
  assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|cloudbase\.init|signInWithOtp)\s*\(/);
  assert.doesNotMatch(s,/\b(?:localStorage|sessionStorage|indexedDB)\s*(?:\.|\[|\()/);
  assert.doesNotMatch(s,/\.rpc\s*\(|\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(s,/\b(?:console\.log|console\.error|innerHTML)\b/);
 }
 assert.match(ui,/textContent=value/);
 assert.match(html,/不要将它们发给开发对话/);
});

test('browser page controller parses as strict JavaScript before user receives upload instructions',()=>{
 assert.doesNotThrow(()=>new vm.Script(ui,{filename:'legacy-backup-check.js'}));
});
