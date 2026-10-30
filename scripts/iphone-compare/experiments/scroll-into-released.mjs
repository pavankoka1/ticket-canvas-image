/** Scrolling into a region whose tile gave its pixels back: how long is it blank? */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');
const SLOWDOWN = Number(process.env.SLOWDOWN || '1');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__probe = () => {
    const scroll = document.querySelector('.ticketCatalog');
    const box = scroll.getBoundingClientRect();
    let domInView = 0;
    for (const card of document.querySelectorAll('.catalog__dom .ticketCard')) {
      const r = card.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom || r.width === 0) continue;
      domInView += 1;
    }
    const host = document.querySelector('.catalog__canvas');
    let rows = 0;
    let lit = 0;
    for (const tile of host.querySelectorAll('canvas')) {
      const r = tile.getBoundingClientRect();
      const top = Math.max(r.top, box.top);
      const bottom = Math.min(r.bottom, box.bottom);
      if (bottom - top < 4 || tile.width === 0) continue;
      const c2d = tile.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 5; i++) {
        const y = Math.floor((top - r.top + ((bottom - top) * (i + 0.5)) / 5) * (tile.height / r.height));
        const row = c2d.getImageData(0, Math.min(y, tile.height - 1), tile.width, 1).data;
        rows += 1;
        let on = 0;
        for (let p = 3; p < row.length; p += 4) if (row[p] > 8) on += 1;
        if (on > tile.width / 20) lit += 1;
      }
    }
    return { top: Math.round(scroll.scrollTop), domInView, rows, lit };
  };
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);
for (let i = 0; i < 10; i++) {
  await page.click('[data-add-count="100"]');
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(1500);
console.log('1000 tickets ready');

if (SLOWDOWN > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
  console.log(`CPU throttled ${SLOWDOWN}×`);
}

const jumpTo = async (label, top) => {
  await page.evaluate((t) => document.querySelector('.ticketCatalog').scrollTo({ top: t }), top);
  const frames = [];
  for (let i = 0; i < 14; i++) {
    frames.push(await page.evaluate(() => window.__probe()));
    await page.waitForTimeout(60);
  }
  const covered = frames.map((f) => (f.domInView > 0 || f.lit > 0 ? '#' : '.')).join('');
  const firstCovered = frames.findIndex((f) => f.domInView > 0 || f.lit > 0);
  console.log(
    `${label} (top=${top}): ${covered}  first painted ~${firstCovered < 0 ? 'never' : `${firstCovered * 60}ms`}`,
  );
};

await jumpTo('jump to middle  ', 9000);
await jumpTo('jump to top     ', 0);
await jumpTo('jump to bottom  ', 20000);
await jumpTo('jump back middle', 9000);

await browser.close();
