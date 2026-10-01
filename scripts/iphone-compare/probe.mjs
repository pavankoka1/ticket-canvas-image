// canvas-dom-pixels probe for every /compare stack on a physical iPhone (Safari WebDriver).
// Env: IPHONE_UDID, COMPARE_URL, OUT (json path). Optional PRESET.
// Records the skill's required fields plus the ancestor transform/zoom chain, so a
// transformed rectangle is never mistaken for a layout origin, and compare cache state.
import { writeFileSync } from 'node:fs';

const WD = 'http://localhost:4444';
const URL = process.env.COMPARE_URL || 'http://localhost:5173/compare';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wd = async (m, p, b) => {
  const r = await (await fetch(WD + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  if (r.value?.error) throw new Error(JSON.stringify(r.value).slice(0, 400));
  return r.value;
};
const { sessionId: s } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari', platformName: 'iOS', 'safari:deviceUDID': process.env.IPHONE_UDID } } });
const ajs = script => wd('POST', `/session/${s}/execute/async`, { script: `const done=arguments[arguments.length-1];(async()=>{${script}})().then(done,e=>done('ERR '+e.message))`, args: [] });
try {
  await wd('POST', `/session/${s}/url`, { url: URL });
  await sleep(5000);
  if (process.env.PRESET) {
    await ajs(`const sel=document.querySelector('.compare__controls label:first-child select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,${JSON.stringify(process.env.PRESET)});sel.dispatchEvent(new Event('change',{bubbles:true}));`);
    await sleep(8000);
  }
  const result = await ajs(`
    await document.fonts.ready;
    const dpr = devicePixelRatio;
    const chain = el => { const out = []; for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.transform !== 'none' || (cs.zoom && cs.zoom !== '1' && cs.zoom !== 'normal') || cs.position !== 'static')
        out.push({ node: n.className || n.tagName, position: cs.position, left: n.style.left || cs.left, top: n.style.top || cs.top, transform: cs.transform, zoom: cs.zoom }); }
      return out; };
    const dpcb = el => new Promise(res => { if (!('ResizeObserver' in window)) return res(null);
      const ro = new ResizeObserver(e => { ro.disconnect(); const b = e[0].devicePixelContentBoxSize?.[0]; res(b ? { inline: b.inlineSize, block: b.blockSize } : null); });
      try { ro.observe(el, { box: 'device-pixel-content-box' }); } catch { res(null); } setTimeout(() => res(null), 500); });
    const stacks = [...document.querySelectorAll('section[data-renderer] .compare__stack')];
    const rows = [];
    for (const st of stacks) {
      const card = st.querySelector('.ticketCard'), c = st.querySelector('canvas');
      const r = card.getBoundingClientRect(), cr = c.getBoundingClientRect();
      rows.push({
        renderer: st.closest('section').dataset.renderer, ticket: st.closest('section').dataset.ticket,
        dpr, zoom: outerWidth / innerWidth,
        rect: { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height },
        rectDevice: [(r.left + scrollX) * dpr, (r.top + scrollY) * dpr],
        devicePixelContentBox: await dpcb(c),
        canvas: { width: c.width, height: c.height },
        drawingBuffer: { width: c.width, height: c.height },
        overlayRect: { left: cr.left - r.left, top: cr.top - r.top, width: cr.width, height: cr.height },
        targetCanvasPoint: { x: 0, y: 0 },
        ancestors: chain(card),
      });
    }
    const keys = await new Promise(res => { const q = indexedDB.open('bingo-cell-atlas'); q.onerror = () => res(null);
      q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('atlases')) return res([]);
        const k = db.transaction('atlases').objectStore('atlases').getAllKeys(); k.onsuccess = () => res(k.result.map(String)); k.onerror = () => res(null); }; });
    const prefixes = {}; for (const k of keys || []) { const p = k.split('|')[0]; prefixes[p] = (prefixes[p] || 0) + 1; }
    return JSON.stringify({ when: new Date().toISOString(), ua: navigator.userAgent, viewport: [innerWidth, innerHeight], scroll: [scrollX, scrollY], cache: prefixes, rows });
  `);
  writeFileSync(process.env.OUT, result);
  console.log(String(result).slice(0, 300));
} finally {
  await wd('DELETE', `/session/${s}`).catch(() => {});
}
