/* Isolated Node VM harness: executes the EXACT importData function text
 * extracted from the current production index.html, against SYNTHETIC backups.
 * No actual browser, file picker, localStorage, network, credentials or user data.
 * The only 'save' writes to this transient VM fixture's in-memory string.
 * Do not bundle with production UI or run on users' real exported JSON.
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
const fragments=[
 exactLine("const SIZES=['NB','S','M','L','XL','XXL'];"),
 exactLine("const defaults=()=>"),
 exactLine("const num=(x,fb=0)=>"),
 exactLine("const clamp=(x,lo,hi)=>"),
 exactLine("function importData(file)")
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
 "'use strict';\n"+fragments.slice(0,-1).join('\n')+"\n"+
 "let state=defaults();\n"+importSource+"\n"+
 "globalThis.__getState=()=>JSON.parse(JSON.stringify(state));\n",
 {filename:'production-v1.1.2-importData-extracted.js'}
);
function executeImport(exportObject,{approved=true}={}){
 const events=[];
 let persisted=null;
 const temporaryFile={content:typeof exportObject==='string'?
  exportObject:JSON.stringify(exportObject)};
 const sandbox={
  XBGrowth:Growth,
  __uploadedFile:temporaryFile,
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
  toast:message=>{events.push('toast:'+message);},
  save:()=>{events.push('isolated_save');persisted=JSON.stringify(sandbox.__getState());return true;}
 };
 const context=vm.createContext(sandbox,{
  name:'synthetic-v1.1.2-import-only',
  codeGeneration:{strings:false,wasm:false}
 });
 script.runInContext(context,{timeout:1000});
 vm.runInContext('importData(__uploadedFile)',context,{timeout:1000});
 return Object.freeze({
  didSave:typeof persisted==='string',
  // Local transient JSON string, not browser localStorage.
  savedState:persisted?JSON.parse(persisted):null,
  events:Object.freeze(events),
  // A non-committing run can still inspect initial fixture defaults.
  currentState:sandbox.__getState(),
  productionFunctionUsed:true,
  realBrowserStorageTouched:false
 });
}
module.exports=Object.freeze({executeImport,importSource});
