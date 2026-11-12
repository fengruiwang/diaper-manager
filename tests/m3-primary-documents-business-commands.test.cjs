const test=require('node:test'),assert=require('node:assert/strict');
const Cmd=require('../sync/primary-documents-business-commands.js');
const base={
 quotes:{items:[{id:'q1',brand:'好奇',series:'小森林',size:'S',per:50,
  packs:1,pieces:50,price:60,unit:1.2,legacyExtra:'preserve'}]},
 growth:{items:[{id:'w1',date:'2026-11-01',weight:3.25,note:'old'}]},
 reference:{referenceOverrides:{'好奇|小森林|S':1.123}},
 profile:{babyProfile:{name:'小宝',sex:'',birthTime:''},
  dueDate:'2027-01-08',birthDate:'',babyWeight:''},
 settings:{currentSize:'NB',sizeMode:'manual',autoSize:'NB',
  target:{NB:100,S:60},daily:{NB:10,S:9},unknownExtension:'keep'}
};
function fixture({enabled=false,pending=0}={}){
 const calls=[];const queue={cloudWritesEnabled:enabled,
  pending:async()=>({status:'DOCUMENT_QUEUE_COUNTS_VERIFIED',outstanding:pending}),
  queue:async x=>{calls.push(x);return {
   status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:x.requestId}}};
 const client={read:async x=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',
  kind:x.kind,body:base[x.kind],revision:2})};
 const commands=Cmd.create({client,queue,
  uuid:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'});
 return {commands,calls};
}
test('quote updates preserve unknown migrated fields, delete and clear preserve old ledger separately',()=>{
 const f=fixture();
 const edit=f.commands.transform('quotes','edit',base.quotes,{id:'q1',price:55});
 assert.equal(edit.items[0].price,55);
 assert.equal(edit.items[0].legacyExtra,'preserve');
 assert.equal(base.quotes.items[0].price,60);
 assert.deepEqual(f.commands.transform('quotes','delete',base.quotes,{id:'q1'}).items,[]);
 assert.deepEqual(f.commands.transform('quotes','clear',base.quotes,null).items,[]);
});
test('reference CAS retains mill precision, permits reset and rejects submill prices',()=>{
 const f=fixture();
 const next=f.commands.transform('reference','set',base.reference,
  {key:'好奇|小森林|S',value:1.124});
 assert.equal(next.referenceOverrides['好奇|小森林|S'],1.124);
 const reset=f.commands.transform('reference','reset',base.reference,
  {key:'好奇|小森林|S'});
 assert.equal(Object.keys(reset.referenceOverrides).length,0);
 assert.throws(()=>f.commands.transform('reference','set',base.reference,
  {key:'好奇|小森林|S',value:1.1234}),/reference_precision/);
});
test('growth edit original record is a separate versioned document, not a stock delta',()=>{
 const f=fixture();
 const edited=f.commands.transform('growth','edit',base.growth,
  {id:'w1',weight:3.5});
 assert.equal(edited.items[0].weight,3.5);
 assert.equal(edited.items[0].note,'old');
 assert.equal(base.growth.items[0].weight,3.25);
});
test('profile and settings patch preserve unknown preexisting fields',()=>{
 const f=fixture();
 const settings=f.commands.transform('settings','patch',base.settings,
  {target:{NB:110,S:80},currentSize:'S'});
 assert.equal(settings.unknownExtension,'keep');
 assert.equal(settings.target.NB,110);
 const profile=f.commands.transform('profile','patch',base.profile,
  {babyProfile:{name:'小宝2'}});
 assert.equal(profile.babyProfile.sex,'');
 assert.equal(profile.babyProfile.name,'小宝2');
});
test('writes disabled before UUID generation, network or local queue access',async()=>{
 const f=fixture();
 const r=await f.commands.submit({kind:'quotes',action:'add',
  record:{id:'q2',brand:'好奇'},operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,0);
});
test('in-flight doc ACK or conflict blocks generation of another editing command ID',async()=>{
 const f=fixture({enabled:true,pending:1});
 const r=await f.commands.submit({kind:'quotes',action:'add',record:{id:'q2'},
  familyId:'F',actorUid:'A',operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_PENDING_REVIEW_REQUIRED');
 assert.equal(f.calls.length,0);
});
test('approved candidate add queues exact full CAS state with server revision',async()=>{
 const f=fixture({enabled:true});
 const r=await f.commands.submit({kind:'quotes',action:'add',
  record:{id:'q2',brand:'Babycare',series:'皇室',size:'S',pieces:10,price:15},
  familyId:'F',actorUid:'A',operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.equal(f.calls[0].expectedRevision,2);
 assert.equal(f.calls[0].nextBody.items.length,2);
 assert.equal(f.calls[0].nextBody.items[0].id,'q1');
 assert.equal(f.calls[0].nextBody.items[1].id,'q2');
 assert.equal(r.cloudWriteCommitted,false);
});
