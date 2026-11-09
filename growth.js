/* XiaoBao growth and post-birth planning domain, v1.1.1. No network, no storage writes. */
(function(root){
'use strict';
const SIZES=['NB','S','M','L','XL','XXL'];
const MAX_KG={NB:5,S:8,M:11,L:14,XL:17,XXL:Infinity};
const LIMITS={NB:'约 5 kg 以下',S:'约 4–8 kg',M:'约 6–11 kg',L:'约 9–14 kg',XL:'约 12–17 kg',XXL:'参考商品包装'};
const isSize=x=>SIZES.includes(x);
const str=x=>String(x==null?'':x);
const esc=x=>str(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=x=>Number(x);
const validWeight=x=>x!==''&&x!=null&&Number.isFinite(number(x))&&number(x)>=0.3&&number(x)<=40;
const dateOK=x=>/^\d{4}-\d{2}-\d{2}$/.test(str(x))&&!Number.isNaN(Date.parse(str(x)+'T00:00:00Z'))&&new Date(str(x)+'T00:00:00Z').toISOString().slice(0,10)===str(x);
const timeOK=x=>!x||/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(str(x));
const localToday=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const born=state=>dateOK(state.birthDate)&&state.birthDate<=localToday();
function replenishmentPolicy(state){
 const raw=state&&state.replenishPolicy;
 return {mode:raw&&raw.mode==='custom'?'custom':'days',
  days:raw&&[5,7,10].includes(Number(raw.days))?Number(raw.days):7};
}
function targetForSize(state,size){
 const d=Math.max(1,Math.min(30,number((state.daily||{})[size])||8));
 const policy=replenishmentPolicy(state),configured=number((state.target||{})[size]);
 if(policy.mode==='days')return {target:d*policy.days,source:'days',policy};
 if(Number.isFinite(configured)&&configured>0)return {target:Math.round(configured),source:'custom',policy};
 return {target:d*7,source:'fallback',policy};
}
function extras(raw){
 const p=raw.babyProfile&&typeof raw.babyProfile==='object'&&!Array.isArray(raw.babyProfile)?raw.babyProfile:{};
 return {
  babyProfile:{name:str(p.name||'小宝').slice(0,30),sex:['男','女',''].includes(p.sex)?p.sex:'',birthTime:timeOK(p.birthTime)?str(p.birthTime):'',birthWeight:validWeight(p.birthWeight)?number(p.birthWeight):'',birthLength:p.birthLength!==''&&p.birthLength!=null&&number(p.birthLength)>=20&&number(p.birthLength)<=70?number(p.birthLength):''},
  weightRecords:Array.isArray(raw.weightRecords)?raw.weightRecords.filter(x=>x&&dateOK(x.date)&&timeOK(x.time)&&validWeight(x.weight)&&str(x.id)).map(x=>({id:str(x.id).slice(0,80),date:str(x.date),time:str(x.time),weight:number(x.weight),note:str(x.note).slice(0,120)})):[],
  sizeMode:raw.sizeMode==='auto'?'auto':'manual',
  autoSize:isSize(raw.autoSize)?raw.autoSize:(isSize(raw.currentSize)?raw.currentSize:'NB'),
   replenishPolicy:replenishmentPolicy(raw)
 };
}
function measurements(state){
 const out=[];
 const profile=state.babyProfile||{};
 if(dateOK(state.birthDate)&&validWeight(profile.birthWeight)){
  out.push({id:'__birth__',date:state.birthDate,time:str(profile.birthTime),weight:number(profile.birthWeight),note:'出生体重',isBirth:true});
 }
 for(const r of state.weightRecords||[]){
  if(r&&dateOK(r.date)&&timeOK(r.time)&&validWeight(r.weight))out.push({...r,weight:number(r.weight),isBirth:false});
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||str(a.time).localeCompare(str(b.time))||(a.isBirth?-1:1));
}
function latestWeight(state){
 const all=measurements(state);
 if(all.length){const last=all[all.length-1];return {weight:last.weight,date:last.date,source:last.isBirth?'birth':'record',count:all.length}}
 if(validWeight(state.babyWeight))return {weight:number(state.babyWeight),date:'',source:'legacy',count:0};
 return null;
}
function recommendSize(weight,anchor){
 if(!validWeight(weight))return null;
 let i=Math.max(0,SIZES.indexOf(isSize(anchor)?anchor:'NB'));
 while(i<SIZES.length-1&&number(weight)>MAX_KG[SIZES[i]])i++;
 return SIZES[i];
}
function effectiveSize(state){
 const manual=isSize(state.currentSize)?state.currentSize:'NB';
 if(state.sizeMode!=='auto'||!born(state))return manual;
 const weight=latestWeight(state);
 return weight?recommendSize(weight.weight,isSize(state.autoSize)?state.autoSize:manual):manual;
}
function syncAutoSize(state){
 if(state.sizeMode==='auto'&&born(state)&&latestWeight(state))state.autoSize=effectiveSize(state);
 return effectiveSize(state);
}
function stockPlan(state){
 const size=effectiveSize(state),idx=SIZES.indexOf(size),next=SIZES[idx+1]||null;
 const stock=x=>Math.max(0,Math.round(number((state.inventory||{})[x])||0));
 const daily=x=>Math.max(1,Math.min(30,number((state.daily||{})[x])||8));
 const configured=targetForSize(state,size),target=configured.target;
 return {size,next,idx,stock:stock(size),daily:daily(size),target,targetSource:configured.source,policy:configured.policy,shortage:Math.max(0,target-stock(size)),days:stock(size)/daily(size),
  upcoming:SIZES.slice(idx+1),past:SIZES.slice(0,idx).filter(x=>stock(x)>0),stockOf:stock,dailyOf:daily,weight:latestWeight(state)};
}
const fmt=n=>Math.round(n).toLocaleString('zh-CN');
const money=n=>'¥'+(Number(n)||0).toFixed(2);
function dashboard(state){
 const p=stockPlan(state);
 const days=p.days.toFixed(1),weight=p.weight;
 const kpis='<div class="kpi"><div class="kpi-label">当前使用尺码</div><div class="kpi-value purple">'+p.size+'</div><div class="kpi-meta">'+(state.sizeMode==='auto'?'体重自动推荐':'手动指定')+'</div></div>'
  +'<div class="kpi"><div class="kpi-label">'+p.size+' 码现有库存</div><div class="kpi-value">'+fmt(p.stock)+' <span class="fine">片</span></div><div class="kpi-meta">日用约 '+fmt(p.daily)+' 片</div></div>'
  +'<div class="kpi"><div class="kpi-label">当前尺码预计可用</div><div class="kpi-value '+(p.days<5?'orange':'green')+'">'+days+' <span class="fine">天</span></div><div class="kpi-meta">按现有库存计算</div></div>'
  +'<div class="kpi"><div class="kpi-label">建议补货</div><div class="kpi-value">'+fmt(p.shortage)+' <span class="fine">片</span></div><div class="kpi-meta">补至 '+fmt(p.target)+' 片 · '+(p.targetSource==='days'?'按'+p.policy.days+'天用量':p.targetSource==='custom'?'自定义目标':'临时按7天用量')+'</div></div>';
 let advice='',warn=p.days<5;
 if(warn)advice=p.size+' 码现有库存预计可用 '+days+' 天，建议根据试穿贴合情况小批量补货。';
 else advice='当前 '+p.size+' 码库存预计可用 '+days+' 天，可关注下一尺码，但不建议提前大量囤货。';
 if(state.sizeMode==='auto'&&!weight)advice+=' 尚无有效体重，暂沿用原尺码。';
 if(state.sizeMode==='auto'&&weight&&weight.source==='legacy')advice+=' 当前参考的是旧体重数据，建议在「成长记录」补充测量日期。';
 const alert='<div class="alert '+(warn?'warning':'')+'"><div><strong>'+(warn?'⚠️ 补货提醒':'💡 采购提示')+'</strong><p>'+esc(advice)+'</p></div><button class="btn secondary sm" data-action="go" data-target="compare">去比价</button></div>';
 function sizeCard(s){
  const n=p.stockOf(s),d=p.dailyOf(s),goalInfo=targetForSize(state,s),goal=goalInfo.target;
  const pct=Math.max(0,Math.min(100,(n/goal)*100));
  return '<div class="sizecard '+(s===p.size?'focus':'')+'"><div class="size-top"><span class="size-pill">'+s+(s===p.size?' · 正在用':s===p.next?' · 下一码':'')+'</span><span class="size-range">'+esc(LIMITS[s])+'</span></div>'
   +'<div class="stock-number"><b>'+fmt(n)+'</b><small>片现货</small></div>'
   +'<div class="bar"><span style="width:'+pct.toFixed(0)+'%"></span></div>'
   +'<div class="micro"><span>'+(goalInfo.source==='fallback'?'参考备货 '+fmt(goal)+' 片':'目标 '+fmt(goal)+' 片')+'</span><span>约可用 '+(n/d).toFixed(1)+' 天</span></div>'
   +'<div class="size-actions"><button class="btn secondary sm" data-action="consume" data-size="'+s+'" data-count="1" '+(!n?'disabled':'')+'>− 用 1 片</button><button class="btn ghost sm" data-action="consume" data-size="'+s+'" data-count="'+Math.min(n,Math.round(d))+'" '+(!n?'disabled':'')+'>− 记 1 天</button><button class="btn ghost sm" data-action="editstock" data-size="'+s+'">盘点</button></div>'
   +'<div class="size-detail">'+(s===p.size?'当前使用尺码':s===p.next?'下一尺码，建议先试小包装':'未来尺码，按需关注')+'</div></div>';
 }
 const cards=[p.size,...p.upcoming].map(sizeCard).join('');
 const currentRow='<div class="plan-row"><div class="plan-left"><span class="dot">'+p.size+'</span><div><b>当前尺码补货</b><div class="progress-info">现有 '+fmt(p.stock)+' 片 · 目标 '+fmt(p.target)+' 片</div></div></div><div class="planned '+(p.shortage?'purple':'green')+'">'+(p.shortage?'建议 '+fmt(p.shortage)+' 片':'✓ 暂时充足')+'</div></div>';
 const nextRow=p.next?'<div class="plan-row"><div class="plan-left"><span class="dot">'+p.next+'</span><div><b>下一尺码提前关注</b><div class="progress-info">已有 '+fmt(p.stockOf(p.next))+' 片 · 暂不建议大量囤货</div></div></div><div class="planned">按需试用</div></div>':'';
 const goalBudget=money(p.shortage*(number(state.goalPrice)||1.5));
 const shopping='<h3 class="section-title">建议优先安排</h3>'+currentRow+nextRow+'<div class="tip" style="margin-top:15px"><b>当前尺码粗略补货预算：'+goalBudget+'</b><br>仅按目标单价估算，不代表最低实付价。</div>';
 const tips='<h3 class="section-title">当前使用建议</h3><div class="statline"><span class="sub">尺码决策</span><strong>'+esc(state.sizeMode==='auto'?'体重自动':'手动优先')+'</strong></div>'
 +'<div class="statline"><span class="sub">最新体重</span><strong>'+(weight?weight.weight.toFixed(2)+' kg':'尚未记录')+'</strong></div>'
 +'<div class="statline"><span class="sub">累计已花</span><strong>'+money((state.transactions||[]).filter(x=>x.type==='buy').reduce((n,x)=>n+(number(x.price)||0),0))+'</strong></div>'
 +'<div class="tip" style="margin-top:13px"><b>尺码提醒：</b>体重区间仅供参考，最终以品牌包装、腰腿贴合、是否勒痕或漏尿为准。</div>';
 const historical=p.past.map(s=>'<div class="statline"><span><b>'+s+'</b> · 已换码</span><span><strong>'+fmt(p.stockOf(s))+' 片</strong>　<button class="btn ghost sm" data-action="editstock" data-size="'+s+'">盘点</button></span></div>').join('');
 return {kpis,alert,cards,shopping,tips,historical,hasHistorical:p.past.length>0,plan:p};
}
function chart(state,range){
 let entries=measurements(state);
 if(range!=='all'){const days=range==='30'?30:90;const cutoff=Date.now()-(days-1)*86400000;entries=entries.filter(x=>Date.parse(x.date+'T12:00:00Z')>=cutoff);}
 if(!entries.length)return '<div class="empty"><b>还没有可绘制的体重记录</b>保存出生体重或新增一次测量后即可查看曲线。</div>';
 const w=740,h=255,L=53,R=24,T=21,B=42,pw=w-L-R,ph=h-T-B;
 const ms=x=>Date.parse(x.date+'T00:00:00Z')+(x.time?Number(x.time.slice(0,2))*3600000+Number(x.time.slice(3,5))*60000:0);
 const times=entries.map(ms),start=Math.min(...times),end=Math.max(...times),span=Math.max(end-start,86400000);
 const values=entries.map(x=>x.weight),lo=Math.max(0,Math.min(...values)-0.4),hi=Math.max(...values)+0.4,rangeY=Math.max(hi-lo,0.5);
 const xy=entries.map((e,i)=>({x:entries.length===1?L+pw/2:L+(times[i]-start)/span*pw,y:T+(hi-e.weight)/rangeY*ph,e}));
 const yGrid=Array.from({length:5},(_,i)=>{const val=hi-(rangeY/4)*i,y=T+ph*i;return '<line x1="'+L+'" x2="'+(w-R)+'" y1="'+y+'" y2="'+y+'" stroke="#e9eaf3"/><text x="'+(L-8)+'" y="'+(y+4)+'" font-size="12" text-anchor="end" fill="#8690a4">'+val.toFixed(1)+'</text>'}).join('');
 const line=xy.length>1?'<polyline fill="none" stroke="#7167da" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="'+xy.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ')+'"/>':'';
 const points=xy.map(p=>'<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4.5" fill="#7167da" stroke="white" stroke-width="2"><title>'+esc(p.e.date+' '+p.e.weight.toFixed(2)+'kg')+'</title></circle>').join('');
 const labels=[{x:L,text:entries[0].date},{x:L+pw,text:entries[entries.length-1].date}].filter((v,i)=>i===0||entries.length>1&&entries[0].date!==entries[entries.length-1].date).map((v,i)=>'<text x="'+v.x+'" y="'+(h-10)+'" font-size="12" text-anchor="'+(i===0?'start':'end')+'" fill="#8690a4">'+esc(v.text.slice(5))+'</text>').join('');
 return '<svg class="growth-chart" role="img" aria-label="宝宝体重趋势，单位千克，共'+entries.length+'个数据点" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'+yGrid+line+points+labels+'</svg>';
}
function history(state){
 const entries=measurements(state).slice().reverse();
 if(!entries.length)return '<div class="empty"><b>暂无测量记录</b>填写出生体重或新增一次测量。</div>';
 return '<div class="table-wrap"><table class="tbl"><thead><tr><th>日期时间</th><th>体重</th><th>备注</th><th>操作</th></tr></thead><tbody>'+entries.map(x=>'<tr><td>'+esc(x.date)+' '+esc(x.time)+'</td><td><b>'+x.weight.toFixed(2)+' kg</b></td><td>'+esc(x.note)+'</td><td>'+(x.isBirth?'<span class="fine">在宝宝资料中修改</span>':'<button class="btn ghost sm" data-action="editweight" data-id="'+esc(x.id)+'">编辑</button><button class="btn danger sm" data-action="deleteweight" data-id="'+esc(x.id)+'">删除</button>')+'</td></tr>').join('')+'</tbody></table></div>';
}
const api={SIZES,MAX_KG,dateOK,timeOK,validWeight,born,extras,replenishmentPolicy,targetForSize,measurements,latestWeight,recommendSize,effectiveSize,syncAutoSize,stockPlan,dashboard,chart,history};
if(root)root.XBGrowth=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
