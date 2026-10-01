import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const WD='http://localhost:4444', OUT=process.env.OUT, URL=''+(process.env.COMPARE_URL||'http://localhost:5173/compare')+'', EL='element-6066-11e4-a52e-4f735466cecf';
const BODY=readFileSync(new URL('./inject-body.js', import.meta.url),'utf8');
const PRESETS=['desktopMedium','desktopSmall','mobile','mobileLarge','mobileCompact'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wd=async(m,p,b)=>{const r=await(await fetch(WD+p,{method:m,headers:{'content-type':'application/json'},body:b&&JSON.stringify(b)})).json();if(r.value?.error)throw new Error(JSON.stringify(r.value).slice(0,400));return r.value;};
mkdirSync(OUT,{recursive:true});
const {sessionId:s}=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari',platformName:'iOS','safari:deviceUDID':process.env.IPHONE_UDID}}});
const js=(script,args=[])=>wd('POST',`/session/${s}/execute/sync`,{script,args});
const ajs=(script)=>wd('POST',`/session/${s}/execute/async`,{script:`const done=arguments[arguments.length-1];(async()=>{${script}})().then(v=>done(v),e=>done('ERR '+e.message))`,args:[]});
const load=async()=>{await wd('POST',`/session/${s}/url`,{url:URL});await sleep(5000);};
const pick=async(preset)=>{await js(`const sel=document.querySelector('.compare__controls label:first-child select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,arguments[0]);sel.dispatchEvent(new Event('change',{bubbles:true}));`,[preset]);await sleep(800);
 for(let t=0;t<180;t++){if(await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length>=6`))break;await sleep(500);}await sleep(1500);};
const shoot=async(tag)=>{const stacks=await wd('POST',`/session/${s}/elements`,{using:'css selector',value:'section[data-renderer] .compare__stack'});
 const meta=await js(`return [...document.querySelectorAll('section[data-renderer] .compare__stack')].map(st=>st.closest('section').dataset.renderer+'-'+st.closest('section').dataset.ticket)`);
 for(let i=0;i<stacks.length;i++){const id=stacks[i][EL];
  const set=(dom,cv)=>js(`const st=document.querySelectorAll('section[data-renderer] .compare__stack')[arguments[0]];st.scrollIntoView({block:'center'});st.querySelector('.ticketCard').style.visibility=arguments[1];const c=st.querySelector('canvas');c.style.opacity=arguments[2];c.style.mixBlendMode='normal';`,[i,dom,cv]);
  await set('visible','0');await sleep(400);writeFileSync(`${OUT}/${tag}-${meta[i]}-dom.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
  await set('hidden','1');await sleep(400);writeFileSync(`${OUT}/${tag}-${meta[i]}-cv.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
  await set('visible','1');}};
const raster=(mode)=>ajs(`${BODY}; window.__deltas=[]; for (const w of document.querySelectorAll('section[data-renderer="full"] .compare__stack')) await window.__raster(w.querySelector('.ticketCard'), w.querySelector('canvas'), '${mode}'); return JSON.stringify(window.__deltas);`);

const CASES={
 base:[[],''],
 s6a_noBadges:[[],'.ticketCard_win .ticketCard__badgeHost{display:none!important}'],
 s6b_noLabel:[[],'.ticketCard_win .ticketCard__badgeLabel{display:none!important}'],
 s6c_noDiscImg:[[],'.ticketCard_win .ticketCard__badgeHost{background-image:none!important}'],
 s6d_goldPlainBg:[[],'.ticketCard_win{background:#f8eadb!important}.ticketCard_win .ticketCard__body{background:linear-gradient(180deg,#ffffff 0%,#f3eae0 100%)!important}'],
 s6e_normalGoldBg:[[],'.ticketCard:not(.ticketCard_win):not(.ticketCard_disabled){background:#ffd65c!important}'],
 s2_noFill:[[],'.ticketCard__multiplierFill{visibility:hidden!important}'],
 s2_noStroke:[[],'.ticketCard__multiplierStroke{visibility:hidden!important}'],
 s2_noShadow:[[],'.ticketCard__multiplierShadow{visibility:hidden!important}'],
 s2_noRotate:[[],'.ticketCard__multiplier{transform:none!important}']
};
const applyText=(edits)=>js(`for(const st of document.querySelectorAll('section[data-renderer="full"] .compare__stack')){const t=st.closest('section').dataset.ticket,c=st.querySelector('.ticketCard');for(const k of ['win','id']){const el=c.querySelector('.ticketCard__'+k);const n=[...el.childNodes].find(x=>x.nodeType===3);el.dataset.orig??=n.data;n.data=el.dataset.orig;}for(const [tk,k,v] of arguments[0])if(tk===t){const el=c.querySelector('.ticketCard__'+k);[...el.childNodes].find(x=>x.nodeType===3).data=v;}}`,[edits]);
const styles=()=>js(`return [...document.querySelectorAll('section[data-renderer="full"] .ticketCard')].map(c=>{const g=(s,ps)=>{const cs=getComputedStyle(c.querySelector(s));return ps.map(p=>cs[p]).join(' ')};return g('.ticketCard__id',['color','fontSize','lineHeight','height','justifyContent'])+' | '+g('.ticketCard__win',['color','visibility','height'])+' | idRect '+(()=>{const r=c.querySelector('.ticketCard__id').getBoundingClientRect(),cr=c.getBoundingClientRect();return [r.left-cr.left,r.top-cr.top,r.width,r.height].map(v=>+(v*3).toFixed(3)).join(',')})()})`);
const setCss=css=>js(`let e=document.getElementById('s4');if(!e){e=document.createElement('style');e.id='s4';document.head.append(e);}e.textContent=arguments[0];`,[css]);
const env=()=>js(`return {dpr:devicePixelRatio,vw:innerWidth,vh:innerHeight,sy:scrollY,rects:[...document.querySelectorAll('section[data-renderer="full"] .ticketCard')].map(c=>{const r=c.getBoundingClientRect();return [r.left+scrollX,r.top+scrollY,r.width,r.height].map(v=>+(v*devicePixelRatio).toFixed(4))}),imgs:[...document.images].every(i=>i.complete),fonts:document.fonts.status}`);
const shootFull=async(tag)=>{const stacks=await wd('POST',`/session/${s}/elements`,{using:'css selector',value:'section[data-renderer="full"] .compare__stack'});
 const meta=await js(`return [...document.querySelectorAll('section[data-renderer="full"] .compare__stack')].map(st=>st.closest('section').dataset.ticket)`);
 for(let i=0;i<stacks.length;i++){const id=stacks[i][EL];
  const set=(dom,cv)=>js(`const st=document.querySelectorAll('section[data-renderer="full"] .compare__stack')[arguments[0]];st.scrollIntoView({block:'center'});st.querySelector('.ticketCard').style.visibility=arguments[1];const c=st.querySelector('canvas');c.style.opacity=arguments[2];c.style.mixBlendMode='normal';`,[i,dom,cv]);
  await set('visible','0');await sleep(400);writeFileSync(`${OUT}/${tag}-${meta[i]}-dom.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
  await set('hidden','1');await sleep(400);writeFileSync(`${OUT}/${tag}-${meta[i]}-cv.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
  await set('visible','1');}};
try{
 await load();
 for(const p of PRESETS){await pick(p);
  await setCss(''); await shootFull(`A-${p}`);
  for(const [name,[edits,css='']] of Object.entries(CASES)){
   await setCss(css); await applyText(edits); await sleep(300);
   writeFileSync(`${OUT}/${name}-${p}-styles.json`,JSON.stringify(await styles()));
   const r=await raster('zoom'); if(String(r).startsWith('ERR'))throw new Error(name+' '+r);
   await sleep(400); writeFileSync(`${OUT}/${name}-${p}-env.json`,JSON.stringify(await env()));
   await shootFull(`${name}-${p}`);
  }
  await setCss(''); await applyText([]); console.log('S5',p);
 }
}finally{await wd('DELETE',`/session/${s}`).catch(()=>{});}
