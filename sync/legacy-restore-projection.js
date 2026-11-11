/* XiaoBao P2-4B: pure read-only projection of legacy v1.1.2 JSON importer.
 * Inspects how existing index.html importData would normalize a backup.
 * This is a diagnostic simulation, NOT execution of the production importer.
 * Does not call localStorage, IndexedDB, CloudBase, or any write API.
 */
(function(root){
 'use strict';
 const SIZES=Object.freeze(['NB','S','M','L','XL','XXL']);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 function fail(code){throw Error('restore_projection:'+code);}
 function defaults(){return {
  dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
  babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
  weightRecords:[],sizeMode:'manual',autoSize:'NB',
  replenishPolicy:{mode:'days',days:7},goalPrice:1.5,plannedBudget:250,
  target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
  daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
  inventory:Object.fromEntries(SIZES.map(s=>[s,0])),
  quotes:[],transactions:[],referenceOverrides:{},preset:'balanced'
 };}
 const num=(x,fb=0)=>Number.isFinite(+x)?+x:fb;
 const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
 function simulateImporter(exported,growth){
  if(!object(exported)||exported.app!=='xiaobao-diapers'
     ||exported.version!==1||!object(exported.data)
     ||!object(exported.data.inventory)||!object(exported.data.target))
   fail('unsupported_export');
  if(!growth||typeof growth.extras!=='function'
     ||typeof growth.syncAutoSize!=='function')
   fail('growth_dependency_required');
  const raw=exported.data,d=defaults();
  let state={
   ...d,...raw,
   target:{...d.target,...raw.target},
   daily:{...d.daily,...raw.daily},
   inventory:{...d.inventory,...raw.inventory},
   quotes:Array.isArray(raw.quotes)?raw.quotes:[],
   transactions:Array.isArray(raw.transactions)?raw.transactions:[],
   referenceOverrides:object(raw.referenceOverrides)?raw.referenceOverrides:{}
  };
  for(const size of SIZES){
   state.inventory[size]=clamp(Math.round(num(state.inventory[size])),0,100000);
   state.target[size]=clamp(Math.round(num(state.target[size])),0,10000);
   state.daily[size]=clamp(Math.round(num(state.daily[size],8)),1,30);
  }
  Object.assign(state,growth.extras({...raw,currentSize:state.currentSize}));
  growth.syncAutoSize(state);
  return state;
 }
 // No original values or user-controlled record keys returned in the report.
 // Comparison is structural; all changes, even harmless default additions, are
 // flagged for explicit review rather than silently accepted as lossless.
 function compare(before,after,{maxExamples=20}={}){
  if(!Number.isInteger(maxExamples)||maxExamples<0||maxExamples>100)
   fail('invalid_comparison_limit');
  const byRoot=new Map(),examples=[];
  let differenceCount=0;
  function difference(tokens){
   differenceCount++;
   const root=String(tokens[0]??'state');
   byRoot.set(root,(byRoot.get(root)||0)+1);
   if(examples.length<maxExamples){
    // Only return static, known root sections and generic token TYPES.
    // Never return raw property keys, record IDs, user names or values.
    const known=new Set([
     'dueDate','birthDate','currentSize','babyWeight','babyProfile',
     'weightRecords','sizeMode','autoSize','replenishPolicy',
     'goalPrice','plannedBudget','target','daily','inventory',
     'quotes','transactions','referenceOverrides','preset'
    ]);
    examples.push({
     section:known.has(root)?root:'unknown_extension',
     depth:tokens.length,
     leafKind:typeof tokens.at(-1)==='number'?'array_index':'field'
    });
   }
  }
  function walk(a,b,path){
   if(Object.is(a,b))return;
   if(Array.isArray(a)||Array.isArray(b)){
    if(!Array.isArray(a)||!Array.isArray(b)){difference(path);return;}
    if(a.length!==b.length)difference([...path,'length']);
    const n=Math.max(a.length,b.length);
    for(let i=0;i<n;i++){
     if(i>=a.length||i>=b.length)difference([...path,i]);
     else walk(a[i],b[i],[...path,i]);
    }
    return;
   }
   if(object(a)||object(b)){
    if(!object(a)||!object(b)){difference(path);return;}
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    for(const key of keys){
     if(!Object.prototype.hasOwnProperty.call(a,key)
       ||!Object.prototype.hasOwnProperty.call(b,key))
      difference([...path,key]);
     else walk(a[key],b[key],[...path,key]);
    }
    return;
   }
   difference(path);
  }
  walk(before,after,[]);
  const sectionChanges=[...byRoot].map(([name,count])=>({
   section:new Set(Object.keys(defaults())).has(name)?name:'unknown_extension',
   differences:count
  })).sort((a,b)=>a.section.localeCompare(b.section));
  return Object.freeze({
   status:differenceCount===0?'PROJECTION_IDENTICAL':'PROJECTION_DIFF_REVIEW_REQUIRED',
   differenceCount,
   sectionChanges:Object.freeze(sectionChanges),
   examples:Object.freeze(examples),
   productionImportExecuted:false,
   localStateUnchanged:true,
   canReplaceLocalState:false,
   canUpload:false
  });
 }
 function inspect(exported,growth){
  const simulated=simulateImporter(exported,growth);
  return compare(exported.data,simulated);
 }
 const api=Object.freeze({inspect,simulateImporter,compare});
 if(root)root.XBLegacyRestoreProjection=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
