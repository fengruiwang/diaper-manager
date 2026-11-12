const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/legacy-backup-check.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/legacy-backup-check.js'),'utf8');
const needed=['legacy-backup-vault','migration-contract','legacy-purchase-audit',
 'legacy-migration-manifest','legacy-restore-projection','growth',
 'strict-migration-gate','legacy-stage-022-preflight','legacy-single-export-preflight','legacy-backup-check'];
test('backup page loads all required same-origin scripts and denies outbound connections',()=>{
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/connect-src 'none'/);assert.match(html,/default-src 'none'/);
 assert.match(html,/script-src 'self'/);
 for(const part of needed)
  assert.match(html,new RegExp('<script src="\\./'+part+'\\.js"></script>'));
 assert.equal((html.match(/<script src=/g)||[]).length,needed.length);
 assert.doesNotMatch(html,/<script[^>]+src="https?:/i);
});
test('backup page has file-only selectors, local protection and re-verification actions',()=>{
 for(const id of ['sourceFile','bundleFile','protect','verify',
  'downloadBundle','downloadOriginal','report'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/id="downloadBundle"[^>]+disabled/);
 assert.match(html,/id="downloadOriginal"[^>]+disabled/);
 assert.match(ui,/XBStrictMigrationGate/);
 assert.match(ui,/XBLegacyStage022Preflight/);
 assert.match(ui,/XBLegacySingleExportPreflight/);
 assert.match(ui,/\.run\(raw,/);
 assert.match(ui,/verifyProtectedArchive\(archive\)/);
 assert.match(ui,/\.addEventListener\('click'/);
 assert.match(ui,/URL\.createObjectURL\(/);
 assert.match(ui,/anchor\.download=/);
});
test('backup page never writes browser storage, calls cloud APIs, or logs records',()=>{
 for(const s of [html,ui]){
  assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|cloudbase\.init|signInWithOtp)\s*\(/);
  assert.doesNotMatch(s,/\b(?:localStorage|sessionStorage|indexedDB)\s*(?:\.|\[|\()/);
  assert.doesNotMatch(s,/\.rpc\s*\(|\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(s,/\b(?:console\.log|console\.error|innerHTML)\b/);
 }
 assert.match(ui,/\.textContent=x/);
 assert.match(html,/不要将 JSON、原文/);
});
test('strict browser controller parses without syntax error',()=>{
 assert.doesNotThrow(()=>new vm.Script(ui,{filename:'legacy-backup-check.js'}));
});
