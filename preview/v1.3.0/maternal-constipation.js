/* Daily summaries use the maternal page's shared document and save lifecycle. */
(function(root){
'use strict';

const kind='constipation';
const levels={none:'无',mild:'轻微',moderate:'中度',severe:'严重'};
const water={
 lt_500:'少于 500 ml','500_999':'500～999 ml','1000_1499':'1000～1499 ml',
 '1500_1999':'1500～1999 ml','2000_plus':'2000 ml 及以上'
};
const fields={
 Date:'date',DidDefecate:'didDefecate',Count:'defecationCount',StoolType:'stoolType',
 Difficulty:'difficulty',Bloating:'bloating',Pain:'abdominalPain',Water:'waterIntakeRange',Note:'note'
};
const ownLabel=(labels,key)=>Object.prototype.hasOwnProperty.call(labels,key)?labels[key]:'未记录';
const yesNo=value=>value===true?'有':value===false?'无':'未记录';
const wholeBetween=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;

function history(body){
 return (body?.items||[]).filter(item=>item.kind===kind).sort((a,b)=>b.date.localeCompare(a.date));
}
function valuesForDisplay(item){
 return [
  ['是否排便',item.didDefecate===true?'是':item.didDefecate===false?'否':'未记录'],
  ['排便次数',wholeBetween(item.defecationCount,0,3)
   ?(item.defecationCount===3?'3 次及以上':item.defecationCount+' 次'):'未记录'],
  ['Bristol 性状',item.didDefecate===false?'不适用'
   :wholeBetween(item.stoolType,1,7)?item.stoolType+' 型':'未记录'],
  ['排便困难',ownLabel(levels,item.difficulty)],['腹胀',ownLabel(levels,item.bloating)],
  ['腹痛',yesNo(item.abdominalPain)],['饮水',ownLabel(water,item.waterIntakeRange)],
  ['备注',typeof item.note==='string'&&item.note.trim()?item.note:'未记录']
 ];
}
function updateDocument(body,record,{editing=false}={}){
 const previous=body.items.find(item=>item.id===record.id);
 if(editing?previous?.kind!==kind:Boolean(previous))return null;
 if(previous?.date!==record.date&&body.items.some(item=>item.kind===kind&&item.date===record.date))
  return null;
 const next={...previous,...record};
 if(previous&&'details' in previous)next.details=previous.details;
 return {...body,items:editing?body.items.map(item=>item===previous?next:item):[...body.items,next]};
}
function deleteDocument(body,id){
 if(!body.items.some(item=>item.kind===kind&&item.id===id))return null;
 return {...body,items:body.items.filter(item=>item.kind!==kind||item.id!==id)};
}
const booleanValue=value=>value==='true'?true:value==='false'?false:null;
const numericValue=value=>value===''?null:Number(value);
const sameDateMessage='该日期已有记录，已切换为编辑模式。';
const duplicateDateMessage='这一天有多条历史记录，请在下方选择要编辑的记录。';
const blockedMessages={
 'waiting-context':'等待家庭账号验证完成。',
 reading:'正在读取妈妈健康档案…',
 'queue-checking':'正在核验本地保存队列…',
 'queue-timeout':'本地保存队列核验超时，请重新刷新。',
 refresh:'请先刷新云端记录，读取成功后才能录入。',
 storage:'当前浏览器暂不能保存，请检查浏览器存储。',
 pending:'请先核验待确认保存。',
 working:'正在处理妈妈健康操作…',
 disabled:'当前环境未开放排便记录保存。'
};

function mount({doc,localDate,validDate,validRecord,getBody,newId,save}){
 const byName=name=>doc.getElementById('maternalConstipation'+name);
 const form=byName('Form');
 if(!form)return;
 const heading=byName('Heading'),status=byName('Status'),saveButton=byName('Save');
 const cancel=byName('Cancel'),empty=byName('Empty'),list=byName('History'),warning=byName('Warning');
 const blocker=byName('Blocker');
 const inputs=Object.fromEntries(Object.keys(fields).map(name=>[name,byName(name)]));
 const {Date:date,DidDefecate:did,Count:count,StoolType:stool}=inputs;
 let editId=null,originalValues=null,dirty=false,blocked='waiting-context';

 function controls(reason=blocked){
  blocked=reason;
  const writable=!blocked;
  if(blocker){
   blocker.hidden=writable;
   blocker.textContent=blockedMessages[blocked]||'';
  }
  for(const input of Object.values(inputs))input.disabled=!writable;
  for(const name of ['DidDefecate','Count','Difficulty','Bloating','Pain','StoolType','Water']){
   const placeholder=inputs[name].options?.[0];
   const optional=name==='StoolType'||name==='Water';
   if(placeholder)placeholder.textContent=editId?'未记录':optional?'不记录':'未选择';
  }
  stool.disabled=!writable||did.value!=='true';
  saveButton.disabled=!writable;
  cancel.hidden=!dirty&&!editId;
  cancel.disabled=!writable;
  for(const button of list.querySelectorAll('button'))button.disabled=!writable;
 }
 function reset(){
  editId=null;originalValues=null;dirty=false;
  date.max=date.value=localDate(new Date());
  did.value=count.value=stool.value='';
  inputs.Difficulty.value=inputs.Bloating.value='none';
  inputs.Pain.value='false';
  inputs.Water.value=inputs.Note.value='';
  heading.textContent='每日排便记录';
  saveButton.textContent='保存排便记录';
  status.textContent='';
  controls();
 }
 function edit(item){
  editId=item.id;dirty=false;
  date.max=localDate(new Date());
  for(const [name,key] of Object.entries(fields)){
   const value=item[key];
   inputs[name].value=value==null?'':String(value);
  }
  originalValues=Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,input.value]));
  heading.textContent='编辑排便记录';
  saveButton.textContent='保存修改';
  status.textContent='';
  controls();
 }
 function selectDate(){
  if(originalValues?.Date===date.value)return false;
  const matching=(getBody()?.items||[]).filter(item=>item.kind===kind&&item.date===date.value);
  if(matching.length===1){
   edit(matching[0]);
   status.textContent=sameDateMessage;
   return true;
  }
  if(matching.length>1){
   status.textContent=duplicateDateMessage;
   dirty=true;controls();
   return true;
  }
  return false;
 }
 function deleteRecord(item){
  if(blocked||!doc.defaultView.confirm('确定删除 '+item.date+' 的排便记录？删除后无法撤销。'))return;
  return save(body=>{
   const next=deleteDocument(body,item.id);
   if(!next)status.textContent='这条排便记录已不存在，请刷新后重试。';
   return next;
  },{feedback:status,successMessage:'排便记录已从云端删除。',
   onCommit:()=>{if(editId===item.id)reset();}});
 }
 function appendRecord(item){
  const card=doc.createElement('li'),title=doc.createElement('h4'),data=doc.createElement('dl');
  title.textContent=item.date;
  for(const [label,value] of valuesForDisplay(item)){
   const pair=doc.createElement('div'),term=doc.createElement('dt'),description=doc.createElement('dd');
   term.textContent=label;description.textContent=value;
   pair.append(term,description);data.append(pair);
  }
  const actions=doc.createElement('div');
  actions.className='maternal-bowel-actions';
  for(const [label,action] of [['编辑',()=>{edit(item);date.focus();}],['删除',()=>deleteRecord(item)]]){
   const button=doc.createElement('button');
   button.className='btn ghost sm';button.type='button';button.textContent=label;
   button.setAttribute('aria-label',label+' '+item.date+' 的排便记录');
   button.addEventListener('click',()=>{if(!blocked)return action();});
   actions.append(button);
  }
  card.append(title,data,actions);list.append(card);
 }
 function render(){
  const body=getBody(),records=history(body);
  const duplicateDates=new Set(),seenDates=new Set();
  list.replaceChildren();
  for(const item of records){
   if(seenDates.has(item.date))duplicateDates.add(item.date);
   seenDates.add(item.date);
   appendRecord(item);
  }
  warning.hidden=!duplicateDates.size;
  warning.textContent=duplicateDates.size
   ?'发现同日多条历史记录（'+[...duplicateDates].join('、')+'），已保留，请逐条核对。':'';
  empty.hidden=records.length>0;
  empty.textContent=body?'暂无排便记录。':'尚未读取云端排便记录。';
  controls();
 }

 form.addEventListener('input',()=>{if(!blocked){dirty=true;controls();}});
 date.addEventListener('change',()=>{
  if(blocked)return;
  status.textContent='';
  if(!selectDate()){dirty=true;controls();}
 });
 did.addEventListener('change',()=>{
  if(blocked)return;
  count.value=did.value==='true'?'1':did.value==='false'?'0':'';
  if(did.value!=='true')stool.value='';
  dirty=true;controls();
 });
 count.addEventListener('change',()=>{
  if(blocked)return;
  did.value=count.value===''?'':String(count.value!=='0');
  if(did.value!=='true')stool.value='';
  dirty=true;controls();
 });
 cancel.addEventListener('click',()=>{if(!blocked)reset();});
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(blocked)return;
  if(selectDate())return;
  const today=localDate(new Date());
  const values={date:date.value,didDefecate:booleanValue(did.value),
   defecationCount:numericValue(count.value),stoolType:numericValue(stool.value),
   difficulty:inputs.Difficulty.value,bloating:inputs.Bloating.value,
   abdominalPain:booleanValue(inputs.Pain.value),waterIntakeRange:inputs.Water.value||null,
   note:inputs.Note.value};
  if(!validDate(values.date)||values.date>today){
   status.textContent='请填写有效且不晚于今天的日期。';
   return;
  }
  return save(body=>{
   const previous=body.items.find(item=>item.kind===kind&&item.id===editId);
   let record={...values,kind,entryVersion:1,details:previous?.details??[]};
   if(previous&&previous.entryVersion===undefined){
    const changes=Object.fromEntries(Object.entries(fields)
     .filter(([name])=>inputs[name].value!==originalValues[name])
     .map(([,key])=>[key,values[key]]));
    const upgraded={stoolType:null,waterIntakeRange:null,note:'',details:[],
     ...previous,...changes,entryVersion:1};
    record=validRecord(upgraded)?upgraded:{...previous,...changes};
   }else if(!validRecord(record)){
    status.textContent='请明确选择是否排便、排便次数、困难程度、腹胀和腹痛情况。';
    return null;
   }
   const next=updateDocument(body,{...record,id:editId||newId()},{editing:Boolean(editId)});
   if(!next)status.textContent='日期已有记录或原记录已不存在，请核对历史记录。';
   return next;
  },{feedback:status,successMessage:'排便记录已保存至云端。',onCommit:reset});
 });
 reset();
 return {controls,render,reset,hasDraft:()=>dirty||Boolean(editId)};
}

const api={mount,history,valuesForDisplay,updateDocument,deleteDocument};
if(root)root.XBMaternalConstipation=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
