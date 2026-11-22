/* Maternal weight panel for the formal family preview. */
(function(root){
'use strict';

function localDate(now=new Date()){
 return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),
  String(now.getDate()).padStart(2,'0')].join('-');
}

function localTime(now=new Date()){
 return [now.getHours(),now.getMinutes()].map(part=>String(part).padStart(2,'0')).join(':');
}

const isTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const recordTime=item=>isTime(item?.time)?item.time:'';
const recordNote=item=>typeof item.note==='string'?item.note:'';

function formatJin(kg){return String(Number((kg*2).toFixed(2)));}

function validDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000-'))return false;
 const time=Date.parse(date+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date;
}
function jinToKg(jin){
 const value=String(jin).trim();
 const cents=Math.round(Number(value)*100);
 return /^(?:[0-9]+(?:\.[0-9]{1,2})?|\.[0-9]{1,2})$/.test(value)
  &&Number.isSafeInteger(cents)&&cents>0?cents/200:null;
}
function weightInput(date,jin,today=localDate()){
 if(!validDate(date)||date>today)
  return {error:'请选择有效的测量日期，日期不能晚于今天。'};
 const weightKg=jinToKg(jin);
 if(weightKg===null)
  return {error:'请输入大于 0 的体重，最多保留两位小数（斤）。'};
 return {date,weightKg};
}
function profileInput({jin}){
 const prePregnancyWeightKg=jinToKg(jin);
 if(jin.trim()&&prePregnancyWeightKg===null)
  return {error:'孕前体重必须大于 0，最多保留两位小数（斤）。'};
 return {prePregnancyWeightKg};
}
function maternalStage(babyDates){
 if(!babyDates)return '未关联宝宝资料';
 if(validDate(babyDates.birthDate))return '产后';
 return validDate(babyDates.dueDate)?'孕期':'未填写宝宝日期';
}

function history(body){
 return (body?.items||[]).filter(item=>item.kind==='weight')
  .sort((a,b)=>b.date.localeCompare(a.date)||recordTime(b).localeCompare(recordTime(a)));
}

function trendRecords(records,period){
 if(period==='all')return records;
 const seen=new Set();
 // History is newest first, so the first record in a period wins.
 return records.filter(({date})=>{
  let key=date;
  if(period==='month')key=date.slice(0,7);
  else if(period==='week'){
   // UTC arithmetic here represents calendar days, not local timestamps.
   const monday=new Date(date+'T00:00:00Z');
   monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
   key=monday.getTime();
  }
  if(seen.has(key))return false;
  seen.add(key);
  return true;
 });
}

function weightChange(latest,previous){
 // Convert to hundredths of a jin and round the difference once.
 const change=latest.weightKg*200-previous.weightKg*200;
 const cents=Math.round(Math.abs(change));
 const sign=cents===0?'':change<0?'-':'+';
 return sign+(cents/100).toFixed(2)+' 斤';
}

function updateDocument(body,record){
 const index=body.items.findIndex(item=>item.id===record.id);
 if(index!==-1&&body.items[index].kind!=='weight')return null;
 const items=body.items.slice();
 if(index===-1)items.push(record);
 else items[index]={...items[index],...record};
 return {...body,items};
}

function deleteDocument(body,recordId){
 const index=body.items.findIndex(item=>item.id===recordId&&item.kind==='weight');
 if(index===-1)return null;
 const items=body.items.slice();
 items.splice(index,1);
 return {...body,items};
}

