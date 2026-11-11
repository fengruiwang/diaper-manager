/* Isolated Node VM: executes EXACT production importData, save, load and
 * helpers extracted from current index.html with a SYNTHETIC FileReader.
 * localStorage is replaced with a disposable Map scoped to one VM call.
 * No real browser, user backup, credential, network or filesystem writes.
 * Never bundle this test-only helper in production PWA or public test pages.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Growth=require('../../growth.js');
const root=path.join(__dirname,'../..');
const page=fs.readFileSync(path.join(root,'index.html'),'utf8');
const lines=page.split(/\r?\n/);
function exactLine(prefix){
 const found=lines.filter(line=>line.startsWith(prefix));
 if(found.length!==1)throw Error('isolated_importer:source_contract_changed:'+prefix);
 return found[0];
}
function exactBlock(startPrefix,endPrefix){
 const starts=lines.map((line,i)=>line.startsWith(startPrefix)?i:-1)
  .filter(x=>x>=0);
 const ends=lines.map((line,i)=>line.startsWith(endPrefix)?i:-1)
  .filter(x=>x>=0);
 if(starts.length!==1||ends.length!==1||ends[0]<=starts[0])
  throw Error('isolated_importer:load_source_contract_changed');
 return lines.slice(starts[0],ends[0]).join('\n');
}
const fragments=[
 exactLine("const SIZES=['NB','S','M','L','XL','XXL'];"),
 exactLine("const KEY='xiaobao_diaper_planner_v1';"),
 exactLine("const defaults=()=>"),
 exactLine("const num=(x,fb=0)=>"),
 exactLine("const clamp=(x,lo,hi)=>"),
 exactBlock('function load(){','let state=load();'),
 exactLine('let state=load();'),
 exactLine('function save()'),
 exactLine('function importData(file)')
];
const importSource=fragments.at(-1);
for(const literal of [
 'new FileReader()','JSON.parse(reader.result)',
 'state={...d,...raw','XBGrowth.extras','XBGrowth.syncAutoSize(state)',
 'save();renderAll();toast('
]){
 if(!importSource.includes(literal))
  throw Error('isolated_importer:production_import_contract_changed:'+literal);
}
const script=new vm.Script(
 "'use strict';\n"+fragments.join('\n')+"\n"+
 "globalThis.__getState=()=>JSON.parse(JSON.stringify(state));\n"+
 "globalThis.__getReloadedState=()=>JSON.parse(JSON.stringify(load()));\n",
 {filename:'production-v1.1.2-import-and-load-extracted.js'}
);
function executeImport(exportObject,{approved=true}={}){
 const events=[];
 const virtualStorage=new Map();
 const temporaryFile={content:typeof exportObject==='string'?
  exportObject:JSON.stringify(exportObject)};
 const sandbox={
  XBGrowth:Growth,
  __uploadedFile:temporaryFile,
  localStorage:{
   getItem:key=>{
    if(key!=='xiaobao_diaper_planner_v1')
     throw Error('isolated_importer:unknown_storage_key');
    return virtualStorage.get(key)??null;
   },
   setItem:(key,value)=>{
    if(key!=='xiaobao_diaper_planner_v1'||typeof value!=='string')
     throw Error('isolated_importer:unexpected_storage_write');
    events.push('isolated_storage_write');
    virtualStorage.set(key,value);
   },
   clear:()=>{throw Error('isolated_importer:clear_forbidden');},
   removeItem:()=>{throw Error('isolated_importer:remove_forbidden');}
  },
  FileReader:class{
   result=null;
   onload=null;
   readAsText(file,encoding){
    if(encoding!=='utf-8')throw Error('isolated_importer:unexpected_encoding');
    if(!file||typeof file.content!=='string')
     throw Error('isolated_importer:synthetic_file_required');
    this.result=file.content;
    if(typeof this.onload==='function')this.onload();
   }
  },
  confirm:()=>{events.push('confirm');return approved;},
  renderAll:()=>{events.push('render');},
  toast:message=>{events.push('toast:'+message);}
 };
 const context=vm.createContext(sandbox,{
  name:'synthetic-v1.1.2-import-only',
  codeGeneration:{strings:false,wasm:false}
 });
 script.runInContext(context,{timeout:1000});
 vm.runInContext('importData(__uploadedFile)',context,{timeout:1000});
 const persisted=virtualStorage.get('xiaobao_diaper_planner_v1')??null;
 return Object.freeze({
  didSave:typeof persisted==='string',
  savedState:persisted?JSON.parse(persisted):null,
  // Normalize the VM realm's prototype before host assert.deepEqual.
  reloadedState:JSON.parse(JSON.stringify(sandbox.__getReloadedState())),
  events:Object.freeze(events),
  currentState:sandbox.__getState(),
  productionFunctionUsed:true,
  realBrowserStorageTouched:false
 });
}
module.exports=Object.freeze({executeImport,importSource});
