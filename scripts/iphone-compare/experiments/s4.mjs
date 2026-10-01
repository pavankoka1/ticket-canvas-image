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
 base:'',
 solidHeader:'.ticketCard_win .ticketCard__header{background:#ffd65c!important}',
 noOverflow:'.ticketCard__header{overflow:visible!important}',
 noRadius:'.ticketCard__header{border-radius:0!important}',
 noBoth:'.ticketCard__header{overflow:visible!important;border-radius:0!important}',
 gradOnNormal:'.ticketCard:not(.ticketCard_win) .ticketCard__header{background:linear-gradient(180deg,#ffefa5 0%,#ffd65c 100%)!important}',
};
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
  for(const [name,css] of Object.entries(CASES)){
   await setCss(css); await sleep(300);
   const r=await raster('zoom'); if(String(r).startsWith('ERR'))throw new Error(name+' '+r);
   await sleep(400); writeFileSync(`${OUT}/${name}-${p}-env.json`,JSON.stringify(await env()));
   await shootFull(`${name}-${p}`);
  }
  await setCss(''); console.log('S4',p);
 }
}finally{await wd('DELETE',`/session/${s}`).catch(()=>{});}
