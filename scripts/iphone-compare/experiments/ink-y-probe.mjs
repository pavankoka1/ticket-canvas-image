/** DOM vs optimized canvas ink row probe (physical iPhone). */
const WD = 'http://localhost:4444';
const URL = process.env.COMPARE_URL || 'http://192.168.1.37:5173/compare';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wd = async (m, p, b) => {
  const r = await (await fetch(WD + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  if (r.value?.error) throw new Error(JSON.stringify(r.value).slice(0, 500));
  return r.value;
};

const { sessionId: s } = await wd('POST', '/session', {
  capabilities: { alwaysMatch: { browserName: 'safari', platformName: 'iOS', 'safari:deviceUDID': process.env.IPHONE_UDID } },
});
const js = (script, args = []) => wd('POST', `/session/${s}/execute/sync`, { script, args });

const probe = `
const dpr = devicePixelRatio;
const inkTop = (text, card, i = 0) => {
  const e = text.getExtentOfChar(i);
  const m = text.getScreenCTM();
  const cr = card.getBoundingClientRect();
  const p = new DOMPoint(e.x, e.y).matrixTransform(m);
  return (p.y - cr.top) * dpr;
};
const rowInkY = (ctx, w, y0, y1) => {
  const d = ctx.getImageData(0, y0, w, y1 - y0).data;
  let bestY = -1, best = 0;
  for (let y = 0; y < y1 - y0; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 32) s++;
    }
    if (s > best) { best = s; bestY = y0 + y; }
  }
  return bestY;
};
const out = [];
for (const sec of document.querySelectorAll('section[data-renderer=optimized]')) {
  const card = sec.querySelector('.ticketCard');
  const canvas = sec.querySelector('canvas');
  const overlay = card.querySelector('.ticketCard__svgOverlay');
  const idText = [...overlay.querySelectorAll('text')].find((t) => t.getAttribute('text-anchor') === 'end');
  const numText = [...overlay.querySelectorAll('text')].find((t) => t.getAttribute('text-anchor') === 'middle');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const hh = Math.round(parseFloat(card.style.getPropertyValue('--ticket-header-height')) * dpr);
  out.push({
    ticket: sec.dataset.ticket,
    domIdTop: idText ? +inkTop(idText, card, 0).toFixed(2) : null,
    domNumTop: numText ? +inkTop(numText, card, 0).toFixed(2) : null,
    cvIdRow: rowInkY(ctx, w, 0, hh + 6),
    cvNumRow: rowInkY(ctx, w, hh, hh + Math.round(canvas.height * 0.35)),
  });
}
return out;
`;

try {
  await wd('POST', `/session/${s}/url`, { url: URL });
  await sleep(6000);
  await js(`const m=document.querySelector('select option[value="svg-all"]').parentElement;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(m,'svg-all');m.dispatchEvent(new Event('change',{bubbles:true}));`);
  await js(`const sel=document.querySelector('.compare__controls label:first-of-type select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,'mobileLarge');sel.dispatchEvent(new Event('change',{bubbles:true}));`);
  for (let t = 0; t < 90; t++) {
    if (await js(`return document.querySelectorAll('section[data-renderer=optimized] canvas[data-ready="true"]').length>=3`)) break;
    await sleep(400);
  }
  await sleep(3000);
  console.log(JSON.stringify(await js(probe), null, 2));
} finally {
  await wd('DELETE', `/session/${s}`).catch(() => {});
}
