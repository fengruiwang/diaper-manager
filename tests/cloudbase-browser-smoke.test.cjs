const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/auth-test.html'),'utf8');
const match=source.match(/<script>\s*([\s\S]*?)<\/script>/);
test('standalone P1 smoke JavaScript is syntactically valid and never needs production data',()=>{
 assert.ok(match,'inline client script must exist');
 assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert.match(source,/id="instantStatus"/);
 assert.match(source,/SDK_CDN_UNREACHABLE/);
 assert.doesNotMatch(source,/xiaobao_diaper_planner_v1/);
 assert.match(source,/from\('families'\)\.select\('id'\)\.limit\(1\)/);
});
test('click initializes SDK and enables OTP using a fake SDK without network',async()=>{
 const elements=new Map();
 const getElementById=id=>{
  if(!elements.has(id))elements.set(id,{
   id,value:id==='envId'?'fake-env':id==='publishable'?'fake-publishable-key':'',
   textContent:'',disabled:id!=='connectBtn',onclick:null
  });
  return elements.get(id);
 };
 const window={cloudbase:null};
 const auth={getSession:async()=>({data:{session:null},error:null})};
 const db={};
 const document={
  getElementById,
  createElement:()=>({src:'',async:false,onload:null,onerror:null,remove(){}}),
  head:{appendChild:script=>{
   // Mimics Tencent's successfully loaded CDN script. Never performs an HTTP request.
   window.cloudbase={init:({env,accessKey})=>{
    assert.equal(env,'fake-env');assert.equal(accessKey,'fake-publishable-key');
    return {auth,rdb:()=>db};
   }};
   queueMicrotask(()=>script.onload());
  }}
 };
 vm.runInNewContext(match[1],{document,window,Promise,setTimeout,clearTimeout});
 assert.match(getElementById('instantStatus').textContent,/诊断版 4/);
 assert.equal(typeof getElementById('connectBtn').onclick,'function');
 getElementById('connectBtn').onclick();
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(getElementById('sendBtn').disabled,false,'OTP must enable after SDK init');
 assert.match(getElementById('instantStatus').textContent,/SDK 初始化成功/);
 assert.equal(getElementById('publishable').value,'','key input cleared after init');
});