function chart(records,prePregnancyWeightKg){
 if(!records.length)return '';
 const hasReference=Number.isFinite(prePregnancyWeightKg)&&prePregnancyWeightKg>0;
 const reference=hasReference?Number(formatJin(prePregnancyWeightKg)):null;
 // The same grid, polyline and point pattern as the existing growth SVG.
 const w=740,h=255,left=56,right=24,top=hasReference?42:22,bottom=39;
 const width=w-left-right,height=h-top-bottom;
 const entries=records.slice().reverse();
 const dates=entries.map(item=>Date.parse(item.date+'T'+(recordTime(item)||'00:00')+':00Z'));
 const span=dates[dates.length-1]-dates[0];
 const values=entries.map(item=>Number(formatJin(item.weightKg)));
 const scaleValues=hasReference?[...values,reference]:values;
 const high=Math.max(...scaleValues)+1,low=Math.max(0,Math.min(...scaleValues)-1);
 const yFor=value=>top+(high-value)/(high-low)*height;
 const xy=entries.map((item,i)=>({
  x:span?left+(dates[i]-dates[0])/span*width:left+width/2,
  y:yFor(values[i]),item
 }));
 const grid=Array.from({length:5},(_,i)=>{
  const y=top+height*i/4,label=(high-(high-low)*i/4).toFixed(1);
  return '<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y+'" y2="'+y+'" stroke="#e9eaf3"/>'
   +'<text x="'+(left-8)+'" y="'+(y+4)+'" font-size="13" text-anchor="end" fill="#657189">'+label+'</text>';
 }).join('');
 const referenceLabel=hasReference?'孕前参考体重 · '+reference+' 斤':'';
 const referenceLine=hasReference
  ?'<path d="M '+left+' '+yFor(reference).toFixed(2)+' H '+(w-right)
   +'" fill="none" stroke="#986331" stroke-width="2" stroke-dasharray="7 5"/>'
   +'<path d="M '+left+' 18 h 26" fill="none" stroke="#986331" stroke-width="2" stroke-dasharray="7 5"/>'
   +'<text class="maternal-reference-label" x="'+(left+34)+'" y="24" font-size="16" fill="#795027">'+referenceLabel+'</text>'
  :'';
 const line=xy.length>1?'<polyline fill="none" stroke="#7167da" stroke-width="3" points="'
  +xy.map(point=>point.x.toFixed(2)+','+point.y.toFixed(2)).join(' ')+'"/>':'';
 const points=xy.map((point,i)=>'<circle cx="'+point.x.toFixed(2)+'" cy="'+point.y.toFixed(2)
  +'" r="4.5" fill="#7167da" stroke="white" stroke-width="2"><title>'
  +point.item.date+' · '+values[i]+' 斤'+(recordTime(point.item)?' · '+recordTime(point.item):'')
  +'</title></circle>').join('');
 const twoDates=entries[0].date!==entries[entries.length-1].date;
 const labels='<text x="'+(twoDates?left:left+width/2)+'" y="'+(h-9)+'" font-size="14" fill="#657189"'
  +(twoDates?'':' text-anchor="middle"')+'>'+entries[0].date+'</text>'
  +(twoDates?'<text x="'+(w-right)+'" y="'+(h-9)+'" font-size="14" text-anchor="end" fill="#657189">'
   +entries[entries.length-1].date+'</text>':'');
 return '<svg class="growth-chart" role="img" aria-label="妈妈体重趋势，单位斤，共'+entries.length
  +'个数据点'+(hasReference?'，'+referenceLabel:'')+'" viewBox="0 0 '+w+' '+h+'">'
  +grid+referenceLine+line+points+labels+'</svg>';
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
 COMMITTED_QUEUE_UNVERIFIED:'云端已确认保存，本地回执尚未核验，请继续核验原保存请求。',
 QUEUE_WRITE_FAILED:'本地入队失败，尚未提交云端，请检查浏览器存储后重试。',
 QUEUE_UNVERIFIED:'本地队列状态未确认，请刷新后核验原保存请求。',
 PENDING_REQUEST:'有待确认的保存，请先核验原请求。',
 UNKNOWN:'保存结果未确认。请核验待确认保存，原请求已保留。'
};
const queueMessages={
 timeout:'本地保存队列核验超时，请重新刷新。',
 storage:'当前浏览器暂不能保存，请检查浏览器存储。'
};
const same=(a,b)=>a&&b&&a.actorUid===b.actorUid&&a.familyId===b.familyId&&a.app===b.app;

