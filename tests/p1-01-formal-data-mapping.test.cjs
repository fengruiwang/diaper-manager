const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const UI=require('../sync/primary-ui-projection.js');
const Overlay=require('../sync/primary-documents-overlay.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const P='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const OTHER='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const sizes=['NB','S','M','L','XL','XXL'];
function source(){
 const inventory={NB:20,S:80,M:0,L:0,XL:0,XXL:0},revisions={NB:2,S:3,M:1,L:1,XL:1,XXL:1};
 const rows=Array.from({length:10},(_,i)=>({kind:'transaction',id:'historic-'+i,
  payload:{id:'historic-'+i,type:'buy',date:'2026-11-0'+(i%9+1),
   size:i<5?'NB':'S',brand:'好奇',series:'小森林',pieces:20,price:19.8}}));
 rows.push({kind:'quote',id:'old-quote',payload:{id:'old-quote',brand:'好奇',
  series:'小森林',date:'2026-11-11',size:'S',pieces:60,price:100,unit:1.666}});
 rows.push({kind:'weight',id:'old-weight',payload:{id:'old-weight',
  date:'2026-11-10',time:'09:00',weight:3.4,note:'historical'}});
 return {status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,familyId:F,childId:P,actorUid:'dad',
  inventory,revisions,
  settings:{currentSize:'S',goalPrice:1.5,target:{NB:50,S:100},
   daily:{NB:9,S:7},referenceOverrides:{'好奇|小森林|S':1.123}},
  profileData:{dueDate:'2027-01-08',birthDate:'',babyWeight:'',
   babyProfile:{name:'真实宝宝',sex:''}},
  legacyHistory:{rows,total:rows.length,hasMore:false,complete:true},
  livePurchases:[],legacyPurchasesAppliedToInventory:false};
}
function defaults(){return {inventory:{},transactions:[],quotes:[],weightRecords:[],
 referenceOverrides:{},babyProfile:{},target:{},daily:{},dueDate:'',currentSize:'NB'};}
function docs(child=P){
 const bodies={quotes:{items:[{id:'cloud-quote',brand:'好奇'}]},
 reference:{referenceOverrides:{'好奇|小森林|S':1.55}},
 growth:{items:[{id:'cloud-weight',weight:3.6,date:'2026-11-12'}]},
 profile:{babyProfile:{name:'真实宝宝'},dueDate:'2027-01-08'},
 settings:{target:{NB:50,S:100},daily:{NB:9,S:7}}};
 return {status:'PRIMARY_DOCUMENTS_FULLY_READ',
 documents:Object.fromEntries(Object.entries(bodies).map(([kind,body])=>
 [kind,{status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,body,revision:1,
  familyId:F,childId:child}]))};
}
test('P1-01 ten migrated purchases display without changing authoritative inventory',()=>{
 const p=UI.project(source(),defaults());
 assert.equal(p.familyId,F);assert.equal(p.childId,P);
 assert.equal(p.state.transactions.length,10);
 assert.equal(p.state.transactions.filter(x=>x.origin==='legacy_migration').length,10);
 assert.equal(p.state.transactions.reduce((n,t)=>n+t.pieces,0),200);
 assert.equal(p.state.inventory.NB,20);assert.equal(p.state.inventory.S,80);
 assert.deepEqual(Object.keys(p.revisions),sizes);
 assert.equal(p.historicPurchasesAddedToStock,false);
 assert.equal(p.state.referenceOverrides['好奇|小森林|S'],1.123);
 assert.equal(p.state.quotes.length,1);assert.equal(p.state.weightRecords.length,1);
 assert.equal(p.state.babyProfile.name,'真实宝宝');
 assert.equal(p.synthetic,false);assert.equal(p.canWrite,false);
});
test('P1-01 verified optional documents update only corresponding fields',()=>{
 const base=UI.project(source(),defaults()),merged=Overlay.apply(base,docs());
 assert.equal(merged.sharedBusinessDocumentsVerified,true);
 assert.equal(merged.state.quotes[0].id,'cloud-quote');
 assert.equal(merged.state.weightRecords[0].id,'cloud-weight');
 assert.equal(merged.state.referenceOverrides['好奇|小森林|S'],1.55);
 assert.equal(merged.state.transactions.length,10);
 assert.deepEqual(merged.state.inventory,base.state.inventory);
 assert.equal(merged.cloudDocumentsActorScope.childId,P);
});
test('P1-01 mismatched primary vs document child scope cannot overwrite the current UI',()=>{
 assert.throws(()=>Overlay.apply(UI.project(source(),defaults()),docs(OTHER)),
  /primary_overlay:document_primary_scope_mismatch/);
});
test('P1-01 internally mixed document family scope fails',()=>{
 const snap=docs();snap.documents.growth.familyId=OTHER;
 assert.throws(()=>Overlay.apply(UI.project(source(),defaults()),snap),
  /primary_overlay:mixed_family_documents/);
});
test('P1-01 actual HTML embeds canonical projection, preserving cloud purchase operation IDs',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/formal/index.html'),'utf8');
 const moduleSource=fs.readFileSync(path.join(__dirname,'../sync/primary-ui-projection.js'),'utf8');
 const overlaySource=fs.readFileSync(path.join(__dirname,'../sync/primary-documents-overlay.js'),'utf8');
 assert.ok(html.includes(moduleSource.trim()),'HTML projection differs from source');
 assert.ok(html.includes(overlaySource.trim()),'HTML overlay differs from source');
 const input=source();input.livePurchases=[{
  operationId:'79192488-bd70-4b88-8c66-3c5b5fb29ef5',
  purchaseDate:'2026-11-12',size:'S',pieces:20,totalFen:3300,
  brand:'好奇',series:'小森林',reversed:false
 }];
 const p=UI.project(input,defaults());
 assert.equal(p.state.transactions.length,11);
 assert.equal(p.state.transactions.at(-1).operationId,input.livePurchases[0].operationId);
 assert.equal(p.state.transactions.at(-1).origin,'cloud_post_migration');
});
