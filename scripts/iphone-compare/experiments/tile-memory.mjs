/** Canvas backing-store footprint of the tile pool as tickets accumulate. */
import { chromium } from 'playwright-core';

const URL = process.env.CATALOG_URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || '3');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => [...document.querySelectorAll('strong')].some((e) => e.textContent === 'ready'),
  null,
  { timeout: 90000 },
);

const report = async (label) => {
  const data = await page.evaluate(() => {
    const host = document.querySelector('.catalog__canvas');
    const tiles = [...host.querySelectorAll('canvas')].map((c) => ({
      w: c.width,
      h: c.height,
      mb: (c.width * c.height * 4) / 1024 / 1024,
    }));
    const stat = [...document.querySelectorAll('.stat')].map((s) => s.textContent).join(' | ');
    return { tiles, stat, dpr: window.devicePixelRatio };
  });
  const total = data.tiles.reduce((a, t) => a + t.mb, 0);
  const biggest = data.tiles.reduce((a, t) => Math.max(a, t.mb), 0);
  console.log(
    `${label}: ${data.tiles.length} tiles, ${total.toFixed(0)} MB total, largest ${biggest.toFixed(0)} MB ` +
      `(${data.tiles[0] ? `${data.tiles[0].w}×${data.tiles[0].h}` : 'n/a'})`,
  );
  return total;
};

for (const step of [1, 2, 3, 5, 10]) {
  for (let i = 0; i < (step === 1 ? 1 : step - (step === 2 ? 1 : step === 3 ? 2 : step === 5 ? 3 : 5)); i++) {
    await page.click('[data-add-count="100"]');
    await page.waitForTimeout(1800);
  }
  await page.waitForTimeout(600);
  await report(`${step * 100} tickets`);
}

await browser.close();
