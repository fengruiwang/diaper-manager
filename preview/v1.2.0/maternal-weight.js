/* Maternal weight panel for the formal family preview. */
(function(root){
'use strict';

function localDate(now=new Date()){
 return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),
  String(now.getDate()).padStart(2,'0')].join('-');
}

function formatJin(kg){return String(Number((kg*2).toFixed(2)));}

function weightInput(date,jin,today=localDate()){
 const time=Date.parse(date+'T00:00:00Z');
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||date.startsWith('0000-')
   ||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date||date>today)
  return {error:'请选择有效的测量日期，日期不能晚于今天。'};
 const value=String(jin).trim();
 const cents=Math.round(Number(value)*100);
 if(!/^(?:[0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$/.test(value)
   ||!Number.isSafeInteger(cents)||cents<=0)
  return {error:'请输入大于 0 的体重，最多保留两位小数（斤）。'};
 return {date,weightKg:cents/200};
}

function history(body){
 return (body?.items||[]).filter(item=>item.kind==='weight')
  .sort((a,b)=>b.date.localeCompare(a.date));
}

function updateDocument(body,record){
 const index=body.items.findIndex(item=>item.id===record.id);
 if(index!==-1&&body.items[index].kind!=='weight')return null;
 const items=body.items.slice();
 if(index===-1)items.push(record);
 else items[index]={...items[index],...record};
 return {...body,items};
}

function chart(records){
 if(!records.length)return '';
 // The same grid, polyline and point pattern as the existing growth SVG.
 const w=740,h=255,left=56,right=24,top=22,bottom=39;
 const width=w-left-right,height=h-top-bottom;
 const entries=records.slice().reverse();
 const dates=entries.map(item=>Date.parse(item.date+'T00:00:00Z'));
 const span=dates[dates.length-1]-dates[0];
 const values=entries.map(item=>Number(formatJin(item.weightKg)));
 const high=Math.max(...values)+1,low=Math.max(0,Math.min(...values)-1);
 const xy=entries.map((item,i)=>({
  x:span?left+(dates[i]-dates[0])/span*width:left+width/2,
  y:top+(high-values[i])/(high-low)*height,item
 }));
 const grid=Array.from({length:5},(_,i)=>{
  const y=top+height*i/4,label=(high-(high-low)*i/4).toFixed(1);
  return '<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y+'" y2="'+y+'" stroke="#e9eaf3"/>'
   +'<text x="'+(left-8)+'" y="'+(y+4)+'" font-size="13" text-anchor="end" fill="#657189">'+label+'</text>';
 }).join('');
 const line=xy.length>1?'<polyline fill="none" stroke="#7167da" stroke-width="3" points="'
  +xy.map(point=>point.x.toFixed(2)+','+point.y.toFixed(2)).join(' ')+'"/>':'';
 const points=xy.map((point,i)=>'<circle cx="'+point.x.toFixed(2)+'" cy="'+point.y.toFixed(2)
  +'" r="4.5" fill="#7167da" stroke="white" stroke-width="2"><title>'
  +point.item.date+' · '+values[i]+' 斤</title></circle>').join('');
 const labels='<text x="'+(span?left:left+width/2)+'" y="'+(h-9)+'" font-size="14" fill="#657189"'
  +(span?'':' text-anchor="middle"')+'>'+entries[0].date+'</text>'
  +(span?'<text x="'+(w-right)+'" y="'+(h-9)+'" font-size="14" text-anchor="end" fill="#657189">'
   +entries[entries.length-1].date+'</text>':'');
 return '<svg class="growth-chart" role="img" aria-label="妈妈体重趋势，单位斤，共'+entries.length
  +'个数据点" viewBox="0 0 '+w+' '+h+'">'+grid+line+points+labels+'</svg>';
}

const messages={
 UNAVAILABLE:'妈妈健康云端服务尚未部署或暂不可用，请稍后刷新。',
 PERMISSION_DENIED:'当前家庭账号暂无法访问妈妈健康云端服务。',
 OFFLINE:'当前离线，未确认云端保存，请联网后重试。',
 WRITES_DISABLED:'当前环境未开放妈妈体重保存。',
 REVISION_CONFLICT:'另一端已更新数据。本次未保存，请刷新云端记录后核对并重新保存。',
 REQUEST_ID_CONFLICT:'原保存请求与云端回执不一致。请刷新记录后核对。',
 INVALID_INPUT:'体重记录未通过保存校验，请检查输入后重试。',
 COMMITTED_NEEDS_REFRESH:'云端已确认保存，历史记录暂未刷新。请点击刷新云端记录。',
 PENDING_REQUEST:'有待确认的保存，请先核验原请求。',
 UNKNOWN:'保存结果未确认。请核验待确认保存，原请求已保留。'
};
const same=(a,b)=>a&&b&&a.actorUid===b.actorUid&&a.familyId===b.familyId&&a.app===b.app;

function mount({doc,host,controller,clientFactory,operationsFactory,cloudWritesEnabled=false}){
 const $=id=>doc.getElementById(id);
 const panel=$('maternal-health'),form=$('maternalWeightForm');
 if(!panel||!form)return;
 const date=$('maternalWeightDate'),jin=$('maternalWeightJin');
 const save=$('maternalWeightSave'),cancel=$('maternalWeightCancel');
 const refreshButton=$('maternalWeightRefresh'),recover=$('maternalWeightRecover');
 const archive=$('maternalWeightArchive'),status=$('maternalWeightStatus');
 const chartNode=$('maternalWeightChart'),empty=$('maternalWeightEmpty');
 const table=$('maternalWeightTable'),rows=$('maternalWeightRows');
 const client=clientFactory?.create({controller,cloudWritesEnabled});
 let operations;
 try{operations=operationsFactory?.create({host,controller,client,cloudWritesEnabled});}
 catch(_){/* Reading is available when persistent browser storage is unavailable. */}
 let scope=null,snapshot=null,canSave=false,busy=false,pending=false,conflict=null;
 let editId=null,draftRequest=null;

 function controls(){
  const disabled=busy||!scope;
  save.disabled=disabled||!operations||!cloudWritesEnabled||!canSave||pending;
  date.disabled=jin.disabled=cancel.disabled=refreshButton.disabled=disabled;
  cancel.hidden=!editId;
  recover.hidden=!pending;
  recover.disabled=disabled;
  archive.hidden=!conflict||!canSave||!(snapshot.revision>conflict.expectedRevision);
  archive.disabled=disabled;
  for(const button of rows.querySelectorAll('button'))button.disabled=disabled||!canSave;
 }
 function resetForm(){
  editId=draftRequest=null;
  date.max=date.value=localDate();
  jin.value='';
  $('maternalWeightHeading').textContent='记录体重';
  save.textContent='保存体重记录';
 }
 function render(){
  const records=history(snapshot?.body);
  const caption=snapshot?'暂无体重记录':'尚未读取体重记录';
  empty.hidden=records.length>0;
  empty.textContent=caption;
  table.hidden=!records.length;
  rows.replaceChildren();
  for(const item of records){
   const tr=doc.createElement('tr');
   for(const value of [item.date,formatJin(item.weightKg)]){
    const td=doc.createElement('td');td.textContent=value;tr.append(td);
   }
   const td=doc.createElement('td'),button=doc.createElement('button');
   button.type='button';button.className='btn ghost sm';button.textContent='编辑';
   button.setAttribute('aria-label','编辑 '+item.date+' 的体重记录');
   button.addEventListener('click',()=>{
    if(busy||!canSave)return;
    editId=item.id;draftRequest=null;date.value=item.date;jin.value=formatJin(item.weightKg);
    $('maternalWeightHeading').textContent='编辑体重';
    save.textContent='保存修改';
    controls();
    jin.focus();
   });
   td.append(button);tr.append(td);rows.append(tr);
  }
  chartNode.classList.toggle('empty',!records.length);
  if(records.length)chartNode.innerHTML=chart(records);
  else chartNode.textContent=caption;
  controls();
 }
 function current(started){return scope===started&&same(started,controller.verifiedContext());}
 async function run(message,work){
  if(!scope||busy)return;
  const started=scope;
  busy=true;status.textContent=message;controls();
  try{await work(started);}
  catch(_){
   if(current(started))status.textContent='操作未完成，请刷新记录或核验待确认保存。';
  }finally{
   if(scope===started){busy=false;controls();}
  }
 }
 async function review(started){
  if(!operations)return;
  const queue=await operations.pending();
  const conflicts=await operations.conflicts();
  if(!current(started))return;
  if(queue.status==='QUEUE_VERIFIED')pending=queue.pending+queue.retry>0;
  if(conflicts.status==='CONFLICTS_VERIFIED')conflict=conflicts.items[0]||null;
 }
 function refresh(){
  return run('正在读取云端体重记录…',async started=>{
   const result=host.navigator?.onLine===false?{status:'OFFLINE'}:await client?.read(started);
   if(!current(started))return;
   canSave=result?.status==='READ_VERIFIED';
   if(canSave){snapshot=result;render();}
   await review(started);
   if(!current(started))return;
   status.textContent=!canSave
    ?messages[result?.status]||'暂时无法读取妈妈健康云端记录，请刷新重试。'
    :!operations?'体重记录已读取。浏览器持久化存储不可用，暂不能保存。'
    :pending?messages.PENDING_REQUEST
    :conflict?'云端已刷新。核对并重新编辑后可保存，也可明确放弃旧冲突请求。'
    :'云端体重记录已刷新。';
  });
 }
 async function send(started){
  const result=await operations.send();
  if(!current(started))return;
  if(result.status==='COMMITTED'){
   snapshot=result.document;canSave=true;
   if(result.requestId===draftRequest)resetForm();
   render();
  }else if(result.status==='COMMITTED_NEEDS_REFRESH'){
   canSave=false;
   if(result.requestId===draftRequest)resetForm();
  }else if(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','UNAVAILABLE'].includes(result.status)){
   canSave=false;
  }
  await review(started);
  if(!current(started))return;
  status.textContent=result.status==='COMMITTED'?'体重记录已保存至云端。'
   :result.status==='EMPTY'?'没有待确认的保存请求。'
   :messages[result.status]||'本次保存未确认，请刷新记录或核验原请求。';
 }
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(save.disabled)return;
  const fields=weightInput(date.value,jin.value);
  if(fields.error){status.textContent=fields.error;return;}
  const existing=editId&&snapshot.body.items.find(item=>item.id===editId&&item.kind==='weight');
  if(editId&&!existing){status.textContent='原记录已变化，请取消编辑后从历史记录重新选择。';return;}
  if(existing&&formatJin(existing.weightKg)===formatJin(fields.weightKg))
   fields.weightKg=existing.weightKg;
  void run('正在保存体重记录…',async started=>{
   const nextBody=updateDocument(snapshot.body,{id:editId||host.crypto.randomUUID(),kind:'weight',...fields});
   if(!nextBody){status.textContent=messages.INVALID_INPUT;return;}
   const queued=await operations.queue({baseline:snapshot,nextBody});
   if(!current(started))return;
   if(queued.status==='QUEUED'){
    draftRequest=queued.requestId;pending=true;
    await send(started);
   }else{
    await review(started);
    if(current(started))status.textContent=messages[queued.status]||'本机未确认入队，请核验待确认保存。';
   }
  });
 });
 refreshButton.addEventListener('click',refresh);
 recover.addEventListener('click',()=>run('正在核验原保存请求…',send));
 cancel.addEventListener('click',()=>{resetForm();controls();});
 archive.addEventListener('click',()=>run('正在核验旧冲突请求…',async started=>{
  const result=await operations.abandonConflict({requestId:conflict.requestId,
   baseline:snapshot,userConfirmed:true});
  if(!current(started))return;
  await review(started);
  if(current(started))status.textContent=result.status==='ABANDONED'
   ?'旧冲突请求已归档。':'旧请求尚未归档，请刷新后重试。';
 }));
 doc.addEventListener('maternal-health-open',refresh);

 function setContext(next){
  if(!scope&&!next||same(scope,next))return;
  scope=next;snapshot=null;canSave=busy=pending=false;conflict=null;
  resetForm();render();
  status.textContent='尚未读取云端体重记录。';
  if(scope&&panel.classList.contains('active'))void refresh();
 }
 resetForm();render();
 return {setContext};
}

const api={mount,localDate,formatJin,weightInput,history,updateDocument,chart};
if(root)root.XBMaternalWeight=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
