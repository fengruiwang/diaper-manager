const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
const page=read('cloudbase/smoke/auth-test.html');
const script=page.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const familyId='c3759058-e919-49ba-b64e-670f5d548cc0';
function boot({denyAlias=false}={}){
 const elements=new Map(),calls=[];
 const members=[
  {user_uid:'long-secret-owner',member_role:'owner',member_alias:null,alias_revision:0},
  {user_uid:'long-secret-member',member_role:'member',member_alias:null,alias_revision:0}
 ];
 function el(id){
  if(!elements.has(id)){
   const v={id,value:id==='envId'?'env-demo':id==='publishable'?'pub-key':'',
    textContent:'',disabled:id!=='connectBtn',onclick:null,onchange:null,children:[],
    _innerHTML:'',appendChild(o){this.children.push(o);if(this.value==='')this.value=o.value},
    get innerHTML(){return this._innerHTML},
    set innerHTML(val){this._innerHTML=val;if(!val)this.children=[]}
   };
   elements.set(id,v);
  }
  return elements.get(id);
 }
 const db={
  from(name){return {select(columns){return {
   limit:async()=>({data:name==='families'?[{id:familyId,display_name:'小宝家庭'}]:[],error:null}),
   eq:async(col,value)=>{calls.push(['read',name,col,value]);return {data:members.map(m=>({...m})),error:null}}
  }}}},
  async rpc(name,params){
   calls.push(['rpc',name,params]);
   if(denyAlias)return {data:null,error:{code:'DATABASE_42501'}};
   const member=members.find(m=>m.user_uid===params.p_member_uid);
   if(!member||member.alias_revision!==params.p_expected_revision)
    return {data:null,error:{code:'DATABASE_40001'}};
   member.member_alias=params.p_alias||null;
   member.alias_revision++;
   return {data:{saved:true,changed:true,member_alias:member.member_alias,alias_revision:member.alias_revision},error:null};
  }
 };
 const auth={getSession:async()=>({data:{session:{access_token:'fake'}},error:null}),
  signOut:async()=>({data:{},error:null})};
 const app={auth,rdb:()=>db};
 const doc={getElementById:el,createElement:tag=>({tagName:tag,value:'',textContent:''})};
 const win={cloudbase:{init:()=>app},confirm:()=>true};
 assert.ok(script,'inline smoke script exists');
 vm.runInNewContext(script,{document:doc,window:win,Promise,setTimeout,clearTimeout});
 async function click(id){
  assert.equal(typeof el(id).onclick,'function');
  el(id).onclick();
  for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 }
 return {el,click,calls,members};
}
test('read-only alias list uses role or nickname and never renders raw UID',async()=>{
 const x=boot();
 await x.click('connectBtn');x.el('familyId').value=familyId;
 await x.click('loadAliasesBtn');
 assert.equal(x.el('loadAliasesBtn').disabled,false);
 assert.equal(x.el('aliasMemberSelect').children.length,2);
 assert.equal(x.el('aliasMemberSelect').children[1].textContent,'家庭成员 · 家庭成员');
 assert.doesNotMatch(x.el('aliasMemberSelect').children.map(o=>o.textContent).join(''),/long-secret/);
 assert.ok(x.calls.some(c=>c[0]==='read'&&c[1]==='family_members'));
 assert.equal(x.calls.some(c=>c[0]==='rpc'),false);
});
test('member nickname save updates label by stable UID and checks revision',async()=>{
 const x=boot();await x.click('connectBtn');x.el('familyId').value=familyId;
 await x.click('loadAliasesBtn');
 x.el('aliasMemberSelect').value='1';x.el('aliasMemberSelect').onchange();
 x.el('aliasValue').value='老婆';
 await x.click('saveAliasBtn');
 const write=x.calls.find(c=>c[0]==='rpc');
 assert.equal(write[1],'xb_set_member_alias');
 assert.equal(write[2].p_member_uid,'long-secret-member');
 assert.equal(write[2].p_expected_revision,0);
 assert.equal(write[2].p_alias,'老婆');
 assert.equal(x.el('aliasMemberSelect').children[1].textContent,'老婆 · 家庭成员');
 assert.equal(x.el('saveAliasBtn').disabled,false);
});
test('permission denied leaves member unchanged and allows retry',async()=>{
 const x=boot({denyAlias:true});await x.click('connectBtn');x.el('familyId').value=familyId;
 await x.click('loadAliasesBtn');
 x.el('aliasValue').value='测试';
 await x.click('saveAliasBtn');
 assert.equal(x.members[0].member_alias,null);
 assert.equal(x.el('saveAliasBtn').disabled,false);
 assert.match(x.el('instantStatus').textContent,/DATABASE_42501/);
});
test('003 migration is additive and authenticated RPC checks ownership and app permission',()=>{
 const sql=read('cloudbase/sql/003_member_alias_migration.sql');
 assert.match(sql,/ALTER TABLE public\.family_members/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS member_alias/);
 assert.match(sql,/p_expected_revision/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/xb_private\.can_use_app/);
 assert.match(sql,/v_actor_role <> 'owner'/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/family_member_alias_audit/);
 assert.doesNotMatch(sql,/\bDROP TABLE\b|\bTRUNCATE\b|\bDELETE FROM public\.family_members\b/i);
});
