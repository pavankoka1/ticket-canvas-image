import { writeFileSync } from 'node:fs';
const wd=async(method,path,body)=>{const response=await fetch('http://localhost:4444'+path,{method,headers:{'content-type':'application/json'},body:body&&JSON.stringify(body)});const result=await response.json();if(result.value?.error)throw new Error(JSON.stringify(result.value));return result.value;};
const {sessionId}=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari',platformName:'iOS','safari:deviceUDID':process.env.IPHONE_UDID}}});
const js=(script,args=[])=>wd('POST',`/session/${sessionId}/execute/sync`,{script,args});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];
try{
 await wd('POST',`/session/${sessionId}/url`,{url:process.env.COMPARE_URL});
 await pause(4000);
 for(const preset of ['desktopSmall','mobile','desktopMedium','mobileLarge','mobileCompact']){
 await js(`const s=document.querySelector('.compare__controls select');s.value=arguments[0];s.dispatchEvent(new Event('change',{bubbles:true}));`,[preset]);
 await pause(1000);
 for(let t=0;t<80;t++){if(await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length===6`))break;await pause(250);}
 const data=await js(`const dpr=devicePixelRatio;const card=document.querySelector('section[data-renderer="full"][data-ticket="cmp-dab"] .ticketCard');const cr=card.getBoundingClientRect();
 const rows=[];
 for(const selector of ['.ticketCard__id','.ticketCard__win']){
 const el=card.querySelector(selector),cs=getComputedStyle(el),r=el.getBoundingClientRect();
 const probes=[];
 for(const zoom of [1,dpr]){
 const host=document.createElement('div');host.style.cssText='position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;zoom:'+zoom;
 const box=document.createElement('div');box.style.cssText='position:absolute;left:0;top:'+(r.top-cr.top)+'px;box-sizing:border-box;width:'+r.width+'px;height:'+r.height+'px;display:'+cs.display+';flex-direction:'+cs.flexDirection+';align-items:'+cs.alignItems+';justify-content:'+cs.justifyContent+';padding:'+cs.padding+';white-space:nowrap;font-family:'+cs.fontFamily+';font-weight:'+cs.fontWeight+';font-size:'+cs.fontSize+';line-height:'+cs.lineHeight+';letter-spacing:'+cs.letterSpacing;
 const line=document.createElement('span');line.textContent=el.textContent;const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0';line.append(marker);box.append(line);host.append(box);document.body.append(host);
 const base=(marker.getBoundingClientRect().top-host.getBoundingClientRect().top)/zoom;
 const lr=line.getBoundingClientRect();
 probes.push({zoom,baselineCss:base,baselineDevice:base*dpr,lineTop:(lr.top-host.getBoundingClientRect().top)/zoom,lineHeight:lr.height/zoom,boxHeight:box.getBoundingClientRect().height/zoom});host.remove();
 }
 const cvs=document.createElement('canvas');const ctx=cvs.getContext('2d');ctx.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;const tm=ctx.measureText(el.textContent);
 rows.push({selector,text:el.textContent,font:cs.fontSize,lineHeight:cs.lineHeight,probes,canvasMetrics:{ascent:tm.actualBoundingBoxAscent,descent:tm.actualBoundingBoxDescent,fontAscent:tm.fontBoundingBoxAscent,fontDescent:tm.fontBoundingBoxDescent}});
 }
 return {dpr,rows};`);
 results.push({preset,...data});console.log(JSON.stringify(results.at(-1)));
 }
 writeFileSync('/tmp/ticket-baseline-inspect.json',JSON.stringify(results,null,2));
}finally{await wd('DELETE',`/session/${sessionId}`).catch(()=>{});}
