/* XiaoBao v1.2.0: read-only migration inspection. No storage, SDK or network side effects. */
(function (root) {
  'use strict';
  const LEGACY_KEY = 'xiaobao_diaper_planner_v1';
  const SIZES = Object.freeze(['NB','S','M','L','XL','XXL']);

  const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isId = x => typeof x === 'string' && x.length > 0 && x.length <= 200;
  const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);

  function assert(condition, message) {
    if (!condition) throw new Error('migration_preflight: ' + message);
  }

  function validateArray(name, records) {
    assert(Array.isArray(records), name + '_must_be_array');
    const ids = new Set();
    for (const row of records) {
      assert(isObject(row) && isId(row.id), name + '_invalid_id');
      assert(!ids.has(row.id), name + '_duplicate_id');
      ids.add(row.id);
    }
  }

  function verifyLegacyState(state) {
    assert(isObject(state), 'state_must_be_object');
    for (const name of ['inventory','target','daily','referenceOverrides']) {
      assert(isObject(state[name]), name + '_must_be_object');
    }
    for (const size of SIZES) {
      const qty = state.inventory[size];
      assert(Number.isInteger(qty) && qty >= 0 && qty <= 100000,
        'inventory_invalid_' + size);
      const target = state.target[size];
      assert(Number.isInteger(target) && target >= 0 && target <= 10000,
        'target_invalid_' + size);
      const daily = state.daily[size];
      assert(Number.isInteger(daily) && daily >= 1 && daily <= 30,
        'daily_invalid_' + size);
    }
    validateArray('transactions',state.transactions);
    validateArray('quotes',state.quotes);
    if (own(state,'weightRecords')) validateArray('weightRecords',state.weightRecords);
    if (own(state,'babyProfile')) assert(isObject(state.babyProfile),'babyProfile_invalid');
    const dateNames=['dueDate','birthDate'];
    for(const d of dateNames)assert(typeof state[d]==='string',d+'_invalid');
    return true;
  }

  function count(state) {
    verifyLegacyState(state);
    const types = {buy:0,use:0,other:0};
    let purchasesCents=0, purchasePrecisionIssueCount=0;
    let purchasedPieces=0,consumedPieces=0;
    for (const t of state.transactions) {
      if(t.type==='buy'){
        types.buy++;
        purchasedPieces+=Number(t.pieces)||0;
        // This is a display summary, not a migration authorization.
        // Do not silently round a real third decimal of the purchase total.
        const money=t.price,scaled=money*100;
        if(typeof money==='number'&&Number.isFinite(money)&&money>0
          &&money<=100000&&Number.isSafeInteger(Math.round(scaled))
          &&Math.abs(scaled-Math.round(scaled))<=1e-7)
         purchasesCents+=Math.round(scaled);
        else purchasePrecisionIssueCount++;
      }else if(t.type==='use'){
        types.use++;consumedPieces+=Number(t.pieces)||0;
      }else types.other++;
    }
    const inventory = Object.fromEntries(SIZES.map(size=>[size,state.inventory[size]]));
    return {
      inventory, totalInventory:SIZES.reduce((sum,size)=>sum+inventory[size],0),
      transactionCount:state.transactions.length,
      purchaseCount:types.buy, consumptionCount:types.use, otherTransactionCount:types.other,
      purchasedPieces,consumedPieces,
      totalPurchaseCents:purchasePrecisionIssueCount?null:purchasesCents,
      purchasePrecisionIssueCount,
      quoteCount:state.quotes.length,
      weightRecordCount:(state.weightRecords||[]).length,
      referenceOverrideCount:Object.keys(state.referenceOverrides).length,
      birthDate:state.birthDate,
      dueDate:state.dueDate
    };
  }

  // Sort keys, but never reorder arrays or change numeric values.
  function stableStringify(value) {
    if (Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
    if (isObject(value)) {
      const keys=Object.keys(value).sort();
      return '{'+keys.map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';
    }
    const json=JSON.stringify(value);
    assert(json !== undefined, 'unsupported_json_value');
    return json;
  }
  async function sha256Hex(data,cryptoProvider) {
    const provider=cryptoProvider || (typeof globalThis!=='undefined' && globalThis.crypto);
    assert(provider && provider.subtle && typeof provider.subtle.digest==='function','webcrypto_required');
    const bytes=(typeof TextEncoder!=='undefined' ? new TextEncoder() : null);
    assert(!!bytes,'text_encoder_required');
    const result=await provider.subtle.digest('SHA-256',bytes.encode(data));
    return Array.from(new Uint8Array(result),n=>n.toString(16).padStart(2,'0')).join('');
  }

  async function inspect(state, cryptoProvider) {
    const summary=count(state);
    const canonical=stableStringify(state);
    return {app:'xiaobao-diapers',legacyKey:LEGACY_KEY,manifestVersion:1,
      sha256:await sha256Hex(canonical,cryptoProvider),byteLength:new TextEncoder().encode(canonical).length,
      summary};
  }

  const api=Object.freeze({LEGACY_KEY,SIZES,verifyLegacyState,count,stableStringify,sha256Hex,inspect});
  if(root)root.XBMigrationContract=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
