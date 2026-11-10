/* XiaoBao v1.2.0: legacy purchase read-only precision audit.
 * Never touches localStorage, network, IndexedDB, state or CloudBase.
 * Unknown legacy fields stay in the original JSON and must be preserved by
 * the later explicit migration; this module only reports whether orders are
 * safe to represent as exact integer RMB cents.
 */
(function(root){
 'use strict';
 const SIZES=new Set(['NB','S','M','L','XL','XXL']);
 function cents(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100000)
   throw new Error('invalid_legacy_price');
  const scaled=value*100,nearest=Math.round(scaled);
  // Compensate for IEEE754 binary approximation without silently rounding
  // a genuine third decimal place.
  if(!Number.isSafeInteger(nearest)||nearest<1||nearest>10000000
     ||Math.abs(scaled-nearest)>1e-7)
   throw new Error('legacy_price_precision_review_required');
  return nearest;
 }
 function validDay(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  const d=new Date(day+'T00:00:00.000Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day;
 }
 function textOK(value){
  return typeof value==='string'&&Array.from(value.trim()).length>0
   &&Array.from(value.trim()).length<=120
   &&!/[\u0000-\u001f\u007f]/u.test(value);
 }
 function audit(transactions){
  if(!Array.isArray(transactions))throw new Error('legacy_transactions_not_array');
  const ids=new Set(),issues=[],orders=[];
  let purchases=0,uses=0,piecesBought=0,amountFen=0;
  for(let i=0;i<transactions.length;i++){
   const row=transactions[i];
   const id=row&&typeof row.id==='string'?row.id:null;
   const issue=code=>issues.push({index:i,id,code});
   if(!row||typeof row!=='object'||Array.isArray(row)){
    issue('invalid_transaction');continue;
   }
   if(!id||id.length>200){issue('invalid_record_id');continue;}
   if(ids.has(id)){issue('duplicate_record_id');continue;}
   ids.add(id);
   if(!['buy','use'].includes(row.type)){issue('unknown_transaction_type');continue;}
   if(!validDay(row.date))issue('invalid_purchase_or_use_date');
   if(!SIZES.has(row.size))issue('invalid_size');
   if(!Number.isInteger(row.pieces)||row.pieces<1||row.pieces>100000)
    issue('invalid_piece_count');
   if(row.type==='use'){uses++;continue;}
   purchases++;
   if(!textOK(row.brand))issue('invalid_brand');
   if(!textOK(row.series))issue('invalid_series');
   let fen=null;
   try{fen=cents(row.price)}catch(e){issue(e.message)}
   if(fen!=null&&Number.isInteger(row.pieces)&&row.pieces>=1
     &&Number.isSafeInteger(amountFen+fen)&&Number.isSafeInteger(piecesBought+row.pieces)){
    amountFen+=fen;piecesBought+=row.pieces;
    orders.push({legacyId:id,priceFen:fen});
   }else if(fen!=null)issue('purchase_total_out_of_range');
  }
  return {
   canMigrate:issues.length===0,
   recordCount:transactions.length,purchaseCount:purchases,useCount:uses,
   pieceCount:piecesBought,spendFen:amountFen,
   orders,issues
  };
 }
 const api=Object.freeze({cents,validDay,audit});
 if(root)root.XBLegacyPurchaseAudit=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
