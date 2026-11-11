/* XiaoBao v1.2.0 P2-3B IN-MEMORY smoke rehearsal.
 * Completely synthetic. No CloudBase SDK, fetch, RPC, storage or real data.
 * MUST NOT be imported into the production PWA.
 */
(function(root){
 'use strict';
 const CHILD='00000000-0000-4000-8000-0000000000aa';
 const FAMILY='00000000-0000-4000-8000-0000000000bb';
 const A_OP='00000000-0000-4000-8000-0000000000a1';
 const B_OP='00000000-0000-4000-8000-0000000000b1';
 const BUY_A=Object.freeze({id:A_OP,actor:'A',size:'S',pieces:60,fen:3999,brand:'模拟品牌A',series:'仅测试'});
 const BUY_B=Object.freeze({id:B_OP,actor:'B',size:'S',pieces:80,fen:5999,brand:'模拟品牌B',series:'仅测试'});
 function model(){
  let child=null,retired=false,quantity=0,revision=0;
  let purchases=new Map();
  function state(){
   return Object.freeze({
    environment:'MEMORY_ONLY',
    family:'SYNTHETIC',
    smokeChild:!!child,
    retired,quantity,revision,
    operationCount:purchases.size,
    purchaseCount:purchases.size,
    activeTotalFen:[...purchases.values()].reduce((x,p)=>x+p.fen,0),
    visibleToRealApp:false
   });
  }
  function reply(status,code,details){
   return Object.freeze({status,code,details:details||null,state:state()});
  }
  function create(actor){
   if(actor!=='A')return reply('REJECTED','OWNER_REQUIRED');
   if(retired)return reply('REJECTED','RETIRED_SLOT_CANNOT_REOPEN');
   if(child)return reply('PASS','IDEMPOTENT_SAME_CHILD',{child:'SYNTHETIC'});
   child=CHILD;
   return reply('PASS','SINGLE_TEST_CHILD_CREATED',{child:'SYNTHETIC'});
  }
  function buy(p){
   if(!child||retired)return reply('REJECTED','CHILD_UNAVAILABLE');
   const prior=purchases.get(p.id);
   if(prior){
    if(JSON.stringify(prior)===JSON.stringify(p))
     return reply('PASS','DUPLICATE_ACK_NO_CHANGE',{operation:'SYNTHETIC'});
    return reply('REJECTED','OPERATION_ID_CONFLICT');
   }
   if(!Number.isSafeInteger(p.pieces)||p.pieces<1||quantity+p.pieces>100000)
    return reply('REJECTED','INVALID_QUANTITY');
   purchases.set(p.id,Object.freeze({...p}));
   quantity+=p.pieces;revision++;
   return reply('PASS','APPLIED_ONCE',{operation:'SYNTHETIC'});
  }
  function read(actor){
   if(!child||retired)return reply('REJECTED','CHILD_UNAVAILABLE');
   if(actor!=='A'&&actor!=='B')return reply('REJECTED','MEMBER_REQUIRED');
   return reply('PASS','SERVER_VIEW_SIMULATED',{
    quantity,revision,seenOwnOperations:[...purchases.values()]
     .filter(p=>p.actor===actor).map(_=>'ACK')
   });
  }
  function retire(actor){
   if(actor!=='A')return reply('REJECTED','OWNER_REQUIRED');
   if(!child)return reply('REJECTED','CHILD_UNAVAILABLE');
   if(retired)return reply('PASS','ALREADY_RETIRED');
   retired=true;
   return reply('PASS','TEST_CHILD_RETIRED_HISTORY_RETAINED');
  }
  function run(action){
   switch(action){
    case 'createAsMember':return create('B');
    case 'create':return create('A');
    case 'repeatCreate':return create('A');
    case 'buyA':return buy(BUY_A);
    case 'buyB':return buy(BUY_B);
    case 'retryA':return buy(BUY_A);
    case 'reusedIdModifiedAmount':return buy({...BUY_A,pieces:66});
    case 'readA':return read('A');
    case 'readB':return read('B');
    case 'retireAsMember':return retire('B');
    case 'retire':return retire('A');
    case 'buyAfterRetire':return buy({...BUY_A,id:'00000000-0000-4000-8000-0000000000c1'});
    default:return reply('REJECTED','UNKNOWN_TEST_ACTION');
   }
  }
  return Object.freeze({run,state});
 }
 const api=Object.freeze({create:model,scenario:Object.freeze([
  Object.freeze({id:'createAsMember',title:'B 尝试创建（应拒绝）',expected:'OWNER_REQUIRED'}),
  Object.freeze({id:'create',title:'A 创建唯一测试宝宝',expected:'SINGLE_TEST_CHILD_CREATED'}),
  Object.freeze({id:'repeatCreate',title:'A 重复创建（幂等）',expected:'IDEMPOTENT_SAME_CHILD'}),
  Object.freeze({id:'buyA',title:'A 模拟采购 S +60',expected:'APPLIED_ONCE'}),
  Object.freeze({id:'buyB',title:'B 模拟采购 S +80',expected:'APPLIED_ONCE'}),
  Object.freeze({id:'retryA',title:'A 同操作 ID 重发（不增加）',expected:'DUPLICATE_ACK_NO_CHANGE'}),
  Object.freeze({id:'reusedIdModifiedAmount',title:'A 修改原操作金额/数量（应拒绝）',expected:'OPERATION_ID_CONFLICT'}),
  Object.freeze({id:'readA',title:'A 模拟读取库存及本人回执',expected:'SERVER_VIEW_SIMULATED'}),
  Object.freeze({id:'readB',title:'B 模拟读取库存及本人回执',expected:'SERVER_VIEW_SIMULATED'}),
  Object.freeze({id:'retireAsMember',title:'B 尝试停用（应拒绝）',expected:'OWNER_REQUIRED'}),
  Object.freeze({id:'retire',title:'A 停用（保留历史）',expected:'TEST_CHILD_RETIRED_HISTORY_RETAINED'}),
  Object.freeze({id:'buyAfterRetire',title:'停用后尝试采购（应拒绝）',expected:'CHILD_UNAVAILABLE'})
 ])});
 if(root)root.XBSmokePreview=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
