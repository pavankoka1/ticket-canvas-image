/** How much of the scrollport is painted while a +100 bulk add scrolls to the bottom? */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');
const SLOWDOWN = Number(process.env.SLOWDOWN || '1');
const TAPS = Number(process.env.TAPS || '3');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__samples = [];
  const sample = () => {
    const scroll = document.querySelector('.ticketCatalog');
    if (!scroll) return;
    const box = scroll.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.catalog__dom .ticketCard')];
    let domInView = 0;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom || r.width === 0) continue;
      domInView += 1;
    }
    // Painted canvas under the scrollport: sample the tile pixels behind it.
    let canvasInk = 0;
    let canvasRows = 0;
    const host = document.querySelector('.catalog__canvas');
    const hidden = host ? getComputedStyle(host).visibility === 'hidden' : true;
    for (const tile of host ? host.querySelectorAll('canvas') : []) {
      const r = tile.getBoundingClientRect();
      const top = Math.max(r.top, box.top);
      const bottom = Math.min(r.bottom, box.bottom);
      if (bottom - top < 4) continue;
      const scaleY = tile.height / r.height;
      const scaleX = tile.width / r.width;
      const ctx2d = tile.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 5; i++) {
        const y = Math.floor((top - r.top + ((bottom - top) * (i + 0.5)) / 5) * scaleY);
        const data = ctx2d.getImageData(0, Math.min(y, tile.height - 1), Math.floor(r.width * scaleX), 1).data;
        canvasRows += 1;
        let lit = 0;
        for (let p = 3; p < data.length; p += 4) if (data[p] > 8) lit += 1;
        if (lit > data.length / 4 / 20) canvasInk += 1;
      }
    }
    window.__samples.push({
      t: Math.round(performance.now()),
      scrollTop: Math.round(scroll.scrollTop),
      domInView,
      canvasHidden: hidden,
      canvasInk,
      canvasRows,
    });
  };
  window.__startSampling = () => {
    window.__samples = [];
    const id = setInterval(sample, 80);
    return () => clearInterval(id);
  };
  window.__sampleOnce = sample;
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);

if (SLOWDOWN > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  console.log(`CPU throttled ${SLOWDOWN}×`);
}

for (let tap = 1; tap <= TAPS; tap++) {
  await page.evaluate(() => {
    window.__stop = window.__startSampling();
  });
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(Number(process.env.GAP || '3200'));
  const samples = await page.evaluate(() => {
    window.__stop?.();
    return window.__samples.slice();
  });
  const moving = samples.filter((s, i) => i > 0 && s.scrollTop !== samples[i - 1].scrollTop);
  const blank = samples.filter((s) => s.domInView === 0 && (s.canvasHidden || s.canvasInk === 0));
  const t0 = samples[0]?.t ?? 0;
  console.log(
    `\ntap ${tap}: ${samples.length} samples, ${moving.length} while scrolling, ${blank.length} blank`,
  );
  for (const s of samples) {
    const state = s.domInView > 0 ? `dom ${s.domInView}` : s.canvasHidden ? 'CANVAS HIDDEN' : `canvas ink ${s.canvasInk}/${s.canvasRows}`;
    const flag = s.domInView === 0 && (s.canvasHidden || s.canvasInk === 0) ? '  <-- BLANK' : '';
    console.log(`  +${String(s.t - t0).padStart(4)}ms top=${String(s.scrollTop).padStart(5)} ${state}${flag}`);
  }
}

await browser.close();
