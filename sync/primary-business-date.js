/* P4-04C-01: China Standard Time calendar day; original UTC timestamps are immutable. */
(function(root){
 'use strict';
 const formatter=new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
 });
 function fromTimestamp(timestamp){
  const instant=new Date(timestamp);
  if(!Number.isFinite(instant.getTime()))
   throw Error('primary_business_date:invalid_timestamp');
  const parts=formatter.formatToParts(instant);
  const field=type=>parts.find(x=>x.type===type)?.value;
  return field('year')+'-'+field('month')+'-'+field('day');
 }
 const api=Object.freeze({fromTimestamp});
 if(root)root.XBPrimaryBusinessDate=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
