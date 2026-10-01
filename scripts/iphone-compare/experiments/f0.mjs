import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const WD='http://localhost:4444', OUT=process.env.OUT, URL=''+(process.env.COMPARE_URL||'http://localhost:5173/compare')+'', EL='element-6066-11e4-a52e-4f735466cecf';
const PRESETS=['desktopMedium','desktopSmall','mobile','mobileLarge','mobileCompact'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wd=async(m,p,b)=>{const r=await(await fetch(WD+p,{method:m,headers:{'content-type':'application/json'},body:b&&JSON.stringify(b)})).json();if(r.value?.error)throw new Error(JSON.stringify(r.value).slice(0,400));return r.value;};
mkdirSync(OUT,{recursive:true});
const caps=process.env.SIM?{'safari:useSimulator':true}:{'safari:deviceUDID':process.env.IPHONE_UDID};
const {sessionId:s}=await wd('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari',platformName:'iOS',...caps}}});
const js=(script,args=[])=>wd('POST',`/session/${s}/execute/sync`,{script,args});
try{
 await wd('POST',`/session/${s}/url`,{url:URL}); await sleep(5000);
 const idbKeys=()=>wd('POST',`/session/${s}/execute/async`,{script:`const done=arguments[0];const q=indexedDB.open('bingo-cell-atlas');q.onsuccess=()=>{const db=q.result;if(!db.objectStoreNames.contains('atlases'))return done([]);const k=db.transaction('atlases').objectStore('atlases').getAllKeys();k.onsuccess=()=>done(k.result.map(String).filter(x=>x.startsWith('compare-sprites')).length)};q.onerror=()=>done(-1)`,args:[]});
 if(process.env.WARM){ // warm every preset, then reload in the same session so captures can reuse stored sprites
  for(const preset of PRESETS){await js(`const sel=document.querySelector('.compare__controls label:first-child select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,arguments[0]);sel.dispatchEvent(new Event('change',{bubbles:true}));`,[preset]);await sleep(800);for(let t=0;t<180;t++){if(await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length>=6`))break;await sleep(500);}}
  const before=await idbKeys(); await wd('POST',`/session/${s}/url`,{url:URL}); await sleep(5000);
  writeFileSync(`${OUT}/cache.json`,JSON.stringify({mode:'warm',keysBeforeReload:before}));
 } else writeFileSync(`${OUT}/cache.json`,JSON.stringify({mode:'cold',keysAtStart:await idbKeys()}));
 for(const preset of PRESETS){
  await js(`const sel=document.querySelector('.compare__controls label:first-child select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,arguments[0]);sel.dispatchEvent(new Event('change',{bubbles:true}));`,[preset]);
  await sleep(800);
  let ok=false; for(let t=0;t<180;t++){if(await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length>=6`)){ok=true;break;}await sleep(500);}
  await sleep(1500);
  const probe=await js(`const d=devicePixelRatio;return [...document.querySelectorAll('section[data-renderer] .compare__stack')].map(st=>{const c=st.querySelector('.ticketCard'),cr=c.getBoundingClientRect(),rel=e=>{const r=e.getBoundingClientRect();return [r.left-cr.left,r.top-cr.top,r.width,r.height].map(v=>+(v*d).toFixed(4))};return {renderer:st.closest('section').dataset.renderer,ticket:st.closest('section').dataset.ticket,dpr:d,origin:[+(cr.left*d).toFixed(4),+(cr.top*d).toFixed(4)],canvas:[st.querySelector('canvas').width,st.querySelector('canvas').height],hosts:[...c.querySelectorAll('.ticketCard__badgeHost')].filter(h=>h.style.display!=='none').map(rel),mult:[...c.querySelectorAll('.ticketCard__multiplier')].map(rel)}})`);
  writeFileSync(`${OUT}/${preset}-probe.json`,JSON.stringify({ready:ok,probe},null,1));
  const stacks=await wd('POST',`/session/${s}/elements`,{using:'css selector',value:'section[data-renderer] .compare__stack'});
  for(let rep=0;rep<3;rep++)for(let i=0;i<stacks.length;i++){
   const id=stacks[i][EL], tag=`${preset}-${probe[i].renderer}-${probe[i].ticket}-r${rep}`;
   const set=(dom,cv)=>js(`const st=document.querySelectorAll('section[data-renderer] .compare__stack')[arguments[0]];st.scrollIntoView({block:'center'});st.querySelector('.ticketCard').style.visibility=arguments[1];const c=st.querySelector('canvas');c.style.opacity=arguments[2];c.style.mixBlendMode='normal';`,[i,dom,cv]);
   await set('visible','0');await sleep(400);
   writeFileSync(`${OUT}/${tag}-dom.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
   await set('hidden','1');await sleep(400);
   writeFileSync(`${OUT}/${tag}-cv.png`,Buffer.from(await wd('GET',`/session/${s}/element/${id}/screenshot`),'base64'));
   await set('visible','1');
  }
  console.log('done',preset,'ready',ok);
 }
const fin=JSON.parse(readFileSync(`${OUT}/cache.json`,'utf8'));fin.keysAtEnd=await idbKeys();writeFileSync(`${OUT}/cache.json`,JSON.stringify(fin));console.log('cache',JSON.stringify(fin));
}finally{await wd('DELETE',`/session/${s}`).catch(()=>{});}
