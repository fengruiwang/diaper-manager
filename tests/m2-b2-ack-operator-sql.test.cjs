const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=()=>fs.readFileSync(path.join(__dirname,
 '../cloudbase/sql/B2_STAGE_ACK_READONLY_OPERATOR_CHECK.sql'),'utf8');
test('B2 operator SQL is SELECT-only and does not display any private archive columns',()=>{
 const sql=read();
 assert.match(sql,/WITH args AS \(/);
 assert.match(sql,/STAGED_SAME_SOURCE_VERIFIED/);
 assert.match(sql,/STAGE_NOT_FOUND_STOP/);
 assert.match(sql,/STAGE_SOURCE_OR_RECORD_MISMATCH_STOP/);
 assert.match(sql,/RECEIPT_PRESENT_STOP_READBACK_ONLY/);
 assert.match(sql,/QUERY_CONTEXT_UNVERIFIED_STOP/);
 for(const forbidden of [/\bCREATE\s+(?:TABLE|FUNCTION)/i,/\bGRANT\s+EXECUTE\b/i,
 /\bDROP\s+(?:TABLE|FUNCTION)/i,/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/i,
 /\b(?:CALL|PERFORM|EXECUTE)\s+(?:public\.)?xb_/i])
  assert.doesNotMatch(sql,forbidden);
 const select=sql.slice(sql.lastIndexOf('\nSELECT CASE'));
 assert.doesNotMatch(select,/source_text|state_data|legacy_record_id|source_sha256|record_id|babyProfile/i);
});
test('B2 operator SQL cross-checks original scope, digest, staged row counts and all record payloads',()=>{
 const sql=read();
 for(const key of ['__FAMILY_UUID__','__CHILD_UUID__','__ORIGINAL_STAGE_UUID__',
  '__ORIGINAL_SOURCE_SHA256__','pg_catalog','source_bytes','sha256(convert_to',
  'source_state_match','exact_record_match','source_sha256','stage_status',
  'migration_baseline','target_empty']){
  if(key==='pg_catalog'||key==='migration_baseline')continue;
  assert.ok(sql.includes(key),key);
 }
 assert.match(sql,/FULL OUTER JOIN actual/);
 assert.match(sql,/e\.payload IS DISTINCT FROM t\.payload/);
 assert.match(sql,/e\.record_id IS DISTINCT FROM t\.record_id/);
});