// Read-only work may finish later. Only the returned result is applied by the caller.
async function readWithin(work){
 let timer;
 try{
  return await Promise.race([
   work(),
   new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'TIMEOUT'}),12000);})
  ]);
 }catch(_){return null;}
 finally{clearTimeout(timer);}
}

function mount({doc,host,controller,clientFactory,operationsFactory,refreshBabyDates,
 constipationFactory,cloudWritesEnabled=false}){
 const $=id=>doc.getElementById(id);
 const panel=$('maternal-health'),form=$('maternalWeightForm');
 if(!panel||!form)return;
 const date=$('maternalWeightDate'),jin=$('maternalWeightJin');
 const time=$('maternalWeightTime'),note=$('maternalWeightNote');
 const save=$('maternalWeightSave'),cancel=$('maternalWeightCancel');
 const refreshButton=$('maternalWeightRefresh'),recover=$('maternalWeightRecover');
 const archive=$('maternalWeightArchive'),status=$('maternalWeightStatus');
 const chartNode=$('maternalWeightChart'),empty=$('maternalWeightEmpty');
 const table=$('maternalWeightTable'),rows=$('maternalWeightRows');
 const pregnancyButton=$('maternalWeightPregnancy'),postpartumButton=$('maternalWeightPostpartum');
 const periodButtons=Array.from($('maternalWeightPeriods')?.querySelectorAll('button[data-period]')||[]);
 const latestWeight=$('maternalWeightLatest'),latestDate=$('maternalWeightLatestDate');
 const deltaWeight=$('maternalWeightDelta'),previousDate=$('maternalWeightPreviousDate');
 const profileForm=$('maternalProfileForm'),profileJin=$('maternalProfileJin');
 const profileDue=$('maternalProfileDue'),profileDelivery=$('maternalProfileDelivery');
 const profileStage=$('maternalProfileStage'),profileSave=$('maternalProfileSave'),profileStatus=$('maternalProfileStatus');
 const client=clientFactory?.create({controller,cloudWritesEnabled});
 let operations;
 try{operations=operationsFactory?.create({host,controller,client,cloudWritesEnabled});}
 catch(_){/* Reading is available when persistent browser storage is unavailable. */}
 let scope=null,snapshot=null,canSave=false,busy=false,pending=false,conflict=null;
 let queueState='idle';
 let reading=false;
 let editId=null,draftRequest=null,deletionRequest=null;
 let weightDirty=false;
 let profileDirty=false,profileRequest=null;
 let constipationRequest=null;
 let profileRead='idle';
 let birthDate='',stageView='pregnancy',trendPeriod='all';
 const constipation=constipationFactory?.({
  doc,localDate,validDate,validRecord:clientFactory?.validConstipation,
  getBody:()=>scope&&current(scope)?snapshot?.body:null,
  newId:()=>host.crypto.randomUUID(),
  save:(update,{feedback,onCommit,successMessage})=>{
   if(!canWrite())return;
   return run('正在保存排便记录…',started=>{
    let nextBody;
    try{nextBody=update(snapshot.body);}
    catch(_){feedback.textContent='无法准备排便记录，本次未提交，请重试。';}
    if(!nextBody)return;
    return saveDocument(started,nextBody,{bowelSave:{feedback,onCommit,successMessage}});
   },feedback);
  }
 });

 function canWrite(){
  return Boolean(scope&&current(scope)&&!busy&&canSave&&queueState==='verified'
   &&!pending&&operations&&cloudWritesEnabled);
 }

 function canRecover(){
  return Boolean(scope&&current(scope)&&!busy&&queueState==='verified'
   &&pending&&operations&&cloudWritesEnabled);
 }

 function controls(){
  const disabled=busy||!scope;
  const canWriteNow=canWrite();
  save.disabled=!canWriteNow;
  if(profileForm){
   profileSave.disabled=!canWriteNow;
   profileJin.disabled=disabled||!canSave||pending;
  }
  date.disabled=jin.disabled=cancel.disabled=refreshButton.disabled=disabled;
  if(time)time.disabled=disabled;
  if(note)note.disabled=disabled;
  cancel.hidden=!editId;
  recover.hidden=queueState!=='verified'||!pending;
  recover.disabled=!canRecover();
  archive.hidden=queueState!=='verified'||!conflict||!canSave||!(snapshot.revision>conflict.expectedRevision);
  archive.disabled=disabled;
  for(const button of rows.querySelectorAll('button'))
   button.disabled=button.dataset.deleteWeight?!canWriteNow:disabled||!canSave;
  const bowelBlock=!scope||!current(scope)?'waiting-context'
   :reading?'reading'
   :queueState==='checking'?'queue-checking'
   :busy?'working'
   :pending?'pending'
   :!canSave?(profileRead==='idle'?'reading':'refresh')
   :queueState==='timeout'?'queue-timeout'
   :queueState!=='verified'?'storage'
   :!cloudWritesEnabled?'disabled':'';
  constipation?.controls(bowelBlock);
 }
 function resetForm(){
  editId=draftRequest=null;
  weightDirty=false;
  const now=new Date();
  date.max=date.value=localDate(now);
  if(time)time.value=localTime(now);
  if(note)note.value='';
  jin.value='';
  $('maternalWeightHeading').textContent='记录体重';
  save.textContent='保存体重记录';
 }
 function setBabyDates(dates){
  if(!profileForm||(dates&&!current(scope)))return;
  profileStage.textContent=maternalStage(dates);
  profileDue.textContent=validDate(dates?.dueDate)?dates.dueDate:'未填写';
  profileDelivery.textContent=validDate(dates?.birthDate)?dates.birthDate:'未填写';
  const nextBirthDate=postpartumButton&&validDate(dates?.birthDate)?dates.birthDate:'';
  if(nextBirthDate===birthDate)return;
  if(!birthDate||!nextBirthDate)stageView=nextBirthDate?'postpartum':'pregnancy';
  birthDate=nextBirthDate;
  renderRecords();
 }
 function renderProfile(){
  if(!profileForm||profileDirty)return;
  const profile=snapshot?.body.maternalProfile;
  profileJin.value=profile?.prePregnancyWeightKg?formatJin(profile.prePregnancyWeightKg):'';
 }
 function render(){
  renderProfile();
  renderRecords();
  constipation?.render();
 }
 function selectStage(stage){
  if(stage===stageView||(stage==='postpartum'&&!birthDate))return;
  stageView=stage;
  renderRecords();
 }
 function stageRecords(){
  return history(snapshot?.body).filter(item=>!birthDate
   ||(stageView==='postpartum'?item.date>=birthDate:item.date<birthDate));
 }
 function emptyCaption(){
  if(!snapshot)return '尚未读取体重记录';
  return birthDate?(stageView==='postpartum'?'暂无产后体重记录':'暂无孕期体重记录'):'暂无体重记录';
 }
 function renderTrend(records){
  for(const button of periodButtons)
   button.setAttribute('aria-pressed',String(button.dataset.period===trendPeriod));
  const points=trendRecords(records,trendPeriod);
  chartNode.classList.toggle('empty',!points.length);
  if(points.length)chartNode.innerHTML=chart(points,snapshot.body.maternalProfile?.prePregnancyWeightKg);
  else chartNode.textContent=emptyCaption();
 }
 function renderStatistics([latest,previous]){
  if(!latestWeight)return;
  latestWeight.textContent=latest?formatJin(latest.weightKg)+' 斤':emptyCaption();
  latestDate.textContent=latest?[latest.date,recordTime(latest)].filter(Boolean).join(' · '):'';
  latestDate.hidden=!latest;
  deltaWeight.textContent=previous?weightChange(latest,previous):'暂无可比较记录';
  previousDate.textContent=previous?'上一条 · '+previous.date:'';
  previousDate.hidden=!previous;
 }
 function renderRecords(){
  pregnancyButton?.setAttribute('aria-pressed',String(stageView==='pregnancy'));
  if(postpartumButton){
   postpartumButton.hidden=!birthDate;
   postpartumButton.setAttribute('aria-pressed',String(stageView==='postpartum'));
  }
  const records=stageRecords();
  empty.hidden=records.length>0;
  empty.textContent=emptyCaption();
  table.hidden=!records.length;
  rows.replaceChildren();
  for(const item of records){
   const tr=doc.createElement('tr');
   const values=[item.date];
   if(time)values.push(recordTime(item)||'未记录');
   values.push(formatJin(item.weightKg));
   if(note)values.push(recordNote(item));
   for(const value of values){
    const td=doc.createElement('td');td.textContent=value;tr.append(td);
   }
   const td=doc.createElement('td'),button=doc.createElement('button');
   button.type='button';button.className='btn ghost sm';button.textContent='编辑';
   button.setAttribute('aria-label','编辑 '+item.date+' 的体重记录');
   button.addEventListener('click',()=>{
    if(busy||!canSave)return;
    editId=item.id;draftRequest=null;date.value=item.date;jin.value=formatJin(item.weightKg);
    if(time)time.value=recordTime(item);
    if(note)note.value=recordNote(item);
    $('maternalWeightHeading').textContent='编辑体重';
    save.textContent='保存修改';
    controls();
    jin.focus();
   });
   const remove=doc.createElement('button');
   remove.type='button';remove.className='btn ghost sm';remove.textContent='删除';
   remove.dataset.deleteWeight=item.id;
   remove.setAttribute('aria-label','删除 '+item.date+' 的体重记录（'+formatJin(item.weightKg)+' 斤）');
   remove.addEventListener('click',()=>deleteRecord(item));
   td.append(button,remove);tr.append(td);rows.append(tr);
  }
  renderStatistics(records);
  renderTrend(records);
  controls();
 }
 function current(started){return scope===started&&same(started,controller.verifiedContext());}
 async function run(message,work,feedback=status,phase=true){
  if(!scope||busy)return;
  const started=scope;
  busy=true;
  reading=phase==='reading';
  if(message)feedback.textContent=message;
  controls();
  try{return await work(started);}
  catch(_){
   if(current(started))feedback.textContent='操作未完成，请刷新记录或核验待确认保存。';
  }finally{
   if(scope===started){busy=reading=false;controls();}
  }
 }
 async function review(started,{refreshing=false}={}){
  if(!current(started))return;
  if(!operations){queueState='storage';return;}
  queueState='checking';
  if(refreshing)status.textContent='正在核验本地保存队列…';
  controls();
  const [queue,conflicts]=await Promise.all([
   readWithin(()=>operations.pending()),
   readWithin(()=>operations.conflicts())
  ]);
  // Both reads return data only; a timed-out promise or old scope cannot apply it later.
  if(!current(started))return;
  if(queue?.status==='QUEUE_VERIFIED')pending=queue.pending+queue.retry>0;
  if(conflicts?.status==='CONFLICTS_VERIFIED')conflict=conflicts.items[0]||null;
  queueState=queue?.status==='QUEUE_VERIFIED'&&conflicts?.status==='CONFLICTS_VERIFIED'?'verified'
   :queue?.status==='TIMEOUT'||conflicts?.status==='TIMEOUT'?'timeout':'storage';
 }
 function refresh({background=false,babyDates=false}={}){
  const quiet=background&&Boolean(snapshot);
  return run(quiet?null:'正在读取云端体重记录…',async started=>{
   if(profileStatus&&profileRead==='failed')profileStatus.textContent='';
   if(!snapshot){
    profileRead='loading';
    if(profileStatus)profileStatus.textContent='正在读取妈妈健康档案…';
   }
   const datesRead=babyDates&&refreshBabyDates&&host.navigator?.onLine!==false
    ?Promise.resolve().then(()=>refreshBabyDates(started)).catch(()=>false):null;
   const result=host.navigator?.onLine===false?{status:'OFFLINE'}
    :await readWithin(()=>client?.read(started));
   if(!current(started))return;
   reading=false;
   canSave=result?.status==='READ_VERIFIED'&&(!snapshot||result.revision>=snapshot.revision);
   if(canSave&&profileStatus&&profileRead==='loading')profileStatus.textContent='';
   profileRead=canSave?'ready':'failed';
   if(canSave){snapshot=result;render();}
   else{
    if(profileStatus)profileStatus.textContent=snapshot
     ?'云端刷新失败，当前显示上次读取的数据。请点击「刷新云端记录」重试。'
     :'暂时无法读取妈妈健康档案，请点击「刷新云端记录」重试。';
   }
   await review(started,{refreshing:true});
   const datesResult=await datesRead;
   if(!current(started))return;
   const queueIssue=queueMessages[queueState];
   const healthReady=canSave&&!queueIssue;
   const unavailable=['UNAVAILABLE','PERMISSION_DENIED'].includes(result?.status)?messages[result.status]+' ':'';
   const healthMessage=!canSave
    ?unavailable+'云端读取失败，请重新刷新。'+(queueIssue?' '+queueIssue
     :pending?' '+messages.PENDING_REQUEST:'')
    :queueIssue?'妈妈健康档案已读取。'+queueIssue
    :pending?messages.PENDING_REQUEST
    :conflict?'云端已刷新。核对并重新编辑后可保存，也可明确放弃旧冲突请求。'
    :'云端体重记录已刷新。'+(cloudWritesEnabled?'妈妈健康档案已读取，可以操作。':'');
   const datesMessage=datesResult===false?'宝宝日期刷新失败，保留上次已验证的日期。请重试。'
    :datesResult===true?'宝宝日期已刷新。':'';
   const partialRefresh=Boolean(canSave&&queueIssue)||(typeof datesResult==='boolean'&&healthReady!==datesResult);
   status.textContent=(partialRefresh?'部分刷新。':'')+healthMessage+(datesMessage?' '+datesMessage:'');
   return partialRefresh?'partial':healthReady?'success':'failure';
  },status,'reading');
 }
 async function send(started,feedback=status){
  let result;
  try{result=await operations.send();}
  catch(_){result={status:'UNKNOWN'};}
  if(!current(started))return;
  const deletedId=deletionRequest&&result.requestId===deletionRequest.requestId
   ?deletionRequest.recordId:null;
  const savedProfile=profileRequest&&result.requestId===profileRequest;
  const savedBowel=constipationRequest?.requestId===result.requestId?constipationRequest:null;
  const committed=['COMMITTED','COMMITTED_NEEDS_REFRESH','COMMITTED_QUEUE_UNVERIFIED'].includes(result.status);
  let message=result.status==='COMMITTED'
   ?(savedBowel?.successMessage||(savedProfile?'妈妈健康档案已保存至云端。'
    :deletedId?'体重记录已从云端删除。':'记录已保存至云端。'))
   :result.status==='EMPTY'?'没有待确认的保存请求。'
   :messages[result.status]||'本次保存未确认，请刷新记录或核验原请求。';
  if(['UNAVAILABLE','PERMISSION_DENIED','OFFLINE'].includes(result.status))message='云端提交未完成。'+message;
  if(committed){
   const editRemoved=editId&&result.status==='COMMITTED'
    &&!result.document.body.items.some(item=>item.id===editId&&item.kind==='weight');
   if(savedProfile){profileDirty=false;profileRequest=null;}
   else if(savedBowel){savedBowel.onCommit();constipationRequest=null;}
   else if(result.requestId===draftRequest||(deletedId&&editId===deletedId)||editRemoved)resetForm();
   if(deletedId)deletionRequest=null;
  }
  if(result.status==='COMMITTED'){
   snapshot=result.document;canSave=true;
   if(profileStatus&&profileRead==='failed')profileStatus.textContent='';
   profileRead='ready';
   try{render();}
   catch(_){canSave=false;message=messages.COMMITTED_NEEDS_REFRESH;}
  }else if(committed){
   canSave=false;
  }else if(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','UNAVAILABLE'].includes(result.status)){
   canSave=false;
  }
  const targets=new Set([feedback,savedProfile?profileStatus:null,savedBowel?.feedback]);
  for(const target of targets){if(target)target.textContent=message;}
  await review(started);
  if(!current(started))return;
  if(queueMessages[queueState]){
   const checked=(committed?'保存后的本地队列未确认。':'')+queueMessages[queueState];
   for(const target of targets){
    if(target)target.textContent=message+' '+checked;
   }
  }
 }
 async function saveDocument(started,nextBody,{deletedId,profileSave=false,bowelSave}={}){
  const feedback=bowelSave?.feedback||(profileSave?profileStatus:status);
  feedback.textContent='正在将保存请求写入本地队列…';
  let queued;
  try{queued=await operations.queue({baseline:snapshot,nextBody});}
  catch(_){queued={status:'QUEUE_UNVERIFIED'};}
  if(!current(started))return;
  if(queued.status==='QUEUED'||(queued.status==='QUEUE_UNVERIFIED'&&queued.requestId)){
   if(deletedId)deletionRequest={requestId:queued.requestId,recordId:deletedId};
   else if(profileSave)profileRequest=queued.requestId;
   else if(bowelSave)constipationRequest={requestId:queued.requestId,...bowelSave};
   else draftRequest=queued.requestId;
   pending=true;
  }
  if(queued.status==='QUEUED'){
   feedback.textContent='正在提交云端并核验保存回执…';
   await send(started,feedback);
  }else{
   if(queued.status==='QUEUE_UNVERIFIED'||queued.status==='PENDING_REQUEST')pending=true;
   const message=messages[queued.status]||'本机未确认入队，请核验待确认保存。';
   feedback.textContent=message;
   await review(started);
   if(current(started)&&queueMessages[queueState])feedback.textContent=message+' '+queueMessages[queueState];
  }
 }
 function deleteRecord(item){
  if(!canWrite())return;
  if(!doc.defaultView?.confirm('确定删除 '+item.date+' 的妈妈体重记录？删除后无法撤销。'))return;
  if(!canWrite())return;
  return run('正在删除体重记录…',async started=>{
   const nextBody=deleteDocument(snapshot.body,item.id);
   if(!nextBody){status.textContent='原记录已变化，请刷新云端记录后重试。';return;}
   await saveDocument(started,nextBody,{deletedId:item.id});
  });
 }
 const markWeightDirty=()=>{weightDirty=true;};
 form.addEventListener('input',markWeightDirty);
 form.addEventListener('change',markWeightDirty);
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(save.disabled)return;
  const fields=weightInput(date.value,jin.value);
  if(fields.error){status.textContent=fields.error;return;}
  const existing=editId&&snapshot.body.items.find(item=>item.id===editId&&item.kind==='weight');
  if(editId&&!existing){status.textContent='原记录已变化，请取消编辑后从历史记录重新选择。';return;}
  if(time){
   if(isTime(time.value))fields.time=time.value;
   else if(time.value||time.validity?.badInput||!existing||recordTime(existing)){
    status.textContent='请输入有效的测量时间（HH:mm）。';return;
   }
  }
  if(note)fields.note=note.value;
  if(existing&&formatJin(existing.weightKg)===formatJin(fields.weightKg))
   fields.weightKg=existing.weightKg;
  void run('正在保存体重记录…',async started=>{
   const nextBody=updateDocument(snapshot.body,{id:editId||host.crypto.randomUUID(),kind:'weight',...fields});
   if(!nextBody){status.textContent=messages.INVALID_INPUT;return;}
   await saveDocument(started,nextBody);
  });
 });
 profileForm?.addEventListener('input',()=>{
  profileDirty=true;
  profileStatus.textContent='';
 });
 profileForm?.addEventListener('submit',event=>{
  event.preventDefault();
  if(!canWrite())return;
  if(profileJin.validity?.badInput){
   profileStatus.textContent='请检查孕前体重输入。';return;
  }
  const profile=profileInput({jin:profileJin.value});
  if(profile.error){profileStatus.textContent=profile.error;return;}
  const nextBody={...snapshot.body};
  const previous=nextBody.maternalProfile;
  if(profile.prePregnancyWeightKg!==null&&previous?.prePregnancyWeightKg
    &&formatJin(profile.prePregnancyWeightKg)===formatJin(previous.prePregnancyWeightKg))
   profile.prePregnancyWeightKg=previous.prePregnancyWeightKg;
  if(previous||profile.prePregnancyWeightKg!==null)nextBody.maternalProfile={...previous,...profile};
  return run('正在保存妈妈健康档案…',started=>saveDocument(started,nextBody,{profileSave:true}),profileStatus);
 });
 const refreshCloudRecords=()=>refresh({babyDates:true});
 pregnancyButton?.addEventListener('click',()=>selectStage('pregnancy'));
 postpartumButton?.addEventListener('click',()=>selectStage('postpartum'));
 for(const button of periodButtons)button.addEventListener('click',()=>{
  if(trendPeriod===button.dataset.period)return;
  trendPeriod=button.dataset.period;
  renderTrend(stageRecords());
 });
 refreshButton.addEventListener('click',refreshCloudRecords);
 recover.addEventListener('click',()=>{
  if(canRecover())return run('正在核验原保存请求…',send);
 });
 cancel.addEventListener('click',()=>{resetForm();controls();});
 archive.addEventListener('click',()=>run('正在核验旧冲突请求…',async started=>{
  const result=await operations.abandonConflict({requestId:conflict.requestId,
   baseline:snapshot,userConfirmed:true});
  if(!current(started))return;
  await review(started);
  if(current(started))status.textContent=result.status==='ABANDONED'
   ?'旧冲突请求已归档。':'旧请求尚未归档，请刷新后重试。';
 }));
 doc.addEventListener('maternal-health-open',()=>refresh({background:true}));

 function setContext(next){
  if(!scope&&!next||same(scope,next))return;
  scope=next?{...next}:null;
  snapshot=null;canSave=busy=reading=pending=false;conflict=null;queueState='idle';
  trendPeriod='all';
  setBabyDates(null);
  deletionRequest=null;
  constipationRequest=null;
  constipation?.reset();
  profileRead='idle';
  profileDirty=false;profileRequest=null;
  if(profileStatus)profileStatus.textContent='尚未读取妈妈健康档案。';
  resetForm();render();
  status.textContent='尚未读取云端体重记录。';
  if(scope&&panel.classList.contains('active'))void refresh();
 }
 setBabyDates(null);resetForm();render();
 return {setContext,setBabyDates,refreshCloudRecords,
  canPullRefresh:()=>Boolean(scope&&current(scope)&&!busy&&!editId&&!weightDirty&&!profileDirty
    &&!constipation?.hasDraft())};
}

const api={mount,localDate,formatJin,weightInput,profileInput,maternalStage,history,trendRecords,updateDocument,deleteDocument,chart};
if(root)root.XBMaternalWeight=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
