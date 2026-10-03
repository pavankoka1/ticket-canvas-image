/** G1: svg-all optimized row vs live DOM, all presets (physical iPhone). */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const WD = 'http://localhost:4444';
const OUT = process.env.OUT;
const URL = `${process.env.COMPARE_URL || 'http://localhost:5173/compare'}`;
const EL = 'element-6066-11e4-a52e-4f735466cecf';
const PRESETS = ['desktopMedium', 'desktopSmall', 'mobile', 'mobileLarge', 'mobileCompact'];
const MODE = 'svg-all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wd = async (m, p, b) => {
  const r = await (await fetch(WD + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  if (r.value?.error) throw new Error(JSON.stringify(r.value).slice(0, 400));
  return r.value;
};

mkdirSync(OUT, { recursive: true });
const caps = process.env.SIM ? { 'safari:useSimulator': true } : { 'safari:deviceUDID': process.env.IPHONE_UDID };
const { sessionId: s } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari', platformName: 'iOS', ...caps } } });
const js = (script, args = []) => wd('POST', `/session/${s}/execute/sync`, { script, args });

const waitForModeOption = async () => {
  for (let t = 0; t < 120; t++) {
    if (await js(`return !!document.querySelector('select option[value="${MODE}"]')`)) return;
    await sleep(500);
  }
  throw new Error(`option ${MODE} never appeared`);
};

const setSelect = (kind, value) =>
  js(
    `const kind=arguments[1];
const sel=kind==='preset'
  ? document.querySelector('.compare__controls label:first-of-type select')
  : document.querySelector('select option[value="${MODE}"]').parentElement;
if(!sel) throw new Error('select missing: '+kind);
Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,arguments[0]);
sel.dispatchEvent(new Event('change',{bubbles:true}));`,
    [value, kind],
  );

const setPreset = (preset) => setSelect('preset', preset);

const assertSvgAll = () =>
  js(
    `const stacks=[...document.querySelectorAll('section[data-renderer]')];
if(stacks.length!==6) return {ok:false,why:'stacks'};
for(const st of stacks){
 if(st.dataset.renderMode!=='svg-all') return {ok:false,why:'mode',ticket:st.dataset.ticket,mode:st.dataset.renderMode};
 const card=st.querySelector('.ticketCard');
 if(!card?.querySelector('.ticketCard__svgOverlay')) return {ok:false,why:'overlay',ticket:st.dataset.ticket};
}
return {ok:true};`,
  );

try {
  await wd('POST', `/session/${s}/url`, { url: URL });
  await sleep(5000);
  await waitForModeOption();
  await setSelect('mode', MODE);
  await sleep(1500);

  if (process.env.WARM) {
    for (const preset of PRESETS) {
      await setPreset(preset);
      await sleep(800);
      for (let t = 0; t < 180; t++) {
        if (await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length>=6`)) break;
        await sleep(500);
      }
    }
    await wd('POST', `/session/${s}/url`, { url: URL });
    await sleep(5000);
    await waitForModeOption();
    await setSelect('mode', MODE);
    await sleep(1500);
  }

  for (const preset of PRESETS) {
    await setPreset(preset);
    await sleep(800);
    let ok = false;
    for (let t = 0; t < 180; t++) {
      if (await js(`return document.querySelectorAll('section[data-renderer] canvas[data-ready="true"]').length>=6`)) {
        ok = true;
        break;
      }
      await sleep(500);
    }
    const modeCheck = await assertSvgAll();
    if (!modeCheck.ok) throw new Error(`svg-all assert failed ${preset}: ${JSON.stringify(modeCheck)}`);
    await sleep(1500);

    const probe = await js(`const d=devicePixelRatio;return [...document.querySelectorAll('section[data-renderer] .compare__stack')].map(st=>{const c=st.querySelector('.ticketCard'),cr=c.getBoundingClientRect();return {renderer:st.closest('section').dataset.renderer,ticket:st.closest('section').dataset.ticket,mode:st.closest('section').dataset.renderMode,dpr:d,origin:[+(cr.left*d).toFixed(4),+(cr.top*d).toFixed(4)],canvas:[st.querySelector('canvas').width,st.querySelector('canvas').height]}})`);
    writeFileSync(`${OUT}/${preset}-probe.json`, JSON.stringify({ ready: ok, modeCheck, probe }, null, 1));

    const stacks = await wd('POST', `/session/${s}/elements`, { using: 'css selector', value: 'section[data-renderer] .compare__stack' });
    for (let rep = 0; rep < 3; rep++)
      for (let i = 0; i < stacks.length; i++) {
        const id = stacks[i][EL];
        const tag = `${preset}-${probe[i].renderer}-${probe[i].ticket}-r${rep}`;
        const set = (dom, cv) =>
          js(
            `const st=document.querySelectorAll('section[data-renderer] .compare__stack')[arguments[0]];st.scrollIntoView({block:'center'});st.querySelector('.ticketCard').style.visibility=arguments[1];const c=st.querySelector('canvas');c.style.opacity=arguments[2];c.style.mixBlendMode='normal';`,
            [i, dom, cv],
          );
        await set('visible', '0');
        await sleep(400);
        writeFileSync(`${OUT}/${tag}-dom.png`, Buffer.from(await wd('GET', `/session/${s}/element/${id}/screenshot`), 'base64'));
        await set('hidden', '1');
        await sleep(400);
        writeFileSync(`${OUT}/${tag}-cv.png`, Buffer.from(await wd('GET', `/session/${s}/element/${id}/screenshot`), 'base64'));
        await set('visible', '1');
      }
    console.log('done', preset, 'ready', ok, 'mode', modeCheck.ok);
  }
} finally {
  await wd('DELETE', `/session/${s}`).catch(() => {});
}
