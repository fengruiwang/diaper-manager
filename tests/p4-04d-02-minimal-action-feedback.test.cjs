const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({purchaseSubmit,flush,quoteSubmit,send,readPurchase,readQuotes,readRef,quoteInput}={}){
 const events={},notifications=[],counts={purchase:0,quote:0,readQuotes:0,flush:0,send:0};
 const nodes=Object.fromEntries([
  ['buyNow','已购买 · 立即入库'],['saveQuote','加入候选价'],
  ['restoreDefaultReference','恢复默认价'],['saveEditedReference','保存新价格'],
  ['formalCompareActionFeedback',''],['formalReferenceActionFeedback','']
 ].map(([id,textContent])=>[id,{id,dataset:{},disabled:false,textContent,closest(){return this;}}]));
 const doc={addEventListener:(type,fn)=>{events[type]=fn;},removeEventListener(){},
  getElementById:id=>nodes[id]||null};
 const ui=Bridge.create({
  commands:{submit:async(action,value)=>{
   counts.purchase++;return purchaseSubmit?purchaseSubmit(action,value):
    {status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:'purchase-original'};
  }},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'}),
   flush:async()=>{counts.flush++;return flush?flush():
    {status:'PRIMARY_CLOUD_SYNCED_VERIFIED'};}},
  readPurchase:()=>({brand:'好奇',series:'小森林',size:'S',pieces:20,price:30}),
  readQuote:()=>null,readTransaction:()=>null,
  notify:a=>notifications.push(a),formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  allowReference:true,allowQuotes:true,purchaseOnly:true,
  documentCommands:{submit:async(input)=>{
   counts.quote++;return quoteSubmit?quoteSubmit(input):
    {status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'quote-original'};
  }},
  documentQueue:{send:async()=>{counts.send++;return send?send():
    {status:'DOCUMENT_SYNC_CONFIRMED'};}},
  readDocumentInput:el=>{
   if(el.id==='saveQuote'){
    counts.readQuotes++;return quoteInput?quoteInput():{kind:'quotes',action:'add',
     record:{id:'quote-original-id',brand:'好奇',size:'S'}};
   }
   return {kind:'reference',action:'reset',
    record:{key:'好奇|小森林|S'}};
  },
  readQuotesBaseline:()=>({familyId:'family-A',actorUid:'A',revision:3,body:{items:[]}}),
  onQuotesReadback:readQuotes||(()=> 'ready'),
  readReferenceBaseline:()=>({familyId:'family-A',actorUid:'A',revision:4,
   body:{referenceOverrides:{'好奇|小森林|S':1.25}}}),
  onReferenceReadback:readRef||(()=> 'ready'),
  onPurchaseReadback:readPurchase||(()=> 'ready')
 });
 const binding=ui.attach(doc);
 function click(id){
  const el=nodes[id],e={target:el,preventDefault(){},stopImmediatePropagation(){}};
  events.click(e);
 }
 return {nodes,click,notifications,counts,binding};
}
test('P4 trial: rapid purchase taps create exactly one original purchase and only verified readback succeeds',async()=>{
 const submit=deferred(),readback=deferred();
 const f=fixture({purchaseSubmit:()=>submit.promise,readPurchase:()=>readback.promise});
 f.click('buyNow');f.click('buyNow');f.click('buyNow');
 assert.equal(f.counts.purchase,1);
 assert.equal(f.nodes.buyNow.disabled,true);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/正在保存采购/);
 submit.resolve({status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:'purchase-original'});
 await tick();
 assert.equal(f.nodes.buyNow.disabled,true);
 assert.doesNotMatch(f.nodes.formalCompareActionFeedback.textContent,/保存成功/);
 readback.resolve('ready');
 await tick();await tick();
 assert.equal(f.counts.purchase,1);
 assert.equal(f.nodes.buyNow.disabled,false);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/采购保存成功.*读回/);
});
test('P4 trial: unknown purchase ACK keeps original ID and blocks repeat until verified recovery',async()=>{
 let recovered=false;
 const f=fixture({
  flush:()=>({status:'PRIMARY_ACK_UNKNOWN'}),
  readPurchase:async p=>{assert.equal(p.operationId,'purchase-original');
   return recovered?'ready':'pending';}
 });
 f.click('buyNow');await tick();await tick();
 assert.equal(f.nodes.buyNow.disabled,true);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/正在核验，请勿重复提交/);
 assert.equal(f.binding.hasPendingMinimalReview('purchase'),true);
 f.click('buyNow');await tick();assert.equal(f.counts.purchase,1);
 assert.equal(await f.binding.recoverMinimalButtons({domain:'purchase'}),false);
 recovered=true;
 assert.equal(await f.binding.recoverMinimalButtons({domain:'purchase'}),true);
 assert.equal(f.nodes.buyNow.disabled,false);
 assert.equal(f.binding.hasPendingMinimalReview('purchase'),false);
});
test('P4 trial: candidate quote allocates one record UUID, blocks rapid taps and only marks readback success',async()=>{
 const readback=deferred(),f=fixture({readQuotes:()=>readback.promise});
 f.click('saveQuote');f.click('saveQuote');
 assert.equal(f.counts.quote,1);
 assert.equal(f.counts.readQuotes,1,'avoid generating a second quote id during feedback');
 assert.equal(f.nodes.saveQuote.disabled,true);
 await tick();
 assert.doesNotMatch(f.nodes.formalCompareActionFeedback.textContent,/保存成功/);
 readback.resolve('ready');await tick();await tick();
 assert.equal(f.nodes.saveQuote.disabled,false);
 assert.equal(f.counts.quote,1);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/候选价保存成功/);
});
test('P4 trial: quote uncertain ACK retains original request and exact record for manual verification',async()=>{
 let verified=false;
 const f=fixture({
  send:()=>({status:'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID'}),
  readQuotes:async p=>{assert.equal(p.requestId,'quote-original');
   assert.equal(p.record.id,'quote-original-id');
   assert.equal(p.expectedRevision,3);
   return verified?'ready':'pending';}
 });
 f.click('saveQuote');await tick();await tick();
 assert.equal(f.nodes.saveQuote.disabled,true);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/正在核验，请勿重复提交/);
 f.click('saveQuote');await tick();assert.equal(f.counts.quote,1);
 assert.equal(await f.binding.recoverMinimalButtons({domain:'quotes'}),false);
 verified=true;
 assert.equal(await f.binding.recoverMinimalButtons({domain:'quotes'}),true);
 assert.equal(f.nodes.saveQuote.disabled,false);
});
test('P4 trial: restore default shows immediate progress, stops repeat and waits on actual readback',async()=>{
 const readback=deferred(),f=fixture({readRef:()=>readback.promise});
 f.click('restoreDefaultReference');f.click('restoreDefaultReference');
 assert.equal(f.counts.quote,1);
 assert.equal(f.nodes.restoreDefaultReference.disabled,true);
 assert.match(f.nodes.restoreDefaultReference.textContent,/正在恢复/);
 assert.match(f.nodes.formalReferenceActionFeedback.textContent,/正在恢复默认价/);
 await tick();
 assert.doesNotMatch(f.nodes.formalReferenceActionFeedback.textContent,/已恢复默认价/);
 readback.resolve('ready');await tick();await tick();
 assert.equal(f.nodes.restoreDefaultReference.disabled,false);
 assert.match(f.nodes.formalReferenceActionFeedback.textContent,/已恢复默认价.*读回/);
});
test('P4 trial: invalid quote restores button without false success',async()=>{
 const f=fixture({quoteSubmit:()=>({status:'QUOTES_FORM_INVALID'})});
 f.click('saveQuote');await tick();await tick();
 assert.equal(f.nodes.saveQuote.disabled,false);
 assert.match(f.nodes.formalCompareActionFeedback.textContent,/未保存|未完成/);
 assert.doesNotMatch(f.nodes.formalCompareActionFeedback.textContent,/保存成功/);
});
test('P4 trial: new feedback elements exist in development UI; original rc4 source remains frozen',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/formal/index.html'),'utf8');
 const module=fs.readFileSync(path.join(__dirname,'../sync/primary-formal-ui-actions.js'),'utf8');
 const ctrl=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(html,/id="formalCompareActionFeedback" role="status"/);
 assert.match(html,/id="formalReferenceActionFeedback" role="status"/);
 assert.ok(html.includes(module.trim()));
 assert.match(ctrl,/recoverMinimalButtons.*domain:'quotes'/);
 assert.match(ctrl,/recoverMinimalButtons.*domain:'purchase'/);
 require('../scripts/verify-v120-frozen-candidates.cjs').check('rc4');
});
