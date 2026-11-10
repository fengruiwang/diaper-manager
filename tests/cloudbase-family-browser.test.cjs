const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/auth-test.html'),'utf8');
const js=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const UUID='c3759058-e919-49ba-b64e-670f5d548cc0';
const INVITE='22a34fb0-2e32-4f15-b453-97515bea2c12';
function boot({loggedIn=true,grant=true}={}){
 const elements=new Map(),calls=[];
 const doc={
  getElementById(id){
   if(!elements.has(id))elements.set(id,{
    id,disabled:id!=='connectBtn',value:id==='envId'?'env-demo':id==='publishable'?'publish-demo':'',
    textContent:'',onclick:null
   });
   return elements.get(id);
  },
  createElement(){return {src:'',async:false,onload:null,onerror:null,remove(){}}},
  head:{appendChild(script){queueMicrotask(()=>script.onload())}}
 };
 const auth={
  getSession:async()=>({data:{session:loggedIn?{access_token:'test'}:null},error:null}),
  signOut:async()=>({data:{},error:null})
 };
 const db={
  from(table){
   return {select(fields){return {limit:async count=>{
    calls.push(['read',table,fields,count]);
    return {data:table==='families'?[{id:UUID,display_name:'小宝家庭'}]:[],error:null};
   }}}};
  },
  async rpc(name,params){
   calls.push(['rpc',name,params]);
   if(!grant)return {data:null,error:{code:'42501',message:'denied'}};
   const data=name==='xb_create_family'?{family_id:UUID}:
    name==='xb_create_invite'?{invite_token:INVITE}:{family_id:UUID};
   return {data,error:null};
  }
 };
 const window={cloudbase:{init:()=>({auth,rdb:()=>db})},confirm:()=>true};
 assert.ok(js);
 vm.runInNewContext(js,{document:doc,window,Promise,setTimeout,clearTimeout});
 const get=id=>doc.getElementById(id);
 async function click(id){
  assert.equal(typeof get(id).onclick,'function');
  get(id).onclick();
  for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));
 }
 return {get,calls,click,window};
}
test('family functions are never called on load or SDK connect',async()=>{
 const x=boot();
 assert.equal(x.calls.length,0);
 await x.click('connectBtn');
 assert.equal(x.calls.filter(y=>y[0]==='rpc').length,0);
 assert.equal(x.get('createFamilyBtn').disabled,false);
});
test('create family requires explicit click and fills family id without touching local cache',async()=>{
 const x=boot();
 await x.click('connectBtn');
 x.get('familyName').value='小宝家庭';
 await x.click('createFamilyBtn');
 assert.equal(x.calls.filter(y=>y[0]==='rpc').length,1);
 assert.equal(x.calls.find(y=>y[0]==='rpc')[1],'xb_create_family');
 assert.equal(x.get('familyId').value,UUID);
 assert.match(x.get('instantStatus').textContent,/家庭创建成功/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
});
test('family invite requires a valid family id and is only generated after click',async()=>{
 const x=boot();
 await x.click('connectBtn');
 await x.click('createInviteBtn');
 assert.equal(x.calls.filter(y=>y[0]==='rpc').length,0);
 x.get('familyId').value=UUID;
 await x.click('createInviteBtn');
 assert.equal(x.get('inviteToken').value,INVITE);
 assert.equal(x.calls.filter(y=>y[0]==='rpc')[0][1],'xb_create_invite');
});
test('joining uses invite RPC, removes secret after accepted, and does not log token',async()=>{
 const x=boot();
 await x.click('connectBtn');
 x.get('inviteToken').value=INVITE;
 await x.click('acceptInviteBtn');
 assert.equal(x.calls.filter(y=>y[0]==='rpc')[0][1],'xb_accept_invite');
 assert.equal(x.get('inviteToken').value,'');
 assert.equal(x.get('familyId').value,UUID);
 assert.doesNotMatch(x.get('instantStatus').textContent,new RegExp(INVITE));
});
test('server permission error never writes family id or emits invitation secret',async()=>{
 const x=boot({grant:false});
 await x.click('connectBtn');
 x.get('familyName').value='小宝家庭';
 await x.click('createFamilyBtn');
 assert.equal(x.get('familyId').value,'');
 assert.match(x.get('instantStatus').textContent,/42501/);
});
test('read own family uses RLS with SELECT and no table-write calls',async()=>{
 const x=boot();
 await x.click('connectBtn');
 await x.click('listFamiliesBtn');
 assert.deepEqual(x.calls.map(y=>y[0]),['read']);
 assert.equal(x.get('familyId').value,UUID);
});
